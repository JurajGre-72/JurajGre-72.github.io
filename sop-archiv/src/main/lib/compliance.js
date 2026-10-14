'use strict';
// Checks documents (SOP, OS, …) against the text of a legal act:
//   • a § / article the document cites no longer exists in the act        -> high
//   • a § / article the document cites was changed (when a diff is known)  -> high
//   • a deadline, period or temperature in the document differs from the
//     values in the cited § (e.g. SOP "5 rokov" vs. law "desať rokov")   -> medium
//   • the document does not cite the act but its content clearly deals
//     with what some § regulates                                          -> info
// Pure function: text in, findings out. Unit-tested in test/unit/compliance.test.js.

const { splitSections } = require('./legis-parse');
const { chunkPages, words, processTerm } = require('./text');
const { detectCitations } = require('./metadata');
const { extractQuantities, mismatches } = require('./quantities');

// Words that appear in almost every legal text and say nothing about its subject.
const LEGAL_STOP = new Set(
  [
    'zákon', 'zákona', 'zákone', 'odsek', 'odseku', 'odseky', 'písmeno', 'písm', 'ustanovenie', 'ustanovenia', 'predpis', 'predpisu', 'predpisov',
    'osobitný', 'osobitného', 'uvedený', 'uvedené', 'uvedenej', 'ktorý', 'ktorá', 'ktoré', 'ktorého', 'ktorej', 'ktorých', 'podľa', 'ďalej',
    'alebo', 'najmä', 'ak', 'tohto', 'táto', 'tieto', 'týchto', 'ustanovení', 'vykonáva', 'účely', 'účel', 'článok', 'článku', 'nariadenie',
    'nariadenia', 'smernica', 'smernice', 'členský', 'členské', 'členských', 'štát', 'štátu', 'štáty', 'povinný', 'povinná', 'povinnosť',
    // words every pharmaceutical document contains – they say nothing about the topic of a section
    'liek', 'lieky', 'liekov', 'liekmi', 'držiteľ', 'držiteľa', 'povolenie', 'povolenia', 'povolení', 'osoba', 'osoby', 'zabezpečiť', 'zabezpečuje',
    'vykonáva', 'zdravotníckych', 'pomôcok', 'pomôcky', 'štátny', 'štátneho', 'ústav', 'ústavu', 'spoločnosť', 'spoločnosti',
    'zmene', 'doplnení', 'niektorých', 'zákonov', 'shall', 'article', 'paragraph', 'regulation', 'directive', 'member', 'state', 'states'
  ]
    .map(processTerm)
    .filter(Boolean)
);

