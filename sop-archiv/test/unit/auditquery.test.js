'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { queryAudit, areaOf } = require('../../src/main/lib/auditquery');

const local = (y, m, d, h) => new Date(y, m - 1, d, h).toISOString();
const rows = [
  { ts: local(2026, 9, 30, 23), user: 'Eva Nováková', action: 'auth.login' },
  { ts: local(2026, 10, 1, 0), user: 'Eva Nováková', action: 'doc.opened', docId: 'd1', code: 'SOP-QA-001' },
  { ts: local(2026, 10, 1, 9), user: 'Juraj Gregus', action: 'doc.updated', docId: 'd1', code: 'SOP-QA-001', changes: { status: { from: 'draft', to: 'effective' } } },
  { ts: local(2026, 10, 2, 10), user: 'Juraj Gregus', action: 'approval.approved', docId: 'd2', code: 'SOP-SK-002' },
  { ts: local(2026, 10, 3, 11), user: 'Eva Nováková', action: 'training.confirmed', docId: 'd1' },
  { ts: local(2026, 10, 4, 12), user: 'Juraj Gregus', action: 'decision.added', reason: 'Omamné látky nedistribuujeme.' },
  { ts: local(2026, 10, 5, 8), user: 'Juraj Gregus', action: 'notice.handled', title: 'Stiahnutie lieku Fiktivol' }
];

test('audit trail filters: period (local days), person, area, document, text, changes only', () => {
  const all = queryAudit(rows, {});
  assert.equal(all.total, 7);
  assert.deepEqual(all.users, ['Eva Nováková', 'Juraj Gregus']);
  assert.equal(all.rows[0].action, 'notice.handled', 'newest first');
  assert.equal(queryAudit(rows, { from: '2026-10-01', to: '2026-10-01' }).total, 2, 'midnight belongs to its local day');
  assert.equal(queryAudit(rows, { user: 'Eva Nováková' }).total, 3);
  assert.deepEqual(queryAudit(rows, { area: 'documents' }).rows.map((r) => r.action), ['doc.updated', 'doc.opened']);
  assert.equal(queryAudit(rows, { docId: 'd1' }).total, 3);
  assert.equal(queryAudit(rows, { docId: 'd1', changesOnly: true }).total, 2, 'opening is not a change');
  assert.deepEqual(queryAudit(rows, { q: 'omamne' }).rows.map((r) => r.action), ['decision.added'], 'diacritics do not matter');
  assert.equal(queryAudit(rows, { limit: 2 }).rows.length, 2);
  assert.equal(queryAudit(rows, { limit: 2 }).total, 7, 'the total counts all matches');
  assert.equal(areaOf('notices.new'), 'notices');
  assert.equal(areaOf('user.password-reset'), 'users');
});
