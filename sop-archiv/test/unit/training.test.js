'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const T = require('../../src/main/lib/training');
const { Archive } = require('../../src/main/archive');

test('who must be trained, and on which version', () => {
  const sklad = { id: 'p1', name: 'Ján', department: 'Sklad' };
  const qa = { id: 'p2', name: 'Eva', department: 'Kvalita (QA)' };
  const gone = { id: 'p3', name: 'Peter', department: 'Sklad', active: false };
  const doc = { id: 'd1', status: 'effective', trainingFor: ['Sklad'], trainingSeq: 2, versions: [{ id: 'v1', seq: 1 }, { id: 'v2', seq: 2 }], currentVersionId: 'v2' };
  assert.equal(T.isRequired(doc, sklad), true);
  assert.equal(T.isRequired(doc, qa), false);
  assert.equal(T.isRequired(doc, gone), false, 'not for employees who left');
  assert.equal(T.isRequired({ ...doc, status: 'draft' }, sklad), false, 'not for drafts');
  assert.equal(T.isRequired({ ...doc, trainingFor: ['*'] }, qa), true, 'everyone');
  assert.equal(T.isRequired({ ...doc, trainingFor: [] }, sklad), false);
  const old = { personId: 'p1', docId: 'd1', versionSeq: 1, date: '2025-01-01' };
  assert.equal(T.validRecord(doc, sklad, [old]), null, 'training on the previous version does not count');
  assert.ok(T.validRecord({ ...doc, trainingSeq: 1 }, sklad, [old]), 'a correction that needs no retraining keeps it valid');
  const ov = T.overview([doc, { ...doc, id: 'd2', trainingFor: ['*'], trainingSeq: 1 }], [sklad, qa, gone], [old, { personId: 'p2', docId: 'd2', versionSeq: 1, date: '2025-02-01' }]);
  assert.equal(ov.missing, 2, 'Ján on d1 (new version) and on d2');
  assert.deepEqual(ov.people.find((p) => p.person.id === 'p2'), { person: qa, required: 1, trained: 1, missing: [] });
});

test('archive: employees, recorded training, new version requires it again (unless a correction), read-and-understood', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-tr-'));
  const a = new Archive({ dataDir: path.join(dir, 'arch'), user: 'qa' });
  await a.open();
  await a.buildIndex();
  const u = await a.createUser({ name: 'Ján Skladník', role: 'reader', password: 'heslo-12345' });
  const jan = await a.savePerson({ name: 'Ján Skladník', department: 'Sklad', position: 'skladník', userId: u.id });
  const eva = await a.savePerson({ name: 'Eva Nováková', department: 'Kvalita (QA)' });
  await assert.rejects(() => a.savePerson({ name: 'Iný', userId: u.id }), /USER_LINKED/);
  await assert.rejects(() => a.savePerson({ name: ' ' }), /NAME_REQUIRED/);
  const f = path.join(dir, 'SOP-QA-001.txt');
  fs.writeFileSync(f, 'SOP-QA-001 Príjem\nVerzia: 1\nPostup príjmu tovaru.');
  const doc = await a.importFile(f, { trainingFor: 'Sklad' });
  assert.deepEqual(doc.trainingFor, ['Sklad']);
  let ov = a.trainingOverview();
  assert.equal(ov.missing, 1);
  assert.deepEqual(a.readingList(u.id).docs.map((d) => d.id), [doc.id], 'Ján has it on his reading list');
  assert.deepEqual(a.readingList('nobody').docs, []);

  // read and understood (recorded as confirmed by the user)
  const [r1] = await a.recordTraining({ docId: doc.id, personIds: [jan.id], method: 'reading' }, { confirmedByUser: u.id });
  assert.equal(r1.versionSeq, 1);
  assert.equal(a.trainingOverview().missing, 0);
  assert.deepEqual(a.readingList(u.id).docs, []);

  // a correction: no retraining
  const f2 = path.join(dir, 'SOP-QA-001-v2.txt');
  fs.writeFileSync(f2, 'SOP-QA-001 Príjem\nVerzia: 2\nPostup príjmu tovaru (oprava preklepu).');
  await a.addVersion(doc.id, f2, { version: '2', retrain: false });
  assert.equal(a.trainingOverview().missing, 0, 'earlier training still valid');
  // a real change: everyone again
  const f3 = path.join(dir, 'SOP-QA-001-v3.txt');
  fs.writeFileSync(f3, 'SOP-QA-001 Príjem\nVerzia: 3\nNový postup príjmu tovaru s dataloggerom.');
  await a.addVersion(doc.id, f3, { version: '3' });
  ov = a.trainingOverview();
  assert.equal(ov.missing, 1, 'training needed on version 3');
  assert.deepEqual(ov.people.find((p) => p.id === jan.id).missing.map((d) => d.version), ['3']);

  // a session for the whole warehouse, everyone on the document
  await a.updateDoc(doc.id, { trainingFor: ['*'] });
  await new Promise((r) => setTimeout(r, 5));
  await a.recordTraining({ docId: doc.id, personIds: [jan.id, eva.id], method: 'session', trainer: 'QA manažér' });
  const card = a.personCard(jan.id);
  assert.equal(card.missing.length, 0);
  assert.deepEqual(card.records.map((r) => r.version), ['3', '1']);
  const dt = a.docTraining(doc.id);
  assert.equal(dt.rows.length, 2);
  assert.ok(dt.rows.every((r) => r.record && r.record.versionSeq === 3));
  await assert.rejects(() => a.recordTraining({ docId: doc.id, personIds: [] }), /PEOPLE_REQUIRED/);

  // an employee who left no longer counts
  await a.savePerson({ ...eva, active: false });
  assert.equal(a.docTraining(doc.id).rows.length, 1);
  await a.removeTraining(card.records[0].id);
  assert.equal(a.trainingOverview().missing, 1);

  await new Promise((r) => setTimeout(r, 50));
  const log = await a.readAudit({ limit: 100 });
  for (const action of ['person.added', 'person.updated', 'training.confirmed', 'training.recorded', 'training.removed']) assert.ok(log.some((x) => x.action === action), action);
});
