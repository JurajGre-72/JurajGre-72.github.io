'use strict';
// Pure helpers for legislation monitoring: recognising the source, reading the list
// of versions from a rendered page, splitting a law into § / articles and diffing two versions.

const crypto = require('crypto');
const { diffWords, diffLines } = require('diff');
const { compactToIso } = require('./dates');
const { cleanText } = require('./text');

function detectSource(url) {
  const u = String(url || '').toLowerCase();
  if (u.includes('slov-lex.sk') || /\/sk\/zz\/\d{4}\/\d+/.test(u)) return 'slovlex';
  if (u.includes('eur-lex.europa.eu') || /celex(?::|=|%3a)3\d{4}/.test(u)) return 'eurlex';
  return 'generic';
}

function slovlexId(url) {
  const m = String(url || '').match(/SK\/ZZ\/(\d{4})\/(\d+)/i);
  return m ? { year: m[1], num: m[2] } : null;
}

function baseCelex(law, url) {
  const fromKey = String((law && law.key) || '').match(/^EU:(3\d{4}[A-Z]\d{4})$/);
  if (fromKey) return fromKey[1];
  const m = decodeURIComponent(String(url || '')).match(/CELEX[:=](3\d{4}[A-Z]\d{4})/i);
  return m ? m[1].toUpperCase() : null;
}

function eurlexLang(url) {
  const m = String(url || '').match(/legal-content\/([A-Z]{2})\//i);
  return m ? m[1].toUpperCase() : 'SK';
}

function uniqueSorted(versions) {
  const map = new Map();
  for (const v of versions) if (v.date && !map.has(v.key)) map.set(v.key, v);
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}

// Slov-Lex keeps every version of an act as a plain page on static.slov-lex.sk, listed on an index
// page ("História predpisu"). It needs no JavaScript or sign-in, unlike the www.slov-lex.sk portal.
function slovlexIndexUrl(url) {
  const id = slovlexId(url);
  if (!id) return null;
  let origin = 'https://static.slov-lex.sk';
  try {
    const u = new URL(url);
    if (!/(^|\.)slov-lex\.sk$/i.test(u.hostname)) origin = u.origin; // a mirror or a test server
  } catch (_) {
    /* not a URL: use Slov-Lex */
  }
  return `${origin}/static/SK/ZZ/${id.year}/${id.num}/`;
}

/**
 * Versions listed on a Slov-Lex index page:
 * [{ key, date, url, until, amendedBy: ['88/2026 Z. z.'] }] sorted ascending (the promulgated text is left out).
 */
function slovlexIndexVersions(html, indexUrl) {
  const base = String(indexUrl || '').replace(/\/?$/, '/');
  const out = [];
  const re = /<tr\b([^>]*\beffectivenessHistoryItem\b[^>]*)>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const attr = (name) => (m[1].match(new RegExp(`${name}="([^"]*)"`, 'i')) || [])[1] || '';
    const key = (attr('data-iri').match(/\/(\d{8})$/) || [])[1];
    const date = key && compactToIso(key);
    if (!date || attr('data-vyhlasene') === '1') continue;
    const amendedBy = [...m[2].matchAll(/>\s*(\d+\/\d{4})(?:&nbsp;|\s|\u00a0)*Z\.(?:&nbsp;|\s|\u00a0)*z\.\s*</gi)].map((x) => `${x[1]} Z. z.`);
    out.push({ key, date, url: `${base}${key}.html`, until: /^\d{4}-\d{2}-\d{2}$/.test(attr('data-ucinnostdo')) ? attr('data-ucinnostdo') : null, amendedBy: [...new Set(amendedBy)] });
  }
  return uniqueSorted(out);
}

/** The act stops being in force: its last version on the Slov-Lex index has an end date. */
function slovlexIndexRepealed(versions, day) {
  const last = versions[versions.length - 1];
  if (!last || !last.until) return null;
  const [y, mo, d] = last.until.split('-');
  return `${last.until < day ? 'Predpis je zrušený alebo stratil účinnosť' : 'Predpis bude zrušený alebo stratí účinnosť'} – posledné znenie je účinné do ${Number(d)}. ${Number(mo)}. ${y}.`;
}

/**
 * Read the versions ("znenia" / consolidated versions) of a law from a rendered page:
 * its links, final URL and raw HTML (versions may sit in <select> options or embedded JSON).
 * Returns [{ key: 'YYYYMMDD', date: 'YYYY-MM-DD', url }] sorted ascending.
 */
