#!/usr/bin/env python3
"""Temporary: print the structure of candidate source pages from a GitHub runner."""
import re, sys, html, urllib.request, urllib.error

UA = "Mozilla/5.0 (compatible; PharmacopolaRegMonitor/1.0)"
BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
# url || anchor filter regex || timeout || user agent
URLS = sys.argv[1:] or [
    "https://www.nrsr.sk/web/Default.aspx?sid=zakony/prehlad/predlozene||ZakZakon|zakon&||150",
    "https://www.nrsr.sk/web/Default.aspx?sid=zakony/prehlad/posledneSchvalene||ZakZakon|zakon&||150",
    "https://uvzsr.sk/||.||40||browser",
    "http://www.uvzsr.sk/||.||40||browser",
    "https://www.uvzsr.sk/web/uvz/aktuality||.||40||browser",
]

for spec in URLS:
    url, flt, timeout, ua = (spec.split("||") + ["", "", "", ""])[:4]
    flt = re.compile(flt or ".", re.I)
    print("=" * 100)
    print("URL", url)
    try:
        h = {"User-Agent": BROWSER_UA if ua == "browser" else UA, "Accept": "text/html,application/xhtml+xml,*/*",
             "Accept-Language": "sk,en;q=0.8"}
        if ua == "browser":
            h.update({"Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none",
                      "Upgrade-Insecure-Requests": "1"})
        req = urllib.request.Request(url, headers=h)
        with urllib.request.urlopen(req, timeout=int(timeout or 40)) as r:
            body = r.read()
            print("STATUS", r.status, "FINAL", r.geturl(), "TYPE", r.headers.get("Content-Type"), "LEN", len(body))
            text = body.decode(r.headers.get_content_charset() or "utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        print("HTTP ERROR", e.code, dict(e.headers)); print("BODY", e.read()[:800]); continue
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
    for t in tables[:1]:
        for row in re.findall(r"<tr.*?</tr>", t, re.S)[:40]:
            if "pager" in row or "__doPostBack" in row:
                continue
            links = re.findall(r'href="([^"]+)"', row)
            cells = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", c))).strip()
                     for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)]
            print("ROW", cells, links[:3])
