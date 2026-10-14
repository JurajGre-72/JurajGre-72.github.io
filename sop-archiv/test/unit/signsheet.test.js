'use strict';
// The signature sheet: signatures in the app on it, rows for people without the app to sign by hand, and the
// signed paper recorded back (employees' acknowledgement, approval by hand, the scan kept encrypted).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { Archive } = require('../../src/main/archive');
const { extractFile } = require('../../src/main/lib/extract');
const { buildSignSheet, appendSheet } = require('../../src/main/lib/signsheet');

const textOf = async (dir, buf, name) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, buf);
  const ex = await extractFile(p);
  return { pages: ex.pages.length, text: ex.pages.map((x) => x.text).join('\n').replace(/\s+/g, ' ') };
};

test('the sheet: electronic signatures, rows to approve by hand, employees to sign – over several pages', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-sheet-'));
  const people = Array.from({ length: 30 }, (_, i) => ({ name: `Zamestnanec Číslo${i + 1}`, position: 'Sklad' }));
  const buf = await buildSignSheet({
    org: 'PHARMACOPOLA s.r.o.',
    lang: 'sk',
    printedAt: new Date('2026-10-09T08:00:00'),
    doc: { code: 'SM Q 05', title: 'Stiahnutie liekov z trhu', version: '3', effectiveDate: '2026-10-01' },
    submitted: { name: 'Juraj Gregus', at: '2026-09-29T09:12:00' },
    electronic: [
      { role: 'review', name: 'Eva Nováková', at: '2026-09-30T10:00:00' },
      { role: 'approve', name: 'Konateľ Firmy', at: null }
    ],
    read: [{ name: 'Peter Šťastný', date: '2026-10-02', method: 'reading' }],
    handApproval: true,
    people,
    emptyRows: 5
  });
  const { pages, text } = await textOf(dir, buf, 'sheet.pdf');
  assert.ok(pages >= 2, 'continues on the next page');
  for (const s of ['PODPISOVÝ HÁROK', 'SM Q 05 Stiahnutie liekov z trhu', 'Verzia 3 · platná od 1. 10. 2026', 'Na schválenie predložil(a): Juraj Gregus, 29. 9. 2026 09:12', 'Preskúmal(a) Eva Nováková 30. 9. 2026 10:00 elektronicky (heslom)', 'čaká na podpis v aplikácii', 'Peter Šťastný 2. 10. 2026 potvrdené elektronicky (heslom)', 'Schválenie vlastnoručným podpisom', 'Svojím podpisom potvrdzujem', 'Zamestnanec Číslo1 Sklad', 'Zamestnanec Číslo30', '35.', `Strana ${pages} / ${pages}`]) assert.ok(text.includes(s), s);

  const en = await textOf(dir, await buildSignSheet({ lang: 'en', doc: { code: 'X', title: 'Y', version: '1' }, electronic: [], read: [], people: [], emptyRows: 0 }), 'en.pdf');
  assert.match(en.text, /SIGNATURE SHEET/);
  assert.match(en.text, /not been signed in the app yet/);
  assert.doesNotMatch(en.text, /acknowledgement of the document/, 'no rows asked for: no acknowledgement table');

  // At the end of a document
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  d.addPage([595, 842]).drawText('SOP text', { x: 60, y: 760, size: 12, font: f });
  const joined = await appendSheet(Buffer.from(await d.save()), buf);
  assert.equal((await PDFDocument.load(joined)).getPageCount(), 1 + pages);
});