function parseVersions(source, page, law) {
  const hrefs = [...(page.links || []).map((l) => l.href), page.url].filter(Boolean);
  const html = String(page.html || '');
  if (source === 'slovlex') {
    const id = slovlexId(law.url) || slovlexId(page.url);
    if (!id) return [];
    const pat = `SK/ZZ/${id.year}/${id.num}/(\\d{8})(?![\\d])`;
    const re = new RegExp(pat, 'i');
    const base = String(law.url || page.url).match(/^(.*?SK\/ZZ\/\d{4}\/\d+)/i);
    const out = [];
    for (const href of hrefs) {
      const m = href.match(re);
      if (m && compactToIso(m[1])) out.push({ key: m[1], date: compactToIso(m[1]), url: href.split('#')[0] });
    }
    const reG = new RegExp(pat, 'gi');
    let m;
    while ((m = reG.exec(html))) {
      if (compactToIso(m[1]) && base) out.push({ key: m[1], date: compactToIso(m[1]), url: `${base[1]}/${m[1]}` });
    }
    return uniqueSorted(out);
  }
  if (source === 'eurlex') {
    const celex = baseCelex(law, law.url) || baseCelex(null, page.url);
    if (!celex) return [];
    const cons = `0${celex.slice(1)}`;
    const lang = eurlexLang(law.url);
    const keys = [];
    const reG = new RegExp(`${cons}-(\\d{8})`, 'gi');
    let decodedHtml = html;
    try {
      decodedHtml = decodeURIComponent(html.replace(/%(?![0-9a-f]{2})/gi, '%25'));
    } catch (_) {
      /* keep raw */
    }
    for (const src of [...hrefs.map((h) => {
      try {
        return decodeURIComponent(h);
      } catch (_) {
        return h;
      }
    }), decodedHtml]) {
      reG.lastIndex = 0;
      let m;
      while ((m = reG.exec(src))) keys.push(m[1]);
    }
    return uniqueSorted(
      keys
        .filter((k) => compactToIso(k))
        .map((k) => ({ key: k, date: compactToIso(k), url: `https://eur-lex.europa.eu/legal-content/${lang}/TXT/?uri=CELEX:${cons}-${k}` }))
    );
  }
  return [];
}

/** Version a fetched Slov-Lex page shows (from its final URL), if any. */
function pageVersionKey(page) {
  const m = String(page.url || '').match(/SK\/ZZ\/\d{4}\/\d+\/(\d{8})(?![\d])/i);
  return m ? m[1] : null;
}

/** A short "no longer in force" notice from the top of the page, or null. */
function detectRepealed(source, text) {
  const head = String(text || '').slice(0, source === 'eurlex' ? 6000 : 3000);
  const re =
    source === 'eurlex'
      ? /(No longer in force[^\n]{0,80}|Už nie je v platnosti[^\n]{0,80}|Nie je v platnosti[^\n]{0,80})/i
      : /(predpis\s+(?:bol\s+)?zrušen[ýý][^\n]{0,80}|zrušený\s+predpisom[^\n]{0,80})/i;
  const m = head.match(re);
  return m ? m[1].trim() : null;
}

/** Version in force on `day` (latest not after it) and the newest known version. */
function pickVersions(versions, day) {
  if (!versions.length) return { effective: null, newest: null, upcoming: [] };
  const past = versions.filter((v) => v.date <= day);
  const effective = past.length ? past[past.length - 1] : versions[0];
  const newest = versions[versions.length - 1];
  return { effective, newest, upcoming: versions.filter((v) => v.date > day) };
}

// ---------------------------------------------------------------------------
// Sections

const CAP = 'A-ZÁÄČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ';
const HEADINGS = [
  { re: new RegExp(`^§\\s*(\\d+[a-z]{0,2})(?:\\s*$|\\s+[${CAP}][^.;§]{0,110}$)`), kind: '§' },
  { re: new RegExp(`^(?:Článok|ČLÁNOK|Čl\\.|Article|ARTICLE|Art\\.)\\s*(\\d+[a-z]?|[IVXLC]{1,6})(?:\\s*$|\\s+[${CAP}(][^.;]{0,110}$)`), kind: 'art' },
  { re: new RegExp(`^(?:Príloha|PRÍLOHA|Prílohy|Annex|ANNEX)\\s*(?:č\\.\\s*)?([0-9]+[a-z]?|[IVXLC]{1,6})\\b[^.;]{0,110}$`), kind: 'annex' }
];

function headingOf(line) {
  const l = line.trim();
  if (l.length > 130) return null;
  for (const h of HEADINGS) {
    const m = l.match(h.re);
    if (m) return { kind: h.kind, num: m[1].toLowerCase() };
  }
  return null;
}

