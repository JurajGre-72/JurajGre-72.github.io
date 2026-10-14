#!/usr/bin/env python3
"""Slovak regulatory monitor for a pharmaceutical / veterinary distributor.

Checks official Slovak sources, keeps only items relevant to the business
(rules in config.json), stores them in data/items.json for the dashboard and,
when something new turns up, writes a Markdown digest that the GitHub Actions
workflow turns into an issue (GitHub then e-mails the repository owner).

Standard library only, so it runs on any GitHub runner without installs.

Usage:
    python3 monitor.py [--notify-out PATH] [--sources slovlex,sukl,...]
"""

from __future__ import annotations

import argparse
import datetime as dt
import email.utils
import hashlib
import html
import json
import os
import re
import smtplib
import sys
import time
import unicodedata
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from email.message import EmailMessage
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
ITEMS_FILE = DATA / "items.json"
STATE_FILE = DATA / "state.json"
CONFIG_FILE = HERE / "config.json"
DASHBOARD_URL = "https://jurajgre-72.github.io/pharma-monitor/"

UA = "Mozilla/5.0 (compatible; PharmacopolaRegMonitor/1.0; +https://jurajgre-72.github.io/pharma-monitor/)"
LEVELS = {"low": 1, "medium": 2, "high": 3}
LEVEL_NAMES = {v: k for k, v in LEVELS.items()}

SOURCES = {
    "slovlex": "Slov-Lex · Zbierka zákonov SR",
    "sukl": "ŠÚKL · Aktuality",
    "sukl_recall": "ŠÚKL · Stiahnutia liekov z trhu",
    "mzsr": "Ministerstvo zdravotníctva SR",
    "uskvbl": "ÚŠKVBL · Veterinárne lieky",
}


# --------------------------------------------------------------------------- helpers

def now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def iso(d: dt.datetime | None) -> str | None:
    return d.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z") if d else None


def parse_iso(s: str | None) -> dt.datetime | None:
    if not s:
        return None
    try:
        d = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)


def fold(text: str) -> str:
    """Lower-case and strip diacritics so 'Liečivá' matches 'lieciva'."""
    text = unicodedata.normalize("NFKD", text or "")
    return "".join(c for c in text if not unicodedata.combining(c)).lower()


def strip_html(text: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?</\1>", " ", text or "")
    text = re.sub(r"(?i)<br\s*/?>|</(p|div|li|tr|h\d)>", "\n", text)
    text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    text = text.replace("​", "").replace("\xa0", " ")
    lines = (re.sub(r"[ \t]+", " ", ln).strip() for ln in text.splitlines())
    return "\n".join(ln for ln in lines if ln)


def shorten(text: str, n: int = 320) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    return text if len(text) <= n else text[: n - 1].rsplit(" ", 1)[0] + "…"


def fetch(url: str, timeout: int = 45, retries: int = 3) -> str:
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "sk,en;q=0.8"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
                charset = r.headers.get_content_charset() or "utf-8"
            return raw.decode(charset, errors="replace").lstrip("﻿")
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"{url}: {last}")


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    tmp.replace(path)


# --------------------------------------------------------------------------- relevance

class Rules:
    def __init__(self, cfg: dict):
        self.keywords = [(k["label"], LEVELS[k["level"]], re.compile(k["pattern"])) for k in cfg["keywords"]]
        self.exclude = [re.compile(p) for p in cfg.get("exclude", [])]
        self.slovlex_skip = [re.compile(p) for p in cfg.get("slovlex_skip_title", [])]
        self.key_laws = cfg.get("key_laws", {})
        self.key_law_levels = cfg.get("key_law_levels", {})
        self.bootstrap_days = cfg.get("bootstrap_days", 90)
        self.keep_days = cfg.get("keep_days", 730)
        self.generic = set(cfg.get("generic_labels", []))
        self.notify_min = LEVELS[cfg.get("notify_min_priority", "medium")]

    def excluded(self, *texts: str) -> bool:
        t = fold(" ".join(texts))
        return any(p.search(t) for p in self.exclude)

    def match(self, text: str, specific_only: bool = False) -> tuple[int, list[str]]:
        """Return (level, tags). specific_only: generic labels (e.g. 'Medicines') tag but don't raise the
        level – used for regulator feeds where nearly every item mentions medicines."""
        t = fold(text)
        level, tags = 0, []
        for label, lvl, pat in self.keywords:
            if pat.search(t):
                tags.append(label)
                if not (specific_only and label in self.generic):
                    level = max(level, lvl)
        return level, tags

    def law_refs(self, text: str) -> dict[str, str]:
        """Key laws a legal text mentions: 'amends' if it has an amending article, else 'mentions'."""
        t = fold(text)
        out = {}
        for num in self.key_laws:
            n = re.escape(num)
            if not re.search(rf"\b{n}\s*(z\.\s*z\.|zb\.)", t):
                continue
            # Amending articles open with the nominative "Zákon č. 362/2011 Z. z. ... sa mení a dopĺňa takto";
            # "v znení zákona č. ..." (genitive) only lists earlier amendments and must not count.
            amend = re.search(rf"\b(zakon|vyhlaska|nariadenie vlady)( narodnej rady)?( slovenskej republiky)?\s+(c\.\s*)?{n}\s*(z\.\s*z\.|zb\.)"
                              rf"[^§]{{0,3000}}?\s(sa\s+(meni|dopln|zrus)|sa\s+zrusuje)", t)
            out[num] = "amends" if amend else "mentions"
        return out


