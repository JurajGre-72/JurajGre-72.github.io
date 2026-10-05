'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const L = require('../../src/main/lib/legis-parse');
const { Archive } = require('../../src/main/archive');
const { LegislationMonitor } = require('../../src/main/legislation');
const { makeAll } = require('../fixtures/make');

test('detectSource', () => {
  assert.equal(L.detectSource('https://www.slov-lex.sk/pravne-predpisy/SK/ZZ/2011/362/'), 'slovlex');
  assert.equal(L.detectSource('https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/2011/362/'), 'slovlex');
  assert.equal(L.detectSource('https://eur-lex.europa.eu/legal-content/SK/ALL/?uri=CELEX:32019R0006'), 'eurlex');
  assert.equal(L.detectSource('https://www.sukl.sk/'), 'generic');
});

test('Slov-Lex versions from links, final URL and raw HTML', () => {
  const page = {
    url: 'https://www.slov-lex.sk/pravne-predpisy/SK/ZZ/2011/362/20250101',
    links: [{ href: 'https://www.slov-lex.sk/pravne-predpisy/SK/ZZ/2011/362/20240601' }, { href: 'https://www.slov-lex.sk/pravne-predpisy/SK/ZZ/2011/363/20990101' }],
    html: '<option value="/pravne-predpisy/SK/ZZ/2011/362/20270101">od 1.1.2027</option>'
  };
  const vs = L.parseVersions('slovlex', page, { url: 'https://www.slov-lex.sk/pravne-predpisy/SK/ZZ/2011/362/' });
  assert.deepEqual(vs.map((v) => v.date), ['2024-06-01', '2025-01-01', '2027-01-01']);
  const p = L.pickVersions(vs, '2026-10-05');
  assert.equal(p.effective.date, '2025-01-01');
  assert.equal(p.newest.date, '2027-01-01');
  assert.equal(p.upcoming.length, 1);
  assert.equal(L.pageVersionKey(page), '20250101');
});

test('EUR-Lex consolidated versions', () => {
  const page = { url: 'x', links: [{ href: 'https://eur-lex.europa.eu/legal-content/SK/AUTO/?uri=CELEX%3A02019R0006-20220128' }], html: '<a href="?uri=CELEX:02019R0006-20230101">' };
  const vs = L.parseVersions('eurlex', page, { url: 'https://eur-lex.europa.eu/legal-content/SK/ALL/?uri=CELEX:32019R0006', key: 'EU:32019R0006' });
  assert.deepEqual(vs.map((v) => v.key), ['20220128', '20230101']);
  assert.equal(vs[1].url, 'https://eur-lex.europa.eu/legal-content/SK/TXT/?uri=CELEX:02019R0006-20230101');
});

test('section split and diff ignore renumbered footnotes', () => {
  const a = '§ 1\nPredmet\n(1) Text.\n§ 18\nPovinnosti\n(1) Evidencia 5 rokov podľa predpisu15).\n§ 19\n(1) Bez zmeny podľa predpisu16).\n§ 23a\n(1) Zrušený.';
  const b = '§ 1\nPredmet\n(1) Text.\n§ 18\nPovinnosti\n(1) Evidencia 10 rokov podľa predpisu16).\n§ 19\n(1) Bez zmeny podľa predpisu17).\n§ 19a\nNové\n(1) Nový text.';
  const d = L.diffLaw(a, b);
  assert.equal(d.mode, 'sections');
  assert.deepEqual(d.changed.map((s) => s.key), ['§18']);
  assert.deepEqual(d.added.map((s) => s.key), ['§19a']);
  assert.deepEqual(d.removed.map((s) => s.key), ['§23a']);
  assert.ok(d.changed[0].parts.some((p) => p.t === 'add' && p.s.includes('10')));
  assert.deepEqual(L.touchedKeys(d).sort(), ['§18', '§19a', '§23a']);
});

test('EU articles are split as sections', () => {
  const s = L.splitSections('Preambula\nČlánok 1\nPredmet\nText\nČlánok 2\nVymedzenie pojmov\nText\nPRÍLOHA I\nZoznam');
  assert.deepEqual(s.sections.map((x) => x.key), ['art1', 'art2', 'annexi']);
});

test('generic pages fall back to a line diff', () => {
  const d = L.diffLaw('Oznamy\nNovinka 1', 'Oznamy\nNovinka 1\nNovinka 2');
  assert.equal(d.mode, 'lines');
  assert.deepEqual(d.added, ['Novinka 2']);
});

