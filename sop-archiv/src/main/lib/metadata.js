'use strict';
// Heuristic metadata extraction from document text, and detection of legislation citations.
// Pure functions – unit-tested in test/unit/metadata.test.js.

const { fold, escapeRegExp } = require('./text');
const { parseDate, DATE_PATTERN } = require('./dates');
const { parseFileName } = require('./filenames');

const DATE_RE = DATE_PATTERN;

function firstMatch(text, regexes) {
  for (const re of regexes) {
    const m = text.match(re);
    if (m) return m;
  }
  return null;
}

function labelledDate(head, labels) {
  const re = new RegExp(`(?:${labels})\\s*[:\\-–]?\\s*(${DATE_RE})`, 'i');
  const m = head.match(re);
  return m ? parseDate(m[1]) : null;
}

const TYPE_HINTS = [
  { type: 'OS', re: /organiza[čc]n[áa]\s+smernic|organizational\s+directive/i },
  { type: 'SOP', re: /[šs]tandardn[ýy]\s+(?:opera[čc]n[ýy]\s+)?postup|standard\s+operating\s+procedure/i },
  { type: 'PP', re: /pracovn[ýy]\s+postup|work(?:ing)?\s+instruction/i },
  { type: 'MP', re: /metodick[ýy]\s+pokyn/i },
  { type: 'F', re: /\bformul[áa]r\b|\bform\s+no\b/i }
];

const CODE_RES = [
  // Labelled codes: "Číslo dokumentu: SOP-QA-001", "Document No.: OS 3/2024"
  /(?:[čc][íi]slo\s+dokumentu|ozna[čc]enie(?:\s+dokumentu)?|k[óo]d\s+dokumentu|document\s+(?:no\.?|number|code|id))\s*[:\-–]?\s*([A-Z][A-Z0-9]{0,5}(?:[\s\-_./][A-Z0-9]{1,6}){0,3})/i,
  // SOP-QA-001, SOP 12, SOP_DIST_03
  /\b(SOP[\s\-_.]?(?:[A-Z]{1,5}[\-_.\s])?\d{1,4}(?:[\-_./]\d{1,4})?)\b/,
  // OS-05, OS č. 3/2024, OS 3/2024
  /\b(OS[\s\-_.]?(?:[čc]\.\s*)?\d{1,4}(?:\/\d{2,4})?)\b/,
  // "Organizačná smernica č. 3/2024"
  /organiza[čc]n[áa]\s+smernica\s+[čc]\.\s*(\d{1,4}(?:\/\d{2,4})?)/i,
  // Other common prefixes: PP-02, MP 01, WI-3
  /\b((?:PP|MP|WI|SM|QM|FR)[\s\-_.]?(?:[A-Z]{1,5}[\-_.\s])?\d{1,4}(?:[\-_./]\d{1,4})?)\b/
];

function normCode(c) {
  return c.replace(/\s+/g, ' ').replace(/\s*([\-_./])\s*/g, '$1').trim();
}

function guessTitle(text, fileName, code) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 40);
  const bad = /:|^(strana|page|verzia|version|rev[íi]zia|d[áa]tum|schv[áa]lil|vypracoval|platnos|[úu][čc]innos|copyright|\d+\s*\/\s*\d+$)|\b(s\.\s?r\.\s?o\.|a\.\s?s\.|spol\.|k\.\s?s\.)/i;
  const typeHeader = /^(organiza[čc]n[áa]\s+smernica|[šs]tandardn[ýy]\s+(?:opera[čc]n[ýy]\s+)?postup|standard\s+operating\s+procedure|pracovn[ýy]\s+postup|metodick[ýy]\s+pokyn|smernica)\b[\s\d./č,-]*$/i;
  const good = (l) => {
    if (l.includes(' | ')) l = l.split(' | ')[0];
    if (l.length < 6 || l.length > 140 || bad.test(l) || typeHeader.test(l)) return false;
    const letters = (l.match(/\p{L}/gu) || []).length;
    return letters / l.length >= 0.6;
  };
  // 1) The line carrying the document code usually carries the title too.
  if (code) {
    const cf = code.toUpperCase().replace(/[\s\-_.]/g, '');
    for (const raw of lines) {
      const compact = raw.toUpperCase().replace(/[\s\-_.]/g, '');
      const at = compact.indexOf(cf);
      if (at < 0) continue;
      // drop everything up to and including the code (in whatever spacing it was written)
      let consumed = 0;
      let i = 0;
      while (i < raw.length && consumed < at + cf.length) {
        if (!/[\s\-_.]/.test(raw[i])) consumed++;
        i++;
      }
      const rest = raw.slice(i).replace(/^[\s\-–:|]+/, '').trim();
      if (good(rest)) return rest.replace(/\s+/g, ' ');
    }
  }
  // 2) Otherwise the first line that looks like a heading.
  for (const l of lines) if (good(l)) return l.split(' | ')[0].replace(/\s+/g, ' ');
  return fileTitle(fileName);
}