# --------------------------------------------------------------------------- sources

def rss_items(xml_text: str) -> list[dict]:
    root = ET.fromstring(xml_text.encode("utf-8"))
    out = []
    for it in root.iter("item"):
        get = lambda tag: (it.findtext(tag) or "").strip()
        pub = None
        if get("pubDate"):
            try:
                pub = email.utils.parsedate_to_datetime(get("pubDate"))
            except (TypeError, ValueError):
                pub = None
        out.append({
            "title": html.unescape(get("title")),
            "link": get("link"),
            "guid": get("guid") or get("link"),
            "description": get("description"),
            "category": get("category"),
            "date": pub,
        })
    return out


# URL fragment -> (category, base level). First match wins.
SUKL_SECTIONS = [
    ("oznamy-o-stiahnuti", "Recall / quality", 3),
    ("rapid-alert", "Recall / quality", 3),
    ("/dostupnost-liekov/", "Supply disruption", 3),
    ("/kvalita-liekov/", "Recall / quality", 3),
    ("vyroba-distribucia", "Distribution & pharmacies", 3),
    ("lekarne-a-vydajne", "Distribution & pharmacies", 2),
    ("drogove-prekurzory", "Distribution & pharmacies", 2),
    ("bezpecnost-liekov", "Drug safety", 2),
    ("zdravotnicke-pomocky", "Medical devices", 2),
    ("reklama-liekov", "ŠÚKL notice", 2),
    ("sadzobnik", "ŠÚKL notice", 2),
    ("registracia", "ŠÚKL notice", 1),
]


def check_sukl(rules: Rules, state: dict, recalls_only: bool) -> list[dict]:
    if recalls_only:
        url = "https://www.sukl.sk/sk/rss?page_id=1355&pid=208&days=365"
        key = "sukl_recall"
    else:
        url = "https://www.sukl.sk/sk/rss?page_id=1355&days=365"
        key = "sukl"
    seen = state.setdefault(key, {}).setdefault("seen", {})
    results = []
    for it in rss_items(fetch(url)):
        uid = it["guid"]
        if uid in seen:
            continue
        seen[uid] = iso(now_utc())
        text = strip_html(it["description"])
        if rules.excluded(it["title"], it["link"], it["category"]):
            continue
        path = it["link"].lower()
        if not recalls_only and "oznamy-o-stiahnuti" in path:
            continue  # reported by the dedicated recall feed
        level, tags = rules.match(f"{it['title']} {text}", specific_only=True)
        if recalls_only:
            category, base = SUKL_SECTIONS[0][1], SUKL_SECTIONS[0][2]
        else:
            category, base = next(((c, b) for frag, c, b in SUKL_SECTIONS if frag in path), ("ŠÚKL notice", 1))
        if category == "Recall / quality":
            tags = ["Recall / quality defect"] + [t for t in tags if t != "Recall / quality defect"]
        level = max(base, min(level, 3))
        results.append(make_item(key, uid, it["title"], it["link"], it["date"], category, level, tags, text))
    return results


