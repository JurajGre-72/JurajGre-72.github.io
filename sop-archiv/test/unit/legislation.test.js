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
  assert.equal(vs[1].url, 'https://eur-lex.europa.eu/legal-content/SK/TXT/HTML/?uri=CELEX:02019R0006-20230101', 'HTML-only page: 404 instead of another language');
  assert.equal(vs[0].fallbackUrl, 'https://eur-lex.europa.eu/legal-content/SK/TXT/HTML/?uri=CELEX:32019R0006', 'the first version can be read from the act as adopted');
  assert.equal(vs[1].fallbackUrl, undefined);
});

test('monitor: EUR-Lex versions not yet available in Slovak are skipped, never read in another language', async () => {
  const dir = tmpDir();
  const a = new Archive({ dataDir: dir, user: 't' });
  await a.open();
  const reg = a.data.laws.find((l) => l.key === 'EU:32021R1248');
  const art = (n, body) => `Článok ${n}\nNázov\n${body} ${'Text ustanovenia. '.repeat(6)}`;
  const sk = (extra) => ['VYKONÁVACIE NARIADENIE KOMISIE (EÚ) 2021/1248', art(1, 'Predmet.'), art(2, 'Vymedzenie pojmov.'), art(3, 'Systém kvality.' + extra)].join('\n');
  const seen = [];
  const pages = {
    'ALL/?uri=CELEX:32021R1248': { text: 'Info', html: '<a href="?uri=CELEX:02021R1248-20210730">x</a><a href="?uri=CELEX:02021R1248-20240101">y</a>' },
    'TXT/HTML/?uri=CELEX:32021R1248': { text: sk('') } // the act as adopted (in Slovak)
    // 02021R1248-20210730 and -20240101: consolidated, not published in Slovak -> 404
  };
  const fetchPage = async (url) => {
    seen.push(url);
    const k = Object.keys(pages).find((p) => url.endsWith(p));
    if (!k) throw new Error('HTTP 404');
    return { url, title: 'EUR-Lex', html: '', links: [], ...pages[k] };
  };
  const m = new LegislationMonitor(a, { fetchPage, pauseMs: 0 });
  const r = await m.checkLaw(reg.id);
  assert.equal(r.status, 'ok', r.error);
  assert.equal(r.state.newestKey, '20210730', 'the 2024 version is not in Slovak yet, so it is not used');
  assert.match(await a.loadSnapshot(reg.id, '20210730'), /VYKONÁVACIE NARIADENIE/);
  assert.ok(seen.some((u) => u.endsWith('TXT/HTML/?uri=CELEX:32021R1248')), 'first version read from the act as adopted');
  assert.equal(r.changes.length, 0);
  // Once the 2024 version is published in Slovak, it is reported as a new version.
  pages['TXT/HTML/?uri=CELEX:02021R1248-20240101'] = { text: sk(' Doplnené: overovanie dodávateľov.') };
  const r2 = await m.checkLaw(reg.id);
  assert.equal(r2.state.newestKey, '20240101');
  const ch = await a.getChange(r2.changes[0]);
  assert.equal(ch.kind, 'new-version');
  assert.deepEqual(ch.touched, ['art3']);
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
  const reviewBefore = a.getDoc(d.id).reviewDate;
  const v2 = await a.addVersion(d.id, fx.odt, { version: '2' });
  assert.equal(v2.reviewDate, reviewBefore, 'a new version without a new effective date keeps the planned review');
  const v3 = await a.addVersion(d.id, fx.txt, { version: '3', effectiveDate: '2026-11-01' });
  assert.equal(v3.reviewDate, '2028-11-01', 'a new effective date moves the review by the interval');
  assert.equal(v3.versions.length, 3);
  assert.equal(v3.versions[0].status, 'superseded');
  assert.equal(v3.version, '3');
  assert.ok(fs.existsSync(a.filePath(d.id, v3.versions[0].id)));
  await assert.rejects(() => a.deleteDoc(d.id), /REASON_REQUIRED/, 'a reason is required');
  assert.deepEqual(a.deletionBlockers(d.id), []);
  await a.deleteDoc(d.id, 'Omylom importovaný súbor.');
  assert.equal(a.listDocs().length, 0);
  assert.equal(fs.readdirSync(path.join(dir, 'arch', 'trash')).length, 1);
  const tr = await a.trashInfo();
  assert.equal(tr.count, 1);
  assert.ok(tr.bytes > 0);
  assert.deepEqual(await a.emptyTrash(), tr);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'arch', 'trash')), [], 'the files are gone for good; the folder stays');
  assert.deepEqual(await a.trashInfo(), { count: 0, bytes: 0 });
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

