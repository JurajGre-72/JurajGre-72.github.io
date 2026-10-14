#!/usr/bin/env python3
"""Temporary: print the structure of candidate source pages from a GitHub runner."""
import re, sys, html, urllib.request, urllib.error

UA = "Mozilla/5.0 (compatible; PharmacopolaRegMonitor/1.0)"
BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
# url || anchor filter regex || timeout || user agent
URLS = sys.argv[1:] or [
    "https://svps.sk/feed/",
    "https://svps.sk/wp-json/wp/v2/posts?per_page=3&_fields=id,date,modified,title,link,categories",
    "https://svps.sk/wp-json/wp/v2/categories?per_page=100&_fields=id,name,count",
    "https://www.nrsr.sk/web/Default.aspx?sid=zakony/prehlad/predlozene||zakon|cpt|sid=||150",
    "https://www.nrsr.sk/web/Default.aspx?sid=zakony/sslp||zakon|cpt|sid=||150",
    "https://www.ema.europa.eu/en/news-events/rss-feeds||xml|rss",
    "https://www.uvzsr.sk/||.||40||browser",
    "https://www.uvzsr.sk/web/uvz||.||40||browser",
]

for spec in URLS:
    url, flt, timeout, ua = (spec.split("||") + ["", "", "", ""])[:4]
    flt = re.compile(flt or ".", re.I)
    print("=" * 100)
    print("URL", url)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": BROWSER_UA if ua == "browser" else UA,
                                                   "Accept": "text/html,application/xhtml+xml,*/*", "Accept-Language": "sk,en;q=0.8"})
        with urllib.request.urlopen(req, timeout=int(timeout or 40)) as r:
            body = r.read()
            print("STATUS", r.status, "FINAL", r.geturl(), "TYPE", r.headers.get("Content-Type"), "LEN", len(body))
            text = body.decode(r.headers.get_content_charset() or "utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        print("HTTP ERROR", e.code, dict(e.headers)); print(e.read()[:800]); continue
    except Exception as e:
        print("ERROR", e); continue
    m = re.search(r"<title[^>]*>(.*?)</title>", text, re.S | re.I)
    print("TITLE", html.unescape(m.group(1)).strip()[:150] if m else None)
    for f in re.findall(r"<link[^>]+(?:rss|atom)[^>]*>", text, re.I)[:10]:
        print("FEED", f)
    if text.lstrip().startswith(("[", "{")):
        print("JSON", text[:3000])
        continue
    if "<item" in text or "<entry" in text:
        for it in re.findall(r"<(?:item|entry)\b.*?</(?:item|entry)>", text, re.S)[:6]:
            print("ITEM", re.sub(r"\s+", " ", it)[:600])
        continue
    seen = set()
    n = 0
    for href, label in re.findall(r'<a\s[^>]*?href="([^"#]+)"[^>]*>(.*?)</a>', text, re.S | re.I):
        label = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", label))).strip()
        if href in seen or len(label) < 2 or not (flt.search(href) or flt.search(label)):
            continue
        seen.add(href)
        print("A", href[:160], "|", label[:140])
        n += 1
        if n >= 150:
            break
    tables = re.findall(r"<table.*?</table>", text, re.S | re.I)
    print("TABLES", len(tables))
    for t in tables[:2]:
        print("TABLE", re.sub(r"\s+", " ", t)[:2500])
