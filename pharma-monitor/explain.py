"""Plain-language explanations of monitor items, written by Claude.

For each item the dashboard shows three short parts:
  about        – what the document, notice or page is
  what_changed – concretely what is new or different
  impact       – what it means for PHARMACOPOLA (wholesale distribution of human and veterinary medicines)

Runs only when ANTHROPIC_API_KEY is set (GitHub secret). Without it, or without the `anthropic` package, the
monitor works exactly as before. At most MAX_PER_RUN items are explained per run: new items first, then older
items without an explanation, newest first, so the existing list fills in over a few checks.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

import slovak

MODEL = "claude-opus-5-5"
MAX_PER_RUN = 40
DETAIL_CHARS = 12000  # how much of a "what changed" detail file is sent along (law diffs can be long)

SYSTEM = """You explain regulatory updates to the management of PHARMACOPOLA s.r.o., a Slovak wholesale \
distributor of human and veterinary medicines, medical devices and related products (good distribution practice \
= SDP/GDP, ŠÚKL and ÚŠKVBL licences, FMD/medicines verification, reimbursement and prices).

For the item you are given, write three short parts in plain English (the readers are pharmacists, not lawyers):
- about: what this document, notice or web page is, in one or two sentences. Name the issuer and the subject.
- what_changed: concretely what is new or different, in one to three sentences. Use the facts given (provisions,
  dates, products, ŠÚKL codes, stage of a draft law). If the input only shows that a page changed, say what was
  added or removed. Never invent facts that are not in the input; if something is unclear, say so briefly.
- impact: one or two sentences on what it means for a wholesale distributor like PHARMACOPOLA and whether any
  action is needed (e.g. check stock, update an SOP, inform customers, watch the deadline). If it does not concern
  a distributor, say "No direct impact on distribution." and why in a few words.