test('monitor: without the static index, the Slov-Lex portal URL falls back to the /ezbierky/ form on HTTP 404', async () => {
  const dir = tmpDir();
  const a = new Archive({ dataDir: dir, user: 't' });
  await a.open();
  const lieky = a.data.laws.find((l) => l.key === 'SK:362/2011');
  lieky.url = 'https://www.slov-lex.sk/pravne-predpisy/SK/ZZ/2011/362/'; // address form used before 2025
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
  assert.equal(seen[0], 'https://static.slov-lex.sk/static/SK/ZZ/2011/362/', 'the static version index is tried first');
  assert.ok(seen[2].includes('/ezbierky/pravne-predpisy/SK/ZZ/2011/362/'));
});

// Trimmed copy of a real Slov-Lex index page (static.slov-lex.sk/static/SK/ZZ/<year>/<num>/).
const indexRow = (n, key, from, to, act) =>
  `<tr class="effectivenessHistoryItem" data-iri="/SK/ZZ/2011/362/${key}" data-vyhlasene="0" data-ucinnostod="${from}" data-ucinnostdo="${to}"><td class="title">${n}.</td>` +
  `<td class="title"><a href="${key}.html"><span>${from} - ${to}</span></a></td><td>${act ? `<a href="../../../ZZ/${act.split('/')[1]}/${act.split('/')[0]}/${key}.html">${act}&nbsp;Z.&nbsp;z.</a>` : ''}</td></tr>`;
const indexPage = (rows) =>
  `<html><body><h1>História predpisu 362/2011 Z. z.</h1><table><tbody>` +
  `<tr class="effectivenessHistoryItem" data-iri="/SK/ZZ/2011/362/vyhlasene_znenie" data-vyhlasene="1" data-ucinnostod="" data-ucinnostdo=""><td><a href="vyhlasene_znenie.html">Vyhlásené znenie</a></td></tr>` +
  rows.join('') +
  `</tbody></table></body></html>`;

test('Slov-Lex index: versions, amending acts and repeal', () => {
  const html = indexPage([indexRow(2, '20250101', '2025-01-01', '2026-12-31', '361/2024'), indexRow(3, '20270101', '2027-01-01', '', '77/2026')]);
  const v = L.slovlexIndexVersions(html, 'https://static.slov-lex.sk/static/SK/ZZ/2011/362/');
  assert.deepEqual(
    v.map((x) => [x.key, x.until, x.amendedBy.join(), x.url]),
    [
      ['20250101', '2026-12-31', '361/2024 Z. z.', 'https://static.slov-lex.sk/static/SK/ZZ/2011/362/20250101.html'],
      ['20270101', null, '77/2026 Z. z.', 'https://static.slov-lex.sk/static/SK/ZZ/2011/362/20270101.html']
    ]
  );
  assert.equal(L.slovlexIndexRepealed(v, '2026-10-06'), null, 'last version open-ended: in force');
  const gone = L.slovlexIndexVersions(indexPage([indexRow(2, '20110701', '2011-07-01', '2011-11-30', '34/2011')]), 'x/');
  assert.match(L.slovlexIndexRepealed(gone, '2026-10-06'), /zrušený.*30\. 11\. 2011/);
  const ending = L.slovlexIndexVersions(indexPage([indexRow(2, '20260101', '2026-01-01', '2026-12-31', '')]), 'x/');
  assert.match(L.slovlexIndexRepealed(ending, '2026-10-06'), /bude zrušený.*31\. 12\. 2026/);
  assert.equal(L.slovlexIndexUrl('https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/2011/362/20260530'), 'https://static.slov-lex.sk/static/SK/ZZ/2011/362/');
  assert.equal(L.slovlexIndexUrl('http://127.0.0.1:8080/pravne-predpisy/SK/ZZ/2011/362/'), 'http://127.0.0.1:8080/static/SK/ZZ/2011/362/');
});