function fileTitle(fileName) {
  return String(fileName || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect document metadata from extracted text (header area) and file name.
 * A file name in the company's pattern (see filenames.js) decides the code, type, title and edition;
 * the text adds what the name does not carry (dates, author, approver, version number).
 * Returns only the fields it found (all optional).
 */
function detectMetadata(text, fileName = '', { folder = '' } = {}) {
  const fromText = detectFromText(text, fileName);
  const fn = parseFileName(fileName, folder);
  if (!fn) return fromText;
  const out = { ...fromText };
  const en = fn.lang === 'en';
  if (fn.code) out.code = en ? `${fn.code} (EN)` : fn.code;
  else delete out.code;
  if (fn.type) out.type = fn.type;
  out.title = fn.title || fromText.title;
  // An edition year (or "2024.09") in the name gives way to a version number written in the document.
  const editionOnly = fn.version && /^\d{4}(?:\.\d{2})?$/.test(fn.version);
  if (fn.version && !(editionOnly && fromText.version)) out.version = fn.version;
  if (fn.effectiveDate) out.effectiveDate = fn.effectiveDate;
  if (fn.annexOf) out.annexOf = en ? `${fn.annexOf} (EN)` : fn.annexOf;
  if (fn.area) out.area = fn.area;
  if (en) out.lang = 'en';
  return out;
}

function detectFromText(text, fileName) {
  const head = String(text || '').slice(0, 8000);
  const out = {};

  const codeFromName = String(fileName).match(/\b((?:SOP|OS|PP|MP|WI)[\-_ .]?(?:[A-Z]{1,5}[\-_ .])?\d{1,4})/i);
  const cm = firstMatch(head, CODE_RES);
  if (cm) {
    let c = normCode(cm[1]);
    if (/^\d/.test(c)) c = `OS ${c}`; // "Organizačná smernica č. 3/2024"
    out.code = c.toUpperCase().replace(/^OS[\-_.]?[ČC]\.\s*/, 'OS ');
  } else if (codeFromName) {
    out.code = normCode(codeFromName[1]).toUpperCase();
  }

  let type = null;
  if (out.code) {
    if (/^SOP/i.test(out.code)) type = 'SOP';
    else if (/^OS\b|^OS[\-_.\d]/i.test(out.code)) type = 'OS';
    else if (/^PP/i.test(out.code)) type = 'PP';
    else if (/^MP/i.test(out.code)) type = 'MP';
  }
  if (!type) {
    const hint = TYPE_HINTS.find((h) => h.re.test(head));
    if (hint) type = hint.type;
  }
  if (type) out.type = type;

  const vm = head.match(/(?:verzia|verzie|version|rev[íi]zia\s+[čc]\.|vydanie|edition|rev\.)\s*(?:[čc]\.|no\.|[čc][íi]slo)?\s*[:\-–]?\s*(\d{1,3}(?:\.\d{1,3}){0,2})\b/i);
  if (vm) out.version = vm[1];

  const eff = labelledDate(
    head,
    'd[áa]tum\\s+[úu][čc]innosti|[úu][čc]innos[ťt]\\s+od|[úu][čc]inn[ýá]\\s+od|platnos[ťt]\\s+od|platn[ýá]\\s+od|d[áa]tum\\s+platnosti|effective\\s+date|effective\\s+from|valid\\s+from|in\\s+force\\s+from'
  );
  if (eff) out.effectiveDate = eff;

  const rev = labelledDate(
    head,
    'd[áa]tum\\s+(?:nasleduj[úu]cej\\s+|[ďd]al[šs]ej\\s+|najbli[žz][šs]ej\\s+)?rev[íi]zie|(?:nasleduj[úu]ca|[ďd]al[šs]ia|najbli[žz][šs]ia)\\s+rev[íi]zia|rev[íi]zia\\s+do|revidova[ťt]\\s+do|term[íi]n\\s+(?:nasleduj[úu]cej\\s+|[ďd]al[šs]ej\\s+)?rev[íi]zie|next\\s+review(?:\\s+date)?|review\\s+date|review\\s+by|review\\s+due'
  );
  if (rev) out.reviewDate = rev;

  const appr = head.match(/(?:schv[áa]lil[a]?|approved\s+by)\s*[:\-–]?\s*([^\n]{3,60})/i);
  if (appr) out.approver = cleanName(appr[1]);
  const auth = head.match(/(?:vypracoval[a]?|spracoval[a]?|autor|author|prepared\s+by)\s*[:\-–]?\s*([^\n]{3,60})/i);
  if (auth) out.owner = cleanName(auth[1]);

  out.title = guessTitle(head, fileName, out.code);
  return out;
}

function cleanName(s) {
  return s
    .split(/\s{2,}|\t|\s+(?:d[áa]tum|date|podpis|signature|funkcia)\b/i)[0]
    .replace(/[,;:]+$/, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Legislation citations

/**
 * Default aliases for a register entry derived from its key.
 *   "SK:362/2011"   -> ["362/2011"]
 *   "EU:32019R0006" -> ["2019/6", "32019R0006"]
 *   "EU:32004R0726" -> ["726/2004", "32004R0726"]
 *   "EU:32001L0083" -> ["2001/83", "32001L0083"]
 */
function aliasesFromKey(key) {
  if (!key) return [];
  let m;
  if ((m = key.match(/^SK:(\d+)\/(\d{4})$/))) return [`${m[1]}/${m[2]}`];
  if ((m = key.match(/^EU:3(\d{4})([RLD])(\d{4})$/))) {
    const year = +m[1];
    const num = +m[3];
    const celex = `3${m[1]}${m[2]}${m[3]}`;
    if (m[2] === 'R' && year < 2015) return [`${num}/${year}`, celex];
    return [`${year}/${num}`, celex];
  }
  return [];
}

function aliasRegex(alias) {
  const parts = fold(alias)
    .trim()
    .split(/\s+/)
    .map((p) => escapeRegExp(p).replace(/\//g, '\\s*/\\s*').replace(/\\\*/g, '\\p{L}*'));
  // Do not match inside longer numbers ("2019/6" must not match "2019/60").
  return new RegExp(`(?<![\\p{L}\\p{N}/])${parts.join('\\s+')}(?![\\p{N}])`, 'gu');
}

const SEC_RE = /§§?\s*(\d+[a-z]?)((?:\s*(?:,|a|az|-|–)\s*\d+[a-z]?(?![\p{L}]))*)/gu;
const ART_RE = /(?:cl\.|clanok|clanku|clanky|clankov|clankoch|article|articles|art\.)\s*(\d+[a-z]?)((?:\s*(?:,|a|az|and|-|–)\s*\d+[a-z]?(?![\p{L}]))*)/gu;

function sectionsIn(windowText) {
  const out = [];
  for (const [re, prefix] of [[SEC_RE, '§'], [ART_RE, 'art']]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(windowText))) {
      out.push(prefix + m[1]);
      const rest = m[2] || '';
      for (const n of rest.match(/\d+[a-z]?/g) || []) out.push(prefix + n);
    }
  }
  return out;
}

/**
 * Section refs that precede a citation ("§ 18 ods. 1 zákona č. …"). If a conjunction
 * separates the last ref from the citation ("článok 99 a zákona č. …"), the refs belong
 * to something else.
 */
function sectionsBefore(before) {
  const found = sectionsIn(before);
  if (!found.length) return [];
  let lastEnd = 0;
  for (const re of [SEC_RE, ART_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(before))) lastEnd = Math.max(lastEnd, m.index + m[0].length);
  }
  const tail = before.slice(lastEnd);
  if (/(?:^|\s)(?:a|aj|and|alebo|or|ako aj)\s/.test(tail)) return [];
  return found;
}

/**
 * Find citations of registered laws in a document.
 * laws: [{ id, aliases: [] , key }]
 * Returns [{ lawId, count, sections: ['§18', 'art5', ...] }]
 */
function detectCitations(text, laws) {
  const folded = fold(text);
  const out = [];
  for (const law of laws || []) {
    const aliases = Array.from(new Set([...(law.aliases || []), ...aliasesFromKey(law.key)])).filter((a) => a && a.trim().length >= 3);
    if (!aliases.length) continue;
    let count = 0;
    const sections = new Set();
    for (const alias of aliases) {
      const re = aliasRegex(alias);
      let m;
      while ((m = re.exec(folded))) {
        count++;
        // Look back within the same line, but not past another act's citation
        // ("§ 5 zákona č. 18/2018 Z. z. a § 18 zákona č. 362/2011" -> only § 18).
        let before = folded.slice(Math.max(0, m.index - 160), m.index);
        const nl = before.lastIndexOf('\n');
        if (nl >= 0) before = before.slice(nl + 1);
        let cut = -1;
        const otherRe = /\d+\s*\/\s*\d{2,4}|z\.\s*z\.|zb\./g;
        let o;
        while ((o = otherRe.exec(before))) cut = o.index + o[0].length;
        if (cut >= 0) before = before.slice(cut);
        for (const s of sectionsBefore(before)) sections.add(s);
        // "... 362/2011 Z. z., § 18" – a § right after the citation.
        const after = folded.slice(m.index + m[0].length, m.index + m[0].length + 60);
        const am = after.match(/^\s*(?:z\.\s*z\.|zb\.)?\s*,?\s*(?=§|cl\.|clan|article|art\.)/);
        if (am) for (const s of sectionsIn(after.slice(am[0].length).split(/[;\n]/)[0])) sections.add(s);
      }
    }
    if (count) out.push({ lawId: law.id, count, sections: Array.from(sections).sort(sectionSort) });
  }
  return out;
}

function sectionSort(a, b) {
  const na = parseInt(a.replace(/\D+/g, ''), 10) || 0;
  const nb = parseInt(b.replace(/\D+/g, ''), 10) || 0;
  return a.localeCompare(b, undefined, { numeric: true }) || na - nb;
}

/**
 * Detect any Slovak or EU legal act cited in the text, registered or not.
 * Returns [{ key, label, jurisdiction, url, count }]
 */
function detectAllLawRefs(text) {
  const folded = fold(text);
  const found = new Map();
  const add = (key, label, jurisdiction, url) => {
    const e = found.get(key) || { key, label, jurisdiction, url, count: 0 };
    if (/^\d/.test(e.label) && !/^\d/.test(label)) e.label = label; // "Vyhláška č. 82/2012 Z. z." beats "82/2012 Z. z."
    e.count++;
    found.set(key, e);
  };
  const slovlex = (num, year) => `https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/${year}/${num}/`;
  let m;
  const skRe = /(?<![\p{N}/])(\d{1,4})\s*\/\s*(\d{4})\s*(z\.\s*z\.|zb\.)/gu;
  while ((m = skRe.exec(folded))) {
    const num = +m[1];
    const year = +m[2];
    if (year < 1945 || year > 2150) continue;
    const coll = m[3].startsWith('zb') ? 'Zb.' : 'Z. z.';
    add(`SK:${num}/${year}`, `${num}/${year} ${coll}`, 'SK', slovlex(num, year));
  }
  // "zákona č. 362/2011", "vyhlášky MZ SR č. 129/2012", "Vyhlášky 82-2012 MZSR", "nariadenia vlády č. 211/2021"
  const SK_KINDS = [
    [/^zakonnik/, 'Zákonník'],
    [/^zakon/, 'Zákon'],
    [/^vyhlas/, 'Vyhláška'],
    [/^nariaden/, 'Nariadenie vlády'],
    [/^vynos/, 'Výnos']
  ];
  const kwRe = /(zakon\p{L}*|vyhlas\p{L}*|nariaden\p{L}*\s+vlady|vynos\p{L}*)(?![\p{L}])[^\n;§]{0,60}?(?<![\p{N}/.\-])(\d{1,4})\s*[/-]\s*((?:19|20)\d{2})(?![\p{N}/\-])/gu;
  while ((m = kwRe.exec(folded))) {
    const num = +m[2];
    const year = +m[3];
    if (!num || year > 2150) continue;
    const kind = (SK_KINDS.find(([re]) => re.test(m[1])) || [null, 'Predpis'])[1];
    const coll = year < 1993 ? 'Zb.' : 'Z. z.';
    add(`SK:${num}/${year}`, `${kind} č. ${num}/${year} ${coll}`, 'SK', slovlex(num, year));
  }
  const euRe = /(nariaden\p{L}*|smernic\p{L}*|rozhodnut\p{L}*|regulation|directive|decision)\b[^.\n;]{0,90}?(?:\((eu|es|ehs|ec|eec|euratom)\)\s*(?:c\.|no\.?)?\s*(\d{1,4})\s*\/\s*(\d{1,4})(?!\s*\/)|(\d{4})\s*\/\s*(\d{1,4})\s*\/\s*(eu|es|ehs|ec|eec))/gu;
  while ((m = euRe.exec(folded))) {
    const kw = m[1];
    const t = /^(nariaden|regulation)/.test(kw) ? 'R' : /^(smernic|directive)/.test(kw) ? 'L' : 'D';
    let a;
    let b;
    if (m[3]) {
      a = +m[3];
      b = +m[4];
    } else {
      a = +m[5];
      b = +m[6];
    }
    let year;
    let num;
    if (a >= 1950 && a <= 2150) {
      year = a;
      num = b;
    } else {
      year = b;
      num = a;
    }
    if (year < 1950 || year > 2150 || !num) continue;
    const celex = `3${year}${t}${String(num).padStart(4, '0')}`;
    const kind = t === 'R' ? 'Nariadenie' : t === 'L' ? 'Smernica' : 'Rozhodnutie';
    const label = t === 'R' && year < 2015 ? `${kind} č. ${num}/${year}` : `${kind} ${year}/${num}`;
    add(`EU:${celex}`, label, 'EU', `https://eur-lex.europa.eu/legal-content/SK/ALL/?uri=CELEX:${celex}`);
  }
  return Array.from(found.values()).sort((x, y) => y.count - x.count);
}

module.exports = { detectMetadata, detectCitations, detectAllLawRefs, aliasesFromKey, fileTitle, sectionsIn };
