#!/usr/bin/env python3
"""Slovak regulatory monitor for a pharmaceutical / veterinary distributor.

Checks official Slovak sources, keeps only items relevant to the business
(rules in config.json), stores them in data/items.json for the dashboard and,
when something new turns up, writes a Markdown digest that the GitHub Actions
workflow turns into an issue (GitHub then e-mails the repository owner).

Standard library only, so it runs on any GitHub runner without installs.

Usage:
    python3 monitor.py [--notify-out PATH] [--sources slovlex,sukl,...]

"What changed" details (law wording before/after, price-list differences, amendment text) are
written to data/changes/*.json and shown on the dashboard when an item is opened.
"""

from __future__ import annotations

import argparse
import datetime as dt
import email.utils
import hashlib
import html
import http.client
import json
import os
import re
import shutil
import smtplib
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from email.message import EmailMessage
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lawdiff  # noqa: E402
import pricelist  # noqa: E402

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
ITEMS_FILE = DATA / "items.json"
STATE_FILE = DATA / "state.json"
STATUS_FILE = DATA / "status.json"  # when each source was last checked; rewritten on every run
CHANGES_DIR = DATA / "changes"
CONFIG_FILE = HERE / "config.json"
DASHBOARD_URL = "https://jurajgre-72.github.io/pharma-monitor/"

UA = "Mozilla/5.0 (compatible; PharmacopolaRegMonitor/1.0; +https://jurajgre-72.github.io/pharma-monitor/)"
LEVELS = {"low": 1, "medium": 2, "high": 3}
LEVEL_NAMES = {v: k for k, v in LEVELS.items()}