test('monitor: Slov-Lex through the static index – upcoming version with its amending act, then repeal', async () => {
  const dir = tmpDir();
  const a = new Archive({ dataDir: dir, user: 't' });
  await a.open();
  const lieky = a.data.laws.find((l) => l.key === 'SK:362/2011');
  let rows = [indexRow(2, '20250101', '2025-01-01', '2026-12-31', '361/2024'), indexRow(3, '20270101', '2027-01-01', '', '77/2026')];
  const seen = [];
  const fetchPage = async (url) => {
    seen.push(url);
    if (url.endsWith('/static/SK/ZZ/2011/362/')) return { url, title: 'História predpisu 362/2011 Z. z.', text: 'História predpisu', html: indexPage(rows), links: [] };
    const k = (url.match(/(\d{8})\.html$/) || [])[1];
    if (k && V[k]) return { url, title: '362/2011 Z. z.', text: V[k], html: '', links: [] };
    throw new Error('HTTP 404');
  };
  const m = new LegislationMonitor(a, { fetchPage, pauseMs: 0 });
  const r = await m.checkLaw(lieky.id);
  assert.equal(r.status, 'ok', r.error);
  assert.equal(seen[0], 'https://static.slov-lex.sk/static/SK/ZZ/2011/362/');
  assert.ok(!seen.some((u) => u.includes('www.slov-lex.sk')), 'the portal is not needed');
  assert.equal(r.state.effectiveKey, '20250101');
  assert.equal(r.state.newestKey, '20270101');
  assert.equal(r.changes.length, 1);
  const ch = await a.getChange(r.changes[0]);
  assert.equal(ch.kind, 'upcoming');
  assert.deepEqual(ch.amendedBy, ['77/2026 Z. z.']);
  assert.ok(ch.touched.includes('§18') && ch.touched.includes('§19a'));
  // The act is later repealed: its last version gets an end date on the index.
  rows = [indexRow(2, '20250101', '2025-01-01', '2026-12-31', '361/2024'), indexRow(3, '20270101', '2027-01-01', '2027-06-30', '77/2026')];
  const r2 = await m.checkLaw(lieky.id);
  assert.match(r2.state.repealed, /bude zrušený.*30\. 6\. 2027/);
  assert.equal((await a.getChange(r2.changes[0])).kind, 'repealed');
});