def check_mzsr(rules: Rules, state: dict) -> list[dict]:
    seen = state.setdefault("mzsr", {}).setdefault("seen", {})
    results = []
    for it in rss_items(fetch("https://www.health.gov.sk/RSS?Clanky")):
        uid = it["link"] or it["guid"]
        if uid in seen:
            continue
        seen[uid] = iso(now_utc())
        text = strip_html(it["description"])
        text = re.sub(r"^Nadpis plný:.*\n?|^Dátum článku:.*\n?", "", text, flags=re.M)
        text = re.sub(r"^Obsah stručný:\s*", "", text, flags=re.M)
        if rules.excluded(it["title"]):
            continue
        level, tags = rules.match(f"{it['title']} {text}")
        tags = [t for t in tags if t not in ("Ministry of Health", "Healthcare providers")]
        if not tags:
            continue  # hospital openings, campaigns etc.
        level, _ = rules.match(f"{it['title']} {text}", specific_only=True)
        title_level, _ = rules.match(it["title"])
        level = max(level, title_level, LEVELS["medium"] if "Medicines" in tags else LEVELS["low"])
        results.append(make_item("mzsr", uid, it["title"], it["link"], it["date"], "Ministry of Health", level, tags, text))
    return results


def check_uskvbl(rules: Rules, state: dict, bootstrap: bool) -> list[dict]:
    """ÚŠKVBL publishes everything as WordPress pages; report pages that changed and what was added."""
    st = state.setdefault("uskvbl", {}).setdefault("pages", {})
    base = "https://www.uskvbl.sk/index.php?rest_route=/wp/v2/pages&orderby=modified&order=desc&per_page=50&_fields=id,title,modified_gmt,link"
    listing = json.loads(fetch(base))
    results = []
    cutoff = now_utc() - dt.timedelta(days=rules.bootstrap_days)
    for page in listing:
        pid = str(page["id"])
        modified = page.get("modified_gmt")
        prev = st.get(pid)
        if prev and prev.get("modified") == modified:
            continue
        mod_dt = parse_iso(modified)
        if not prev and not bootstrap and mod_dt and mod_dt < cutoff:
            st[pid] = {"modified": modified, "lines": []}
            continue
        detail = json.loads(fetch(f"https://www.uskvbl.sk/index.php?rest_route=/wp/v2/pages/{pid}&_fields=id,title,content,link"))
        title = strip_html(detail["title"]["rendered"]) or "Úvodná stránka"
        text = strip_html(detail["content"]["rendered"])
        lines = [ln for ln in text.splitlines() if len(ln) > 3]
        hashes = [hashlib.sha1(ln.encode()).hexdigest()[:10] for ln in lines]
        old = set(prev.get("lines", [])) if prev else None
        st[pid] = {"modified": modified, "lines": hashes}
        if rules.excluded(title, detail.get("link", "")):
            continue
        if old is not None:
            added = [ln for ln, h in zip(lines, hashes) if h not in old]
            if not added:
                continue  # only formatting changed
            summary = "New on the page: " + " · ".join(added[:6])
        else:
            if not mod_dt or mod_dt < cutoff:
                continue
            summary = " · ".join(lines[:5])
        level, tags = rules.match(f"{title} {summary}", specific_only=True)
        t = fold(title)
        level = 3 if any(k in t for k in ("dolezite oznamy", "kvalita", "inspekc", "stiahnut")) else max(level, 2)
        tags = ["Veterinary medicines"] + [x for x in tags if x != "Veterinary medicines"]
        uid = f"uskvbl:{pid}:{modified}"
        results.append(make_item("uskvbl", uid, f"Updated page: {title}", detail.get("link") or page["link"],
                                 mod_dt, "Veterinary (ÚŠKVBL)", level, tags, summary))
    return results


SLOVLEX_ROW = re.compile(r"<td>(\d+)/(\d{4})&nbsp;Z\.&nbsp;z\.</td>\s*<td><a href=\"(\d+)/\">(.*?)</a></td>", re.S)


def check_slovlex(rules: Rules, state: dict, bootstrap: bool) -> list[dict]:
    st = state.setdefault("slovlex", {}).setdefault("seen", {})
    today = now_utc()
    years = [today.year - 1, today.year] if today.month == 1 and not bootstrap else [today.year]
    results = []
    for year in years:
        listing = fetch(f"https://static.slov-lex.sk/static/SK/ZZ/{year}/")
        for num, yr, _href, raw_title in SLOVLEX_ROW.findall(listing):
            ref = f"{num}/{yr}"
            if ref in st:
                continue
            title = html.unescape(re.sub(r"<[^>]+>", "", raw_title)).strip()
            title = re.sub(r"\s+", " ", title)
            st[ref] = iso(now_utc())
            ft = fold(title)
            if any(p.search(ft) for p in rules.slovlex_skip):
                continue
            try:
                item = assess_regulation(rules, ref, title)
            except RuntimeError as e:
                print(f"  ! {ref}: {e} – will retry next run", file=sys.stderr)
                del st[ref]
                continue
            if item:
                results.append(item)
            time.sleep(0.4)
    return results


