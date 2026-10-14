"""Read the Ministry of Health's monthly list of categorised medicines (Part A, .xlsx) and compare months.

Only the standard library is used: an .xlsx file is a zip of XML sheets.
"""

from __future__ import annotations

import io
import re
import zipfile
import xml.etree.ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
ATC = re.compile(r"^[A-Z]\d\d[A-Z]{0,2}\d{0,2}$")
CODE = re.compile(r"^[0-9A-Z]{5}$")
# column index -> field, from the header rows of "cast_A_zoznam_liekov"
FIELDS = {5: "name", 6: "pack", 7: "mah", 10: "price", 11: "reimb", 13: "copay", 17: "po", 18: "io"}
TRACKED = {"price": "Max. price €", "reimb": "Reimbursement €", "copay": "Patient co-pay €", "po": "Prescription restriction",
           "io": "Indication restriction"}


def _col(ref: str) -> int:
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group():
        n = n * 26 + ord(ch) - 64
    return n - 1


def rows(data: bytes) -> list[list[str]]:
    z = zipfile.ZipFile(io.BytesIO(data))
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(NS + "si"):
            shared.append("".join(t.text or "" for t in si.iter(NS + "t")))
    sheet = next(n for n in z.namelist() if n.startswith("xl/worksheets/sheet"))
    out = []
    for _, el in ET.iterparse(z.open(sheet)):
        if el.tag != NS + "row":
            continue
        row = {}
        for c in el.iter(NS + "c"):
            t, v = c.get("t"), c.find(NS + "v")
            if t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter(NS + "t"))
            elif v is None:
                continue
            else:
                val = shared[int(v.text)] if t == "s" else v.text
            row[_col(c.get("r"))] = val or ""
        if row:
            out.append([row.get(i, "") for i in range(max(row) + 1)])
        el.clear()
    return out


def _money(v: str) -> str:
    try:
        return f"{float(v.replace(',', '.')):.2f}"
    except ValueError:
        return v.strip()


def products(data: bytes) -> dict[str, dict]:
    """ŠÚKL code -> product fields, with the active substance (ATC group) it is listed under."""
    out, atc, substance = {}, "", ""
    for r in rows(data)[2:]:
        r = r + [""] * (20 - len(r))
        if CODE.match(r[0]) and r[5] and r[10]:  # product rows carry a price; ATC group rows do not
            p = {"code": r[0], "atc": atc, "substance": substance}
            for i, f in FIELDS.items():
                p[f] = _money(r[i]) if f in ("price", "reimb", "copay") else r[i].strip()
            out[r[0]] = p
        elif ATC.match(r[0]):
            atc, substance = r[0], r[5]
    return out


def compare(old: dict[str, dict], new: dict[str, dict], limit: int = 3000) -> dict:
    added = [new[k] for k in new if k not in old]
    removed = [old[k] for k in old if k not in new]
    changed = []
    for k in new:
        if k not in old:
            continue
        diffs = {f: [old[k][f], new[k][f]] for f in TRACKED if old[k][f] != new[k][f]}
        if diffs:
            changed.append({**{f: new[k][f] for f in ("code", "name", "pack", "substance", "atc", "mah")}, "changes": diffs})
    key = lambda p: (p["substance"], p["name"])
    return {"added": sorted(added, key=key)[:limit], "removed": sorted(removed, key=key)[:limit],
            "changed": sorted(changed, key=key)[:limit], "fields": TRACKED,
            "counts": {"added": len(added), "removed": len(removed), "changed": len(changed)}}