test('importing law texts: first import = check report, newer version = diff + findings, recheck after SOP update', async () => {
  const dir = tmpDir();
  const a = new Archive({ dataDir: path.join(dir, 'arch'), user: 'qa' });
  await a.open();
  await a.buildIndex();
  const sopDir = path.join(dir, 'sop');
  fs.mkdirSync(sopDir);
  const sopV1 = path.join(sopDir, 'SOP-SK-002.txt');
  fs.writeFileSync(sopV1, 'SOP-SK-002 Stiahnutie liekov z trhu\nVerzia: 1\n2. Stiahnutie\nŠarže sa stiahnu z trhu do 48 hodín podľa § 18 ods. 1 písm. k) zákona č. 362/2011 Z. z.\n3. Záznamy\nZáznamy o dodávkach sa uchovávajú 5 rokov podľa § 18 ods. 1 písm. l) zákona č. 362/2011 Z. z.');
  const storage = path.join(sopDir, 'SOP-QA-001.txt');
  fs.writeFileSync(storage, 'SOP-QA-001 Skladovanie\nLieky skladujeme pri teplote 15 – 25 °C. Termolabilné lieky v chladničke, karanténa pre poškodené balenia, kontrola teploty teplomermi s kalibráciou.');
  const sop = await a.importFile(sopV1, {});
  const qa = await a.importFile(storage, {});
  const lieky = a.data.laws.find((l) => l.key === 'SK:362/2011');

  const v2025 = `§ 1\nPredmet\n(1) Zákon upravuje lieky.\n§ 18\nPovinnosti\n(1) k) stiahnuť liek z trhu do 48 hodín, l) uchovávať záznamy päť rokov.\n§ 19\nSkladovanie\n(1) Lieky sa skladujú pri teplote 15 – 25 °C, termolabilné lieky v chladničke pri teplote 2 – 8 °C, poškodené balenia v karanténe, kontrola teploty kalibrovanými teplomermi.\n§ 20\nPreprava\n(1) Preprava liekov s monitorovaním teploty.`;
  const v2027 = v2025.replace('do 48 hodín', 'do dvadsiatich štyroch hodín').replace('päť rokov', 'desať rokov');

  // 1) first text of the act -> a check report; the SOP agrees with it
  const c1 = await a.importLawText({ lawId: lieky.id, text: v2025, versionDate: '2025-01-01', source: { type: 'file', name: 'zakon-2025.pdf' } });
  assert.equal(c1.kind, 'check');
  let full = await a.getChange(c1.id);
  const s1 = full.affected.find((x) => x.docId === sop.id);
  assert.equal(s1.analysis.findings.filter((f) => f.type === 'quantity').length, 0, 'SOP matches the 2025 text');
  const q1 = full.affected.find((x) => x.docId === qa.id);
  assert.equal(q1.severity, 'info', 'storage SOP is content-related');
  assert.equal(q1.analysis.related[0].key, '§19');
  assert.equal(a.getDoc(qa.id).pendingChanges, 0, 'related-only documents are not flagged as pending');

  // 2) newer version -> diff against the stored one + findings for the SOP
  const c2 = await a.importLawText({ lawId: lieky.id, text: v2027, versionDate: '2027-01-01', source: { type: 'file', name: 'zakon-2027.pdf' } });
  assert.equal(c2.kind, 'upcoming');
  assert.equal(c2.fromDate, '2025-01-01');
  full = await a.getChange(c2.id);
  assert.deepEqual(full.touched, ['§18']);
  const s2 = full.affected.find((x) => x.docId === sop.id);
  assert.equal(s2.severity, 'high');
  assert.deepEqual(s2.analysis.findings.filter((f) => f.type === 'quantity').map((f) => f.docValue).sort(), ['48 hodín', '5 rokov']);
  assert.equal(a.data.laws.find((l) => l.id === lieky.id).state.newestKey, '20270101');

  // 3) the SOP is updated -> recheck clears the number findings
  const sopV2 = path.join(sopDir, 'SOP-SK-002-v2.txt');
  fs.writeFileSync(sopV2, fs.readFileSync(sopV1, 'utf8').replace('48 hodín', '24 hodín').replace('5 rokov', '10 rokov').replace('Verzia: 1', 'Verzia: 2'));
  await a.addVersion(sop.id, sopV2, {});
  full = await a.recheckChange(c2.id);
  const s3 = full.affected.find((x) => x.docId === sop.id);
  assert.equal(s3.analysis.findings.filter((f) => f.type === 'quantity').length, 0);
  assert.equal(s3.severity, 'high', 'still cites a changed section until assessed');

  // 4) a new act brought in by file -> created in the register
  const c4 = await a.importLawText({ spec: { key: 'SK:100/2020', title: 'Zákon č. 100/2020 Z. z. (test)' }, text: v2025, source: { type: 'file', name: 'x.pdf' } });
  assert.ok(a.data.laws.some((l) => l.key === 'SK:100/2020' && l.id === c4.lawId));
});

test('monitor.checkAndReport always returns a report', async () => {
  const dir = tmpDir();
  const a = new Archive({ dataDir: dir, user: 't' });
  await a.open();
  const lieky = a.data.laws.find((l) => l.key === 'SK:362/2011');
  const base = 'https://www.slov-lex.sk/pravne-predpisy/SK/ZZ/2011/362/';
  const m = new LegislationMonitor(a, { fetchPage: async () => ({ url: base + '20250101', title: 'Z', text: V['20250101'], html: '', links: [{ href: base + '20250101' }] }), pauseMs: 0 });
  const r1 = await m.checkAndReport(lieky.id, { type: 'name', name: 'zákon o liekoch' });
  assert.equal(r1.newChanges, 0);
  const ch = a.data.changes.find((c) => c.id === r1.changeId);
  assert.equal(ch.kind, 'check');
  assert.equal(ch.toKey, '20250101');
  await assert.rejects(new LegislationMonitor(a, { fetchPage: async () => { throw new Error('HTTP 503'); }, pauseMs: 0 }).checkAndReport(lieky.id), /503/);
});

test('archive lock: second holder is read-only, stale or crashed locks are taken over, release frees it', () => {
  const { ArchiveLock } = require('../../src/main/lib/lock');
  const dir = tmpDir();
  const a = new ArchiveLock(dir, { host: 'pc1', user: 'Juraj', pid: process.pid });
  const b = new ArchiveLock(dir, { host: 'pc2', user: 'Eva', pid: 4242 });
  assert.equal(a.tryAcquire().ok, true);
  const rb = b.tryAcquire();
  assert.equal(rb.ok, false);
  assert.equal(rb.holder.user, 'Juraj');
  assert.equal(a.heartbeat(), true);
  a.release();
  assert.equal(b.tryAcquire().ok, true, 'free after release');
  assert.equal(a.tryAcquire().ok, false);
  // stale lock (no heartbeat for longer than staleMs)
  const c = new ArchiveLock(dir, { host: 'pc3', user: 'Peter', pid: 1, staleMs: 0 });
  assert.equal(c.tryAcquire().ok, true, 'stale lock taken over');
  assert.equal(b.heartbeat(), false, 'previous holder notices it lost the lock');
  // a crashed process on the same computer
  fs.writeFileSync(path.join(dir, '.sop-archiv.lock'), JSON.stringify({ host: 'pc4', user: 'X', pid: 999999, ts: Date.now() }));
  const d = new ArchiveLock(dir, { host: 'pc4', user: 'Y', pid: process.pid });
  assert.equal(d.tryAcquire().ok, true, 'lock of a dead local process is taken over');
});

