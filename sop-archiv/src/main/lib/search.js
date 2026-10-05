'use strict';
// Full-text index over document chunks, with Slovak-aware normalisation
// (diacritics folding + light stemming) and highlighted snippets.

const MiniSearchModule = require('minisearch');
const { processTerm, fold, wordsWithOffsets } = require('./text');

const MiniSearch = MiniSearchModule.default || MiniSearchModule;

function tokenize(text) {
  return String(text || '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Parse a query: "quoted phrases" are required verbatim (diacritics-insensitive). */
function parseQuery(q) {
  const phrases = [];
  const rest = String(q || '').replace(/"([^"]+)"/g, (_, p) => {
    if (p.trim()) phrases.push(p.trim());
    return ' ';
  });
  const terms = tokenize(rest + ' ' + phrases.join(' '))
    .map(processTerm)
    .filter(Boolean);
  return { phrases, terms: Array.from(new Set(terms)) };
}

function normSpace(s) {
  return fold(s).replace(/[^\p{L}\p{N}§]+/gu, ' ').trim();
}

/**
 * Build a snippet around the densest cluster of matching words.
 * Returns [{ text, hit }] segments (plain text – the renderer escapes it).
 */
function snippet(text, terms, maxLen = 260) {
  const words = wordsWithOffsets(text);
  const hits = [];
  for (const w of words) {
    const k = processTerm(w.word);
    if (!k) continue;
    if (terms.some((t) => k === t || (t.length >= 3 && k.startsWith(t)))) hits.push(w);
  }
  let start = 0;
  if (hits.length) {
    // choose the window containing the most hits
    let best = 0;
    let bestStart = hits[0].start;
    let j = 0;
    for (let i = 0; i < hits.length; i++) {
      while (hits[i].end - hits[j].start > maxLen) j++;
      if (i - j + 1 > best) {
        best = i - j + 1;
        bestStart = hits[j].start;
      }
    }
    start = Math.max(0, bestStart - 60);
  }
  let end = Math.min(text.length, start + maxLen);
  // snap to word boundaries
  if (start > 0) {
    const sp = text.indexOf(' ', start);
    if (sp > -1 && sp - start < 20) start = sp + 1;
  }
  if (end < text.length) {
    const sp = text.lastIndexOf(' ', end);
    if (sp > start + maxLen / 2) end = sp;
  }
  const segs = [];
  let pos = start;
  for (const h of hits) {
    if (h.start < start || h.end > end) continue;
    if (h.start > pos) segs.push({ text: text.slice(pos, h.start), hit: false });
    segs.push({ text: text.slice(h.start, h.end), hit: true });
    pos = h.end;
  }
  if (pos < end) segs.push({ text: text.slice(pos, end), hit: false });
  if (start > 0) segs.unshift({ text: '… ', hit: false });
  if (end < text.length) segs.push({ text: ' …', hit: false });
  return segs.map((s) => ({ text: s.text.replace(/\s+/g, ' '), hit: s.hit }));
}

class SearchIndex {
  constructor() {
    this.reset();
  }

  reset() {
    this.ms = new MiniSearch({
      idField: 'id',
      fields: ['text', 'heading', 'title', 'code'],
      storeFields: ['docId', 'versionId', 'kind'],
      tokenize,
      processTerm,
      searchOptions: {
        boost: { code: 6, title: 4, heading: 2 },
        prefix: (term) => term.length >= 4,
        fuzzy: (term) => (term.length >= 7 ? 0.15 : false),
        combineWith: 'AND'
      }
    });
    this.chunks = new Map(); // id -> { docId, versionId, page, heading, text }
    this.byDoc = new Map(); // docId -> Set(ids)
  }

  _track(docId, id) {
    if (!this.byDoc.has(docId)) this.byDoc.set(docId, new Set());
    this.byDoc.get(docId).add(id);
  }