test('archive: who still has to sign by hand, the signed sheet recorded with its scan, a copy with the sheet', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-sheet-'));
  const a = new Archive({ dataDir: path.join(dir, 'arch'), user: 'Juraj Gregus' });
  await a.open();
  await a.buildIndex();
  a.inTx = true;
  await a.enableEncryption();
  const boss = await a.createUser({ name: 'Konateľ Firmy', role: 'admin', password: 'heslo-67890' });
  const pdfOf = async (text) => {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    d.addPage([595, 842]).drawText(text, { x: 60, y: 760, size: 12, font: f });
    const p = path.join(dir, `${text.replace(/\W+/g, '_')}.pdf`);
    fs.writeFileSync(p, await d.save());
    return p;
  };
  const doc = await a.importFile(await pdfOf('SOP-SK-002 Stiahnutie liekov'), { status: 'draft', reviewIntervalMonths: 24 });
  await a.requestApproval(doc.id, { approvers: [boss.id] });
  await a.signApproval(doc.id, boss.id, { decision: 'approved' });
  await a.updateDoc(doc.id, { trainingFor: ['Sklad'] });
  const peter = await a.savePerson({ name: 'Peter Sklad', department: 'Sklad', position: 'skladník' });
  const jana = await a.savePerson({ name: 'Jana Expedícia', department: 'Sklad' });
  await a.savePerson({ name: 'Účtovníčka', department: 'Ekonomika' });
  await a.savePerson({ name: 'Konateľ Firmy', department: 'Sklad', userId: boss.id });

  let s = a.signSheetData(doc.id);
  assert.deepEqual(s.electronic.map((x) => [x.role, x.name, !!x.at]), [['approve', 'Konateľ Firmy', true]]);
  assert.equal(s.submitted.name, 'Juraj Gregus');
  assert.deepEqual(s.people.map((p) => p.name), ['Jana Expedícia', 'Peter Sklad'], 'must know it, no app, not confirmed yet');
  assert.equal(s.people[1].position, 'skladník, Sklad');

  // The signed paper comes back: Peter signed; the scan is kept encrypted with the document.
  const scan = path.join(dir, 'podpisany-harok.pdf');
  fs.writeFileSync(scan, fs.readFileSync(await pdfOf('podpisany harok')));
  await assert.rejects(() => a.recordSignedSheet(doc.id, { kind: 'reading', personIds: [] }), /PEOPLE_REQUIRED/);
  await assert.rejects(() => a.recordSignedSheet(doc.id, { kind: 'reading', personIds: [peter.id], filePath: path.join(dir, 'x.exe') }), /SCAN_TYPE|ENOENT/);
  const sheet = await a.recordSignedSheet(doc.id, { kind: 'reading', personIds: [peter.id], date: '2026-10-08', note: 'Originál v šanóne QA', filePath: scan });
  assert.equal(sheet.people[0].name, 'Peter Sklad');
  const rec = a.data.trainings.find((t) => t.personId === peter.id);
  assert.equal(rec.method, 'signed');
  assert.equal(rec.sheetId, sheet.id);
  assert.equal(rec.date, '2026-10-08');
  assert.deepEqual(a.signSheetData(doc.id).people.map((p) => p.name), ['Jana Expedícia'], 'Peter no longer listed');
  assert.deepEqual(a.signSheetData(doc.id).read.map((r) => [r.name, r.method]), [['Peter Sklad', 'signed']]);
  const stored = a.p(...sheet.file.path.split('/'));
  assert.ok(!fs.readFileSync(stored).includes(Buffer.from('%PDF')), 'the scan is encrypted in the archive');
  assert.deepEqual((await a.sheetContent(doc.id, sheet.id)).data, fs.readFileSync(scan));
  assert.ok(a.deletionBlockers(doc.id).includes('sheets'));

  // Approval by hand: who approved is required.
  await assert.rejects(() => a.recordSignedSheet(doc.id, { kind: 'approval', signers: [{ role: 'review', name: 'Niekto' }] }), /APPROVER_REQUIRED/);
  const appr = await a.recordSignedSheet(doc.id, { kind: 'approval', signers: [{ role: 'prepared', name: 'Juraj Gregus' }, { role: 'approve', name: 'Konateľ Firmy', position: 'konateľ' }] });
  assert.deepEqual(appr.signers.map((x) => x.role), ['prepared', 'approve']);
  assert.match(JSON.stringify(await a.allAudit()), /sheet\.recorded/);

  // A controlled copy with the sheet at the end: stamped like every other page.
  const sheetPdf = await buildSignSheet({ ...a.signSheetData(doc.id), lang: 'sk', people: a.signSheetData(doc.id).people, emptyRows: 3 });
  const copy = await a.issueCopy(doc.id, { issuedTo: 'Sklad', format: 'pdf', sheetPdf });
  assert.equal(copy.copy.withSheet, true);
  const { pages, text } = await textOf(dir, copy.data, 'copy.pdf');
  assert.equal(pages, 2);
  assert.match(text, /PODPISOVÝ HÁROK/);
  assert.match(text, /Jana Expedícia/);
  assert.equal((text.match(/RIADENÁ KÓPIA č\. 1/g) || []).length, 2, 'the sheet carries the copy stamp too');
  a.inTx = false;
});