function sectionLabel(key) {
  const m = key.match(/^(§|art|annex)(.+?)(#\d+)?$/);
  if (!m) return key;
  const n = m[2];
  if (m[1] === '§') return `§ ${n}`;
  if (m[1] === 'art') return `Čl. ${/^[ivxlc]+$/.test(n) ? n.toUpperCase() : n}`;
  return `Príloha ${n.toUpperCase()}`;
}

/** Split law text into { preamble, sections: [{ key, label, text }] }. */
function splitSections(text) {
  const lines = cleanText(text).split('\n');
  const sections = [];
  const seen = new Map();
  let preamble = [];
  let cur = null;
  for (const line of lines) {
    const h = headingOf(line);
    if (h) {
      let key = h.kind + h.num;
      const n = (seen.get(key) || 0) + 1;
      seen.set(key, n);
      if (n > 1) key += `#${n}`;
      cur = { key, label: sectionLabel(key), heading: line.trim(), lines: [] };
      sections.push(cur);
      continue;
    }
    if (cur) cur.lines.push(line);
    else preamble.push(line);
  }
  return {
    preamble: preamble.join('\n'),
    sections: sections.map((s) => ({ key: s.key, label: s.label, heading: s.heading, text: s.lines.join('\n').trim() }))
  };
}

// Footnote markers ("predpisu15)") get renumbered between versions; ignore them when comparing.
function normForCompare(s) {
  return String(s || '')
    .replace(/(?<=[\p{L}.,;])\s?\d{1,3}[a-z]{0,3}\)/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashText(s) {
  return crypto.createHash('sha256').update(normForCompare(s)).digest('hex').slice(0, 16);
}

/** Word diff as compact parts; long unchanged runs are shortened to their edges. */
function wordParts(a, b, context = 140) {
  const parts = diffWords(a, b).map((p) => ({ t: p.added ? 'add' : p.removed ? 'del' : 'eq', s: p.value }));
  return parts.map((p, i) => {
    if (p.t !== 'eq' || p.s.length <= context * 2 + 20) return p;
    const first = i === 0;
    const last = i === parts.length - 1;
    if (first) return { t: 'eq', s: '… ' + p.s.slice(-context) };
    if (last) return { t: 'eq', s: p.s.slice(0, context) + ' …' };
    return { t: 'eq', s: p.s.slice(0, context) + ' … ' + p.s.slice(-context) };
  });
}

const MAX_SECTION = 30000;

/**
 * Compare two versions of a law.
 * Returns { mode: 'sections'|'lines', changed, added, removed, stats }
 */
function diffLaw(oldText, newText) {
  const a = splitSections(oldText);
  const b = splitSections(newText);
  if (a.sections.length >= 3 && b.sections.length >= 3) {
    const mapA = new Map(a.sections.map((s) => [s.key, s]));
    const mapB = new Map(b.sections.map((s) => [s.key, s]));
    const changed = [];
    const added = [];
    const removed = [];
    for (const s of b.sections) {
      const old = mapA.get(s.key);
      if (!old) {
        added.push({ key: s.key, label: s.label, heading: s.heading, newText: s.text.slice(0, MAX_SECTION) });
      } else if (normForCompare(old.text) !== normForCompare(s.text) || normForCompare(old.heading) !== normForCompare(s.heading)) {
        const oldT = `${old.heading}\n${old.text}`;
        const newT = `${s.heading}\n${s.text}`;
        changed.push({
          key: s.key,
          label: s.label,
          heading: s.heading,
          oldText: old.text.slice(0, MAX_SECTION),
          newText: s.text.slice(0, MAX_SECTION),
          parts: oldT.length + newT.length < 2 * MAX_SECTION ? wordParts(oldT, newT) : null
        });
      }
    }
    for (const s of a.sections) {
      if (!mapB.has(s.key)) removed.push({ key: s.key, label: s.label, heading: s.heading, oldText: s.text.slice(0, MAX_SECTION) });
    }
    return {
      mode: 'sections',
      changed,
      added,
      removed,
      stats: { changed: changed.length, added: added.length, removed: removed.length, sectionsOld: a.sections.length, sectionsNew: b.sections.length }
    };
  }
  // Generic page: line diff, ignoring blank/whitespace-only differences.
  const parts = diffLines(cleanText(oldText) + '\n', cleanText(newText) + '\n', { ignoreWhitespace: true });
  const addedLines = [];
  const removedLines = [];
  for (const p of parts) {
    const ls = p.value.split('\n').map((x) => x.trim()).filter(Boolean);
    if (p.added) addedLines.push(...ls);
    else if (p.removed) removedLines.push(...ls);
  }
  return {
    mode: 'lines',
    changed: [],
    added: addedLines.slice(0, 400),
    removed: removedLines.slice(0, 400),
    stats: { changed: 0, added: addedLines.length, removed: removedLines.length }
  };
}

/** Keys of all sections touched by a diff (for matching against document citations). */
function touchedKeys(diff) {
  if (!diff || diff.mode !== 'sections') return [];
  const strip = (k) => k.replace(/#\d+$/, '');
  return Array.from(new Set([...diff.changed, ...diff.added, ...diff.removed].map((s) => strip(s.key))));
}

module.exports = {
  detectSource,
  parseVersions,
  pageVersionKey,
  detectRepealed,
  slovlexIndexUrl,
  slovlexIndexVersions,
  slovlexIndexRepealed,
  pickVersions,
  splitSections,
  diffLaw,
  touchedKeys,
  hashText,
  normForCompare,
  slovlexId,
  baseCelex,
  sectionLabel
};