SOURCES = {
    "slovlex": "Slov-Lex · Zbierka zákonov SR",
    "lawchanges": "Slov-Lex · Znenia kľúčových zákonov",
    "slovlex_lp": "Slov-Lex · Návrhy predpisov (legislatívny proces)",
    "sukl": "ŠÚKL · Aktuality",
    "sukl_recall": "ŠÚKL · Stiahnutia liekov z trhu",
    "sukl_web": "ŠÚKL · Všetky zmeny na webe (dostupnosť liekov, stránky)",
    "mzsr": "Ministerstvo zdravotníctva SR",
    "kategorizacia": "MZ SR · Zoznam kategorizovaných liekov",
    "uskvbl": "ÚŠKVBL · Všetky zmeny na webe",
    "sool": "SOOL · Slovenská organizácia pre overovanie liekov",
    "eurlex": "EUR-Lex · Úradný vestník EÚ",
    "ema": "EMA · European Medicines Agency",
    "svps": "ŠVPS SR · Štátna veterinárna a potravinová správa",
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


def fold1(text: str) -> str:
    """Like fold() but keeps one character per input character, so match positions map back to the original."""
    return "".join(unicodedata.normalize("NFKD", c)[0] for c in text).lower()


def fetch_raw(url: str, timeout: int = 45, retries: int = 3, data: bytes | None = None,
              headers: dict | None = None) -> tuple[bytes, str]:
    last = None
    for attempt in range(retries):
        try:
            h = {"User-Agent": UA, "Accept-Language": "sk,en;q=0.8", **(headers or {})}
            req = urllib.request.Request(url, data=data, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read(), r.headers.get_content_charset() or "utf-8"
        except urllib.error.HTTPError as e:
            last = e
            if 400 <= e.code < 500 and e.code != 429:
                break  # retrying will not help
            time.sleep(2 * (attempt + 1))
        except (urllib.error.URLError, http.client.HTTPException, TimeoutError, ConnectionError) as e:
            last = e
            time.sleep(2 * (attempt + 1))
    if data is None and shutil.which("curl"):
        # Some servers (health.gov.sk) occasionally cut long responses short for urllib; curl copes better.
        h = {"User-Agent": UA, "Accept-Language": "sk,en;q=0.8", **(headers or {})}
        cmd = ["curl", "-sSL", "--fail", "--retry", "2", "--max-time", str(timeout * 2), url]
        for k, v in h.items():
            cmd[1:1] = ["-H", f"{k}: {v}"]
        r = subprocess.run(cmd, capture_output=True, timeout=timeout * 2 + 30)
        if r.returncode == 0 and r.stdout:
            return r.stdout, "utf-8"
    raise RuntimeError(f"{url}: {last!r}")


def fetch(url: str, timeout: int = 45, retries: int = 3) -> str:
    raw, charset = fetch_raw(url, timeout, retries)
    return raw.decode(charset, errors="replace").lstrip("\ufeff")


def head_stamp(url: str) -> str | None:
    """Size and modification date of a file, without downloading it (None if the server will not say)."""
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            stamp = f"{r.headers.get('Content-Length', '')}|{r.headers.get('Last-Modified', '')}|{r.headers.get('ETag', '')}"
        return stamp if stamp.strip("|") else None
    except Exception:
        return None


def fetch_json(url: str, body: dict | None = None, timeout: int = 60):
    data = json.dumps(body).encode() if body is not None else None
    raw, charset = fetch_raw(url, timeout, data=data, headers={"Content-Type": "application/json", "Accept": "application/json"})
    return json.loads(raw.decode(charset, errors="replace"))


def sk_date(d: str | dt.date | None) -> str:
    if not d:
        return ""
    if isinstance(d, str):
        d = dt.date.fromisoformat(d[:10])
    return d.strftime("%d.%m.%Y")


def save_details(item: dict, payload: dict) -> None:
    """Store the 'what changed' payload next to the items and point the item at it."""
    name = re.sub(r"[^A-Za-z0-9_-]+", "_", item["id"]).strip("_") + ".json"
    save_json(CHANGES_DIR / name, payload)
    item["details"] = f"data/changes/{name}"


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
        self.eurlex_min = LEVELS[cfg.get("eurlex_min_priority", "medium")]
        self.eu_keywords = [(k["label"], LEVELS[k["level"]], re.compile(k["pattern"], re.I)) for k in cfg.get("eu_keywords", [])]

    def match_en(self, text: str) -> tuple[int, list[str]]:
        level, tags = 0, []
        for label, lvl, pat in self.eu_keywords:
            if pat.search(text or ""):
                tags.append(label)
                level = max(level, lvl)
        return level, tags

    def amendment_text(self, text: str, num: str, limit: int = 15000) -> str | None:
        """The article of an amending act that changes key law `num` ("Čl. II  Zákon č. 362/2011 Z. z. ... sa mení ...")."""
        t = fold1(text)
        n = re.escape(num)
        m = re.search(rf"\b(zakon|vyhlaska|nariadenie vlady)( narodnej rady)?( slovenskej republiky)?\s+(c\.\s*)?{n}\s*(z\.\s*z\.|zb\.)", t)
        if not m:
            return None
        start = t.rfind("\ncl. ", 0, m.start())
        start = start + 1 if start != -1 and m.start() - start < 400 else m.start()
        end = t.find("\ncl. ", m.end())
        chunk = text[start:end if end != -1 else len(text)].strip()
        return chunk if len(chunk) <= limit else chunk[:limit].rsplit("\n", 1)[0] + "\n…"
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


MZSR_FEED = "https://www.health.gov.sk/rss/sk/novinky.xml"  # new website since November 2026 (old RSS?Clanky is gone)


def check_mzsr(rules: Rules, state: dict) -> list[dict]:
    st = state.setdefault("mzsr", {})
    seen = st.setdefault("seen", {})
    # after a move to a new feed every link is new: older news was already reported under its old address
    moved_since = now_utc() - dt.timedelta(days=25) if st.get("feed") != MZSR_FEED else None
    st["feed"] = MZSR_FEED
    results = []
    for it in rss_items(fetch(MZSR_FEED)):
        uid = it["link"] or it["guid"]
        if uid in seen:
            continue
        seen[uid] = iso(now_utc())
        if moved_since and it["date"] and it["date"] < moved_since:
            continue
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


# --------------------------------------------------------------------------- whole-website change tracking

ICON_WORDS = {"east", "west", "north", "south", "arrow_forward", "arrow_back", "chevron_right", "chevron_left",
              "open_in_new", "download", "expand_more", "expand_less", "close", "search", "menu", "home"}


def text_lines(text: str) -> list[str]:
    return [ln for ln in text.splitlines() if len(ln) > 3 and ln.strip().lower() not in ICON_WORDS]


def line_hashes(lines: list[str]) -> list[str]:
    return [hashlib.sha1(ln.encode()).hexdigest()[:10] for ln in lines]


def describe_change(lines: list[str], hashes: list[str], old: list[str], limit: int = 6) -> str | None:
    """What changed on a page, from its current lines and the previous version's line hashes.
    Added lines get their unchanged label line in front ("Predpokladaný termín obnovenia: 30.11.2026").
    Returns None when the text did not change (only formatting or the order)."""
    before, now = set(old), set(hashes)
    added = []
    for i, (ln, h) in enumerate(zip(lines, hashes)):
        if h in before:
            continue
        label = lines[i - 1] if i and hashes[i - 1] in before and len(lines[i - 1]) <= 40 and not lines[i - 1].endswith(".") else ""
        added.append(f"{label}: {ln}" if label else ln)
    removed = len([h for h in dict.fromkeys(old) if h not in now])
    if not added and not removed:
        return None
    parts = []
    if added:
        parts.append("Added: " + " · ".join(added[:limit]) + (f" (+{len(added) - limit} more)" if len(added) > limit else ""))
    if removed:
        parts.append(f"Removed: {removed} line{'s' if removed != 1 else ''}")
    return " | ".join(parts)


def page_text(url: str) -> list[str]:
    """The readable text of a published page, without menus, header and footer."""
    page = fetch(url)
    m = re.search(r"(?is)<main\b.*?</main>", page) or re.search(r"(?is)<body\b.*?</body>", page)
    body = re.sub(r"(?is)<(nav|header|footer|form|script|style)\b.*?</\1>", " ", m.group(0) if m else page)
    return text_lines(strip_html(body))


# WordPress sites: every page change, new article and newly uploaded document.
WP_SITES = {
    "uskvbl": {"api": "https://www.uskvbl.sk/index.php?rest_route=/wp/v2/{route}",
               "category": "Veterinary (ÚŠKVBL)", "tag": "Veterinary medicines",
               "history": True},  # also list everything published within keep_days, once
    "sool": {"api": "https://sool.sk/index.php?rest_route=/wp/v2/{route}",
             "category": "Medicines verification (SOOL)", "tag": "Medicines verification"},
}
# documents the institutes must publish about their own purchases – shown, but never notified
WP_ADMIN_DOCS = re.compile(r"prehlad[_ -]?(objednav|faktur)|zmluv|objednavk|faktur|verejne obstaravanie|vyrocna sprava")


def wp_get(site: str, route: str, **params):
    url = WP_SITES[site]["api"].format(route=route) + "&" + urllib.parse.urlencode(params)
    return json.loads(fetch(url))


def wp_newest(site: str, route: str, already_seen, **params):
    """Entries newest first, reading further back (100 per request) until one we have already seen, so nothing
    is missed even after many changes between two checks (e.g. when the site was down for a while)."""
    for page_no in range(1, 11):
        try:
            batch = wp_get(site, route, per_page=100, page=page_no, **params)
        except RuntimeError:
            if page_no == 1:
                raise
            return  # WordPress answers 400 when asked past its last page
        done = len(batch) < 100 or any(already_seen(e) for e in batch)  # decide before the caller records them
        yield from batch
        if done:
            return


def wp_level(site: str, title: str, text: str, rules: Rules) -> int:
    t = fold(title)
    level, _ = rules.match(f"{title} {text}", specific_only=True)
    if site == "uskvbl" and any(k in t for k in ("dolezite oznamy", "kvalita", "inspekc", "stiahnut")):
        return 3
    if site == "sool" and any(k in t for k in ("dolezit", "zmena", "poplat", "fee", "end point")):
        return 3
    return max(level, 2)


def check_wordpress(site: str, rules: Rules, state: dict, bootstrap: bool) -> list[dict]:
    """Report every changed page (with the added / removed text), every new or edited article and every new document."""
    cfg = WP_SITES[site]
    st = state.setdefault(site, {})
    cutoff = now_utc() - dt.timedelta(days=rules.bootstrap_days)
    results = []

    def item(uid, title, link, when, level, summary, backlog=False):
        if any(r["id"] == uid for r in results):
            return  # already listed by this run
        _, tags = rules.match(f"{title} {summary}", specific_only=True)
        it = make_item(site, uid, title, link, when, cfg["category"], level, [cfg["tag"]] + [t for t in tags if t != cfg["tag"]], summary)
        if backlog:
            it["_backlog"] = True
        results.append(it)

    # pages and articles: compare the text with the previous version
    for route, kind in (("pages", "page"), ("posts", "article")):
        first = route not in st and not bootstrap  # a part of the site tracked for the first time: baseline only
        known = st.setdefault(route, {})
        unchanged = lambda e, known=known: (known.get(str(e["id"])) or {}).get("modified") == e.get("modified_gmt")
        for page in wp_newest(site, route, unchanged, orderby="modified", order="desc", _fields="id,title,modified_gmt,link"):
            pid, modified = str(page["id"]), page.get("modified_gmt")
            prev = known.get(pid)
            if prev and prev.get("modified") == modified:
                continue
            mod_dt = parse_iso(modified)
            if not prev and not bootstrap and not first and mod_dt and mod_dt < cutoff:
                known[pid] = {"modified": modified, "lines": []}  # old content we had not seen yet
                continue
            detail = wp_get(site, f"{route}/{pid}", _fields="id,title,content,link")
            title = strip_html(detail["title"]["rendered"]) or "Úvodná stránka"
            link = detail.get("link") or page["link"]
            lines = text_lines(strip_html(detail["content"]["rendered"])) or page_text(link)  # some themes keep text outside "content"
            hashes = line_hashes(lines)
            known[pid] = {"modified": modified, "lines": hashes}
            if rules.excluded(title, link):
                continue
            if prev and prev.get("lines"):
                summary = describe_change(lines, hashes, prev["lines"])
                if summary is None:
                    continue  # only formatting changed
                label = "Updated page" if kind == "page" else "Updated article"
            else:
                if not mod_dt or mod_dt < cutoff:
                    continue
                summary = " · ".join(lines[:5])
                label = "Updated page" if kind == "page" else "New article"
            level = 1 if WP_ADMIN_DOCS.search(fold(title)) else wp_level(site, title, summary, rules)
            item(f"{site}:{route}:{pid}:{modified}", f"{label}: {title}", link, mod_dt, level, summary, backlog=first)

    def document(m, when, label, backlog):
        title = strip_html(m["title"]["rendered"]) or m["source_url"].rsplit("/", 1)[-1]
        title = re.sub(r"\s+", " ", title.replace("_", " ")).strip()  # file names: "Duecoxin_40mg_tbl_psy"
        ext = m["source_url"].rsplit(".", 1)[-1].upper()[:5]
        level = 1 if WP_ADMIN_DOCS.search(fold(f"{title} {m['source_url']}")) else wp_level(site, title, "", rules)
        item(f"{site}:media:{m['id']}", f"{label}: {title}", m["source_url"], when, level,
             f"{ext} file uploaded to {urllib.parse.urlparse(m['source_url']).netloc}", backlog=backlog)

    # newly uploaded documents (PDF, Word, Excel …); images are skipped
    first = "media" not in st and not bootstrap
    media = st.setdefault("media", {})
    for m in wp_newest(site, "media", lambda e: str(e["id"]) in media, orderby="date", order="desc",
                       _fields="id,date_gmt,title,source_url,mime_type"):
        mid = str(m["id"])
        if mid in media:
            continue
        media[mid] = m.get("date_gmt")
        if (m.get("mime_type") or "").startswith("image/"):
            continue
        when = parse_iso(m.get("date_gmt"))
        if not when or ((bootstrap or first) and when < cutoff):
            continue
        document(m, when, "New document", backlog=first)

    # one-off: everything the site published within the dashboard's retention (keep_days), listed as history
    if cfg.get("history") and st.get("history_days") != rules.keep_days:
        since = now_utc() - dt.timedelta(days=rules.keep_days)
        too_old = lambda field: (lambda e: (parse_iso(e.get(field)) or since) < since)
        for m in wp_newest(site, "media", too_old("date_gmt"), orderby="date", order="desc",
                           _fields="id,date_gmt,title,source_url,mime_type"):
            when = parse_iso(m.get("date_gmt"))
            if when and when >= since and not (m.get("mime_type") or "").startswith("image/"):
                document(m, when, "Document published", backlog=True)
        for route in ("pages", "posts"):
            for page in wp_newest(site, route, too_old("modified_gmt"), orderby="modified", order="desc",
                                  _fields="id,title,modified_gmt,link"):
                when = parse_iso(page.get("modified_gmt"))
                if not when or when < since:
                    continue
                detail = wp_get(site, f"{route}/{page['id']}", _fields="id,title,content,link")
                title = strip_html(detail["title"]["rendered"]) or "Úvodná stránka"
                link = detail.get("link") or page["link"]
                lines = text_lines(strip_html(detail["content"]["rendered"])) or page_text(link)
                # history shows the page as it is now, not what changed back then – say so
                summary = f"Last updated {sk_date(when.date())} · Page begins: " + " · ".join(lines[:5])
                level = 1 if WP_ADMIN_DOCS.search(fold(title)) else wp_level(site, title, summary, rules)
                item(f"{site}:{route}:{page['id']}:{page['modified_gmt']}",
                     f"{'Updated page' if route == 'pages' else 'Article'}: {title}", link, when, level, summary, backlog=True)
        st["history_days"] = rules.keep_days
    return results


# ŠÚKL publishes every page in its sitemap with the date it last changed.
SUKL_SITEMAP = "https://www.sukl.sk/sitemap_sk.xml"
SUKL_AVAILABILITY = [  # slug fragment -> notice type
    ("prerusenie", "Supply interruption"),
    ("obnovenie", "Supply resumed"),
    ("zrusenie", "Supply ended"),
    ("prve-uvedenie", "First placed on the market"),
]
SUKL_NOTICE_FIELDS = ["Typ oznámenia", "Platnosť od", "Dátum hlásenia", "Predpokladaný termín obnovenia",
                      "Kód ŠÚKL", "ATC", "Držiteľ registrácie", "Poznámka"]
SUKL_WEB_FETCH_LIMIT = 60     # page downloads per run; the rest are picked up in the next runs
SUKL_WEB_MASS_UPDATE = 80     # more pages re-dated at once than this = a site-wide re-stamp, not edits


def sukl_page(url: str) -> tuple[str, list[str]]:
    page = fetch(url)
    m = re.search(r"(?is)<main\b.*?</main>", page)
    body = re.sub(r"(?is)<(nav|header|footer|form)\b.*?</\1>", " ", m.group(0) if m else page)
    h1 = re.search(r"(?is)<h1[^>]*>(.*?)</h1>", body)
    title = strip_html(h1.group(1)) if h1 else ""
    if not title:
        t = re.search(r"(?is)<title>(.*?)</title>", page)
        title = strip_html(t.group(1)).split(" | ")[0] if t else url.rsplit("/", 1)[-1]
    return title.replace("\n", " "), text_lines(strip_html(body))  # same cleaning as page_text()


def notice_summary(lines: list[str]) -> str:
    """'Typ oznámenia: Prerušenie · Platnosť od: 02.11.2026 · …' from the label/value lines of an availability notice."""
    out = []
    for i, ln in enumerate(lines[:-1]):
        if ln in SUKL_NOTICE_FIELDS and lines[i + 1] not in SUKL_NOTICE_FIELDS:
            out.append(f"{ln}: {lines[i + 1]}")
    return " · ".join(out)


def notice_date(summary: str) -> dt.datetime | None:
    """Filing date of a ŠÚKL availability notice: "Dátum hlásenia: 02.11.2026" or, since 11/2026, "2.11.2026 15:22"."""
    m = re.search(r"Dátum hlásenia: (\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})", summary or "")
    return parse_iso(f"{m[3]}-{int(m[2]):02d}-{int(m[1]):02d}T12:00:00Z") if m else None


def notice_key(summary: str) -> tuple | None:
    """What identifies an availability notice whatever its web address: ŠÚKL code, notice type and valid-from date
    (ŠÚKL republishes notices under new addresses, e.g. ...-prerusenie-02.11.2026 -> ...-prerusenie-2.11.2026)."""
    f = {k: v.strip() for k, v in re.findall(r"(Typ oznámenia|Platnosť od|Kód ŠÚKL): ([^·]+)", summary or "")}
    if len(f) < 3:
        return None
    d = re.match(r"(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})", f["Platnosť od"])
    valid = f"{d[3]}-{int(d[2]):02d}-{int(d[1]):02d}" if d else f["Platnosť od"]
    return f["Kód ŠÚKL"], fold(f["Typ oznámenia"]), valid


def check_sukl_web(rules: Rules, state: dict, bootstrap: bool, known_urls: set[str],
                   known_notices: set | None = None) -> list[dict]:
    st = state.setdefault("sukl_web", {})
    stamps, texts, failed = st.setdefault("lastmod", {}), st.setdefault("lines", {}), st.setdefault("failed", {})
    sitemap = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>\s*<lastmod>\s*([^<\s]+)\s*</lastmod>", fetch(SUKL_SITEMAP, timeout=90))
    if len(sitemap) < 100:
        raise RuntimeError(f"sitemap has only {len(sitemap)} pages")
    recent = (now_utc() - dt.timedelta(days=14)).date().isoformat()
    if bootstrap:
        stamps.update(dict(sitemap))
        # show the last two weeks straight away (not notified): supply notices first, then news, recalls and other pages
        todo = sorted(((u, m, False) for u, m in sitemap if m >= recent), key=lambda t: t[1], reverse=True)  # newest first
        todo.sort(key=lambda t: not any(f in t[0] for f, _ in SUKL_AVAILABILITY))  # stable: notices ahead
    else:
        new = [(u, m, True) for u, m in sitemap if u not in stamps]
        changed = [(u, m, False) for u, m in sitemap if u in stamps and m != stamps[u]]
        if len([1 for u, _, _ in changed if u not in texts]) > SUKL_WEB_MASS_UPDATE:
            for u, m, _ in changed:  # the whole site was re-dated; real edits on tracked pages still show
                if u not in texts:
                    stamps[u] = m
            changed = [c for c in changed if c[0] in texts]
        todo = new + changed
    results = []
    for n, (url, lastmod, is_new) in enumerate(todo):
        if n >= SUKL_WEB_FETCH_LIMIT:
            break  # stamps not updated: these are picked up next run
        if url in known_urls:
            stamps[url] = lastmod
            continue  # already reported by the ŠÚKL news or recall feed
        try:
            title, lines = sukl_page(url)
        except RuntimeError as e:
            # leave the old date so the next run tries again; give up on a page that keeps failing (e.g. a dead link)
            tries = failed[url] = failed.get(url, 0) + 1
            print(f"  ! {url}: {e}{' – giving up' if tries >= 3 else ' – will retry'}", file=sys.stderr)
            if tries >= 3:
                stamps[url] = lastmod
                del failed[url]
            continue
        stamps[url] = lastmod
        failed.pop(url, None)
        hashes = line_hashes(lines)
        old = texts.get(url)
        texts[url] = hashes
        if rules.excluded(title, url):
            continue
        notice = next((label for frag, label in SUKL_AVAILABILITY if frag in url.lower()), None)
        change = describe_change(lines, hashes, old) if old else None
        if old and change is None:
            continue  # re-dated, but the text is the same
        if notice and not old and known_notices is not None:
            key = notice_key(notice_summary(lines))
            if key in known_notices:
                continue  # the same notice, republished under a new address
            known_notices.add(key)
        if notice:
            category, base, heading = "Supply / availability", 2, title
            summary = change or notice_summary(lines) or " · ".join(lines[:6])
        else:
            category, base = next(((c, b) for frag, c, b in SUKL_SECTIONS if frag in url), ("ŠÚKL website", 1))
            if old:
                summary, heading = change, f"Updated page: {title}"
            else:
                summary = " · ".join(lines[1:6] if lines and lines[0] == title else lines[:5])
                heading = f"{'New page' if is_new else 'Updated page'}: {title}"
        level, tags = rules.match(f"{title} {summary}", specific_only=True)
        level = max(base, min(level, 3))
        reported = notice_date(notice_summary(lines)) if notice else None
        if reported and (bootstrap or is_new or not old):
            when = reported  # first time we read this notice: date it when it was filed
        else:
            when = now_utc() if not bootstrap else parse_iso(lastmod + "T12:00:00Z")
        uid = f"sukl_web:{url}:{hashlib.sha1(''.join(hashes).encode()).hexdigest()[:10]}"
        it = make_item("sukl_web", uid, heading, url, when, category, level, ([notice] if notice else []) + tags, summary)
        results.append(it)
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
    sections = []
    for n in amended:
        chunk = rules.amendment_text(text, n)
        if chunk:
            sections.append({"law": n, "law_name": rules.key_laws[n], "text": chunk})
    if sections:
        save_details(item, {"kind": "amendment", "act": ref, "title": title, "url": base, "sections": sections})
    return item


# --------------------------------------------------------------------------- key laws: new consolidated wording

HIST_ROW = re.compile(r'<tr class="effectivenessHistoryItem" data-iri="([^"]+)" data-vyhlasene="0" data-ucinnostod="(\d{4}-\d{2}-\d{2})"'
                      r'.*?</td><td>(?:<a href="([^"]*)">(.*?)</a>)?', re.S)


def check_lawchanges(rules: Rules, state: dict) -> list[dict]:
    """When Slov-Lex publishes a new consolidated wording of a key law (often ahead of its effective date),
    compare it with the previous wording provision by provision."""
    st = state.setdefault("lawchanges", {}).setdefault("laws", {})
    results, today = [], now_utc().date()
    for num, name in rules.key_laws.items():
        n, year = num.split("/")
        base = f"https://static.slov-lex.sk/static/SK/ZZ/{year}/{n}/"
        versions = [{"iri": iri, "from": frm, "novela": html.unescape(re.sub(r"<[^>]+>", "", nov or "")).replace("\xa0", " ").strip(),
                     "novela_url": urllib.parse.urljoin(base, href) if href else None}
                    for iri, frm, href, nov in HIST_ROW.findall(fetch(base))]
        versions.sort(key=lambda v: v["from"])
        known = st.get(num)
        if known is None:  # first time we see this law: show the most recent changes as backlog
            targets = [v for v in versions if dt.date.fromisoformat(v["from"]) >= today - dt.timedelta(days=150)][-2:]
            backlog = True
        else:
            targets = [v for v in versions if v["from"] not in known]
            backlog = False
        cache: dict[str, str] = {}
        for v in targets:
            idx = versions.index(v)
            if idx == 0:
                continue
            prev = versions[idx - 1]
            urls = [f"https://static.slov-lex.sk/static{x['iri']}.html" for x in (prev, v)]
            for u in urls:
                if u not in cache:
                    cache[u] = fetch(u, timeout=90)
            changes = lawdiff.compare(cache[urls[0]], cache[urls[1]])
            if not changes:
                continue
            level = LEVELS[rules.key_law_levels.get(num, "low")]
            eff = dt.date.fromisoformat(v["from"])
            title = f"{num} Z. z. – {name}: new wording in force from {sk_date(eff)}"
            by = v["novela"] or "an amending act"
            summary = (f"Changed by {by}{'' if by.endswith('.') else '.'} {len(changes)} provision(s) changed: "
                       f"{lawdiff.summarize(changes)}. Open the item to see the old and new wording.")
            date = min(dt.datetime.combine(eff, dt.time(8), dt.timezone.utc), now_utc())
            item = make_item("lawchanges", f"law:{num}:{v['from']}", title, urls[1], date, "Law change", level,
                             [f"Amends {num}"], summary)
            item["effective"] = [v["from"]]
            if backlog:
                item["_backlog"] = True
            save_details(item, {"kind": "law_diff", "law": num, "law_name": name, "from": prev["from"], "to": v["from"],
                                "amended_by": v["novela"], "amended_by_url": v["novela_url"],
                                "old_url": urls[0], "new_url": urls[1], "changes": changes})
            results.append(item)
        st[num] = [v["from"] for v in versions]
        time.sleep(0.3)
    return results


# --------------------------------------------------------------------------- draft legislation (eLegislatíva)

LP_API = "https://api-gateway.slov-lex.sk/internal/elegislativa/legislativne-materialy"


def check_slovlex_lp(rules: Rules, state: dict, bootstrap: bool) -> list[dict]:
    """New drafts and stage changes in the legislative process (pripomienkové konanie, vláda, NR SR, …)."""
    st = state.setdefault("slovlex_lp", {})
    mats = st.setdefault("materials", {})
    st.pop("last_run", None)  # older versions stored a timestamp; a rolling window keeps quiet runs change-free
    cutoff = now_utc().date() - dt.timedelta(days=60 if bootstrap else 14)
    results = []
    for page in range(1, 40):
        data = fetch_json(f"{LP_API}/filter?page={page}&size=100", {})
        batch = data.get("legMaterialList") or []
        for m in batch:
            if dt.date.fromisoformat(m["zaciatokStadia"]) < cutoff:
                continue
            num, stage = m["cisloLegislativnehoMaterialu"], m["stadium"]
            prev = mats.get(num)
            if prev and prev["stage"] == stage["hodnota"]:
                continue
            if prev is None:
                level, tags = rules.match(m["nazov"])
                refs = rules.law_refs(re.sub(r"(?i)v znen\w* .*", "", m["nazov"]))
                for n in refs:
                    level = max(level, LEVELS[rules.key_law_levels.get(n, "low")])
                    tags.append(f"Amends {n}")
                if m.get("typNazov") == "Akt EÚ" and level < LEVELS["medium"]:
                    level = 0  # EU acts only when clearly about our products
                rel = level
            else:
                rel, tags = prev["rel"], prev.get("tags", [])
            mats[num] = {"stage": stage["hodnota"], "rel": rel, "tags": tags}
            if not rel:
                continue
            try:
                d = fetch_json(f"{LP_API}/{num}")
            except Exception:
                d = {}
            inst = (d.get("zodpovednaInstitucia") or {}).get("nazov")
            amends = (d.get("hlavnyNovelizovanyPredpis") or {}).get("menovka")
            parts = [f"Stage: {stage['nazov']} (since {sk_date(m['zaciatokStadia'])})"]
            if prev:
                parts.insert(0, f"Moved from stage “{prev.get('stage_name', prev['stage'])}” to “{stage['nazov']}”")
            if stage["hodnota"] == "MPK" and m.get("datumUkonceniaPkMpk"):
                parts.append(f"Comments can be submitted until {sk_date(m['datumUkonceniaPkMpk'])}")
            if inst:
                parts.append(f"Submitted by: {inst}")
            if amends:
                parts.append(f"Main act amended: {amends}")
            mats[num]["stage_name"] = stage["nazov"]
            kind = m.get("typNazov") or "Návrh"
            title = f"{num} · {kind}: {m['nazov']}"
            category = "Bill in Parliament (NR SR)" if "narodnej rady" in fold(stage["nazov"]) else "Draft law"
            url = f"https://www.slov-lex.sk/elegislativa/legislativne-procesy/SK/{num}"
            item = make_item("slovlex_lp", f"lp:{num}:{stage['hodnota']}", title, url,
                             dt.datetime.fromisoformat(m["zaciatokStadia"] + "T08:00:00+00:00"),
                             category, rel, tags + [stage["nazov"]], " · ".join(parts))
            if stage["hodnota"] == "MPK" and m.get("datumUkonceniaPkMpk"):
                item["deadline"] = m["datumUkonceniaPkMpk"]
            results.append(item)
        if not batch or dt.date.fromisoformat(batch[-1]["zaciatokStadia"]) < cutoff:
            break
    return results


# --------------------------------------------------------------------------- monthly list of categorised medicines

def check_kategorizacia(rules: Rules, state: dict, bootstrap: bool) -> list[dict]:
    """Compare each month's list of categorised (reimbursed) medicines with the previous month."""
    st = state.setdefault("kategorizacia", {}).setdefault("months", {})
    page = fetch("https://www.health.gov.sk/?kategorizacia-a-ceny")
    months = {}
    for ym, label in re.findall(r'href="/Clanok\?lieky(\d{6})">([^<]+)<', page):
        months.setdefault(ym, html.unescape(label).strip())
    order = sorted(months)
    results = []

    def part_a_url(ym: str) -> str:
        art = fetch(f"https://www.health.gov.sk/Clanok?lieky{ym}")
        m = re.search(rf'href="(Zdroje\?/Sources/kategorizacia/zkl/{ym}/cast_A[^"]+\.xlsx)"', art)
        if not m:
            raise RuntimeError(f"Part A file not found for {ym}")
        return "https://www.health.gov.sk/" + html.unescape(m.group(1))

    def part_a(ym: str) -> bytes:
        return fetch_raw(part_a_url(ym), timeout=120)[0]

    for ym in order[-2:]:
        known = st.get(ym, {})
        if known.get("url") and known.get("stamp") and now_utc().hour != 5:  # full download once a day regardless
            # cheap check first: the file's size/date; only download when it changed (checks run every 15 min)
            if head_stamp(known["url"]) == known["stamp"]:
                continue
        url = part_a_url(ym)
        data = fetch_raw(url, timeout=120)[0]
        stamp = head_stamp(url)
        digest_ = hashlib.sha1(data).hexdigest()[:12]
        if known.get("hash") == digest_:
            st[ym] = {**known, "url": url, "stamp": stamp}
            continue
        idx = order.index(ym)
        if idx == 0:
            continue
        prev_ym = order[idx - 1]
        diff = pricelist.compare(pricelist.products(part_a(prev_ym)), pricelist.products(data))
        c = diff["counts"]
        y, mo = int(ym[:4]), int(ym[4:])
        valid_from = dt.date(y, mo, 1)
        revised = ym in st
        title = (f"{months[ym]}{' (updated version)' if revised else ''}: "
                 f"{c['added']} added, {c['removed']} removed, {c['changed']} price/reimbursement changes")
        summary = (f"Compared with the list valid from {sk_date(dt.date(int(prev_ym[:4]), int(prev_ym[4:]), 1))}. "
                   "Open the item for the full lists by ŠÚKL code.")
        examples = list(dict.fromkeys(p["name"] for p in diff["added"]))[:3]
        if examples:
            summary += " New e.g.: " + ", ".join(examples) + "."
        date = now_utc() if not bootstrap else min(dt.datetime.combine(valid_from, dt.time(8), dt.timezone.utc), now_utc())
        item = make_item("kategorizacia", f"kat:{ym}:{digest_}", title, f"https://www.health.gov.sk/Clanok?lieky{ym}", date,
                         "Reimbursement & prices", 3, ["Reimbursement / categorisation", "Price regulation"], summary)
        item["effective"] = [valid_from.isoformat()]
        save_details(item, {"kind": "price_list", "month": ym, "previous": prev_ym, "title": months[ym], **diff})
        results.append(item)
        st[ym] = {"hash": digest_, "title": months[ym], "url": url, "stamp": stamp}
    return results


# --------------------------------------------------------------------------- EU: Official Journal via the Publications Office

SPARQL = "https://publications.europa.eu/webapi/rdf/sparql"
EU_TYPES = ("REG", "REG_IMPL", "REG_DEL", "DIR", "DIR_IMPL", "DIR_DEL", "DEC", "DEC_IMPL", "DEC_DEL")


def check_eurlex(rules: Rules, state: dict, bootstrap: bool) -> list[dict]:
    seen = state.setdefault("eurlex", {}).setdefault("seen", {})
    since = now_utc().date() - dt.timedelta(days=75)
    query = f"""PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
SELECT ?celex ?date ?type ?lang ?title WHERE {{
  ?work cdm:resource_legal_id_celex ?celex ; cdm:work_date_document ?date ; cdm:work_has_resource-type ?rt .
  FILTER(?date >= "{since}"^^xsd:date)
  FILTER(STRSTARTS(?celex, "3"))
  BIND(STRAFTER(STR(?rt), "resource-type/") AS ?type)
  FILTER(?type IN ({",".join(f'"{t}"' for t in EU_TYPES)}))
  ?exp cdm:expression_belongs_to_work ?work ; cdm:expression_title ?title ; cdm:expression_uses_language ?lang .
  FILTER(?lang IN (<http://publications.europa.eu/resource/authority/language/ENG>,
                   <http://publications.europa.eu/resource/authority/language/SLK>))
}}"""
    url = SPARQL + "?" + urllib.parse.urlencode({"query": query})
    raw, charset = fetch_raw(url, timeout=120, headers={"Accept": "application/sparql-results+json"})
    acts: dict[str, dict] = {}
    for r in json.loads(raw.decode(charset))["results"]["bindings"]:
        a = acts.setdefault(r["celex"]["value"], {"date": r["date"]["value"], "type": r["type"]["value"]})
        a["sk" if r["lang"]["value"].endswith("SLK") else "en"] = r["title"]["value"].replace("\xa0", " ")
    results = []
    for celex, a in acts.items():
        if celex in seen or "en" not in a:
            continue
        seen[celex] = iso(now_utc())
        level, tags = rules.match_en(a["en"])
        if a["en"].lower().startswith("corrigendum"):
            level = min(level, LEVELS["medium"])
        if level < rules.eurlex_min:
            continue  # feed additives, biocide approvals etc. are too frequent to be useful
        amending = re.findall(r"amending (?:Implementing |Delegated )?(?:Regulation|Directive|Decision) \((?:EU|EC|EEC)\) (?:No )?[\d/]+", a["en"])
        summary = a["en"] if a.get("sk") else ""
        if amending:
            summary = ("Changes: " + "; ".join(amending[:3]) + ". " + summary).strip()
        item = make_item("eurlex", f"eu:{celex}", a.get("sk") or a["en"],
                         f"https://eur-lex.europa.eu/legal-content/SK/TXT/?uri=CELEX:{celex}",
                         dt.datetime.fromisoformat(a["date"] + "T08:00:00+00:00"), "EU legislation", level, tags, summary)
        item["doc_type"] = a["type"]
        results.append(item)
    return results


# --------------------------------------------------------------------------- ŠVPS (state veterinary & food administration)

SVPS_CATEGORIES = {  # RSS category -> (our category, base level)
    "veterinarne lieky": ("Veterinary (ŠVPS)", 3),
    "mimoriadne nudzove opatrenia": ("Animal health (ŠVPS)", 2),
    "nakazy a choroby zvierat": ("Animal health (ŠVPS)", 1),
    "nevyhovujuce vyrobky": ("Product safety (ŠVPS)", 0),  # food recalls: only when keywords match (e.g. supplements)
    "legislativa": ("Veterinary (ŠVPS)", 2),
}


def check_svps(rules: Rules, state: dict) -> list[dict]:
    seen = state.setdefault("svps", {}).setdefault("seen", {})
    raw = fetch("https://svps.sk/feed/")
    root = ET.fromstring(raw.encode("utf-8"))
    results = []
    for it in root.iter("item"):
        title = html.unescape(it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        uid = (it.findtext("guid") or link).strip()
        if uid in seen:
            continue
        seen[uid] = iso(now_utc())
        cats = [fold(c.text or "") for c in it.findall("category")]
        text = strip_html(it.findtext("description") or "")
        if rules.excluded(title, " ".join(cats)) or any("pracovnych miest" in c or "majetku" in c for c in cats):
            continue
        level, tags = rules.match(f"{title} {text}")
        category, base = "ŠVPS notice", 0
        for c in cats:
            if c in SVPS_CATEGORIES and SVPS_CATEGORIES[c][1] > base:
                category, base = SVPS_CATEGORIES[c]
        level = max(level, base)
        if not level:
            continue  # food hygiene reports etc. without a link to our products
        try:
            pub = email.utils.parsedate_to_datetime(it.findtext("pubDate") or "")
        except (TypeError, ValueError):
            pub = None
        results.append(make_item("svps", uid, title, link, pub, category, level, tags, text))
    return results


# --------------------------------------------------------------------------- EMA news

def check_ema(rules: Rules, state: dict) -> list[dict]:
    seen = state.setdefault("ema", {}).setdefault("seen", {})
    results = []
    for it in rss_items(fetch("https://www.ema.europa.eu/en/news.xml")):
        uid = it["link"] or it["guid"]
        if uid in seen:
            continue
        seen[uid] = iso(now_utc())
        text = strip_html(it["description"])
        _, tags = rules.match_en(f"{it['title']} {text}")
        level = max(1, rules.match_en(it["title"])[0])  # the headline decides the priority
        results.append(make_item("ema", uid, it["title"], it["link"], it["date"], "EU agency (EMA)", level, tags, text))
    return results


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

HEAVY_SOURCES = {"lawchanges", "eurlex", "kategorizacia"}


def normalized(store: dict) -> str:
    """The published data without the timestamps that change on every run."""
    s = json.loads(json.dumps(store))
    s.pop("updated", None)
    for st in (s.get("sources") or {}).values():
        st.pop("checked", None)
        st.pop("new", None)
    return json.dumps(s, sort_keys=True, ensure_ascii=False)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--notify-out", help="write Markdown digest of new items here (first line = title)")
    ap.add_argument("--sources", default=",".join(SOURCES), help="comma-separated subset of: " + ",".join(SOURCES))
    ap.add_argument("--heavy", choices=["always", "hourly"], default="always",
                    help="'hourly': run the heavier sources (law wordings, EUR-Lex, price list) only in the first "
                         "20 minutes of each hour – used by the 15-minute schedule")
    args = ap.parse_args()

    rules = Rules(load_json(CONFIG_FILE, None))
    state = load_json(STATE_FILE, {})
    store = load_json(ITEMS_FILE, {"items": [], "sources": {}})
    for i in store["items"]:  # ÚŠKVBL page items from before the WordPress tracker: "uskvbl:<page>:<modified>"
        if re.fullmatch(r"uskvbl:\d+:[^:].*", i["id"]):
            i["id"] = "uskvbl:pages:" + i["id"].split(":", 1)[1]
    known = {i["id"] for i in store["items"]}
    status = store.setdefault("sources", {})
    new_items: list[dict] = []
    started = now_utc()

    keys = [s.strip() for s in args.sources.split(",") if s.strip()]
    if args.heavy == "hourly" and now_utc().minute >= 20:  # the :02 run, even when GitHub starts it late
        keys = [k for k in keys if k not in HEAVY_SOURCES or k not in state]
    before = normalized(load_json(ITEMS_FILE, {}))
    for i in store["items"]:  # supply notices first listed with the day we read them: use the day they were filed
        filed = notice_date(i["summary"]) if i.get("source") == "sukl_web" and i.get("category") == "Supply / availability" else None
        if filed and iso(filed) < i["date"] and not i["summary"].startswith("Added:"):
            i["date"] = iso(filed)
    firsts: dict = {}  # the same notice listed twice under two addresses: keep the first one found
    for i in sorted(store["items"], key=lambda i: i["detected"]):
        key = notice_key(i["summary"]) if i.get("source") == "sukl_web" else None
        if key:
            firsts.setdefault(key, i["id"])
    store["items"] = [i for i in store["items"] if i.get("source") != "sukl_web" or
                      firsts.get(notice_key(i["summary"]), i["id"]) == i["id"]]
    for key in keys:
        bootstrap = key not in state
        print(f"→ {key}{' (first run – baseline)' if bootstrap else ''}")
        try:
            if key == "slovlex":
                found = check_slovlex(rules, state, bootstrap)
            elif key in ("sukl", "sukl_recall"):
                found = check_sukl(rules, state, recalls_only=key == "sukl_recall")
            elif key == "mzsr":
                found = check_mzsr(rules, state)
            elif key in ("uskvbl", "sool"):
                found = check_wordpress(key, rules, state, bootstrap)
            elif key == "sukl_web":
                found = check_sukl_web(rules, state, bootstrap, {i["url"] for i in store["items"]},
                                       {notice_key(i["summary"]) for i in store["items"] if i.get("source") == "sukl_web"} - {None})
            elif key == "lawchanges":
                found = check_lawchanges(rules, state)
            elif key == "slovlex_lp":
                found = check_slovlex_lp(rules, state, bootstrap)
            elif key == "kategorizacia":
                found = check_kategorizacia(rules, state, bootstrap)
            elif key == "eurlex":
                found = check_eurlex(rules, state, bootstrap)
            elif key == "ema":
                found = check_ema(rules, state)
            elif key == "svps":
                found = check_svps(rules, state)
            else:
                print(f"  unknown source {key}", file=sys.stderr)
                continue
            if bootstrap:
                days = {"slovlex": 400, "lawchanges": 400, "kategorizacia": 400}.get(key, rules.bootstrap_days)
                cutoff = started - dt.timedelta(days=days)
                found = [i for i in found if parse_iso(i["date"]) >= cutoff]
            for i in found:
                if bootstrap or i.pop("_backlog", False):
                    i["detected"] = min(i["date"], i["detected"])  # don't flag the backlog as "new"
                    i["backlog"] = True
            fresh = [i for i in found if i["id"] not in known]
            store["items"].extend(fresh)
            new_items.extend(i for i in fresh if not i.pop("backlog", False))
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
    if normalized(store) != before:  # only record a new version when something besides check times changed
        store["updated"] = iso(started)
        save_json(ITEMS_FILE, store)
    else:
        print("No changes to the published data.")
    # the dashboard reads this to show when the sources were really last checked, even when nothing changed
    save_json(STATUS_FILE, {"checked": iso(started), "sources": status})
    referenced = {Path(i["details"]).name for i in store["items"] if i.get("details")}
    for f in CHANGES_DIR.glob("*.json"):
        if f.name not in referenced:
            f.unlink()  # detail files of items that were dropped or aged out

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
