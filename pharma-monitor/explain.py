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
import sys
from pathlib import Path

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
Keep Slovak names of laws, institutions and products as they are."""

SCHEMA = {
    "type": "object",
    "properties": {
        "about": {"type": "string"},
        "what_changed": {"type": "string"},
        "impact": {"type": "string"},
    },
    "required": ["about", "what_changed", "impact"],
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
            item["explain"] = {**basic(item), "declined": True}  # keeps the free explanation, not retried
            continue
        tin, tout = result.pop("usage")
        tokens_in, tokens_out = tokens_in + tin, tokens_out + tout
        item["explain"] = {k: str(result[k]).strip() for k in ("about", "what_changed", "impact")}
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
DRAFT_KINDS = {"zakon": "Draft act", "vyhlaska": "Draft decree", "nariadenie vlady": "Draft government regulation",
               "opatrenie": "Draft measure", "akt eu": "EU act handled by a Slovak ministry"}


def _english_notice(text: str) -> str:
    for sk, en in NOTICE_LABELS.items():
        text = text.replace(sk, en)
    return text


SUPPLY_IMPACT = {
    "prerusenie": "Supply of this product is interrupted: check your stock, tell affected customers and plan an alternative.",
    "obnovenie": "Supply resumes: the product can be ordered again from the date given.",
    "zrusenie": "Supply ends: plan a replacement and run down the remaining stock.",
    "prve-uvedenie": "New product on the Slovak market: consider adding it to your range.",
}
CATEGORY_IMPACT = {
    "Recall / quality": "Check your stock for the affected batches, block them, follow ŠÚKL's instructions and inform your customers.",
    "Supply disruption": "Concerns medicine availability: check whether products you distribute are affected.",
    "Distribution & pharmacies": "Concerns wholesale distribution or pharmacies directly: read it and check your procedures.",
    "Drug safety": "Safety information: check whether it concerns products you distribute and pass it on if required.",
    "Medical devices": "Concerns medical devices: check whether it affects devices you distribute.",
    "Reimbursement & prices": "Update prices and reimbursement in your system from the date it applies.",
    "EU legislation": "EU law: check whether Slovak rules or your procedures will have to follow.",
    "Animal health (ŠVPS)": "May change demand for veterinary medicines or vaccines in the affected areas.",
}


def basic(item: dict) -> dict:
    """{"about", "what_changed", "impact", "auto": True} for any monitor item, without calling an AI."""
    src, cat, title = item.get("source", ""), item.get("category", ""), item.get("title", "")
    summary = item.get("summary", "") or ""
    eff = (item.get("effective") or [None])[0]
    about, changed, impact = "", _short(summary) or _short(title), CATEGORY_IMPACT.get(cat, "For information; no action is expected.")

    if src == "lawchanges":
        num, _, rest = title.partition(" – ")
        name = rest.split(":")[0]
        about = f"Slov-Lex published a new consolidated wording of {num} ({name})."
        changed = _short(summary.replace(" Open the item to see the old and new wording.", ""))
        if eff:
            changed += f" In force from {_date(eff)}."
        impact = (f"Check whether your procedures, contracts or licences must change by {_date(eff) or 'the date it applies'}; "
                  "open the item to see the old and new wording side by side.")
    elif src == "slovlex":
        about = f"New act in the Collection of Laws (Zbierka zákonov): {_short(title, 200)}"
        amends = _field(summary, "Amends")
        changed = (f"It amends {amends}." if amends else _short(summary)) + (f" In force from {_date(eff)}." if eff else "")
        impact = ("It changes a law that matters for distribution: check what changes and when." if amends
                  else "New legislation: check whether it concerns your business.")
    elif src == "slovlex_lp":
        kind_sk, _, subject = (title.split(" · ", 1)[1] if " · " in title else title).partition(": ")
        kind = DRAFT_KINDS.get(_fold(kind_sk).strip(), "Draft")
        by = _field(summary, "Submitted by")
        about = (f"{kind} in the Slov-Lex legislative process" + (f", submitted by {by}" if by else "")
                 + (f": {_short(subject, 220)}" if subject else "."))
        changed = _short(summary.split(" · Submitted by")[0])
        stage = _fold(_field(summary, "Stage") or summary)  # the current stage, not the one it moved from
        if "vyhlasene v zbierke" in stage:
            impact = "It has been published in the Collection of Laws and is now law: check what changes and from when."
        elif item.get("deadline") or stage.startswith("pripomienkove konanie"):
            impact = ("Comments are open" + (f" until {_date(item.get('deadline'))}" if item.get("deadline") else "")
                      + ": this is the stage where the draft can still be influenced.")
        elif "narodnej rady" in stage:
            impact = "It is in Parliament and may become law soon: prepare for the change."
        elif "rokovanie vlady" in stage or "poradnych organov vlady" in stage:
            impact = "It is before the Government, so the text is close to final: prepare for the change."
        elif "proces ukonceny" in stage:
            impact = "The legislative process has ended: check whether it was published as law or stopped."
        elif "akt eu" in _fold(kind_sk) or "aktu eu" in stage:
            impact = "Slovakia's position on a proposed EU act: it may change EU rules later; no action needed now."
        else:
            impact = "A draft, not yet law: watch how it develops; no action needed now."
    elif src == "sukl_web" and cat == "Supply / availability":
        product, _, kind = title.rpartition(" - ")
        code = _field(summary, "Kód ŠÚKL")
        about = f"ŠÚKL supply notice for {product or title}" + (f" (ŠÚKL code {code})" if code and code not in product else "") + "."
        url = (item.get("url") or "").lower()
        key = next((k for k in SUPPLY_IMPACT if k in url), None)
        impact = SUPPLY_IMPACT.get(key, "Check whether this product is in your range.")
        if summary.startswith("Added:"):  # an existing notice was edited: show the new values, not the line count
            changed = "Notice updated – " + summary.split(" | Removed:")[0].replace("Added: ", "")
        else:  # the page can list several notices for the product: describe the first (this one) only
            first = summary.split(" · Typ oznámenia:")[0]
            changed = " · ".join(f for f in first.split(" · ") if not f.endswith(": Detail")) or kind
        changed = _short(_english_notice(changed))
    elif src == "sukl_web":
        page = title.split(": ", 1)[-1]
        about = f"ŠÚKL web page “{page}” ({cat})."
        changed = (_short(summary) if summary.startswith(("Added:", "Removed:")) else
                   f"The page was {'published' if title.startswith('New page') else 'updated'}. It begins: {_short(summary, 260)}")
    elif src in ("sukl", "sukl_recall"):
        about = f"ŠÚKL announcement ({cat}): {_short(title, 200)}"
        changed = _short(summary) or "See the announcement for details."
    elif src == "mzsr":
        about = f"News from the Ministry of Health (MZ SR): {_short(title, 200)}"
        changed = _short(summary) or "See the article for details."
    elif src == "kategorizacia":
        about = "MZ SR list of categorised medicines (the reimbursement list)" + (f" valid from {_date(eff)}" if eff else "") + "."
        counts = title.split(": ", 1)[-1] if ": " in title else ""
        changed = _short(f"{counts[:1].upper() + counts[1:]}. {summary.replace(' Open the item for the full lists by ŠÚKL code.', '')}"
                         if counts else summary)
    elif src in ("uskvbl", "sool"):
        site = "ÚŠKVBL (veterinary institute)" if src == "uskvbl" else "SOOL (Slovak Medicines Verification Organisation)"
        kind, _, name = title.partition(": ")
        thing = {"New document": "new document", "Document published": "document", "Updated page": "page",
                 "New article": "new article", "Updated article": "article"}.get(kind, "item")
        about = f"{site}: {thing} “{name or title}”."
        if summary.startswith(("Added:", "Removed:", "New on the page:")):
            changed = _short(summary)
        elif "file uploaded" in summary:
            changed = f"A {summary.split()[0]} file was published on the website."
        else:
            changed = f"{'Published' if 'new' in thing else 'Updated'}. It begins: {_short(summary, 260)}"
        if src == "uskvbl":
            impact = ("The institute's own administration (orders, invoices): no action needed."
                      if item.get("priority") == "low" or any(w in _fold(name) for w in ("faktur", "objednav", "zmluv"))
                      else "Veterinary: check whether it concerns veterinary medicines you distribute.")
        else:
            impact = "Medicines verification (FMD): check whether it affects your verification system, connection or fees."
    elif src == "eurlex":
        about = f"EU legal act in the Official Journal of the EU: {_short(title, 200)}"
    elif src == "ema":
        about = f"European Medicines Agency (EMA) news: {_short(title, 200)}"
    elif src == "svps":
        about = f"State Veterinary and Food Administration (ŠVPS SR): {_short(title, 200)}"
    elif src == "sdp":
        about = f"Official good-distribution-practice (SDP/GDP) reference page: {title.split(': ', 1)[-1]}."
        impact = "Check whether your SDP procedures (SOPs, training, quality system) need updating."
    else:
        about = _short(title, 200)

    if item.get("deadline") and "until" not in impact:
        impact += f" Deadline: {_date(item['deadline'])}."
    return {"about": about, "what_changed": changed, "impact": impact, "auto": True}


def add_basic(items: list[dict]) -> int:
    """Free explanations for every item without a Claude one. Returns how many were (re)written."""
    n = 0
    for i in items:
        if "explain" not in i or i["explain"].get("auto"):
            new = basic(i)
            if i.get("explain", {}).get("declined"):
                new["declined"] = True
            if i.get("explain") != new:
                i["explain"] = new
                n += 1
    return n