test('users: hashed passwords, roles, last administrator protected', async () => {
  const dir = tmpDir();
  const a = new Archive({ dataDir: dir, user: 'setup' });
  await a.open();
  const admin = await a.createUser({ name: 'Juraj Gregus', role: 'admin', password: 'tajne123' });
  const eva = await a.createUser({ name: 'Eva', role: 'reader', password: 'evine-heslo' });
  assert.ok(a.verifyLogin(admin.id, 'tajne123'));
  assert.equal(a.verifyLogin(admin.id, 'zle'), null);
  await assert.rejects(a.createUser({ name: 'eva', role: 'reader', password: 'evine-heslo' }), /NAME_TAKEN/);
  await assert.rejects(a.createUser({ name: 'Peter', role: 'reader', password: '1234567' }), /PASSWORD_SHORT/, 'at least 8 characters');
  await assert.rejects(a.updateUser(admin.id, { role: 'editor' }), /LAST_ADMIN/);
  await a.updateUser(eva.id, { disabled: true });
  assert.equal(a.verifyLogin(eva.id, 'evine-heslo'), null, 'disabled profile cannot sign in');
  await a.saving;
  const raw = fs.readFileSync(path.join(dir, 'archive.json'), 'utf8');
  assert.ok(!raw.includes('tajne123') && !raw.includes('evine-heslo'), 'no plain passwords on disk');
});

test('archive: company logo is stored in the archive folder, replaced and removed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-logo-'));
  const a = new Archive({ dataDir: path.join(dir, 'arch'), user: 't' });
  await a.open();
  assert.equal(a.logoInfo(), null);
  assert.equal(a.logoDataUrl(), null);
  const svg = path.join(dir, 'Logo Firmy.svg');
  fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#c00"/></svg>');
  const info = await a.setLogo(svg);
  assert.equal(info.type, 'image/svg+xml');
  assert.match(a.logoDataUrl(), /^data:image\/svg\+xml;base64,/);
  // A new logo replaces the old one (also when the file type changes).
  const png = path.join(dir, 'logo.PNG');
  fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a', 'hex'));
  await a.setLogo(png);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'arch', 'branding')), ['logo.png']);
  assert.equal(a.logoInfo().type, 'image/png');
  // Only images, and not huge ones.
  const txt = path.join(dir, 'logo.txt');
  fs.writeFileSync(txt, 'x');
  await assert.rejects(a.setLogo(txt), /LOGO_TYPE/);
  const big = path.join(dir, 'big.png');
  fs.writeFileSync(big, Buffer.alloc(1024 * 1024 + 1));
  await assert.rejects(a.setLogo(big), /LOGO_SIZE/);
  assert.equal(a.logoInfo().type, 'image/png', 'a rejected file keeps the current logo');
  await a.clearLogo();
  assert.equal(a.logoInfo(), null);
});