test('archive: who signs by hand is chosen – named on the sheet; the signed sheet makes the version effective', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-sheet-'));
  const a = new Archive({ dataDir: path.join(dir, 'arch'), user: 'Juraj Gregus' });
  await a.open();
  await a.buildIndex();
  a.inTx = true;
  const qa = await a.createUser({ name: 'Eva QA', role: 'editor', password: 'heslo-12345' });
  const reader = await a.createUser({ name: 'Peter Čitateľ', role: 'reader', password: 'heslo-11111' });
  const d0 = await PDFDocument.create();
  d0.addPage([595, 842]).drawText('SOP-QA-009', { x: 60, y: 760, size: 12, font: await d0.embedFont(StandardFonts.Helvetica) });
  const file = path.join(dir, 'sop.pdf');
  fs.writeFileSync(file, await d0.save());
  const doc = await a.importFile(file, { status: 'draft', reviewIntervalMonths: 24 });
  await a.updateDoc(doc.id, { trainingFor: ['*'] });
  const peter = await a.savePerson({ name: 'Peter Čitateľ', department: 'Sklad', userId: reader.id });
  await a.savePerson({ name: 'Mária Ručná', department: 'Sklad' });

  // Eva reviews in the app, the managing director approves by hand.
  await a.requestApproval(doc.id, { reviewers: [qa.id], hand: [{ role: 'approve', name: 'Konateľ Firmy', position: 'konateľ' }] });
  await assert.rejects(() => a.recordSignedSheet(doc.id, { kind: 'approval' }), /ORDER|APPROVER_REQUIRED/, 'not before the review in the app');
  await a.signApproval(doc.id, qa.id, { decision: 'approved' });
  let s = a.signSheetData(doc.id);
  assert.deepEqual(s.electronic.map((x) => x.name), ['Eva QA']);
  assert.deepEqual(s.handSigners.map((x) => [x.role, x.name, x.position, x.signedOn]), [['approve', 'Konateľ Firmy', 'konateľ', null]]);
  assert.equal(s.waitingHand, true);
  assert.deepEqual(s.people.map((p) => p.name), ['Mária Ručná'], 'Peter confirms in the app');

  // Peter is to sign on paper too: on the sheet, no longer on his reading list in the app.
  assert.equal(a.readingList(reader.id).docs.length, 0, 'a draft is not read yet');
  await a.setSignModes(doc.id, { [peter.id]: 'hand' });
  assert.deepEqual(a.signSheetData(doc.id).people.map((p) => p.name), ['Mária Ručná', 'Peter Čitateľ']);
  assert.deepEqual(a.docTraining(doc.id).rows.map((r) => [r.person.name, r.mode]).sort(), [['Mária Ručná', 'hand'], ['Peter Čitateľ', 'hand']]);

  const sheetPdf = await buildSignSheet({ ...a.signSheetData(doc.id), lang: 'sk', emptyRows: 0 });
  const { text } = await textOf(dir, sheetPdf, 'sheet.pdf');
  assert.ok(text.includes('Schválil(a) Konateľ Firmy konateľ'), 'the hand approver named on the sheet');
  assert.ok(text.includes('Preskúmal(a) Eva QA'), 'the review in the app');

  // The signed sheet recorded: the hand approval completes the request – the version is effective.
  const sh = await a.recordSignedSheet(doc.id, { kind: 'approval', date: '2026-10-09' });
  assert.equal(sh.forApproval, true);
  assert.deepEqual(sh.signers.map((x) => x.name), ['Konateľ Firmy']);
  const d = a.getDoc(doc.id);
  assert.equal(d.status, 'effective');
  assert.equal(d.approver, 'Konateľ Firmy');
  assert.equal(d.approvals[0].steps[1].signedOn, '2026-10-09');
  assert.equal(a.readingList(reader.id).docs.length, 0, 'Peter signs on paper: nothing to read in the app');
  await a.setSignModes(doc.id, { [peter.id]: 'app' });
  assert.equal(a.readingList(reader.id).docs.length, 1, 'back to the app: the document waits for him');
  const audit = JSON.stringify(await a.allAudit());
  assert.match(audit, /"byHand":true/);
  assert.match(audit, /sheet\.modes/);
  a.inTx = false;
});
