"""Compare two consolidated versions of a Slovak law from static.slov-lex.sk, provision by provision.

Slov-Lex marks every provision with a stable id, e.g. ``paragraf-18.odsek-1.pismeno-c.text``.
We collect the text of each such element and compare the two versions key by key, so the
result reads like "§ 18 ods. 1 písm. c): old text → new text".
"""

from __future__ import annotations

import difflib
import re
from html.parser import HTMLParser

VOID = {"area", "base", "br", "col", "hr", "img", "input", "link", "meta", "source", "wbr"}
NAMES = {"paragraf": "§", "odsek": "ods.", "bod": "bod", "clanok": "Čl.", "priloha": "Príloha", "cast": "Časť",
         "hlava": "Hlava", "diel": "Diel", "oddiel": "Oddiel"}


class _Provisions(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[str, str | None, bool]] = []
        self.skip = 0  # inside a footnote marker such as <a href="#poznamky.poznamka-85e"><sup>85e</sup>)</a>
        self.open: list[tuple[str, list[str]]] = []
        self.out: dict[str, str] = {}

    def handle_starttag(self, tag, attrs):
        if tag in VOID:
            return
        a = dict(attrs)
        pid = a.get("id") or ""
        capture = (pid.endswith(".text") or pid.endswith(".nadpis")) and not pid.startswith("poznamky")
        footnote = tag == "a" and (a.get("href") or "").startswith("#poznamky")
        self.skip += footnote
        self.stack.append((tag, pid if capture else None, footnote))
        if capture:
            self.open.append((pid, []))

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        for k in range(len(self.stack) - 1, -1, -1):
            if self.stack[k][0] != tag:
                continue
            for _, pid, footnote in reversed(self.stack[k:]):
                self.skip -= footnote
                if pid:
                    for c in range(len(self.open) - 1, -1, -1):
                        if self.open[c][0] == pid:
                            _, parts = self.open.pop(c)
                            self.out[pid] = re.sub(r"\s+", " ", "".join(parts)).strip()
                            break
            del self.stack[k:]
            return

    def handle_data(self, data):
        if self.skip:
            return
        for _, parts in self.open:
            parts.append(data)


def provisions(page_html: str) -> dict[str, str]:
    p = _Provisions()
    p.feed(page_html)
    p.close()
    return p.out


def label(pid: str) -> str:
    """'paragraf-18.odsek-1.pismeno-c.text' -> '§ 18 ods. 1 písm. c)'"""
    nadpis = pid.endswith(".nadpis")
    pid = re.sub(r"\.(text|nadpis)$", "", pid)
    out = []
    for part in pid.split("."):
        kind, _, val = part.partition("-")
        annex = re.match(r"priloha_c_(\w+?)_k_", part)
        if annex:
            out.append(f"Príloha č. {annex.group(1)}")
        elif part == "prilohy" or part.startswith("op-"):
            continue
        elif kind == "pismeno":
            out.append(f"písm. {val})")
        elif kind in NAMES:
            out.append(f"{NAMES[kind]} {val}".strip())
        else:
            out.append(part)
    return " ".join(out) + (" (nadpis)" if nadpis else "")


def word_diff(old: str, new: str) -> list[list[str]]:
    """[['=', 'same words'], ['-', 'removed'], ['+', 'added'], ...]"""
    a, b = re.findall(r"\S+\s*", old), re.findall(r"\S+\s*", new)
    ops = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag == "equal":
            ops.append(["=", "".join(a[i1:i2])])
        else:
            if i2 > i1:
                ops.append(["-", "".join(a[i1:i2])])
            if j2 > j1:
                ops.append(["+", "".join(b[j1:j2])])
    return ops


def compare(old_html: str, new_html: str, limit: int = 400) -> list[dict]:
    old, new = provisions(old_html), provisions(new_html)
    changes = []
    for pid in dict.fromkeys(list(old) + list(new)):
        o, n = old.get(pid), new.get(pid)
        if o == n:
            continue
        entry = {"loc": label(pid), "type": "added" if o is None else "removed" if n is None else "changed"}
        if entry["type"] == "changed":
            entry["diff"] = word_diff(o, n)
        else:
            entry["text"] = n if o is None else o
        changes.append(entry)
        if len(changes) >= limit:
            break
    return changes


def summarize(changes: list[dict], n: int = 6) -> str:
    locs = []
    for c in changes:
        top = re.match(r"(§ \S+|Čl\. \S+|Príloha \S+)", c["loc"])
        key = top.group(1) if top else c["loc"]
        if key not in locs:
            locs.append(key)
    more = f" +{len(locs) - n} more" if len(locs) > n else ""
    return ", ".join(locs[:n]) + more
