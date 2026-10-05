'use strict';
// End-to-end test: launches the real Electron app with Playwright, imports sample documents,
// searches, records a review, checks legislation against a local fake Slov-Lex server and
// runs an AI impact analysis against a local fake Ollama server. Saves screenshots.
//
//   node test/e2e/run.js [screenshotDir]      (on Linux without a display: xvfb-run -a node test/e2e/run.js)

const { _electron: electron } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { makeAll } = require('../fixtures/make');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'sop-archiv-e2e'));

// --- Fake Slov-Lex -------------------------------------------------------------
function lawPage(version, body, versions, port) {
  const links = versions.map((v) => `<li><a href="http://127.0.0.1:${port}/pravne-predpisy/SK/ZZ/2011/362/${v}">Znenie od ${v}</a></li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>362/2011 Z. z.</title></head><body>
  <header>Slov-Lex (test)</header><nav><ul>${links}</ul></nav>
  <main id="text">${body
    .split('\n')
    .map((l) => `<p>${l}</p>`)
    .join('')}</main></body></html>`;
}

const LAW_2025 = `Zákon č. 362/2011 Z. z. o liekoch a zdravotníckych pomôckach
§ 1
Predmet úpravy
(1) Tento zákon upravuje podmienky zaobchádzania s liekmi.
§ 18
Povinnosti držiteľa povolenia na veľkodistribúciu liekov
(1) Držiteľ povolenia na veľkodistribúciu liekov je povinný
k) zabezpečiť stiahnutie lieku z trhu na základe rozhodnutia štátneho ústavu,
l) uchovávať záznamy o dodávkach liekov päť rokov.
§ 19
Zakázané činnosti
(1) Držiteľ povolenia nesmie dodávať lieky osobám bez povolenia.
§ 23
Povinnosti držiteľa povolenia na poskytovanie lekárenskej starostlivosti
(1) Text bez zmeny.`;

const LAW_2027 = LAW_2025.replace('uchovávať záznamy o dodávkach liekov päť rokov.', 'uchovávať záznamy o dodávkach liekov desať rokov v elektronickej podobe.')
  .replace('k) zabezpečiť stiahnutie lieku z trhu na základe rozhodnutia štátneho ústavu,', 'k) zabezpečiť stiahnutie lieku z trhu do 24 hodín od doručenia rozhodnutia štátneho ústavu,')
  .concat('\n§ 19a\nOverovanie ochranných prvkov\n(1) Veľkodistribútor overuje ochranné prvky pri vrátení lieku.');

function startLawServer() {
  return new Promise((resolve) => {
    const versions = ['20240601', '20250101', '20270101'];
    const srv = http.createServer((req, res) => {
      const port = srv.address().port;
      const m = req.url.match(/\/pravne-predpisy\/SK\/ZZ\/2011\/362\/(\d{8})?/);
      res.setHeader('content-type', 'text/html; charset=utf-8');
      if (req.url.startsWith('/spa')) {
        // a page whose content is rendered by JavaScript after a delay
        res.end(`<!doctype html><html><body><div id="app">Načítavam…</div><script>setTimeout(()=>{document.getElementById('app').innerText='ŠÚKL oznamy\\nNové usmernenie k správnej distribučnej praxi platné od 1. 1. 2027\\nZmena formulára hlásenia nežiaducich účinkov\\n'+'Ďalší text oznamu. '.repeat(20)},900)</script></body></html>`);
        return;
      }
      if (!m) {
        res.statusCode = 404;
        return res.end('not found');
      }
      const v = m[1] || '20250101';
      res.end(lawPage(v, v === '20270101' ? LAW_2027 : LAW_2025, versions, port));
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// --- Fake Ollama ---------------------------------------------------------------
function startOllama() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:7b' }, { name: 'llama3.1:8b' }] }));
        if (req.url === '/api/chat') {
          const j = JSON.parse(body);
          const user = j.messages.find((m) => m.role === 'user').content;
          srv.lastPrompt = user;
          const text = user.includes('ZMENENÉ ČASTI PREDPISU')
            ? '1. Záver: OVPLYVNENÝ – § 18 ods. 1 písm. k) skracuje lehotu na stiahnutie lieku na 24 hodín.\n2. Čo treba zmeniť: kap. 2 „Stiahnutie z trhu“ → doplniť lehotu 24 hodín od doručenia rozhodnutia ŠÚKL.\n3. Prečo: § 18 ods. 1 písm. k) v znení od 1. 1. 2027.\n4. Termín: 1. 1. 2027.\n5. Neistoty: overiť prechodné ustanovenia.'
            : 'Dotknuté šarže sa zablokujú a presunú do karantény [SOP-SK-002, s. 1].';
          return res.end(JSON.stringify({ model: j.model, message: { role: 'assistant', content: text } }));
        }
        res.statusCode = 404;
        res.end('{}');
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function shot(page, name) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('  📸', name);
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-e2e-'));
  const fixtures = await makeAll(path.join(tmp, 'fixtures'));
  const lawSrv = await startLawServer();
  const ollama = await startOllama();
  const lawBase = `http://127.0.0.1:${lawSrv.address().port}`;

  // SOP_ARCHIV_EXE=path/to/packaged/binary tests a built app instead of the sources.
  const packaged = process.env.SOP_ARCHIV_EXE;
  const app = await electron.launch({
    executablePath: packaged || require('electron'),
    args: packaged ? ['--no-sandbox'] : [ROOT, '--no-sandbox'],
    env: { ...process.env, SOP_ARCHIV_USERDATA: path.join(tmp, 'userdata'), SOP_ARCHIV_DATA: path.join(tmp, 'archive'), SOP_ARCHIV_NO_TIMERS: '1', LANG: 'sk_SK.UTF-8' }
  });
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.setViewportSize({ width: 1360, height: 860 });
    await page.waitForSelector('#nav .nav-item');
    await page.evaluate(() => window.api.app.setSettings({ lang: 'sk' }));
    await page.reload();
    await page.waitForSelector('.hero-empty');
    await shot(page, '01-dashboard-empty');

    // A PDF fixture, generated by Chromium itself (with Slovak diacritics, 2 pages).
    const pdfPath = path.join(tmp, 'fixtures', 'SOP-QA-001_Prijem_a_skladovanie.pdf');
    const pdfB64 = await app.evaluate(async ({ BrowserWindow }) => {
      const w = new BrowserWindow({ show: false });
      const html = `<html><body style="font-family:sans-serif;font-size:13px"><p>PHARMACOPOLA s.r.o.</p><h1>SOP-QA-001 Príjem a skladovanie liekov</h1>
        <p>Verzia: 3</p><p>Dátum účinnosti: 1. 3. 2024</p><p>Dátum ďalšej revízie: 20. 10. 2026</p><p>Vypracoval: Ing. Ján Novák</p>
        <h2>1. Príjem tovaru</h2><p>Pri príjme sa kontroluje neporušenosť obalov, šarža a dátum exspirácie. Lieky s porušeným obalom sa umiestnia do karantény.</p>
        <h2>2. Teplota</h2><p>Teplota skladovania liekov musí byť 15 – 25 °C. Termolabilné lieky sa skladujú v chladničke pri teplote 2 – 8 °C, v súlade s § 18 ods. 1 zákona č. 362/2011 Z. z.</p>
        <div style="page-break-before:always"><h2>3. Záznamy</h2><p>Záznamy o teplote sa uchovávajú 5 rokov podľa § 18 ods. 1 písm. l) zákona č. 362/2011 Z. z. Veterinárne lieky podľa nariadenia (EÚ) 2019/6.</p></div></body></html>`;
      await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      const buf = await w.webContents.printToPDF({});
      w.destroy();
      return buf.toString('base64');
    });
    fs.writeFileSync(pdfPath, Buffer.from(pdfB64, 'base64'));

    // Import through the real import dialog.
    const paths = [pdfPath, fixtures.docx, fixtures.odt, fixtures.rtf, fixtures.txt, fixtures.xlsx];
    await page.evaluate((p) => import('./js/views/importer.js').then((m) => { m.startImport(p); }), paths);
    await page.waitForSelector('.imp-table tbody tr:nth-child(6)', { timeout: 30000 });
    await page.selectOption('.imp-bulk select[data-bulk="department"]', 'Kvalita (QA)');
    await shot(page, '02-import-dialog');
    const btnText = await page.textContent('.modal-foot .btn-primary');
    assert.match(btnText, /6/, 'import button counts 6 files');
    await page.click('.modal-foot .btn-primary');
    await page.waitForSelector('.toast');
    await page.waitForFunction(() => window.api.docs.list().then((d) => d.length === 6));
    const docs = await page.evaluate(() => window.api.docs.list());
    const byCode = Object.fromEntries(docs.map((d) => [d.code || d.title, d]));
    assert.ok(byCode['SOP-QA-001'], 'PDF imported with detected code');
    assert.equal(byCode['SOP-QA-001'].version, '3');
    assert.equal(byCode['SOP-QA-001'].reviewDate, '2026-10-20');
    assert.equal(byCode['SOP-QA-001'].department, 'Kvalita (QA)');
    assert.ok(byCode['SOP-SK-002'], 'DOCX imported');
    assert.ok(byCode['OS 4/2023'], 'ODT imported');
    assert.equal(byCode['OS 4/2023'].review.state, 'overdue');
    console.log('  ✓ import of 6 files (PDF, DOCX, ODT, RTF, TXT, XLSX) with metadata detection');

    await page.evaluate(() => (location.hash = '#/dashboard'));
    await page.waitForSelector('.kpis');
    await shot(page, '03-dashboard');

    await page.click('a.nav-item[href="#/documents"]');
    await page.waitForSelector('.docs-table tbody tr.clickable');
    await shot(page, '04-documents');

    // Document detail
    await page.click(`tr[data-id="${byCode['SOP-QA-001'].id}"]`);
    await page.waitForSelector('.doc-head');
    await shot(page, '05-document');
    await page.click('a.tab[href$="tab=legis"]');
    await page.waitForSelector('.secs .sec');
    const secs = await page.textContent('.secs');
    assert.match(secs, /§ 18/, 'cites § 18');
    await page.click('a.tab[href$="tab=text"]');
    await page.waitForSelector('#doc-text');
    await page.fill('#find-text', 'karantény');
    await page.waitForSelector('#doc-text mark');
    await shot(page, '06-document-text');
    console.log('  ✓ document detail, citations, text view');

    // Search
    await page.click('a.nav-item[href="#/search"]');
    await page.fill('#q', 'teplota chladnička');
    await page.waitForSelector('.result mark');
    const first = await page.textContent('.result .result-title');
    assert.match(first, /SOP-QA-001/);
    await page.fill('#q', 'stiahnutie lieku z trhu');
    await page.waitForFunction(() => document.querySelectorAll('.result').length >= 2);
    await shot(page, '07-search');
    console.log('  ✓ full-text search with Slovak word forms');

    // Reviews: record a review through the dialog
    await page.click('a.nav-item[href="#/reviews"]');
    await page.waitForSelector('.panel-bad .rows .row');
    await shot(page, '08-reviews');
    await page.click('.panel-bad .rows .row button[data-action="review"]');
    await page.waitForSelector('.modal textarea[name="notes"]');
    await page.fill('.modal textarea[name="notes"]', 'Bez zmien, overené QA.');
    await shot(page, '09-review-dialog');
    await page.click('.modal-foot .btn-primary');
    await page.waitForFunction(() => !document.querySelector('.modal'));
    const os4 = await page.evaluate((id) => window.api.docs.get(id), byCode['OS 4/2023'].id);
    assert.equal(os4.review.state, 'ok');
    assert.equal(os4.reviews.length, 1);
    console.log('  ✓ review recorded, next review date moved');

    // Legislation: point the register at the local fake Slov-Lex, disable the rest.
    const laws = await page.evaluate(() => window.api.laws.list());
    for (const l of laws) {
      if (l.key === 'SK:362/2011') await page.evaluate(([id, url]) => window.api.laws.update(id, { url }), [l.id, `${lawBase}/pravne-predpisy/SK/ZZ/2011/362/`]);
      else await page.evaluate((id) => window.api.laws.update(id, { enabled: false }), l.id);
    }
    await page.evaluate((url) => window.api.laws.add({ title: 'ŠÚKL – oznamy (test)', short: 'ŠÚKL oznamy', url, jurisdiction: 'SK' }), `${lawBase}/spa`);
    await page.click('a.nav-item[href="#/legislation"]');
    await page.waitForSelector('.laws-table');
    await page.click('button[data-action="checkAll"]');
    await page.waitForSelector('.note-good', { timeout: 90000 });
    await shot(page, '10-legislation');
    const changes = await page.evaluate(() => window.api.changes.list());
    assert.equal(changes.length, 1, 'one upcoming change detected at baseline');
    assert.equal(changes[0].kind, 'upcoming');
    assert.deepEqual(changes[0].summary.sections.sort(), ['§18', '§19a']);
    const spaLaw = (await page.evaluate(() => window.api.laws.list())).find((l) => l.short === 'ŠÚKL oznamy');
    assert.equal(spaLaw.state.status, 'ok', 'JS-rendered page read: ' + (spaLaw.state.error || ''));
    console.log('  ✓ legislation check: upcoming version found, § diff computed, JS page rendered');

    // AI (local fake Ollama)
    await page.evaluate((url) => window.api.app.setSettings({ ai: { provider: 'ollama', baseUrl: url, model: 'qwen2.5:7b' } }), `http://127.0.0.1:${ollama.address().port}`);
    await page.evaluate(() => window.__app.reloadInfo());
    await page.click('.change-card');
    await page.waitForSelector('.aff');
    const affected = await page.$$eval('.aff', (els) => els.length);
    assert.ok(affected >= 2, 'affected docs listed');
    await page.click('.aff-direct button[data-action="analyze"]');
    await page.waitForSelector('.ai-text', { timeout: 30000 });
    assert.match(ollama.lastPrompt, /§ 18/, 'prompt contains changed section');
    assert.match(ollama.lastPrompt, /Stiahnutie z trhu|stiahnutie/i, 'prompt contains document excerpt');
    await page.click('.aff-direct button[data-action="flag"]');
    await page.waitForSelector('.toast');
    await shot(page, '11-change');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.$eval('.main', (m) => (m.scrollTop = m.scrollHeight));
    await shot(page, '12-change-diff');
    console.log('  ✓ affected documents, AI impact analysis via local model, flag for review');

    // Ask the archive
    await page.click('a.nav-item[href="#/search"]');
    await page.click('button[data-mode="ask"]');
    await page.fill('#q', 'Čo robíme pri stiahnutí lieku z trhu?');
    await page.click('button[data-action="ask"]');
    await page.waitForSelector('.answer-text');
    await shot(page, '13-ask');
    console.log('  ✓ question answering over passages');

    // Settings + network log
    await page.click('a.nav-item[href="#/settings"]');
    await page.waitForSelector('#set-privacy');
    await shot(page, '14-settings');
    await page.$eval('#set-privacy', (el) => el.scrollIntoView());
    await shot(page, '15-privacy');

    // English + dark theme
    await page.evaluate(() => window.api.app.setSettings({ lang: 'en', theme: 'dark' }));
    await page.evaluate(() => window.__app.reloadInfo().then(() => (location.hash = '#/dashboard')));
    await page.waitForSelector('.kpis');
    await page.waitForTimeout(300);
    await shot(page, '16-dashboard-en-dark');
    await page.evaluate((id) => (location.hash = '#/legislation/change/' + id), changes[0].id);
    await page.waitForSelector('.aff');
    await shot(page, '17-change-en-dark');

    // Data on disk
    const dataDir = path.join(tmp, 'archive');
    assert.ok(fs.existsSync(path.join(dataDir, 'archive.json')));
    assert.ok(fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8').includes('doc.reviewed'));
    console.log('  ✓ archive.json and audit.log written');

    const real = errors.filter((e) => !/favicon|Autofill/i.test(e));
    assert.deepEqual(real, [], 'no renderer errors');
    console.log(`\nAll e2e checks passed. Screenshots: ${OUT}`);
  } finally {
    await app.close().catch(() => {});
    lawSrv.close();
    ollama.close();
  }
}

main().catch((e) => {
  console.error('E2E FAILED:', e);
  process.exit(1);
});