test('archive: PHARMACOPOLA file names – annexes linked to their main document, departments, English copies', async () => {
  const dir = tmpDir();
  const fx = await makeAll(path.join(dir, 'fx'));
  const a = new Archive({ dataDir: path.join(dir, 'arch'), user: 't' });
  await a.open();
  await a.buildIndex();
  const src = path.join(dir, 'in');
  fs.mkdirSync(path.join(src, 'Anglické verzie'), { recursive: true });
  const put = (name, sub = '') => {
    const p = path.join(src, sub, name);
    fs.copyFileSync(fx.txt, p);
    fs.appendFileSync(p, `\n${name}\n`); // different content, so not a duplicate
    return p;
  };
  const os5 = await a.importFile(put('_OS5_Testovacia smernica_2026.txt'));
  const annex = await a.importFile(put('_OS5_Príloha č.1_Zoznam kontaktov.txt'));
  const hr = await a.importFile(put('SM_HR_003_2_Vzorový poriadok_od_01.01.2025.txt'));
  const en = await a.importFile(put('_OS5_Sample directive_2026.txt', 'Anglické verzie'));
  assert.equal(os5.code, 'OS5');
  assert.equal(os5.type, 'OS');
  assert.equal(annex.code, 'OS5 Príloha č. 1');
  assert.equal(annex.annexOf, 'OS5');
  assert.equal(annex.reviewIntervalMonths, 0, 'an annex is reviewed with its main document');
  const parent = a.getDoc(os5.id);
  assert.deepEqual(parent.annexes.map((x) => x.code), ['OS5 Príloha č. 1']);
  assert.equal(a.getDoc(annex.id).parent.code, 'OS5');
  assert.equal(hr.type, 'SM');
  assert.equal(hr.version, '2');
  assert.equal(hr.effectiveDate, '2025-01-01');
  assert.equal(hr.department, 'Personalistika');
  assert.ok(a.data.settings.docTypes.some((t) => t.id === 'SM'));
  assert.equal(en.code, 'OS5 (EN)', 'the English copy does not replace the Slovak document');
  assert.deepEqual(en.tags, ['EN']);
  const again = await a.analyzeFile(put('_OS5_Testovacia smernica_2027.txt'));
  assert.equal(again.sameCode.code, 'OS5', 'a newer edition is offered as a new version of OS5');
});

test('archive: every act cited in a document is watched; removed ones are not added back; official name on the first check', async () => {
  const dir = tmpDir();
  const fx = await makeAll(path.join(dir, 'fx'));
  const a = new Archive({ dataDir: path.join(dir, 'arch'), user: 't' });
  await a.open();
  await a.buildIndex();
  const src = path.join(dir, 'in');
  fs.mkdirSync(src);
  const p1 = path.join(src, '2021.04_Vzorový pokyn podľa Prílohy 1_Vyhlášky 82-2012 MZSR.txt');
  fs.writeFileSync(p1, 'Pokyn pre sklad.\nPostupuje sa podľa zákona č. 147/2001 Z. z. o reklame a zákonníka práce č. 311/2001 Z. z.\n');
  await a.importFile(p1);
  const byKey = (k) => a.data.laws.find((l) => l.key === k);
  for (const k of ['SK:82/2012', 'SK:147/2001', 'SK:311/2001']) {
    assert.ok(byKey(k), `${k} is watched`);
    assert.equal(byKey(k).origin, 'documents');
    assert.equal(byKey(k).enabled, true);
  }
  assert.equal(byKey('SK:82/2012').url, 'https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/2012/82/');
  const doc = a.data.docs[0];
  assert.deepEqual(doc.lawRefs, [], 'nothing is left as a mere suggestion');
  assert.ok(doc.citations.some((c) => c.lawId === byKey('SK:147/2001').id), 'the document is linked to the act it cites');
  // Removed from the register on purpose: a later import does not add it again.
  await a.removeLaw(byKey('SK:147/2001').id);
  const p2 = path.join(src, 'ŠPP_22_2026_reklama.txt');
  fs.writeFileSync(p2, 'Reklama liekov podľa zákona č. 147/2001 Z. z. a nariadenia vlády č. 211/2021 Z. z.\n'.repeat(3));
  await a.importFile(p2);
  assert.equal(byKey('SK:147/2001'), undefined);
  assert.ok(byKey('SK:211/2021'));
  // First check: the official name replaces "Vyhláška č. 82/2012 Z. z.".
  const law = byKey('SK:82/2012');
  const fetchPage = async (url) => {
    if (url.endsWith('/static/SK/ZZ/2012/82/')) return { url, title: 'x', text: 'x', links: [], html: '<tr class="effectivenessHistoryItem" data-iri="/SK/ZZ/2012/82/20250101" data-vyhlasene="0" data-ucinnostod="2025-01-01" data-ucinnostdo=""><td></td></tr>' };
    if (url.endsWith('20250101.html')) return { url, title: '82/2012 Z. z. - Vyhláška Ministerstva zdravotníctva Slovenskej republiky o zozname liekov', text: V['20250101'], links: [], html: '' };
    throw new Error('HTTP 404');
  };
  const r = await new LegislationMonitor(a, { fetchPage, pauseMs: 0 }).checkLaw(law.id);
  assert.equal(r.status, 'ok', r.error);
  assert.equal(law.title, 'Vyhláška Ministerstva zdravotníctva Slovenskej republiky č. 82/2012 Z. z. o zozname liekov');
  assert.equal(law.short, 'Vyhláška o zozname liekov');
  assert.equal(law.autoTitle, false);
});