def assess_regulation(rules: Rules, ref: str, title: str) -> dict | None:
    num, year = ref.split("/")
    base = f"https://static.slov-lex.sk/static/SK/ZZ/{year}/{num}/"
    hist = fetch(base)
    body = fetch(base + "vyhlasene_znenie.html")
    text = strip_html(body)
    published = None
    m = re.search(r"Dátum vyhlásenia:\s*(\d{1,2})\.(\d{1,2})\.(\d{4})", text)
    if m:
        published = dt.datetime(int(m[3]), int(m[2]), int(m[1]), 8, tzinfo=dt.timezone.utc)
    effective = sorted(set(re.findall(r'data-ucinnostod="(\d{4}-\d{2}-\d{2})"', hist)))

    level, tags = rules.match(title)
    refs = rules.law_refs(title + "\n" + text)
    # The title names the main amended act ("..., ktorým sa mení a dopĺňa zákon č. 152/1995 Z. z.").
    in_title = rules.law_refs(re.sub(r"(?i)v znen\w* .*", "", title))
    amended = [n for n, kind in refs.items() if kind == "amends" or n in in_title]
    for n in amended:
        level = max(level, LEVELS[rules.key_law_levels.get(n, "low")])
    # Laws can change medicine rules deep inside an omnibus act; look at the body too.
    body_level, body_tags = rules.match(text[:200000]) if text else (0, [])
    mentions = len(re.findall(r"\bliek|\blieciv|zdravotnick\w* pomoc|veterinarn\w* liek", fold(text)))
    if not level and mentions >= 5:
        level = LEVELS["medium"]
        tags = sorted(set(tags) | {t for t in body_tags if t in ("Medicines", "Medical devices", "Veterinary medicines", "Pharmacy")})
    if not level:
        return None

    kind = title.split(" ", 1)[0]
    summary_parts = []
    if amended:
        summary_parts.append("Amends: " + "; ".join(f"{n} Z. z. – {rules.key_laws[n]}" for n in amended))
    if effective:
        summary_parts.append("Effective from: " + ", ".join(dt.date.fromisoformat(d).strftime("%d.%m.%Y") for d in effective[:4]))
    if mentions:
        summary_parts.append(f"{mentions} mentions of medicines / medical devices in the text")
    item = make_item("slovlex", f"slovlex:{ref}", f"{ref} Z. z. – {title}", base, published,
                     "Legislation", level, tags + [f"Amends {n}" for n in amended], " · ".join(summary_parts))
    item["doc_type"] = kind
    item["effective"] = effective
    item["pdf"] = f"https://static.slov-lex.sk/static/pdf/SK/ZZ/{year}/{num}/ZZ_{year}_{num}.pdf"
    return item


def make_item(source, uid, title, url, date, category, level, tags, summary) -> dict:
    found = now_utc()
    return {
        "id": uid,
        "source": source,
        "source_name": SOURCES[source],
        "title": title.strip(),
        "url": url,
        "date": iso(date) or iso(found),
        "detected": iso(found),
        "category": category,
        "priority": LEVEL_NAMES[max(1, min(3, level))],
        "tags": list(dict.fromkeys(tags))[:8],
        "summary": shorten(summary),
    }


# --------------------------------------------------------------------------- notification