test('detectRepealed', () => {
  assert.match(L.detectRepealed('eurlex', 'Smernica\nNo longer in force, Date of end of validity: 01/01/2027'), /No longer in force/);
  assert.equal(L.detectRepealed('slovlex', '§ 23a\nZrušený od 1.1.2020'), null);
});

// ---------------------------------------------------------------------------

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sop-unit-'));
}

const law = (body) => `Zákon č. 362/2011 Z. z.\n${body}\n§ 99\nÚčinnosť\n${'Záverečné ustanovenia. '.repeat(10)}`;
const V = {
  20250101: law('§ 1\nPredmet\n(1) Text.\n§ 18\nPovinnosti\n(1) Stiahnutie z trhu na základe rozhodnutia.\n§ 19\n(1) Bez zmeny.'),
  20270101: law('§ 1\nPredmet\n(1) Text.\n§ 18\nPovinnosti\n(1) Stiahnutie z trhu do 24 hodín od rozhodnutia.\n§ 19\n(1) Bez zmeny.\n§ 19a\nNové\n(1) Ochranné prvky.'),
  20280101: law('§ 1\nPredmet\n(1) Text upravený.\n§ 18\nPovinnosti\n(1) Stiahnutie z trhu do 24 hodín od rozhodnutia.\n§ 19\n(1) Bez zmeny.\n§ 19a\nNové\n(1) Ochranné prvky.')
};

test('archive + monitor: baseline, upcoming, new version, generic page, errors', async () => {
  const dir = tmpDir();
  const fx = await makeAll(path.join(dir, 'fx'));
  const a = new Archive({ dataDir: path.join(dir, 'arch'), user: 'tester' });
  await a.open();
  await a.buildIndex();
  const doc = await a.importFile(fx.docx, { department: 'QA' });
  assert.equal(doc.code, 'SOP-SK-002');
  assert.equal(doc.department, 'QA');
  assert.ok(doc.citations.length >= 1);

  let keys = ['20240601', '20250101', '20270101'];
  let generic = `ŠÚKL oznamy\nNovinka 1: zmena formulára\n${'Text oznamu. '.repeat(20)}`;
  let fail = false;
  const base = 'https://www.slov-lex.sk/pravne-predpisy/SK/ZZ/2011/362/';
  const fetchPage = async (url) => {
    if (fail) throw new Error('ERR_INTERNET_DISCONNECTED');
    if (url.includes('sukl')) return { url, title: 'ŠÚKL', text: generic, html: '', links: [] };
    const m = url.match(/(\d{8})$/);
    const k = m ? m[1] : '20250101';
    return { url: base + k, title: 'Zákon', text: V[k] || V['20250101'], html: '', links: keys.map((x) => ({ href: base + x })) };
  };
  const lieky = a.data.laws.find((l) => l.key === 'SK:362/2011');
  for (const l of a.data.laws) if (l.id !== lieky.id) l.enabled = false;
  const sukl = await a.addLaw({ title: 'ŠÚKL oznamy', url: 'https://www.sukl.sk/oznamy' });
  const m = new LegislationMonitor(a, { fetchPage, pauseMs: 0 });

  let r = await m.checkLaw(lieky.id);
  assert.equal(r.status, 'ok');
  assert.equal(r.changes.length, 1, 'upcoming version reported at baseline');
  assert.equal(r.state.effectiveDate, '2025-01-01');
  const ch = await a.getChange(r.changes[0]);
  assert.equal(ch.kind, 'upcoming');
  assert.deepEqual(ch.touched.sort(), ['§18', '§19a']);
  assert.equal(ch.affected[0].docId, doc.id);
  assert.deepEqual(ch.affected[0].direct, ['§18']);
  assert.equal(a.getDoc(doc.id).pendingChanges, 1);

  r = await m.checkLaw(lieky.id);
  assert.equal(r.changes.length, 0, 'no duplicate change on re-check');

  keys = [...keys, '20280101'];
  r = await m.checkLaw(lieky.id);
  assert.equal(r.changes.length, 1);
  const ch2 = await a.getChange(r.changes[0]);
  assert.equal(ch2.fromDate, '2027-01-01');
  assert.deepEqual(ch2.touched, ['§1']);

  r = await m.checkLaw(sukl.id);
  assert.equal(r.changes.length, 0, 'generic baseline');
  generic += '\nNovinka 2: nové usmernenie';
  r = await m.checkLaw(sukl.id);
  assert.equal(r.changes.length, 1);
  assert.deepEqual((await a.getChange(r.changes[0])).diff.added, ['Novinka 2: nové usmernenie']);

  fail = true;
  r = await m.checkLaw(lieky.id);
  assert.equal(r.status, 'error');
  assert.match(r.error, /DISCONNECTED/);

  // Assessment workflow
  const upd = await a.updateChange(ch.id, { docId: doc.id, docStatus: 'done', docNote: 'Kap. 2 doplnená', flagForReview: true });
  assert.equal(upd.affected[0].status, 'done');
  assert.equal(a.getDoc(doc.id).status, 'review');
  assert.equal(a.getDoc(doc.id).pendingChanges, 1, 'still pending: second change open');
  await a.updateChange(ch.id, { status: 'resolved', note: 'OK' });
  await a.updateChange(ch2.id, { status: 'resolved', note: 'OK' });
  assert.equal(a.getDoc(doc.id).pendingChanges, 0);

  // Review workflow
  const rv = await a.markReviewed(doc.id, { date: '2026-10-05', outcome: 'no-change', notes: 'OK' });
  assert.equal(rv.reviewDate, '2028-10-05');
  assert.equal(rv.status, 'effective', 'review clears "under review"');

  // Persistence round-trip
  await a.saving;
  const b = new Archive({ dataDir: path.join(dir, 'arch'), user: 'tester' });
  await b.open();
  await b.buildIndex();
  assert.equal(b.listDocs().length, 1);
  assert.ok(b.search('stiahnutie z trhu').results.length === 1);
  const auditRows = await b.readAudit({ docId: doc.id });
  assert.ok(auditRows.some((x) => x.action === 'doc.reviewed'));
  assert.ok(auditRows.some((x) => x.action === 'legislation.doc-assessed'));
});