// ---------------------------------------------------------------------------------------------
// Encryption of the archive folder

const readAll = (dir) => {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else out.push({ f, name: e.name, buf: fs.readFileSync(f) });
    }
  };
  walk(dir);
  return out;
};

test('encryption: nothing readable on disk, locked until sign-in, wrong password fails, recovery code works', async () => {
  const dir = tmpDir();
  const fx = await makeAll(path.join(dir, 'fx'));
  const arch = path.join(dir, 'arch');
  const a = new Archive({ dataDir: arch, user: 'setup' });
  await a.open();
  const code = await a.enableEncryption(); // first-time setup
  const admin = await a.createUser({ name: 'Juraj Gregus', role: 'admin', password: 'Tajne-heslo-1' });
  const eva = await a.createUser({ name: 'Eva Nováková', role: 'reader', password: 'citam123' });
  await a.buildIndex();
  const doc = await a.importFile(fx.docx, { department: 'QA' }); // SOP-SK-002 Reklamácie, vratky a stiahnutie liekov z trhu
  await a.saving;
  await new Promise((r) => setTimeout(r, 50)); // audit lines are appended asynchronously

  // On disk: no document text, no titles in file names, no passwords.
  const words = ['Reklamácie', 'stiahnutie', 'karant', 'Tajne-heslo-1', 'citam123'];
  for (const { f, name, buf } of readAll(arch)) {
    if (name === 'keyring.json') {
      const k = buf.toString('utf8');
      assert.ok(k.includes('Juraj Gregus'), 'the sign-in screen needs the profile names');
      assert.ok(!k.includes('Tajne') && !k.includes('citam'), 'no passwords in the keyring');
      continue;
    }
    if (name === '.sop-archiv.lock') continue;
    const txt = buf.toString('utf8');
    for (const w of words) assert.ok(!txt.includes(w), `${path.relative(arch, f)} contains "${w}"`);
    assert.ok(!/Reklam/i.test(name), `file name ${name} shows a title`);
  }
  assert.ok(fs.readFileSync(path.join(arch, 'audit.log'), 'utf8').split('\n').filter(Boolean).every((l) => l.startsWith('E1:')));

  // A second program (another computer, or after a restart) sees a locked archive.
  const b = new Archive({ dataDir: arch, user: 'pc2' });
  const opened = await b.open();
  assert.equal(opened.locked, true);
  assert.equal(b.locked, true);
  assert.deepEqual(b.publicUsers().map((u) => u.name).sort(), ['Eva Nováková', 'Juraj Gregus']);
  assert.equal(b.data.docs.length, 0, 'nothing is read before signing in');
  assert.equal(await b.login(eva.id, 'zle-heslo'), null);
  const r = await b.login(eva.id, 'citam123');
  assert.ok(r && r.unlocked && r.user.name === 'Eva Nováková');
  assert.equal(b.data.docs.length, 1);
  await b.buildIndex();
  assert.ok(b.search('reklamácie').results.length, 'search works on the decrypted text');
  const original = await b.versionContent(doc.id);
  assert.equal(original.name, path.basename(fx.docx));
  assert.ok(original.data.equals(fs.readFileSync(fx.docx)), 'the original file comes back unchanged');
  assert.equal(await b.login(admin.id, 'citam123'), null, 'another user’s password does not work');

  // All passwords forgotten: the recovery code opens the archive and sets a new administrator password.
  const c = new Archive({ dataDir: arch, user: 'pc3' });
  await c.open();
  assert.equal(await c.recover('AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF', admin.id, 'nove-heslo-2027'), null, 'a wrong code does nothing');
  await assert.rejects(c.recover(code, eva.id, 'nove-heslo-2027'), /NOT_ADMIN/);
  const d = new Archive({ dataDir: arch, user: 'pc4' });
  await d.open();
  const rec = await d.recover(code.toLowerCase().replace(/-/g, ' '), admin.id, 'nove-heslo-2027');
  assert.equal(rec.name, 'Juraj Gregus');
  const e = new Archive({ dataDir: arch, user: 'pc5' });
  await e.open();
  assert.equal(await e.login(admin.id, 'Tajne-heslo-1'), null, 'the old password no longer works');
  assert.ok(await e.login(admin.id, 'nove-heslo-2027'));

  // A disabled profile loses its key; after re-enabling, an administrator sets a new password.
  await e.updateUser(eva.id, { disabled: true });
  const f = new Archive({ dataDir: arch, user: 'pc6' });
  await f.open();
  assert.ok(!f.publicUsers().some((u) => u.id === eva.id));
  await assert.rejects(f.login(eva.id, 'citam123'), /NEEDS_PASSWORD/);
  await e.updateUser(eva.id, { disabled: false });
  assert.equal(e.listUsers().find((u) => u.id === eva.id).needsPassword, true);
  await e.setPassword(eva.id, 'nove-citam-123');
  assert.equal(e.listUsers().find((u) => u.id === eva.id).mustChangePassword, true, 'set by an administrator: changed at the next sign-in');
  const g = new Archive({ dataDir: arch, user: 'pc7' });
  await g.open();
  assert.ok(await g.login(eva.id, 'nove-citam-123'));
  await g.setPassword(eva.id, 'moje-vlastne-1', { self: true });
  assert.equal(g.listUsers().find((u) => u.id === eva.id).mustChangePassword, false, 'her own password');
});

