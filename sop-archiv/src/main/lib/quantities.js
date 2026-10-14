'use strict';
// Finds periods, deadlines and temperatures in Slovak / English text, including numbers written
// as words ("desať rokov", "do dvadsiatich štyroch hodín"), so a SOP and a law can be compared.

const { fold } = require('./text');

const NUM_WORDS = {
  jeden: 1, jedna: 1, jedno: 1, jedneho: 1, jednej: 1, jednom: 1, jednu: 1, jednym: 1, one: 1,
  dva: 2, dve: 2, dvoch: 2, dvom: 2, dvoma: 2, two: 2,
  tri: 3, troch: 3, trom: 3, tromi: 3, three: 3,
  styri: 4, styroch: 4, styrom: 4, styrmi: 4, four: 4,
  pat: 5, piatich: 5, piatim: 5, piatimi: 5, five: 5,
  sest: 6, siestich: 6, siestim: 6, six: 6,
  sedem: 7, siedmich: 7, siedmim: 7, seven: 7,
  osem: 8, osmich: 8, osmim: 8, eight: 8,
  devat: 9, deviatich: 9, deviatim: 9, nine: 9,
  desat: 10, desiatich: 10, desiatim: 10, ten: 10,
  jedenast: 11, dvanast: 12, trinast: 13, strnast: 14, patnast: 15, sestnast: 16, sedemnast: 17, osemnast: 18, devatnast: 19,
  eleven: 11, twelve: 12, fifteen: 15, eighteen: 18,
  dvadsat: 20, tridsat: 30, styridsat: 40, patdesiat: 50, sestdesiat: 60, sedemdesiat: 70, osemdesiat: 80, devatdesiat: 90,
  twenty: 20, thirty: 30, sixty: 60, ninety: 90,
  sto: 100, hundred: 100
};

const TENS_GEN = { dvadsiatich: 20, tridsiatich: 30, styridsiatich: 40, patdesiatich: 50, sestdesiatich: 60, devatdesiatich: 90 };
const TEENS_GEN = /^(jedenast|dvanast|trinast|strnast|patnast|sestnast|sedemnast|osemnast|devatnast)(ich|im|imi)$/;

/** Parse a (folded) Slovak/English number word, e.g. "desat", "patnastich", "dvadsatstyri". */
function wordToNumber(w) {
  if (NUM_WORDS[w] !== undefined) return NUM_WORDS[w];
  if (TENS_GEN[w] !== undefined) return TENS_GEN[w];
  const teen = w.match(TEENS_GEN);
  if (teen) return NUM_WORDS[teen[1]];
  for (const [tw, tv] of Object.entries({ ...TENS_GEN, dvadsat: 20, tridsat: 30, styridsat: 40, patdesiat: 50, sestdesiat: 60, sedemdesiat: 70, osemdesiat: 80, devatdesiat: 90 })) {
    if (w.startsWith(tw) && w.length > tw.length) {
      const rest = NUM_WORDS[w.slice(tw.length)];
      if (rest !== undefined && rest < 10) return tv + rest;
    }
  }
  return null;
}

// Time units in hours (folded word stems).
const TIME_UNITS = [
  { re: /^(rok|roka|roku|roky|rokov|rokoch|rokmi|rokom|year|years)$/, hours: 8760, unit: 'year' },
  { re: /^(mesiac|mesiaca|mesiaci|mesiace|mesiacov|mesiacoch|mesiacmi|mesiacom|month|months)$/, hours: 730, unit: 'month' },
  { re: /^(tyzden|tyzdna|tyzdni|tyzdne|tyzdnov|tyzdnoch|tyzdnami|tyzdnom|week|weeks)$/, hours: 168, unit: 'week' },
  { re: /^(den|dna|dni|dnoch|dnami|dnom|day|days)$/, hours: 24, unit: 'day' },
  { re: /^(hodina|hodiny|hodin|hodinach|hodinu|hodinami|hod|h|hour|hours)$/, hours: 1, unit: 'hour' },
  { re: /^(minuta|minuty|minut|minutach|minutu|min|minute|minutes)$/, hours: 1 / 60, unit: 'minute' }
];
const MODIFIERS = new Set(['pracovnych', 'pracovne', 'pracovny', 'kalendarnych', 'kalendarne', 'celych', 'nasledujucich', 'working', 'calendar', 'business', 'consecutive']);

