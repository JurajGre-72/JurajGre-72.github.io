'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const A = require('../../src/main/lib/approval');

const users = [
  { id: 'u1', name: 'Ján Novák', role: 'editor' },
  { id: 'u2', name: 'Eva QA', role: 'editor' },
  { id: 'u3', name: 'Konateľ', role: 'admin' },
  { id: 'u4', name: 'Odišiel', role: 'editor', disabled: true }
];
const doc = { id: 'd', version: '2', currentVersionId: 'v2', versions: [{ id: 'v1', seq: 1 }, { id: 'v2', seq: 2 }] };

test('approval: reviewers then approvers, in order, each signs only their own step', () => {
  const req = A.createRequest({ doc, reviewers: ['u2'], approvers: ['u3'], by: 'Ján Novák', users, note: 'Nová verzia' });
  assert.equal(req.status, 'pending');
  assert.equal(req.versionSeq, 2);
  assert.deepEqual(req.steps.map((s) => [s.role, s.name]), [['review', 'Eva QA'], ['approve', 'Konateľ']]);
  assert.throws(() => A.sign(req, { userId: 'u3', decision: 'approved' }), /NOT_YOUR_TURN/, 'the approver waits for the review');
  A.sign(req, { userId: 'u2', decision: 'approved', comment: 'Bez pripomienok' });
  assert.equal(A.nextStep(req).userId, 'u3');
  A.sign(req, { userId: 'u3', decision: 'approved' });
  assert.equal(req.status, 'approved');
  assert.ok(req.closedAt);
  assert.throws(() => A.sign(req, { userId: 'u3', decision: 'approved' }), /NOTHING_TO_SIGN/);
});

test('approval: a rejection needs a reason and ends the request; an approver is required; unknown or disabled signers are refused', () => {
  const req = A.createRequest({ doc, reviewers: [], approvers: ['u3'], by: 'x', users });
  assert.throws(() => A.sign(req, { userId: 'u3', decision: 'rejected' }), /REASON_REQUIRED/);
  A.sign(req, { userId: 'u3', decision: 'rejected', comment: 'Chýba kapitola Záznamy' });
  assert.equal(req.status, 'rejected');
  assert.equal(A.nextStep(req), null);
  assert.throws(() => A.createRequest({ doc, reviewers: ['u2'], approvers: [], by: 'x', users }), /APPROVER_REQUIRED/);
  assert.throws(() => A.createRequest({ doc, approvers: ['u4'], by: 'x', users }), /UNKNOWN_SIGNER/);
  assert.throws(() => A.createRequest({ doc, approvers: ['nobody'], by: 'x', users }), /UNKNOWN_SIGNER/);
});