test('encryption: an existing archive is converted in place and everyone keeps their password', async () => {
  const dir = tmpDir();
  const fx = await makeAll(path.join(dir, 'fx'));
  const arch = path.join(dir, 'arch');
  const a = new Archive({ dataDir: arch, user: 't' });
  await a.open();
  const admin = await a.createUser({ name: 'Admin', role: 'admin', password: 'stare-heslo-1' });
  const reader = await a.createUser({ name: 'Čitateľ', role: 'reader', password: 'citatel-123' });
  await a.buildIndex();
  const doc = await a.importFile(fx.docx);
  await a.saving;
  const before = doc.versions[0].file;
  assert.match(before, /v1-.*\.docx$/, 'unencrypted archives keep the file name');
  assert.ok(fs.readFileSync(path.join(arch, 'archive.json'), 'utf8').includes('Reklam'));

  const code = await a.enableEncryption();
  await a.saving;
  assert.equal(a.takePendingRecoveryCode(), code, 'shown to the first administrator who signs in');
  assert.ok(!a.data.users.some((u) => u.hash || u.salt), 'old password checks are removed');
  assert.ok(!fs.existsSync(path.join(arch, before)), 'the plain file is gone');
  for (const { name, buf } of readAll(arch)) if (!['keyring.json', '.sop-archiv.lock'].includes(name)) assert.ok(!buf.toString('utf8').includes('Reklam'), name);

  const b = new Archive({ dataDir: arch, user: 't2' });
  await b.open();
  const r = await b.login(reader.id, 'citatel-123');
  assert.ok(r, 'the old password still works');
  assert.equal(b.keyring.users.find((u) => u.id === reader.id).wrap.kdf.alg, 'scrypt', 'renewed with a fresh salt at sign-in');
  assert.ok((await b.versionContent(doc.id)).data.equals(fs.readFileSync(fx.docx)));
  assert.ok(await b.login(admin.id, 'stare-heslo-1'));
  await b.confirmRecoveryCodeKept();
  assert.equal(b.takePendingRecoveryCode(), null);
});

test('archive: a document used as a controlled record cannot be deleted, only withdrawn', async () => {
  const dir = tmpDir();
  const a = new Archive({ dataDir: dir, user: 'QA' });
  await a.open();
  await a.buildIndex();
  const f = path.join(dir, 'SOP-QA-005.txt');
  fs.writeFileSync(f, 'SOP-QA-005 Čistenie skladu\nVerzia: 1\nPostup čistenia skladu raz týždenne.');
  const d = await a.importFile(f, { code: 'SOP-QA-005', title: 'Čistenie skladu', status: 'effective' });
  assert.deepEqual(a.deletionBlockers(d.id), [], 'a fresh import may still be deleted');
  await a.markReviewed(d.id, { outcome: 'no-change' });
  const p = await a.savePerson({ name: 'Ján', department: 'Sklad' });
  await a.recordTraining({ docId: d.id, personIds: [p.id], date: '2026-10-01', method: 'session' });
  assert.deepEqual(a.deletionBlockers(d.id), ['training', 'reviews']);
  await assert.rejects(() => a.deleteDoc(d.id, 'Už nepotrebujeme.'), /DOC_HAS_RECORDS/);
  assert.equal(a.listDocs().length, 1, 'still in the archive');
});