  /** (Re)index one document: its metadata record plus the chunks of its current text. */
  setDocument(doc, chunks) {
    this.removeDocument(doc.id);
    const metaId = `m:${doc.id}`;
    const metaText = [doc.type, doc.department, doc.owner, doc.approver, (doc.tags || []).join(' '), doc.notes]
      .filter(Boolean)
      .join(' ');
    const records = [{ id: metaId, docId: doc.id, versionId: doc.currentVersionId, kind: 'meta', title: doc.title, code: doc.code, text: metaText, heading: '' }];
    this.chunks.set(metaId, { docId: doc.id, kind: 'meta', page: null, heading: '', text: [doc.code, doc.title, metaText].filter(Boolean).join(' · ') });
    this._track(doc.id, metaId);
    (chunks || []).forEach((c, i) => {
      const id = `c:${doc.id}:${i}`;
      records.push({ id, docId: doc.id, versionId: doc.currentVersionId, kind: 'text', title: '', code: '', text: c.text, heading: c.heading || '' });
      this.chunks.set(id, { docId: doc.id, kind: 'text', page: c.page, heading: c.heading || '', text: c.text });
      this._track(doc.id, id);
    });
    this.ms.addAll(records);
  }

  removeDocument(docId) {
    const ids = this.byDoc.get(docId);
    if (!ids) return;
    for (const id of ids) {
      if (this.ms.has(id)) this.ms.discard(id);
      this.chunks.delete(id);
    }
    this.byDoc.delete(docId);
  }

  get size() {
    return this.byDoc.size;
  }

  /**
   * Search and group results by document.
   * opts: { allowDoc(docId) => bool, limit, perDoc }
   * Returns { terms, results: [{ docId, score, hits: [{ page, heading, snippet, score }] }] }
   */
  search(q, opts = {}) {
    const { phrases, terms } = parseQuery(q);
    if (!terms.length) return { terms, results: [] };
    const limit = opts.limit || 50;
    const perDoc = opts.perDoc || 3;
    const filter = (r) => !opts.allowDoc || opts.allowDoc(r.docId);
    const qs = String(q).replace(/"/g, ' ');
    let raw = this.ms.search(qs, { filter });
    if (!raw.length && terms.length > 1) raw = this.ms.search(qs, { filter, combineWith: 'OR' });
    if (phrases.length) {
      const needles = phrases.map(normSpace);
      raw = raw.filter((r) => {
        const c = this.chunks.get(r.id);
        const hay = normSpace(c ? c.text : '');
        return needles.every((n) => hay.includes(n));
      });
    }
    const groups = new Map();
    for (const r of raw) {
      const c = this.chunks.get(r.id);
      if (!c) continue;
      let g = groups.get(r.docId);
      if (!g) {
        g = { docId: r.docId, score: 0, hits: [], metaMatch: false };
        groups.set(r.docId, g);
      }
      g.score += r.score * (g.hits.length ? 0.3 : 1);
      if (c.kind === 'meta') {
        g.metaMatch = true;
        continue;
      }
      if (g.hits.length < perDoc) {
        g.hits.push({ page: c.page, heading: c.heading, score: r.score, snippet: snippet(c.text, terms), text: c.text });
      }
    }
    const results = Array.from(groups.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return { terms, phrases, results };
  }

  /** Best individual passages for question answering. */
  passages(q, opts = {}) {
    const { terms } = parseQuery(q);
    if (!terms.length) return [];
    const filter = (r) => r.kind === 'text' && (!opts.allowDoc || opts.allowDoc(r.docId));
    let raw = this.ms.search(String(q).replace(/"/g, ' '), { filter, combineWith: 'OR' });
    raw = raw.slice(0, opts.limit || 8);
    return raw.map((r) => {
      const c = this.chunks.get(r.id);
      return { docId: r.docId, page: c.page, heading: c.heading, text: c.text, score: r.score, snippet: snippet(c.text, terms) };
    });
  }
}

module.exports = { SearchIndex, parseQuery, snippet };
