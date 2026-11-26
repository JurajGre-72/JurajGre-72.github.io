"""Slovak versions of what the monitor writes itself: titles, categories, tags and summary phrases.

Text quoted from the sources (ŠÚKL, Slov-Lex, EMA…) stays as published; only the monitor's own wording is translated.
"""
import re

LABELS = {
    # categories
    "Veterinary (ÚŠKVBL)": "Veterina (ÚŠKVBL)", "Draft law": "Návrh predpisu", "Legislation": "Legislatíva",
    "Law change": "Zmena zákona", "Supply / availability": "Dostupnosť liekov", "ŠÚKL notice": "Oznam ŠÚKL",
    "ŠVPS notice": "Oznam ŠVPS", "EU agency (EMA)": "Agentúra EÚ (EMA)", "Drug safety": "Bezpečnosť liekov",
    "Ministry of Health": "Ministerstvo zdravotníctva", "ŠÚKL website": "Web ŠÚKL", "Recall / quality": "Stiahnutie / kvalita",
    "Distribution & pharmacies": "Distribúcia a lekárne", "Bill in Parliament (NR SR)": "Návrh zákona v NR SR",
    "Reimbursement & prices": "Úhrady a ceny", "Medical devices": "Zdravotnícke pomôcky", "EU legislation": "Legislatíva EÚ",
    "Supply disruption": "Výpadok dodávok", "Animal health (ŠVPS)": "Zdravie zvierat (ŠVPS)",
    "Medicines verification (SOOL)": "Overovanie liekov (SOOL)", "Veterinary (ŠVPS)": "Veterina (ŠVPS)",
    "Product safety (ŠVPS)": "Bezpečnosť výrobkov (ŠVPS)", "SDP / GDP": "SDP / GDP",
    # tags
    "Accounting": "Účtovníctvo", "Advertising of medicines": "Reklama liekov", "Animal diseases": "Choroby zvierat",
    "Antimicrobials": "Antimikrobiká", "Authorisation opinions": "Stanoviská k registrácii", "Biocides": "Biocídy",
    "Biocides & chemicals": "Biocídy a chemikálie", "Clinical trials": "Klinické skúšanie", "Commercial law": "Obchodné právo",
    "Consumer protection": "Ochrana spotrebiteľa", "Cosmetics": "Kozmetika", "Customs": "Clo", "Data protection": "Ochrana údajov",
    "Dietetic foods": "Dietetické potraviny", "E-invoicing": "Elektronická fakturácia", "Feed": "Krmivá",
    "Food supplements": "Výživové doplnky", "Health data": "Zdravotné údaje", "Health insurance": "Zdravotné poistenie",
    "Health technology assessment": "Hodnotenie zdravotníckych technológií", "Healthcare providers": "Poskytovatelia zdravotnej starostlivosti",
    "Labour law": "Pracovné právo", "Maximum residue limits": "Maximálne limity rezíduí", "Medicines": "Lieky",
    "Medicines (general)": "Lieky (všeobecne)", "Narcotics & precursors": "Omamné látky a prekurzory",
    "Packaging & waste": "Obaly a odpady", "Waste & packaging": "Odpady a obaly", "Pharmacy": "Lekárne",
    "Price regulation": "Regulácia cien", "Public procurement": "Verejné obstarávanie", "Recall / quality defect": "Stiahnutie / chyba kvality",
    "Reimbursement / categorisation": "Úhrady / kategorizácia", "Shortages / supply": "Výpadky / dodávky", "Taxes": "Dane",
    "Transport of goods": "Preprava tovaru", "VAT": "DPH", "VAT / customs": "DPH / clo", "Vaccines": "Vakcíny",
    "Veterinary care": "Veterinárna starostlivosť", "Veterinary medicines": "Veterinárne lieky",
    "Wholesale distribution": "Veľkodistribúcia", "Medicines verification": "Overovanie liekov",
    "Supply interruption": "Prerušenie dodávok", "Supply resumed": "Obnovenie dodávok", "Supply ended": "Ukončenie dodávok",
    "First placed on the market": "Prvé uvedenie na trh",
}

