'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { AuditLog, fileFor } = require('../../src/main/lib/auditlog');
const vault = require('../../src/main/lib/vault');

test('audit trail: one file per computer, encrypted, chained – a removed or changed line is noticed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-al-'));
  const key = vault.newDataKey();
  const crypt = { encrypt: (j) => vault.encryptLine(key, j), decrypt: (l) => vault.decryptLine(key, l) };
  // An archive from before: one plain audit.log without the chain.
  fs.writeFileSync(path.join(dir, 'audit.log'), vault.encryptLine(key, JSON.stringify({ ts: '2026-01-01T08:00:00.000Z', user: 'Starý', action: 'archive.created' })) + '\n');
  const a = new AuditLog(dir, 'PC-QA', crypt);
  const b = new AuditLog(dir, 'PC-SKLAD', crypt);
  await Promise.all([a.append({ ts: '2026-10-01T08:00:00.000Z', user: 'Juraj', action: 'doc.updated' }), b.append({ ts: '2026-10-01T08:00:01.000Z', user: 'Eva', action: 'training.confirmed' })]);
  for (let i = 0; i < 3; i++) await a.append({ ts: `2026-10-02T08:00:0${i}.000Z`, user: 'Juraj', action: 'doc.reviewed' });
  assert.notEqual(fileFor(dir, 'PC-QA'), fileFor(dir, 'PC-SKLAD'));
  assert.ok(!fs.readdirSync(path.join(dir, 'audit')).some((f) => /PC-/.test(f)), 'the file names do not show the computers');
  assert.ok(!fs.readFileSync(fileFor(dir, 'PC-QA'), 'utf8').includes('Juraj'), 'encrypted');

  let r = await a.readAll();
  assert.equal(r.rows.length, 6);
  assert.deepEqual(r.rows.map((x) => x.user), ['Starý', 'Juraj', 'Eva', 'Juraj', 'Juraj', 'Juraj'], 'all files, by time');
  assert.equal(r.rows[1].host, 'PC-QA', 'each record says which computer');
  assert.equal(r.integrity.ok, true);
  assert.equal(r.integrity.files, 3);

  // A new session on the same computer continues the chain.
  const a2 = new AuditLog(dir, 'PC-QA', crypt);
  await a2.append({ ts: '2026-10-03T08:00:00.000Z', user: 'Juraj', action: 'auth.login' });
  assert.equal((await a2.readAll()).integrity.ok, true);

  // Someone deletes a line from the file outside the app.
  const f = fileFor(dir, 'PC-QA');
  const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
  fs.writeFileSync(f, [lines[0], ...lines.slice(2)].join('\n') + '\n');
  r = await new AuditLog(dir, 'PC-X', crypt).readAll();
  assert.equal(r.integrity.ok, false);
  assert.deepEqual(r.integrity.problems.map((p) => [p.kind, p.line]), [['chain', 2]]);
  // A changed line cannot be read any more.
  fs.writeFileSync(f, [lines[0], lines[1].slice(0, -4) + 'AAAA', ...lines.slice(2)].join('\n') + '\n');
  r = await new AuditLog(dir, 'PC-X', crypt).readAll();
  assert.ok(r.integrity.problems.some((p) => p.kind === 'unreadable' && p.line === 2));
});
