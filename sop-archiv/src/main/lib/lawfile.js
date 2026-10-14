'use strict';
// Legal acts brought in by the user: a downloaded file (Slov-Lex / EUR-Lex PDF, Word, HTML),
// a web address, or just a name / number ("zákon o liekoch", "362/2011", "nariadenie 2019/6").

const { fold, cleanText } = require('./text');
const { parseDate, DATE_PATTERN } = require('./dates');
const { detectAllLawRefs, aliasesFromKey } = require('./metadata');

/** Remove lines repeated on many pages (running headers / footers, page numbers). */
function stripRunningLines(pages) {
  const list = (pages || []).filter((p) => p && p.text);
  if (list.length < 3) return list;
  // Exact repeats only: lines that differ by a number ("§ 18" / "§ 19") are content, not headers.
  const norm = (l) => fold(l).replace(/\s+/g, ' ').trim();
  const heading = /^(§\s*\d|cl\.|clanok|article|priloha|annex)/;
  const count = new Map();
  for (const p of list) {
    const seen = new Set(p.text.split('\n').map(norm).filter((l) => l && l.length <= 120 && !heading.test(l)));
    for (const l of seen) count.set(l, (count.get(l) || 0) + 1);
  }
  const limit = Math.max(3, Math.ceil(list.length * 0.4));
  const drop = new Set(Array.from(count.entries()).filter(([, n]) => n >= limit).map(([l]) => l));
  const pageNo = /^(strana|str\.|page|s\.)?\s*[-–]?\s*\d{1,4}\s*[-–]?\s*((\/|z|of|zo)\s*\d{1,4})?$/;
  return list.map((p) => ({
    ...p,
    text: p.text
      .split('\n')
      .filter((l) => {
        const n = norm(l);
        return !drop.has(n) && !pageNo.test(n);
      })
      .join('\n')
  }));
}

/** Clean, single-spaced text of a legal act from extracted pages. */
function lawTextFromPages(pages) {
  return cleanText(stripRunningLines(pages).map((p) => p.text).join('\n'))
    .replace(/(\p{Ll})-\n(\p{Ll})/gu, '$1$2') // words hyphenated at line ends in PDFs
    .replace(/\n\s*\n/g, '\n');
}

const KIND_WORDS = /^(zákon|zakon|vyhláška|vyhlaska|nariadenie|smernica|rozhodnutie|výnos|vynos|opatrenie|usmernenie|usmernenia|regulation|directive|decision|guidelines)\b/i;

function guessTitle(head) {
  const lines = head.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 25);
  for (let i = 0; i < lines.length; i++) {
    if (!KIND_WORDS.test(lines[i])) continue;
    let t = lines[i];
    // "ZÁKON" / "z 13. septembra 2011" / "o liekoch a zdravotníckych pomôckach …"
    for (let j = i + 1; j < Math.min(lines.length, i + 4) && t.length < 220; j++) {
      if (/^(o|ktor\p{L}*|on|of|laying|ministerstva|komisie|európskeho|rady|vlády|národnej)\b/iu.test(lines[j]) || /^z\s+\d/.test(lines[j]) || /^\(/.test(lines[j])) t += ` ${lines[j]}`;
      else break;
    }
    t = t.replace(/\s+/g, ' ').trim();
    if (t === t.toUpperCase()) t = t.charAt(0) + t.slice(1).toLowerCase();
    return t.slice(0, 240);
  }
  return null;
}

/**
 * Work out which act a text is, and which version.
 * Returns { key, title, versionDate, lawId } (any may be null).
 */
function detectLawIdentity(text, laws = []) {
  const head = String(text || '').slice(0, 4000);
  const top = head.slice(0, 700);
  let key = null;
  let versionDate = null;
  let m;
  // EUR-Lex consolidated text header: "02019R0006 — SK — 28.01.2022 — 001.001"
  if ((m = head.match(/\b0(\d{4}[A-Z]\d{4})\s*[—–-]\s*[A-Z]{2}\s*[—–-]\s*(\d{2}\.\d{2}\.\d{4})/))) {
    key = `EU:3${m[1]}`;
    versionDate = parseDate(m[2]);
  }
  if (!key && (m = head.match(/CELEX[:\s]*(3\d{4}[A-Z]\d{4})/i))) key = `EU:${m[1].toUpperCase()}`;
  if (!key && (m = top.match(/(?:^|\n)\s*(\d{1,4})\s*\/\s*(\d{4})\s*Z\.\s*z\./))) key = `SK:${+m[1]}/${m[2]}`;
  // Slov-Lex documents carry the number on its own line ("129/2012")
  if (!key && /(zákon|vyhláška|nariadenie vlády|výnos|opatrenie)/i.test(top) && (m = top.match(/(?:^|\n)\s*(?:č\.\s*)?(\d{1,4})\s*\/\s*(\d{4})\s*(?:\n|$)/)))
    key = `SK:${+m[1]}/${m[2]}`;
  if (!key) {
    const refs = detectAllLawRefs(top);
    if (refs.length) key = refs[0].key;
  }
  if (!versionDate) {
    const re = new RegExp(`(?:znenie|v\\s+znení\\s+účinnom|účinné|účinný|účinnosť|platné|consolidated\\s+text|version)\\s*(?:od|k|from|as\\s+of)?\\s*:?\\s*(${DATE_PATTERN})`, 'i');
    if ((m = head.match(re))) versionDate = parseDate(m[1]);
  }
  let law = key ? laws.find((l) => l.key === key) : null;
  if (!law) {
    // A registered act whose short name or alias appears in the title area.
    const ft = fold(top);
    law = laws.find((l) => [l.short, ...(l.aliases || [])].filter((a) => a && a.length >= 6 && !a.includes('*')).some((a) => ft.includes(fold(a))));
    if (law && !key) key = law.key || null;
  }
  return { key, title: (law && law.title) || guessTitle(head), versionDate, lawId: law ? law.id : null };
}