test('archive: approval makes the version effective; controlled copies stamped, old ones to withdraw', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const { Archive } = require('../../src/main/archive');
  const { extractFile } = require('../../src/main/lib/extract');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-apr-'));
  const a = new Archive({ dataDir: path.join(dir, 'arch'), user: 'Ján Novák' });
  await a.open();
  await a.buildIndex();
  const qa = await a.createUser({ name: 'Eva QA', role: 'editor', password: 'heslo-12345' });
  const boss = await a.createUser({ name: 'Konateľ', role: 'admin', password: 'heslo-67890' });
  const pdfOf = async (text) => {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    d.addPage([595, 842]).drawText(text, { x: 60, y: 760, size: 12, font: f });
    const p = path.join(dir, `${text.replace(/\W+/g, '_')}.pdf`);
    fs.writeFileSync(p, await d.save());
    return p;
  };
  const doc = await a.importFile(await pdfOf('SOP-QA-001 Prijem tovaru verzia 1'), { status: 'draft', reviewIntervalMonths: 24 });
  await a.requestApproval(doc.id, { reviewers: [qa.id], approvers: [boss.id], note: 'Prvé vydanie' });
  await assert.rejects(() => a.requestApproval(doc.id, { approvers: [boss.id] }), /APPROVAL_PENDING/);
  assert.deepEqual(a.approvalsFor(qa.id).map((d) => d.role), ['review']);
  assert.deepEqual(a.approvalsFor(boss.id), [], 'the approver waits for the review');
  await a.signApproval(doc.id, qa.id, { decision: 'approved', comment: 'OK' });
  await a.signApproval(doc.id, boss.id, { decision: 'approved' });
  let d = a.getDoc(doc.id);
  assert.equal(d.status, 'effective');
  assert.equal(d.approver, 'Konateľ');
  assert.ok(d.effectiveDate && d.reviewDate, 'effective today, next review planned');

  // controlled copy of the PDF: stamped on every page, numbered
  const c1 = await a.issueCopy(doc.id, { issuedTo: 'Sklad – Šárka Žilková', location: 'chladiaca miestnosť', format: 'pdf' });
  assert.equal(c1.copy.no, 1);
  assert.equal(c1.stamped, true);
  assert.match(c1.name, /_RK1\.pdf$/);
  const out = path.join(dir, 'copy.pdf');
  fs.writeFileSync(out, c1.data);
  const text = (await extractFile(out)).pages.map((p) => p.text).join('\n');
  assert.match(text, /RIADENÁ KÓPIA č\. 1/);
  assert.match(text, /Šárka Žilková – chladiaca miestnosť/);
  await assert.rejects(() => a.issueCopy(doc.id, { issuedTo: ' ' }), /RECIPIENT_REQUIRED/);
  assert.equal((await a.issueCopy(doc.id, { issuedTo: 'QA' })).copy.no, 2);
  assert.deepEqual(a.copiesToWithdraw(), []);

  // a new version: both copies of version 1 are to be withdrawn
  await a.addVersion(doc.id, await pdfOf('SOP-QA-001 Prijem tovaru verzia 2'), { version: '2' });
  assert.deepEqual(a.copiesToWithdraw().map((c) => c.no).sort(), [1, 2]);
  await a.withdrawCopy(doc.id, c1.copy.id);
  assert.deepEqual(a.copiesToWithdraw().map((c) => c.no), [2]);

  // the new version: a rejection needs a reason and keeps it as it is
  await a.requestApproval(doc.id, { approvers: [boss.id] });
  await assert.rejects(() => a.signApproval(doc.id, boss.id, { decision: 'rejected' }), /REASON_REQUIRED/);
  await a.signApproval(doc.id, boss.id, { decision: 'rejected', comment: 'Chýba kapitola Záznamy' });
  d = a.getDoc(doc.id);
  assert.deepEqual(d.approvals.map((x) => x.status), ['approved', 'rejected']);
  await new Promise((r) => setTimeout(r, 50));
  const log = await a.readAudit({ limit: 100 });
  for (const action of ['approval.requested', 'approval.signed', 'approval.approved', 'approval.rejected', 'copy.issued', 'copy.withdrawn']) assert.ok(log.some((x) => x.action === action), action);
});

test('approval: each signer signs in the app or by hand; the sheet completes the hand steps in their turn', () => {
  const req = A.createRequest({ doc, reviewers: ['u2'], approvers: [], hand: [{ role: 'approve', name: 'Konateľ Bez Aplikácie', position: 'konateľ' }, { role: 'review', userId: 'u1' }], by: 'x', users });
  assert.deepEqual(req.steps.map((s) => [s.role, s.mode, s.name]), [['review', 'app', 'Eva QA'], ['review', 'hand', 'Ján Novák'], ['approve', 'hand', 'Konateľ Bez Aplikácie']]);
  assert.equal(req.steps[2].position, 'konateľ');
  assert.throws(() => A.signHand(req, { signedOn: '2026-10-09', by: 'QA' }), /ORDER/, 'the review in the app comes first');
  A.sign(req, { userId: 'u2', decision: 'approved' });
  assert.throws(() => A.sign(req, { userId: 'u1', decision: 'approved' }), /HAND_STEP/, 'a step by hand is not signed in the app');
  const done = A.signHand(req, { signedOn: '2026-10-09', by: 'QA', sheetId: 's1' });
  assert.deepEqual(done.map((s) => s.name), ['Ján Novák', 'Konateľ Bez Aplikácie'], 'both hand signatures next in order');
  assert.equal(req.status, 'approved');
  assert.equal(req.steps[2].signedOn, '2026-10-09');
  assert.equal(req.steps[2].sheetId, 's1');
  assert.ok(A.createRequest({ doc, hand: [{ role: 'approve', name: 'Len Ručne' }], by: 'x', users }).steps.length === 1, 'an approval only by hand is possible');
  assert.throws(() => A.createRequest({ doc, hand: [{ role: 'review', name: 'Len Preskúmanie' }], by: 'x', users }), /APPROVER_REQUIRED/);
});