Keep Slovak names of laws, institutions and products as they are.
Then give the same three parts in Slovak under "sk" (natural Slovak for pharmacists, same content)."""

SCHEMA = {
    "type": "object",
    "properties": {
        "about": {"type": "string"},
        "what_changed": {"type": "string"},
        "impact": {"type": "string"},
        "sk": {
            "type": "object",
            "properties": {"about": {"type": "string"}, "what_changed": {"type": "string"}, "impact": {"type": "string"}},
            "required": ["about", "what_changed", "impact"],
            "additionalProperties": False,
        },
    },
    "required": ["about", "what_changed", "impact", "sk"],
    "additionalProperties": False,
}


def item_prompt(item: dict, here: Path) -> str:
    parts = [f"Source: {item.get('source_name', item.get('source'))}",
             f"Category: {item.get('category', '')}",
             f"Date: {item.get('date', '')[:10]}",
             f"Title: {item.get('title', '')}",
             f"Link: {item.get('url', '')}",
             f"Summary from the monitor: {item.get('summary', '')}"]
    if item.get("effective"):
        parts.append(f"In force from: {', '.join(item['effective'])}")
    if item.get("deadline"):
        parts.append(f"Comment deadline: {item['deadline']}")
    if item.get("details"):
        try:
            detail = json.loads((here / item["details"]).read_text(encoding="utf-8"))
            text = json.dumps(detail, ensure_ascii=False)
            if len(text) > DETAIL_CHARS:
                text = text[:DETAIL_CHARS] + " … (cut)"
            parts.append(f"Details of what changed (JSON): {text}")
        except (OSError, ValueError):  # unreadable or not JSON (incl. bad UTF-8): explain from the summary alone
            pass
    return "\n".join(parts)


def explain_one(client, item: dict, here: Path) -> dict | None:
    """One request; returns {"about", "what_changed", "impact"} or None if Claude declined."""
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=4000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",  # if a safety classifier declines, the API retries on a fallback model in the same call
        system=SYSTEM,
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": item_prompt(item, here)}],
    )
    if response.stop_reason == "refusal":
        return None
    text = next((b.text for b in response.content if b.type == "text"), "")
    data = json.loads(text)
    data["usage"] = (response.usage.input_tokens, response.usage.output_tokens)
    return data


def pick(items: list[dict], new_ids: set[str], limit: int) -> list[dict]:
    """New items first, then older ones without an explanation, newest first."""
    todo = sorted((i for i in items if ("explain" not in i or i["explain"].get("auto"))  # free ones get upgraded
                   and not (i.get("explain") or {}).get("declined")),
                  key=lambda i: i.get("date", ""), reverse=True)
    todo.sort(key=lambda i: i["id"] not in new_ids)  # stable: new items first, each group newest first
    return todo[:limit]


def explain_items(items: list[dict], new_ids: set[str], here: Path, client=None, limit: int = MAX_PER_RUN) -> int:
    """Adds item["explain"] in place to at most `limit` items. Returns how many items were explained."""
    if client is None:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            print("Explanations: skipped (no ANTHROPIC_API_KEY).")
            return 0
        try:
            import anthropic
        except ImportError:
            print("Explanations: skipped (the anthropic package is not installed).")
            return 0
        client = anthropic.Anthropic(max_retries=3)
    done, tokens_in, tokens_out = 0, 0, 0
    for item in pick(items, new_ids, limit):
        try:
            result = explain_one(client, item, here)
        except Exception as e:  # one failure must not stop the check; the item is tried again next run
            print(f"  ! explanation for {item['id']}: {type(e).__name__}: {str(e)[:200]}", file=sys.stderr)
            if type(e).__name__ in ("AuthenticationError", "PermissionDeniedError"):
                break  # a wrong key fails every request
            continue
        if result is None:
            item["explain"] = {**free(item), "declined": True}  # keeps the free explanation, not retried
            continue
        tin, tout = result.pop("usage")
        tokens_in, tokens_out = tokens_in + tin, tokens_out + tout
        parts = ("about", "what_changed", "impact")
        item["explain"] = {k: str(result[k]).strip() for k in parts}
        sk = result.get("sk") or {}
        if all(sk.get(k) for k in parts):
            item["explain"]["sk"] = {k: str(sk[k]).strip() for k in parts}
        done += 1
    if done:
        cost = tokens_in / 1e6 * 4 + tokens_out / 1e6 * 20  # Claude Opus 5.5 list prices, USD
        print(f"Explanations: {done} item(s), {tokens_in} input + {tokens_out} output tokens ≈ ${cost:.2f}")
    return done


# --------------------------------------------------------------------------- free explanations (no API key)
# Built by rules from what the monitor already knows. Stored with "auto": True; a Claude explanation, when an API
# key is set, replaces them. Recomputed every run, so improving these rules updates the whole list.

def _short(text: str, n: int = 320) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= n else text[: n - 1].rsplit(" ", 1)[0] + "…"


def _date(iso: str | None) -> str:
    return f"{iso[8:10]}.{iso[5:7]}.{iso[:4]}" if iso and len(iso) >= 10 else ""


def _field(text: str, label: str) -> str:
    import re
    m = re.search(rf"{re.escape(label)}: ([^·|]+)", text or "")
    return m.group(1).strip() if m else ""


def _fold(text: str) -> str:
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFKD", text or "") if not unicodedata.combining(c)).lower()


NOTICE_LABELS = {"Typ oznámenia": "Type", "Platnosť od": "Valid from", "Dátum hlásenia": "Reported",
                 "Predpokladaný termín obnovenia": "Expected resumption", "Kód ŠÚKL": "ŠÚKL code", "Poznámka": "Note",
                 "Prerušenie": "Interruption", "Obnovenie": "Resumption", "Zrušenie": "End of supply",
                 "Prvé uvedenie": "First placed on the market"}
DRAFT_KINDS = {"zakon": ("Draft act", "Návrh zákona"), "vyhlaska": ("Draft decree", "Návrh vyhlášky"),
               "nariadenie vlady": ("Draft government regulation", "Návrh nariadenia vlády"),
               "opatrenie": ("Draft measure", "Návrh opatrenia"),
               "akt eu": ("EU act handled by a Slovak ministry", "Akt EÚ v gescii slovenského ministerstva")}


def _english_notice(text: str) -> str:
    for sk, en in NOTICE_LABELS.items():
        text = text.replace(sk, en)
    return text


SUPPLY_IMPACT = {
    "prerusenie": ("Supply of this product is interrupted: check your stock, tell affected customers and plan an alternative.",
                   "Dodávky lieku sú prerušené: skontrolujte zásoby, informujte dotknutých odberateľov a pripravte náhradu."),
    "obnovenie": ("Supply resumes: the product can be ordered again from the date given.",
                  "Dodávky sa obnovujú: liek bude možné znovu objednať od uvedeného dátumu."),
    "zrusenie": ("Supply ends: plan a replacement and run down the remaining stock.",
                 "Dodávky končia: pripravte náhradu a dopredajte zostávajúce zásoby."),
    "prve-uvedenie": ("New product on the Slovak market: consider adding it to your range.",
                      "Nový liek na slovenskom trhu: zvážte jeho zaradenie do sortimentu."),
}
CATEGORY_IMPACT = {
    "Recall / quality": ("Check your stock for the affected batches, block them, follow ŠÚKL's instructions and inform your customers.",
                         "Skontrolujte zásoby dotknutých šarží, zablokujte ich, postupujte podľa pokynov ŠÚKL a informujte odberateľov."),
    "Supply disruption": ("Concerns medicine availability: check whether products you distribute are affected.",
                          "Týka sa dostupnosti liekov: skontrolujte, či sa týka liekov, ktoré distribuujete."),
    "Distribution & pharmacies": ("Concerns wholesale distribution or pharmacies directly: read it and check your procedures.",
                                  "Priamo sa týka veľkodistribúcie alebo lekární: prečítajte si to a skontrolujte svoje postupy."),
    "Drug safety": ("Safety information: check whether it concerns products you distribute and pass it on if required.",
                    "Bezpečnostná informácia: skontrolujte, či sa týka liekov, ktoré distribuujete, a ak treba, odovzdajte ju ďalej."),
    "Medical devices": ("Concerns medical devices: check whether it affects devices you distribute.",
                        "Týka sa zdravotníckych pomôcok: skontrolujte, či sa týka pomôcok, ktoré distribuujete."),
    "Reimbursement & prices": ("Update prices and reimbursement in your system from the date it applies.",
                               "Aktualizujte ceny a úhrady vo svojom systéme od dátumu platnosti."),
    "EU legislation": ("EU law: check whether Slovak rules or your procedures will have to follow.",
                       "Právo EÚ: skontrolujte, či sa mu budú musieť prispôsobiť slovenské predpisy alebo vaše postupy."),
    "Animal health (ŠVPS)": ("May change demand for veterinary medicines or vaccines in the affected areas.",
                             "Môže zmeniť dopyt po veterinárnych liekoch alebo vakcínach v dotknutých oblastiach."),
}
NO_ACTION = ("For information; no action is expected.", "Na informáciu; nepredpokladá sa žiadna akcia.")


def basic(item: dict, lang: str = "en") -> dict:
    """{"about", "what_changed", "impact", "auto": True} for any monitor item, in English or Slovak ("sk"),
    without calling an AI. Text quoted from the source stays in its own language."""
    sk = lang == "sk"
    t = (lambda en, sk_: sk_ if sk else en)
    pick_ = (lambda pair: pair[1] if sk else pair[0])
    src, cat, title = item.get("source", ""), item.get("category", ""), item.get("title", "")
    summary = item.get("summary", "") or ""
    local = slovak.summary if sk else (lambda x: x)  # the monitor's own English phrases, translated
    cat_l = slovak.label(cat) if sk else cat
    title_l = slovak.title(item) if sk else title
    eff = (item.get("effective") or [None])[0]
    about, changed = "", _short(local(summary)) or _short(title_l)
    impact = pick_(CATEGORY_IMPACT.get(cat, NO_ACTION))

    if src == "lawchanges":
        num, _, rest = title.partition(" – ")
        name = slovak.law_name(num.split()[0], rest.split(":")[0]) if sk else rest.split(":")[0]
        about = t(f"Slov-Lex published a new consolidated wording of {num} ({name}).",
                  f"Slov-Lex zverejnil nové konsolidované znenie predpisu {num} ({name}).")
        changed = _short(local(summary.replace(" Open the item to see the old and new wording.", "")))
        if eff:
            changed += t(f" In force from {_date(eff)}.", f" Účinné od {_date(eff)}.")
        impact = t(f"Check whether your procedures, contracts or licences must change by {_date(eff) or 'the date it applies'}; "
                   "open the item to see the old and new wording side by side.",
                   f"Skontrolujte, či treba do {_date(eff) or 'dátumu účinnosti'} zmeniť vaše postupy, zmluvy alebo povolenia; "
                   "v položke uvidíte staré a nové znenie vedľa seba.")
    elif src == "slovlex":
        about = t(f"New act in the Collection of Laws (Zbierka zákonov): {_short(title, 200)}",
                  f"Nový predpis v Zbierke zákonov: {_short(title, 200)}")
        amends = _field(summary, "Amends")
        if amends and sk:
            amends = slovak.summary(amends)
        rest = re.sub(r"(?: · )?Effective from: [^·]*", "", summary).strip(" ·") if eff else summary  # date added below
        changed = ((t(f"It amends {amends}.", f"Mení {amends}.") if amends else _short(local(rest)))
                   + (t(f" In force from {_date(eff)}.", f" Účinné od {_date(eff)}.") if eff else "")).strip()
        impact = (t("It changes a law that matters for distribution: check what changes and when.",
                    "Mení predpis dôležitý pre distribúciu: skontrolujte, čo sa mení a odkedy.") if amends
                  else t("New legislation: check whether it concerns your business.",
                         "Nový predpis: skontrolujte, či sa týka vašej činnosti."))
    elif src == "slovlex_lp":
        kind_sk, _, subject = (title.split(" · ", 1)[1] if " · " in title else title).partition(": ")
        kind = pick_(DRAFT_KINDS.get(_fold(kind_sk).strip(), ("Draft", "Návrh")))
        by = _field(summary, "Submitted by")
        about = (t(f"{kind} in the Slov-Lex legislative process", f"{kind} v legislatívnom procese Slov-Lex")
                 + (t(f", submitted by {by}", f", predkladateľ: {by}") if by else "")
                 + (f": {_short(subject, 220)}" if subject else "."))
        changed = _short(local(summary.split(" · Submitted by")[0]))
        stage = _fold(_field(summary, "Stage") or summary)  # the current stage, not the one it moved from
        deadline = _date(item.get("deadline"))
        if "vyhlasene v zbierke" in stage:
            impact = t("It has been published in the Collection of Laws and is now law: check what changes and from when.",
                       "Bol vyhlásený v Zbierke zákonov a už platí: skontrolujte, čo sa mení a odkedy.")
        elif item.get("deadline") or stage.startswith("pripomienkove konanie"):
            impact = (t("Comments are open", "Prebieha pripomienkové konanie")
                      + (t(f" until {deadline}", f" (do {deadline})") if deadline else "")
                      + t(": this is the stage where the draft can still be influenced.",
                          ": v tejto fáze sa návrh ešte dá ovplyvniť."))
        elif "narodnej rady" in stage:
            impact = t("It is in Parliament and may become law soon: prepare for the change.",
                       "Je v Národnej rade SR a čoskoro môže platiť: pripravte sa na zmenu.")
        elif "rokovanie vlady" in stage or "poradnych organov vlady" in stage:
            impact = t("It is before the Government, so the text is close to final: prepare for the change.",
                       "Prerokúva ho vláda, text je takmer konečný: pripravte sa na zmenu.")
        elif "proces ukonceny" in stage:
            impact = t("The legislative process has ended: check whether it was published as law or stopped.",
                       "Legislatívny proces sa skončil: overte, či bol predpis vyhlásený, alebo zastavený.")
        elif "akt eu" in _fold(kind_sk) or "aktu eu" in stage:
            impact = t("Slovakia's position on a proposed EU act: it may change EU rules later; no action needed now.",
                       "Stanovisko Slovenska k návrhu aktu EÚ: neskôr môže zmeniť pravidlá EÚ; zatiaľ netreba nič robiť.")
        else:
            impact = t("A draft, not yet law: watch how it develops; no action needed now.",
                       "Návrh, zatiaľ neplatí: sledujte jeho vývoj; teraz netreba nič robiť.")
    elif src == "sukl_web" and cat == "Supply / availability":
        product, _, kind = title.rpartition(" - ")
        code = _field(summary, "Kód ŠÚKL")
        about = (t(f"ŠÚKL supply notice for {product or title}", f"Oznámenie ŠÚKL o dostupnosti lieku {product or title}")
                 + (t(f" (ŠÚKL code {code})", f" (kód ŠÚKL {code})") if code and code not in product else "") + ".")
        url = (item.get("url") or "").lower()
        key = next((k for k in SUPPLY_IMPACT if k in url), None)
        impact = pick_(SUPPLY_IMPACT[key]) if key else t("Check whether this product is in your range.",
                                                          "Skontrolujte, či je tento liek vo vašom sortimente.")
        if summary.startswith("Added:"):  # an existing notice was edited: show the new values, not the line count
            changed = t("Notice updated – ", "Oznámenie aktualizované – ") + summary.split(" | Removed:")[0].replace("Added: ", "")
        else:  # the page can list several notices for the product: describe the first (this one) only
            first = summary.split(" · Typ oznámenia:")[0]
            changed = " · ".join(f for f in first.split(" · ") if not f.endswith(": Detail")) or kind
        changed = _short(changed if sk else _english_notice(changed))  # the notice's own labels are Slovak
    elif src == "sukl_web":
        page = title.split(": ", 1)[-1]
        about = t(f"ŠÚKL web page “{page}” ({cat}).", f"Stránka ŠÚKL „{page}“ ({cat_l}).")
        new_page = title.startswith("New page")
        changed = (_short(local(summary)) if summary.startswith(("Added:", "Removed:")) else
                   t(f"The page was {'published' if new_page else 'updated'}. It begins: ",
                     f"Stránka bola {'zverejnená' if new_page else 'aktualizovaná'}. Začína: ") + _short(summary, 260))
    elif src in ("sukl", "sukl_recall"):
        about = t(f"ŠÚKL announcement ({cat}): ", f"Oznam ŠÚKL ({cat_l}): ") + _short(title, 200)
        changed = _short(summary) or t("See the announcement for details.", "Podrobnosti sú v ozname.")
    elif src == "mzsr":
        about = t("News from the Ministry of Health (MZ SR): ", "Novinka Ministerstva zdravotníctva SR: ") + _short(title, 200)
        changed = _short(summary) or t("See the article for details.", "Podrobnosti sú v článku.")
    elif src == "kategorizacia":
        about = (t("MZ SR list of categorised medicines (the reimbursement list)", "Zoznam kategorizovaných liekov MZ SR (zoznam úhrad)")
                 + (t(f" valid from {_date(eff)}", f" platný od {_date(eff)}") if eff else "") + ".")
        counts = title_l.split(": ", 1)[-1] if ": " in title_l else ""
        rest = local(summary.replace(" Open the item for the full lists by ŠÚKL code.", ""))
        changed = _short(f"{counts[:1].upper() + counts[1:]}. {rest}" if counts else rest)
    elif src in ("uskvbl", "sool"):
        site = (t("ÚŠKVBL (veterinary institute)", "ÚŠKVBL (veterinárny ústav)") if src == "uskvbl"
                else t("SOOL (Slovak Medicines Verification Organisation)", "SOOL (Slovenská organizácia pre overovanie pravosti liekov)"))
        kind, _, name = title.partition(": ")
        things = {"New document": ("new document", "nový dokument"), "Document published": ("document", "dokument"),
                  "Updated page": ("page", "stránka"), "New article": ("new article", "nový článok"),
                  "Updated article": ("article", "článok")}
        thing_en = things.get(kind, ("item", "položka"))[0]
        thing = pick_(things.get(kind, ("item", "položka")))
        about = t(f"{site}: {thing} “{name or title}”.", f"{site}: {thing} „{name or title}“.")
        if summary.startswith(("Added:", "Removed:", "New on the page:")):
            changed = _short(local(summary))
        elif "file uploaded" in summary:
            ext = summary.split()[0]
            changed = t(f"A {ext} file was published on the website.", f"Na webe bol zverejnený súbor {ext}.")
        else:
            published = "new" in thing_en
            changed = (t(f"{'Published' if published else 'Updated'}. It begins: ",
                         f"{'Zverejnené' if published else 'Aktualizované'}. Začína: ") + _short(local(summary), 260))
        if src == "uskvbl":
            admin = item.get("priority") == "low" or any(w in _fold(name) for w in ("faktur", "objednav", "zmluv"))
            impact = (t("The institute's own administration (orders, invoices): no action needed.",
                        "Vlastná administratíva ústavu (objednávky, faktúry): netreba nič robiť.") if admin
                      else t("Veterinary: check whether it concerns veterinary medicines you distribute.",
                             "Veterina: skontrolujte, či sa týka veterinárnych liekov, ktoré distribuujete."))
        else:
            impact = t("Medicines verification (FMD): check whether it affects your verification system, connection or fees.",
                       "Overovanie pravosti liekov (FMD): skontrolujte, či sa týka vášho overovacieho systému, pripojenia alebo poplatkov.")
    elif src == "eurlex":
        about = t("EU legal act in the Official Journal of the EU: ", "Právny akt EÚ v Úradnom vestníku EÚ: ") + _short(title, 200)
    elif src == "ema":
        about = t("European Medicines Agency (EMA) news: ", "Novinka Európskej agentúry pre lieky (EMA): ") + _short(title, 200)
    elif src == "svps":
        about = t("State Veterinary and Food Administration (ŠVPS SR): ", "Štátna veterinárna a potravinová správa (ŠVPS SR): ") + _short(title, 200)
    elif src == "sdp":
        name = title.split(": ", 1)[-1]
        about = t(f"Official good-distribution-practice (SDP/GDP) reference page: {name}.",
                  f"Oficiálna referenčná stránka správnej distribučnej praxe (SDP/GDP): {name}.")
        impact = t("Check whether your SDP procedures (SOPs, training, quality system) need updating.",
                   "Skontrolujte, či treba aktualizovať vaše postupy SDP (SOP, školenia, systém kvality).")
    else:
        about = _short(title_l, 200)

    if item.get("deadline") and _date(item["deadline"]) not in impact:
        impact += t(f" Deadline: {_date(item['deadline'])}.", f" Termín: {_date(item['deadline'])}.")
    return {"about": about, "what_changed": changed, "impact": impact, "auto": True}


def free(item: dict) -> dict:
    """The free explanation in English with its Slovak version under "sk"."""
    sk = basic(item, "sk")
    sk.pop("auto")
    return {**basic(item), "sk": sk}


def add_basic(items: list[dict]) -> int:
    """Free explanations for every item without a Claude one, plus the Slovak title and labels of every item.
    Returns how many items were (re)written."""
    n = 0
    for i in items:
        before = (i.get("explain"), i.get("title_sk"), i.get("category_sk"), i.get("tags_sk"))
        if "explain" not in i or i["explain"].get("auto"):
            new = free(i)
            if i.get("explain", {}).get("declined"):
                new["declined"] = True
            i["explain"] = new
        i["title_sk"] = slovak.title(i)
        i["category_sk"] = slovak.label(i.get("category", ""))
        i["tags_sk"] = [slovak.label(x) for x in i.get("tags") or []]
        if before != (i.get("explain"), i["title_sk"], i["category_sk"], i["tags_sk"]):
            n += 1
    return n