function baseKey(k) {
  return String(k).replace(/#\d+$/, '');
}

/** Map of section key -> { key, label, text } (first occurrence wins). */
function sectionMap(lawText) {
  const { sections } = splitSections(lawText);
  const map = new Map();
  for (const s of sections) {
    const k = baseKey(s.key);
    if (!map.has(k)) map.set(k, { key: k, label: s.label.replace(/#\d+$/, ''), heading: s.heading, text: s.text });
  }
  return map;
}

/** The most characteristic words of each section (tf-idf within the act). */
function sectionKeywords(map, perSection = 6) {
  const docs = [];
  const df = new Map();
  for (const s of map.values()) {
    const tf = new Map();
    const surface = new Map();
    for (const w of words(s.text)) {
      if (w.length < 4 || /\d/.test(w)) continue;
      const k = processTerm(w);
      if (!k || k.length < 4 || LEGAL_STOP.has(k)) continue;
      tf.set(k, (tf.get(k) || 0) + 1);
      if (!surface.has(k)) surface.set(k, w.toLowerCase());
    }
    docs.push({ s, tf, surface });
    for (const k of tf.keys()) df.set(k, (df.get(k) || 0) + 1);
  }
  const n = Math.max(1, docs.length);
  const out = new Map();
  for (const d of docs) {
    const scored = Array.from(d.tf.entries())
      .map(([k, c]) => ({ k, w: d.surface.get(k), score: (1 + Math.log(c)) * Math.log(1 + n / (df.get(k) || 1)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, perSection);
    out.set(d.s.key, scored.map((x) => x.w));
  }
  return out;
}

function excerpt(text, max = 900) {
  const t = String(text || '').trim();
  return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') + ' …' : t;
}

const SEVERITY = { high: 3, medium: 2, low: 1, info: 0 };

/**
 * law:      { id, key, aliases }
 * lawText:  full text of the act (the version being checked)
 * touched:  keys of sections changed by a diff (or null)
 * docs:     [{ doc, pages }]  (doc.citations already computed against the register)
 * searchFn: (words: string[], minTerms) => [{ docId, page, heading, text, score, matched: string[] }]
 */
function analyzeLawAgainstDocs({ law, lawText, touched = null, docs = [], searchFn = null, maxRelatedDocs = 25 }) {
  const map = sectionMap(lawText);
  const reliable = map.size >= 3;
  const touchedSet = new Set((touched || []).map(baseKey));
  const results = new Map();
  const ensure = (docId) => {
    if (!results.has(docId)) results.set(docId, { docId, cites: null, findings: [], refs: [], related: [] });
    return results.get(docId);
  };

  for (const { doc, pages } of docs) {
    if (doc.status === 'obsolete') continue;
    const cit = (doc.citations || []).find((c) => c.lawId === law.id);
    if (!cit) continue;
    const r = ensure(doc.id);
    r.cites = { count: cit.count, sections: cit.sections };
    // Passages of the document that cite this act, grouped by the § they mention.
    const chunks = chunkPages(pages || [], 700);
    const bySection = new Map();
    for (const c of chunks) {
      const hit = detectCitations(c.text, [law])[0];
      if (!hit) continue;
      for (const s of hit.sections) {
        if (!bySection.has(s)) bySection.set(s, []);
        bySection.get(s).push({ page: c.page, heading: c.heading, text: c.text });
      }
    }
    for (const key of cit.sections) {
      const sec = map.get(key);
      const passages = bySection.get(key) || [];
      const ref = {
        key,
        label: sec ? sec.label : key.replace(/^§/, '§ ').replace(/^art/, 'Čl. '),
        inLaw: !!sec,
        changed: touchedSet.has(key),
        lawExcerpt: sec ? excerpt(`${sec.heading}\n${sec.text}`, 1600) : '',
        docExcerpts: passages.slice(0, 3).map((p) => ({ page: p.page, heading: p.heading, text: excerpt(p.text, 700) }))
      };
      r.refs.push(ref);
      if (reliable && !sec) r.findings.push({ type: 'missing', severity: 'high', section: key });
      if (ref.changed) r.findings.push({ type: 'changed', severity: 'high', section: key });
      if (sec && passages.length) {
        const docQ = passages.flatMap((p) => extractQuantities(p.text));
        const lawQ = extractQuantities(sec.text);
        for (const mm of mismatches(docQ, lawQ)) {
          r.findings.push({ type: 'quantity', severity: 'medium', section: key, docValue: mm.doc.raw, lawValues: mm.law });
        }
      }
    }
  }

  // Documents that don't cite the act but whose content matches what its sections regulate.
  if (searchFn && reliable) {
    const kw = sectionKeywords(map);
    const citing = new Set(Array.from(results.keys()));
    const rel = new Map();
    for (const [key, ws] of kw) {
      if (ws.length < 4) continue;
      const surface = new Map(ws.map((w) => [processTerm(w), w]));
      const hits = searchFn(ws, 3);
      for (const h of hits.slice(0, 4)) {
        if (citing.has(h.docId)) continue;
        if (!rel.has(h.docId)) rel.set(h.docId, []);
        rel.get(h.docId).push({ key, label: map.get(key).label, terms: (h.matched || []).map((m) => surface.get(m) || m), score: h.score, page: h.page, heading: h.heading, text: excerpt(h.text, 500), lawExcerpt: excerpt(`${map.get(key).heading}\n${map.get(key).text}`, 1200) });
      }
    }
    const ranked = Array.from(rel.entries())
      .map(([docId, list]) => {
        const best = new Map();
        for (const x of list.sort((a, b) => b.score - a.score)) if (!best.has(x.key)) best.set(x.key, x);
        const top = Array.from(best.values()).slice(0, 3);
        return { docId, top, total: top.reduce((n, x) => n + x.score, 0) };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, maxRelatedDocs);
    for (const { docId, top } of ranked) {
      const r = ensure(docId);
      r.related = top;
      for (const x of top) r.findings.push({ type: 'related', severity: 'info', section: x.key, terms: x.terms });
    }
  }

  const list = Array.from(results.values()).map((r) => {
    const sev = r.findings.reduce((m, f) => (SEVERITY[f.severity] > SEVERITY[m] ? f.severity : m), r.cites ? 'low' : 'info');
    return { ...r, severity: sev };
  });
  list.sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity] || b.findings.length - a.findings.length);
  return { sections: map.size, docs: list };
}

module.exports = { analyzeLawAgainstDocs, sectionMap, sectionKeywords, SEVERITY };
