'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { exportArchive, safe } = require('../../src/main/export');
const { Archive } = require('../../src/main/archive');
const { extractFile } = require('../../src/main/lib/extract');
const labels = require('../../src/main/report-labels');

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.push(path.relative(base, p));
  }
  return out.sort();
}

test('readable export: original files of every version, register with fingerprints, report, audit trail, read-me', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-exp-'));
  const a = new Archive({ dataDir: path.join(base, 'arch'), user: 'Správca' });
  await a.open();
  await a.createUser({ name: 'Správca', role: 'admin', password: 'Tajne-heslo-1', mustChange: false });
  await a.enableEncryption();
  await a.buildIndex();
  const f1 = path.join(base, 'SOP-QA-001.txt');
  fs.writeFileSync(f1, 'SOP-QA-001 Príjem liekov\nVerzia: 1\nPrvé znenie.');
  const d1 = await a.importFile(f1, { code: 'SOP-QA-001', title: 'Príjem / skladovanie: liekov?', status: 'effective', type: 'SOP' });
  const f1b = path.join(base, 'SOP-QA-001 v2.txt');
  fs.writeFileSync(f1b, 'SOP-QA-001 Príjem liekov\nVerzia: 2\nDruhé znenie.');
  await a.addVersion(d1.id, f1b, { version: '2' });
  const f2 = path.join(base, 'OS-1.txt');
  fs.writeFileSync(f2, 'OS 1/2020 Stará smernica');
  const d2 = await a.importFile(f2, { code: 'OS 1/2020', title: 'Stará smernica', status: 'obsolete', type: 'OS' });
  assert.ok(d2);

  const opts = { lang: 'sk', user: 'Správca', version: '1.0.0', labels: labels('sk'), typeLabel: (t) => t, audit: { columns: ['Kedy', 'Kto', 'Čo', 'Dokument', 'Podrobnosti'], rows: [['1. 10. 2026 10:00', 'Správca', 'Dokument importovaný', 'SOP-QA-001', '']] } };
  const dest = path.join(base, 'export');
  const r = await exportArchive(a, dest, { ...opts, includeOld: true, includeObsolete: true });
  assert.deepEqual(r, { dir: dest, docs: 2, files: 3 });
  const files = walk(dest);
  assert.ok(files.includes('ČÍTAJ MA.txt'));
  assert.ok(files.includes('Register dokumentov.xlsx'));
  assert.ok(files.includes('Správa o dokumentácii.xlsx'));
  assert.ok(files.includes('Auditný záznam.xlsx'));
  const docFiles = files.filter((f) => f.startsWith('Dokumenty'));
  assert.equal(docFiles.length, 3);
  assert.ok(docFiles.some((f) => /^Dokumenty[\\/]SOP[\\/]SOP-QA-001 – Príjem skladovanie liekov[\\/]v2 – SOP-QA-001 v2\.txt$/.test(f)), docFiles.join(' | '));
  assert.ok(docFiles.some((f) => /\(stará\) v1 – /.test(f)), 'the older version is marked');
  // The exported file is the original: readable, and its fingerprint is the one in the register.
  const cur = docFiles.find((f) => /v2 – /.test(f));
  const plain = fs.readFileSync(path.join(dest, cur));
  assert.match(plain.toString('utf8'), /Druhé znenie/);
  const sha = crypto.createHash('sha256').update(plain).digest('hex');
  const reg = (await extractFile(path.join(dest, 'Register dokumentov.xlsx'))).pages.map((p) => p.text).join('\n');
  assert.ok(reg.includes(sha), 'register lists the SHA-256 of the exported file');
  assert.match(reg, /platná \(aktuálna\)/);
  assert.match(reg, /staršia, nahradená/);
  assert.match(fs.readFileSync(path.join(dest, 'ČÍTAJ MA.txt'), 'utf8'), /NIE SÚ zašifrované/);

  // Only the valid versions, without obsolete documents; the target must be new or empty.
  await assert.rejects(() => exportArchive(a, dest, { ...opts, includeOld: true, includeObsolete: true }), /EXPORT_NOT_EMPTY/);
  const dest2 = path.join(base, 'export2');
  const r2 = await exportArchive(a, dest2, { ...opts, includeOld: false, includeObsolete: false });
  assert.deepEqual([r2.docs, r2.files], [1, 1]);
  assert.equal(safe('a<b>:c?'), 'a b c');
});