LAWS = {
    "362/2011": "zákon o liekoch a zdravotníckych pomôckach",
    "129/2012": "vyhláška o správnej výrobnej praxi a správnej veľkodistribučnej praxi",
    "363/2011": "zákon o rozsahu a podmienkach úhrady liekov (kategorizácia)",
    "39/2007": "zákon o veterinárnej starostlivosti",
    "139/1998": "zákon o omamných a psychotropných látkach",
    "577/2004": "zákon o rozsahu zdravotnej starostlivosti uhrádzanej z verejného zdravotného poistenia",
    "578/2004": "zákon o poskytovateľoch zdravotnej starostlivosti",
    "581/2004": "zákon o zdravotných poisťovniach",
    "147/2001": "zákon o reklame",
    "152/1995": "zákon o potravinách",
    "67/2010": "chemický zákon",
    "18/1996": "zákon o cenách",
    "79/2015": "zákon o odpadoch",
    "222/2004": "zákon o dani z pridanej hodnoty",
    "595/2003": "zákon o dani z príjmov",
    "431/2002": "zákon o účtovníctve",
    "513/1991": "Obchodný zákonník",
    "311/2001": "Zákonník práce",
    "108/2024": "zákon o ochrane spotrebiteľa",
}

TITLE_PREFIXES = {
    "Document published": "Zverejnený dokument", "New document": "Nový dokument", "Updated page": "Aktualizovaná stránka",
    "New page": "Nová stránka", "New article": "Nový článok", "Updated article": "Aktualizovaný článok", "Changed": "Zmena",
}


def label(text: str) -> str:
    """A category or tag in Slovak ("Amends 39/2007" -> "Mení 39/2007"); unknown ones stay as they are."""
    if text.startswith("Amends "):
        return "Mení " + text[7:]
    return LABELS.get(text, text)


def law_name(num: str, english: str = "") -> str:
    return LAWS.get(num, english)


def counts(text: str) -> str:
    """'17 added, 7 removed, 26 price/reimbursement changes' -> Slovak."""
    return re.sub(r"(\d+) added, (\d+) removed, (\d+) price/reimbursement changes",
                  r"pridané: \1, vyradené: \2, zmeny cien a úhrad: \3", text)


def title(item: dict) -> str:
    t, src = item.get("title", ""), item.get("source", "")
    if src == "lawchanges":
        m = re.match(r"(\S+) Z\. z\. – (.*): new wording in force from (\S+)$", t)
        if m:
            return f"{m[1]} Z. z. – {law_name(m[1], m[2])}: nové znenie účinné od {m[3]}"
    if src == "kategorizacia":
        return counts(t.replace(" (updated version)", " (aktualizovaná verzia)"))
    head, sep, rest = t.partition(": ")
    if sep and head in TITLE_PREFIXES:
        return f"{TITLE_PREFIXES[head]}: {rest}"
    return t


PHRASES = [
    (r"Moved from stage “([^”]*)” to “([^”]*)”", r"Presunuté zo štádia „\1“ do štádia „\2“"),
    (r"Stage: ([^·]*?) \(since ([^)]*)\)", r"Štádium: \1 (od \2)"),
    (r"Comments can be submitted until ", "Pripomienky možno podať do "),
    (r"Submitted by: ", "Predkladateľ: "),
    (r"Main act amended: ", "Hlavný novelizovaný predpis: "),
    (r"Changed by an amending act\.", "Zmenené novelou."),
    (r"Changed by ", "Zmenené predpisom "),
    (r"(\d+) provision\(s\) changed: ", r"Zmenené ustanovenia (\1): "),
    (r" \+(\d+) more", r" a ďalšie (\1)"),
    (r" \(\+(\d+) more\)", r" (a ďalšie: \1)"),
    (r"Open the item to see the old and new wording\.", "V položke je staré a nové znenie vedľa seba."),
    (r"Open the item for the full lists by ŠÚKL code\.", "Úplné zoznamy podľa kódu ŠÚKL sú v položke."),
    (r"Compared with the list valid from ", "V porovnaní so zoznamom platným od "),
    (r"Amends: ", "Mení: "),
    (r"Effective from:? ", "Účinnosť od: "),
    (r"New e\.g\.: ", "Nové napr.: "),
    (r"Last updated ", "Naposledy aktualizované "),
    (r"Page begins: ", "Stránka začína: "),
    (r"New on the page: ", "Nové na stránke: "),
    (r"Added: ", "Pridané: "),
    (r"Removed: (\d+) lines?", r"Odstránené riadky: \1"),
    (r"(\S+) Z\. z\. – (Act|Decree|Labour|Commercial|Chemicals|Waste|VAT|Income|Accounting|Consumer)[^;·.]*",
     lambda m: f"{m[1]} Z. z. – {law_name(m[1], m[0].split(' – ', 1)[1])}"),
]


def summary(text: str) -> str:
    """The monitor's English summary phrases in Slovak; quoted source text is left alone."""
    for pattern, repl in PHRASES:
        text = re.sub(pattern, repl, text or "")
    return counts(text)