test('archive: new version supersedes the old one; duplicates are detected; delete moves to trash', async () => {
  const dir = tmpDir();
  const fx = await makeAll(path.join(dir, 'fx'));
  const a = new Archive({ dataDir: path.join(dir, 'arch'), user: 't' });
  await a.open();
  await a.buildIndex();
  const d = await a.importFile(fx.rtf, {});
  const again = await a.analyzeFile(fx.rtf);
  assert.equal(again.duplicateOf.id, d.id);
  const v2 = await a.addVersion(d.id, fx.odt, { version: '2' });
  assert.equal(v2.versions.length, 2);
  assert.equal(v2.versions[0].status, 'superseded');
  assert.equal(v2.version, '2');
  assert.ok(fs.existsSync(a.filePath(d.id, v2.versions[0].id)));
  await a.deleteDoc(d.id);
  assert.equal(a.listDocs().length, 0);
  assert.equal(fs.readdirSync(path.join(dir, 'arch', 'trash')).length, 1);
});

test('archive: a damaged archive.json is restored from the daily backup', async () => {
  const dir = tmpDir();
  const a = new Archive({ dataDir: dir, user: 't' });
  await a.open();
  await a.updateSettings({ org: 'PHARMACOPOLA s.r.o.' });
  await a.saving;
  await a.updateSettings({ warnDays: 30 });
  await a.saving;
  fs.writeFileSync(path.join(dir, 'archive.json'), '{ broken');
  const b = new Archive({ dataDir: dir, user: 't' });
  await b.open();
  assert.equal(b.restoredFrom, 'archive.prev.json', 'previous save is preferred');
  assert.equal(b.data.org, 'PHARMACOPOLA s.r.o.');
  // previous save also damaged -> newest daily backup
  await b.saving;
  fs.writeFileSync(path.join(dir, 'archive.json'), '{ broken');
  fs.writeFileSync(path.join(dir, 'archive.prev.json'), '{ broken');
  const c = new Archive({ dataDir: dir, user: 't' });
  await c.open();
  assert.match(c.restoredFrom, /^archive-\d{4}-\d{2}-\d{2}\.json$/);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('archive.json.damaged-')));
});

test('monitor: Slov-Lex URL falls back to the /ezbierky/ form on HTTP 404', async () => {
  const dir = tmpDir();
  const a = new Archive({ dataDir: dir, user: 't' });
  await a.open();
  const lieky = a.data.laws.find((l) => l.key === 'SK:362/2011');
  const seen = [];
  const fetchPage = async (url) => {
    seen.push(url);
    if (!url.includes('/ezbierky/')) throw new Error('HTTP 404');
    const base = 'https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/2011/362/';
    return { url: base + '20250101', title: 'Zákon', text: V['20250101'], html: '', links: [{ href: base + '20250101' }] };
  };
  const m = new LegislationMonitor(a, { fetchPage, pauseMs: 0 });
  const r = await m.checkLaw(lieky.id);
  assert.equal(r.status, 'ok', r.error);
  assert.equal(r.state.effectiveDate, '2025-01-01');
  assert.ok(seen[1].includes('/ezbierky/pravne-predpisy/SK/ZZ/2011/362/'));
});