const TOKEN_RE = /[\p{L}\p{N}]+(?:[.,]\d+)?|°\s*C|%|[–-]/gu;

function toNumber(tok) {
  if (/^\d+(?:[.,]\d+)?$/.test(tok)) return parseFloat(tok.replace(',', '.'));
  return wordToNumber(tok);
}

/**
 * Extract quantities: [{ cat: 'time'|'temp', value, unit, base, raw }]
 * base = hours for time, °C for temperature.
 */
function extractQuantities(text) {
  const src = String(text || '');
  const out = [];
  // Temperatures (ranges first).
  const tempRange = /([+-−]?\d+(?:[.,]\d+)?)\s*(?:°\s*C)?\s*(?:–|-|až|do|to|and)\s*([+-−]?\d+(?:[.,]\d+)?)\s*°\s*C/gi;
  const spans = [];
  let m;
  while ((m = tempRange.exec(src))) {
    for (const v of [m[1], m[2]]) {
      const value = parseFloat(v.replace('−', '-').replace(',', '.'));
      out.push({ cat: 'temp', value, unit: '°C', base: value, raw: m[0].replace(/\s+/g, ' ').trim() });
    }
    spans.push([m.index, m.index + m[0].length]);
  }
  const tempOne = /([+-−]?\d+(?:[.,]\d+)?)\s*°\s*C/gi;
  while ((m = tempOne.exec(src))) {
    if (spans.some(([a, b]) => m.index >= a && m.index < b)) continue;
    const value = parseFloat(m[1].replace('−', '-').replace(',', '.'));
    out.push({ cat: 'temp', value, unit: '°C', base: value, raw: m[0].replace(/\s+/g, ' ').trim() });
  }
  // Time periods: <number|number word> [modifier] <unit>
  const toks = [];
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(src))) toks.push({ t: m[0], f: fold(m[0]), i: m.index, end: m.index + m[0].length });
  for (let i = 0; i < toks.length; i++) {
    let n = toNumber(toks[i].f);
    if (n === null || n === undefined) continue;
    let j = i + 1;
    // compound written as two words: "dvadsať štyri"
    if (n >= 20 && n % 10 === 0 && toks[j] && NUM_WORDS[toks[j].f] !== undefined && NUM_WORDS[toks[j].f] < 10) {
      n += NUM_WORDS[toks[j].f];
      j++;
    }
    if (toks[j] && MODIFIERS.has(toks[j].f)) j++;
    if (!toks[j]) continue;
    const unit = TIME_UNITS.find((u) => u.re.test(toks[j].f));
    if (!unit) continue;
    if (unit.unit === 'hour' && toks[j].f === 'h' && !/^\d/.test(toks[i].f)) continue;
    out.push({ cat: 'time', value: n, unit: unit.unit, base: n * unit.hours, raw: src.slice(toks[i].i, toks[j].end).replace(/\s+/g, ' ') });
    i = j;
  }
  return out;
}

/** Quantities in `docQ` whose category appears in `lawQ` but whose value does not. */
function mismatches(docQ, lawQ) {
  const res = [];
  const seen = new Set();
  for (const d of docQ) {
    const same = lawQ.filter((l) => l.cat === d.cat);
    if (!same.length) continue;
    if (same.some((l) => Math.abs(l.base - d.base) <= Math.max(1e-6, Math.abs(d.base) * 0.001))) continue;
    const key = `${d.cat}|${d.base}`;
    if (seen.has(key)) continue;
    seen.add(key);
    res.push({ doc: d, law: Array.from(new Set(same.map((l) => l.raw))).slice(0, 6) });
  }
  return res;
}

module.exports = { extractQuantities, mismatches, wordToNumber };