function urlForKey(key) {
  let m;
  if ((m = String(key).match(/^SK:(\d+)\/(\d{4})$/))) return `https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/${m[2]}/${m[1]}/`;
  if ((m = String(key).match(/^EU:(.+)$/))) return `https://eur-lex.europa.eu/legal-content/SK/ALL/?uri=CELEX:${m[1]}`;
  return '';
}

/**
 * Turn what the user typed into an act: a register entry, a catalogue entry, or a new
 * Slov-Lex / EUR-Lex identifier. Returns { lawId } | { spec: {key,title,short,url,jurisdiction,aliases} } | null
 */
function resolveLawQuery(query, laws = [], catalog = []) {
  const q = String(query || '').trim();
  if (!q) return null;
  if (/^https?:\/\//i.test(q)) {
    const law = laws.find((l) => l.url && l.url.replace(/\/+$/, '') === q.replace(/\/+$/, ''));
    return law ? { lawId: law.id } : { spec: { url: q, title: q, short: '', jurisdiction: 'OTHER' } };
  }
  const fq = fold(q);
  let key = null;
  let m;
  if ((m = q.match(/\b(3\d{4}[A-Z]\d{4})\b/i))) key = `EU:${m[1].toUpperCase()}`;
  if (!key) {
    const refs = detectAllLawRefs(q);
    if (refs.length) key = refs[0].key;
  }
  if (!key && (m = q.match(/\b(\d{1,4})\s*\/\s*(\d{1,4})\b/))) {
    const a = +m[1];
    const b = +m[2];
    const eu = /nariad|smernic|rozhodnut|regulation|directive|decision|\(e[uú]\)|\b(eu|eú|es|ehs|ec)\b/.test(fq);
    if (eu) {
      const t = /smernic|directive/.test(fq) ? 'L' : /rozhodnut|decision/.test(fq) ? 'D' : 'R';
      const [year, num] = a >= 1950 && a <= 2150 ? [a, b] : [b, a];
      key = `EU:3${year}${t}${String(num).padStart(4, '0')}`;
    } else if (b >= 1945 && b <= 2150) key = `SK:${a}/${b}`;
  }
  if (key) {
    const law = laws.find((l) => l.key === key);
    if (law) return { lawId: law.id };
    const cat = catalog.find((l) => l.key === key);
    if (cat) return { spec: { ...cat } };
    const label = key.startsWith('SK:') ? `${key.slice(3)} Z. z.` : key.slice(3);
    return { spec: { key, title: q.length > label.length ? q : label, short: label, url: urlForKey(key), jurisdiction: key.slice(0, 2), aliases: aliasesFromKey(key) } };
  }
  // By name: best word overlap with titles, short names and aliases.
  const qWords = fq.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !['zakon', 'zakona', 'vyhlaska', 'nariadenie', 'smernica'].includes(w));
  if (!qWords.length) return null;
  let best = null;
  for (const [src, l] of [...laws.map((x) => ['law', x]), ...catalog.map((x) => ['cat', x])]) {
    const hay = fold([l.title, l.short, ...(l.aliases || [])].join(' '));
    const hit = qWords.filter((w) => hay.includes(w.slice(0, Math.max(4, w.length - 2)))).length;
    const score = hit / qWords.length;
    if (score >= 0.6 && (!best || score > best.score)) best = { score, src, l };
  }
  if (!best) return null;
  if (best.src === 'law') return { lawId: best.l.id };
  const existing = laws.find((x) => x.key && x.key === best.l.key);
  return existing ? { lawId: existing.id } : { spec: { ...best.l } };
}

module.exports = { stripRunningLines, lawTextFromPages, detectLawIdentity, resolveLawQuery, urlForKey };
