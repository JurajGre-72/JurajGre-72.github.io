'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const R = require('../../src/main/lib/report');
const { buildXlsx } = require('../../src/main/lib/xlsx');
const { extractFile } = require('../../src/main/lib/extract');

const L = new Proxy({ lang: 'sk', overdueBy: 'po termíne {n} dní', inDays: 'o {n} dní', sumEffective: '{n} platných', generated: 'vytvorené {date}' }, { get: (o, k) => (k in o ? o[k] : String(k)) });

const data = {
  org: 'PHARMACOPOLA s.r.o.',
  laws: [{ id: 'L1', title: 'Zákon č. 362/2011 Z. z.', short: 'Zákon o liekoch', enabled: true, state: { status: 'ok', lastCheck: '2026-10-01T08:00:00Z', effectiveDate: '2026-05-30' } }],
  docs: [
    {
      id: 'd1', code: 'SOP-QA-001', title: 'Príjem & skladovanie <liekov>', type: 'SOP', version: '4', status: 'effective', department: 'Sklad', effectiveDate: '2025-01-01', reviewDate: '2026-09-01', approver: 'Konateľ',
      currentVersionId: 'v4', versions: [{ id: 'v4', seq: 4 }], citations: [{ lawId: 'L1', sections: ['§18'] }], trainingFor: ['*'], trainingSeq: 4,
      reviews: [{ date: '2026-03-01', by: 'QA', outcome: 'no-change', nextReviewDate: '2026-09-01', notes: '' }],
      approvals: [{ status: 'approved', versionId: 'v4', version: '4', requestedAt: '2026-02-01T10:00:00Z', requestedBy: 'QA', closedAt: '2026-02-02T10:00:00Z', steps: [{ role: 'approve', name: 'Konateľ', decision: 'approved', at: '2026-02-02T10:00:00Z' }] }],
      copies: [{ no: 1, version: '3', versionId: 'v3', issuedTo: 'Sklad', issuedAt: '2025-06-01T08:00:00Z', status: 'issued' }]
    },
    { id: 'd2', code: 'OS1', title: 'Stará smernica', type: 'OS', version: '1', status: 'obsolete', currentVersionId: 'x', versions: [], citations: [] }
  ],
  changes: [{ id: 'c1', lawId: 'L1', kind: 'upcoming', toDate: '2027-01-01', detectedAt: '2026-09-15T08:00:00Z', status: 'reviewing', affected: [{ severity: 'high' }, { severity: 'info' }] }],
  decisions: [{ lawId: 'L1', section: '§21', docId: null, kind: 'na', reason: 'Nedistribuujeme omamné látky.', by: 'QA', at: '2026-09-20T10:00:00Z' }],
  people: [{ id: 'p1', name: 'Ján', department: 'Sklad' }, { id: 'p2', name: 'Eva', department: 'QA' }],
  trainings: [{ personId: 'p1', personName: 'Ján', docId: 'd1', code: 'SOP-QA-001', title: 'Príjem', versionSeq: 4, version: '4', date: '2026-02-10', method: 'session', trainer: 'QA', confirmedByUser: undefined }]
};

test('inspection report: register, reviews, legislation, decisions, training, approvals, copies', async () => {
  const r = R.reportData(data, { today: '2026-10-06', from: '2026-01-01', to: '2026-12-31' });
  assert.equal(r.register.length, 1, 'documents no longer valid are left out');
  assert.equal(r.register[0].approvedInApp, '2026-02-02');
  assert.equal(r.register[0].training, '1/2');
  assert.equal(r.register[0].laws, 'Zákon o liekoch');
  assert.deepEqual(r.reviewsDue.map((x) => x.days), [-35], 'overdue review');
  assert.equal(r.reviewsDone.length, 1);
  assert.equal(r.changes[0].affected, 1);
  assert.equal(r.decisions[0].reason, 'Nedistribuujeme omamné látky.');
  assert.deepEqual(r.trainingMissing.map((x) => x.person), ['Eva']);
  assert.equal(r.copies[0].status, 'withdraw', 'copy of an old version');
  assert.deepEqual(r.counts, { docs: 1, effective: 1, overdue: 1, dueSoon: 0, openChanges: 1, decisions: 1, trainingMissing: 1, copiesToWithdraw: 1 });
  assert.equal(R.reportData(data, { today: '2026-10-06', from: '2026-03-02', to: '2026-03-31' }).reviewsDone.length, 0, 'the period limits the records');

  const html = R.reportHtml(r, L);
  assert.match(html, /Príjem &amp; skladovanie &lt;liekov&gt;/, 'escaped');
  assert.match(html, /po termíne 35 dní/);
  assert.match(html, /1\. 1\. 2025/, 'dates as d. m. yyyy');

  const tables = R.reportTables(r, L);
  const buf = await buildXlsx(tables.map((t) => ({ name: t.title, columns: t.columns.map((c) => ({ label: c.label, width: c.width })), rows: t.rows.map((row) => t.columns.map((c) => c.fmt(row[c.key]))) })));
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sop-rep-')), 'r.xlsx');
  fs.writeFileSync(f, buf);
  const text = (await extractFile(f)).pages.map((p) => p.text).join('\n');
  assert.match(text, /SOP-QA-001/);
  assert.match(text, /Nedistribuujeme omamné látky\./);
});