def digest(new_items: list[dict]) -> tuple[str, str]:
    high = [i for i in new_items if i["priority"] == "high"]
    title = f"🔔 {len(new_items)} new regulatory update{'s' if len(new_items) != 1 else ''}"
    if high:
        title += f" ({len(high)} high priority)"
    title += f" – {now_utc():%d.%m.%Y}"
    icon = {"high": "🔴", "medium": "🟠", "low": "⚪"}
    lines = [f"The regulatory monitor found **{len(new_items)}** new item(s) relevant to PHARMACOPOLA.",
             f"Dashboard: {DASHBOARD_URL}", ""]
    for pr in ("high", "medium", "low"):
        group = [i for i in new_items if i["priority"] == pr]
        if not group:
            continue
        lines.append(f"### {icon[pr]} {pr.capitalize()} priority")
        for i in sorted(group, key=lambda x: x["date"], reverse=True):
            d = parse_iso(i["date"])
            lines.append(f"- **[{i['title']}]({i['url']})**  ")
            lines.append(f"  {i['source_name']} · {d:%d.%m.%Y} · {i['category']}" + (f" · _{', '.join(i['tags'][:4])}_" if i["tags"] else ""))
            if i["summary"]:
                lines.append(f"  > {i['summary']}")
        lines.append("")
    lines.append("<sub>Automatic digest. Relevance rules: `pharma-monitor/config.json`. "
                 "This is a monitoring aid, not legal advice – always check the official text.</sub>")
    return title, "\n".join(lines)


def send_email(subject: str, body_md: str) -> None:
    host, user, pwd, to = (os.environ.get(k) for k in ("SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "MAIL_TO"))
    if not (host and user and pwd and to):
        return
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = subject, user, to
    msg.set_content(body_md)
    with smtplib.SMTP(host, int(os.environ.get("SMTP_PORT", "587")), timeout=60) as s:
        s.starttls()
        s.login(user, pwd)
        s.send_message(msg)
    print(f"E-mail sent to {to}")


# --------------------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--notify-out", help="write Markdown digest of new items here (first line = title)")
    ap.add_argument("--sources", default=",".join(SOURCES), help="comma-separated subset of: " + ",".join(SOURCES))
    args = ap.parse_args()

    rules = Rules(load_json(CONFIG_FILE, None))
    state = load_json(STATE_FILE, {})
    store = load_json(ITEMS_FILE, {"items": [], "sources": {}})
    known = {i["id"] for i in store["items"]}
    status = store.setdefault("sources", {})
    new_items: list[dict] = []
    started = now_utc()

    for key in [s.strip() for s in args.sources.split(",") if s.strip()]:
        bootstrap = key not in state
        print(f"→ {key}{' (first run – baseline)' if bootstrap else ''}")
        try:
            if key == "slovlex":
                found = check_slovlex(rules, state, bootstrap)
            elif key in ("sukl", "sukl_recall"):
                found = check_sukl(rules, state, recalls_only=key == "sukl_recall")
            elif key == "mzsr":
                found = check_mzsr(rules, state)
            elif key == "uskvbl":
                found = check_uskvbl(rules, state, bootstrap)
            else:
                print(f"  unknown source {key}", file=sys.stderr)
                continue
            if bootstrap:
                cutoff = started - dt.timedelta(days=rules.bootstrap_days if key != "slovlex" else 400)
                found = [i for i in found if parse_iso(i["date"]) >= cutoff]
                for i in found:
                    i["detected"] = i["date"]  # don't flag the backlog as "new"
            fresh = [i for i in found if i["id"] not in known]
            store["items"].extend(fresh)
            if not bootstrap:
                new_items.extend(fresh)
            status[key] = {"name": SOURCES[key], "ok": True, "checked": iso(started), "new": len(fresh), "error": None}
            print(f"  {len(fresh)} relevant new item(s)")
        except Exception as e:  # keep other sources running
            print(f"  ! {key} failed: {e}", file=sys.stderr)
            prev = status.get(key, {})
            status[key] = {"name": SOURCES[key], "ok": False, "checked": iso(started), "new": 0,
                           "error": shorten(str(e), 200), "last_ok": prev.get("checked") if prev.get("ok") else prev.get("last_ok")}
        save_json(STATE_FILE, state)  # checkpoint after each source

    keep_after = started - dt.timedelta(days=rules.keep_days)
    store["items"] = sorted((i for i in store["items"] if parse_iso(i["date"]) >= keep_after),
                            key=lambda i: (i["date"], i["id"]), reverse=True)
    store["updated"] = iso(started)
    save_json(ITEMS_FILE, store)

    new_items = [i for i in new_items if LEVELS[i["priority"]] >= rules.notify_min]
    print(f"Done: {len(new_items)} new item(s) to notify, {len(store['items'])} stored.")
    if new_items:
        subject, body = digest(new_items)
        if args.notify_out:
            Path(args.notify_out).write_text(subject + "\n" + body + "\n", encoding="utf-8")
        try:
            send_email(subject, body)
        except Exception as e:
            print(f"  ! e-mail failed: {e}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
