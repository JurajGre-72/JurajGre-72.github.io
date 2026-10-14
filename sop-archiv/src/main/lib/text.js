'use strict';
// Text helpers shared by search, metadata detection and legislation parsing.
// Everything here is pure (no Electron / fs) so it can be unit-tested with node:test.

const WORD_RE = /[\p{L}\p{N}]+/gu;

/** Lower-case and strip diacritics: "Účinnosť" -> "ucinnost". */
function fold(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// Slovak + English function words that carry no meaning for search.
const STOPWORDS = new Set([
  'a', 'aby', 'aj', 'ak', 'ako', 'ale', 'alebo', 'ani', 'az', 'bez', 'by', 'bol', 'bola', 'boli', 'bolo',
  'byt', 'cez', 'do', 'ho', 'i', 'ich', 'im', 'ja', 'je', 'jeho', 'jej', 'ju', 'k', 'kde', 'ked', 'ktora',
  'ktore', 'ktori', 'ktory', 'ku', 'ma', 'mu', 'na', 'nad', 'nie', 'o', 'od', 'po', 'pod', 'podla', 'pre',
  'pred', 'pri', 's', 'sa', 'si', 'so', 'su', 'ta', 'tak', 'tam', 'to', 'tom', 'tu', 'tym', 'u', 'uz', 'v',
  'vo', 'z', 'za', 'ze', 'zo',
  'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'it', 'of', 'on', 'or', 'that',
  'the', 'this', 'to', 'was', 'with'
]);

// Light Slovak suffix stripper (applied after fold). Longest suffix first.
// It is intentionally conservative: it only needs to map inflected forms of the
// same word to one key ("liek", "lieky", "liekov", "liekmi" -> "liek").
const SUFFIXES = [
  'ovaniami', 'ovaniach', 'ovanim', 'ovania', 'ovanie', 'ovaniu',
  'ostami', 'ostiach', 'ostiam', 'ostou', 'osti',
  'ovych', 'ovymi', 'ovemu', 'oveho', 'ovej', 'ovom', 'ovou',
  'iach', 'iami',
  'ami', 'ach', 'ych', 'ymi', 'emu', 'eho', 'iam', 'ich',
  'ov', 'om', 'ou', 'ej', 'ym', 'ie', 'ia', 'iu', 'ii', 'im', 'mi',
  'a', 'e', 'i', 'o', 'u', 'y'
].sort((a, b) => b.length - a.length);

function stem(term) {
  if (term.length <= 4 || /\d/.test(term)) return term;
  for (const suf of SUFFIXES) {
    if (term.endsWith(suf) && term.length - suf.length >= 3) return term.slice(0, -suf.length);
  }
  return term;
}

/** Turn a raw word into an index key, or null if it should be ignored. */
function processTerm(word) {
  const f = fold(word);
  if (!f || STOPWORDS.has(f)) return null;
  return stem(f);
}

/** Split text into raw words (Unicode letters and digits). */
function words(text) {
  return String(text || '').match(WORD_RE) || [];
}

/** Words with their character offsets in the original string. */
function wordsWithOffsets(text) {
  const out = [];
  const s = String(text || '');
  WORD_RE.lastIndex = 0;
  let m;
  while ((m = WORD_RE.exec(s))) out.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Collapse runs of whitespace, keep paragraph breaks. */
function cleanText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[   ]/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Split extracted pages into search chunks of roughly `target` characters,
 * breaking on paragraph boundaries and remembering the nearest heading.
 * pages: [{ page: number|null, text }]
 */
function chunkPages(pages, target = 700) {
  const chunks = [];
  let heading = '';
  const headingRe = /^(?:\d+(?:\.\d+){0,3}\.?\s+\S.{0,90}|[A-ZÁÄČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ0-9][A-ZÁÄČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ0-9 ,.\-–/()]{3,80}|(?:čl\.|článok|article|§)\s*\d+.{0,80})$/;
  for (const p of pages) {
    const paras = cleanText(p.text).split(/\n+/);
    let buf = '';
    let bufHeading = heading;
    let onlyHeading = false; // buffer holds nothing but a heading line
    const flush = () => {
      const t = buf.trim();
      if (t) chunks.push({ page: p.page ?? null, heading: bufHeading, text: t });
      buf = '';
      bufHeading = heading;
      onlyHeading = false;
    };
    for (const para of paras) {
      const line = para.trim();
      if (!line) continue;
      const isHeading = line.length <= 100 && headingRe.test(line) && !/[.:;,]$/.test(line);
      if (isHeading) {
        if (buf.length > target * 0.4) flush();
        heading = line;
        if (!buf) bufHeading = heading;
      }
      if (buf.length + line.length > target && buf.length > 0 && !onlyHeading) flush();
      onlyHeading = isHeading && !buf;
      if (line.length > target * 2) {
        // Very long paragraph: split on sentence boundaries.
        const sentences = line.split(/(?<=[.!?;])\s+/);
        for (const s of sentences) {
          if (buf.length + s.length > target && buf.length > 0) flush();
          buf += (buf ? ' ' : '') + s;
        }
      } else {
        buf += (buf ? '\n' : '') + line;
      }
    }
    flush();
  }
  return chunks;
}

module.exports = {
  fold,
  stem,
  processTerm,
  words,
  wordsWithOffsets,
  escapeRegExp,
  cleanText,
  chunkPages,
  STOPWORDS
};
