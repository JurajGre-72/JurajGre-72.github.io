#!/usr/bin/env python3
"""Temporary: print the structure of candidate source pages from a GitHub runner."""
import re, sys, html, urllib.request, urllib.error

UA = "Mozilla/5.0 (compatible; PharmacopolaRegMonitor/1.0)"
URLS = sys.argv[1:] or [
    "https://www.nrsr.sk/web/",
    "https://www.nrsr.sk/web/Default.aspx?sid=zakony/prehlad/predlozene",
    "https://www.nrsr.sk/web/Default.aspx?sid=rss",
    "https://www.svps.sk/",
    "https://www.svps.sk/aktuality",
    "https://www.ema.europa.eu/en/news.xml",
    "https://www.ema.europa.eu/en/news-events/rss-feeds",
    "https://www.uvzsr.sk/",
    "https://www.uvzsr.sk/index.php?format=feed&type=rss",
    "https://static.slov-lex.sk/static/SK/ZZ/2026/",
    "https://www.sukl.sk/sk/rss?page_id=1355&pid=208&days=30",
    "https://www.health.gov.sk/RSS?Clanky",
    "https://www.uskvbl.sk/index.php?rest_route=/wp/v2/pages&per_page=1",
    "https://api-gateway.slov-lex.sk/internal/elegislativa/legislativne-materialy/LP/2026/532",
    "https://publications.europa.eu/webapi/rdf/sparql?query=select%201%20where%20%7B%7D",
]

for url in URLS:
    print("=" * 100)
    print("URL", url)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "sk,en;q=0.8"})
        with urllib.request.urlopen(req, timeout=40) as r:
            body = r.read()
            print("STATUS", r.status, "FINAL", r.geturl(), "TYPE", r.headers.get("Content-Type"), "LEN", len(body))
            text = body.decode(r.headers.get_content_charset() or "utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        print("HTTP ERROR", e.code); continue
    except Exception as e:
        print("ERROR", e); continue
    m = re.search(r"<title[^>]*>(.*?)</title>", text, re.S | re.I)
    print("TITLE", html.unescape(m.group(1)).strip()[:150] if m else None)
    for f in re.findall(r"<link[^>]+(?:rss|atom)[^>]*>", text, re.I)[:10]:
        print("FEED", f)
    if "<item" in text or "<entry" in text:
        for it in re.findall(r"<(?:item|entry)\b.*?</(?:item|entry)>", text, re.S)[:6]:
            print("ITEM", re.sub(r"\s+", " ", it)[:600])
        continue
    seen = set()
    n = 0
    for href, label in re.findall(r'<a\s[^>]*?href="([^"#]+)"[^>]*>(.*?)</a>', text, re.S | re.I):
        label = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", label))).strip()
        if href in seen or len(label) < 4:
            continue
        seen.add(href)
        print("A", href[:160], "|", label[:140])
        n += 1
        if n >= 90:
            break
    tables = re.findall(r"<table.*?</table>", text, re.S | re.I)
    print("TABLES", len(tables))
    for t in tables[:2]:
        print("TABLE", re.sub(r"\s+", " ", t)[:2500])
