'use strict';
// Training records: who must know which document, and who has been trained on (or has read and
// understood) its current version. A new version can require training again; a small correction can
// keep the earlier records valid.
//
//   person:   { id, name, department, position, userId, active }
//   doc:      { id, status, trainingFor: ['*'] | [departments], trainingSeq, versions, currentVersionId }
//   training: { personId, docId, versionSeq, date, method }

const METHODS = ['session', 'self', 'reading', 'onjob'];

/** Does this person have to be trained on this document? */
function isRequired(doc, person) {
  if (!doc || !person || person.active === false) return false;
  if (doc.status !== 'effective' && doc.status !== 'review') return false;
  const f = doc.trainingFor || [];
  if (!f.length) return false;
  return f.includes('*') || (!!person.department && f.includes(person.department));
}

/** The version number (seq) from which training is needed. */
function requiredSeq(doc) {
  if (doc.trainingSeq) return doc.trainingSeq;
  const cur = (doc.versions || []).find((v) => v.id === doc.currentVersionId);
  return cur ? cur.seq : 1;
}

/** The latest valid record of this person for this document, or null. */
function validRecord(doc, person, trainings) {
  const need = requiredSeq(doc);
  let best = null;
  for (const t of trainings) {
    if (t.docId !== doc.id || t.personId !== person.id || (t.versionSeq || 0) < need) continue;
    if (!best || String(t.date) > String(best.date)) best = t;
  }
  return best;
}

/**
 * The whole picture: per person (required, trained, missing documents) and per document
 * (who must be trained, who is, who is missing).
 */
function overview(docs, people, trainings) {
  const perPerson = new Map(people.map((p) => [p.id, { person: p, required: 0, trained: 0, missing: [] }]));
  const perDoc = [];
  for (const d of docs) {
    const row = { docId: d.id, required: 0, trained: 0, missing: [] };
    for (const p of people) {
      if (!isRequired(d, p)) continue;
      row.required++;
      const pp = perPerson.get(p.id);
      pp.required++;
      if (validRecord(d, p, trainings)) {
        row.trained++;
        pp.trained++;
      } else {
        row.missing.push(p.id);
        pp.missing.push(d.id);
      }
    }
    if (row.required || (d.trainingFor || []).length) perDoc.push(row);
  }
  const missingTotal = perDoc.reduce((n, r) => n + r.missing.length, 0);
  return { people: Array.from(perPerson.values()), docs: perDoc, missing: missingTotal };
}

module.exports = { METHODS, isRequired, requiredSeq, validRecord, overview };
