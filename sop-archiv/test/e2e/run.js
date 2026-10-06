'use strict';
// End-to-end test of the real Electron app (Playwright):
//   first-time setup → import documents → search → review → legislation monitor →
//   check documents against an act (downloaded PDF, web address, name) → recheck after a SOP update →
//   AI analysis (local fake Ollama) → user profiles and roles → a second computer opens the shared
//   archive read-only and takes over → privacy checks. Saves screenshots.
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
const ADMIN = { name: 'Juraj Gregus', password: 'Tajne-heslo-1' };
const READER = { name: 'Eva Nováková', password: 'citam123' };

// --- Fake Slov-Lex -------------------------------------------------------------
function lawPage(body, versions, port) {
  const links = versions.map((v) => `<li><a href="http://127.0.0.1:${port}/pravne-predpisy/SK/ZZ/2011/362/${v}">Znenie od ${v}</a></li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>362/2011 Z. z.</title></head><body>
  <header>Slov-Lex (test)</header><nav><ul>${links}</ul></nav>
  <main id="text">${body
    .split('\n')
    .map((l) => `<p>${l}</p>`)
    .join('')}</main><footer>© Ministerstvo spravodlivosti SR · aktualizované ${new Date().toISOString()}</footer></body></html>`;
}

const LAW_2025 = `Zákon č. 362/2011 Z. z. o liekoch a zdravotníckych pomôckach
§ 1
Predmet úpravy
(1) Tento zákon upravuje podmienky zaobchádzania s liekmi.
§ 18
Povinnosti držiteľa povolenia na veľkodistribúciu liekov
(1) Držiteľ povolenia na veľkodistribúciu liekov je povinný
k) zabezpečiť stiahnutie lieku z trhu na základe rozhodnutia štátneho ústavu,
l) uchovávať záznamy o dodávkach liekov a o teplote päť rokov.
§ 19
Skladovanie liekov
(1) Lieky sa skladujú pri teplote 15 – 25 °C; termolabilné lieky v chladničke pri teplote 2 – 8 °C. Poškodené balenia sa umiestnia do karantény.
§ 23
Povinnosti držiteľa povolenia na poskytovanie lekárenskej starostlivosti
(1) Text bez zmeny.`;

const LAW_2027 = LAW_2025.replace('o teplote päť rokov.', 'o teplote desať rokov v elektronickej podobe.')
  .replace('k) zabezpečiť stiahnutie lieku z trhu na základe rozhodnutia štátneho ústavu,', 'k) zabezpečiť stiahnutie lieku z trhu do 24 hodín od doručenia rozhodnutia štátneho ústavu,')
  .concat('\n§ 19a\nOverovanie ochranných prvkov\n(1) Veľkodistribútor overuje ochranné prvky pri vrátení lieku.');

// The plain pages on static.slov-lex.sk: an index of all versions and one page per version, where the
// act sits in #predpis next to a contents list and an info box (those must not count as changes).
const AMENDED_BY = { 20240601: '50/2024', 20250101: '361/2024', 20270101: '77/2026' };
const dmy = (k) => `${k.slice(6, 8)}.${k.slice(4, 6)}.${k.slice(0, 4)}`;
function staticIndex(versions) {
  const iso = (k) => `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`;
  const dayBefore = (k) => new Date(Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8) - 1)).toISOString().slice(0, 10);
  const rows = versions.map((k, i) => {
    const to = versions[i + 1] ? dayBefore(versions[i + 1]) : '';
    const act = AMENDED_BY[k];
    return `<tr class="effectivenessHistoryItem" data-iri="/SK/ZZ/2011/362/${k}" data-vyhlasene="0" data-ucinnostod="${iso(k)}" data-ucinnostdo="${to}"><td class="title">${i + 2}.</td><td class="title"><a href="${k}.html"><span>${dmy(k)} - </span></a></td><td><a href="../../../ZZ/${act.split('/')[1]}/${act.split('/')[0]}/${k}.html">${act}&nbsp;Z.&nbsp;z.</a></td></tr>`;
  });
  return `<!doctype html><html><head><meta charset="utf-8"><title>Zbierka zákonov Slovenskej republiky</title></head><body><h1>História predpisu 362/2011 Z. z.</h1><table><tbody>
    <tr class="effectivenessHistoryItem" data-iri="/SK/ZZ/2011/362/vyhlasene_znenie" data-vyhlasene="1" data-ucinnostod="" data-ucinnostdo=""><td class="title">1.</td><td class="title"><a href="vyhlasene_znenie.html">Vyhlásené znenie</a></td><td></td></tr>
    ${rows.join('')}</tbody></table></body></html>`;
}
function staticVersion(body, key) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>362/2011 Z. z. - Zákon o liekoch a zdravotníckych pomôckach</title></head><body><div id="main-content" role="main">
    <h1>362/2011 Z. z.</h1><div class="ucinnost_header"><h4>Časová verzia predpisu účinná od ${dmy(key)}</h4></div>
    <div class="content-table">Obsah<br>Čl. I<br>§ 1<br>§ 18<br>Čl. II Účinnosť</div>
    <div class="accordion-section">Informácie o predpise<br>Dátum účinnosti od: ${dmy(key)}<br>Novela: ${AMENDED_BY[key]} Z. z.</div>
    <div class="predpis Skupina" id="predpis">${body.split('\n').map((l) => `<div>${l}</div>`).join('')}</div>
    <div id="poznamky">Poznámky pod čiarou · stránka vygenerovaná ${new Date().toISOString()}</div>
  </div></body></html>`;
}

function startLawServer() {
  return new Promise((resolve) => {
    const versions = ['20240601', '20250101', '20270101'];
    const srv = http.createServer((req, res) => {
      const port = srv.address().port;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      srv.hits = (srv.hits || 0) + (req.url.startsWith('/static/') ? 1 : 0);
      const st = req.url.match(/^\/static\/SK\/ZZ\/2011\/362\/(?:(\d{8})\.html)?$/);
      if (st) {
        if (!st[1]) return res.end(staticIndex(versions));
        if (!versions.includes(st[1])) {
          res.statusCode = 404;
          return res.end('not found');
        }
        return res.end(staticVersion(st[1] === '20270101' ? LAW_2027 : LAW_2025, st[1]));
      }
      if (req.url.startsWith('/spa')) {
        res.end(`<!doctype html><html><body><div id="app">Načítavam…</div><script>setTimeout(()=>{document.getElementById('app').innerText='ŠÚKL oznamy\\nNové usmernenie k správnej distribučnej praxi platné od 1. 1. 2027\\nZmena formulára hlásenia nežiaducich účinkov\\n'+'Ďalší text oznamu. '.repeat(20)},900)</script></body></html>`);
        return;
      }
      const m = req.url.match(/\/pravne-predpisy\/SK\/ZZ\/2011\/362\/(\d{8})?/);
      if (!m) {
        res.statusCode = 404;
        return res.end('not found');
      }
      const v = m[1] || '20250101';
      res.end(lawPage(v === '20270101' ? LAW_2027 : LAW_2025, versions, port));
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// --- Fake Ollama (a local AI server) --------------------------------------------
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
            ? '1. Záver: OVPLYVNENÝ – § 18 ods. 1 písm. l) predlžuje dobu uchovávania záznamov na desať rokov.\n2. Čo treba zmeniť: kap. 3 „Záznamy“ → 5 rokov nahradiť 10 rokmi, v elektronickej podobe.\n3. Prečo: § 18 ods. 1 písm. l) v znení od 1. 1. 2027.\n4. Termín: 1. 1. 2027.\n5. Neistoty: overiť prechodné ustanovenia.'
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

function launch(tmp, userdata) {
  // SOP_ARCHIV_EXE=path/to/packaged/binary tests a built app instead of the sources.
  const packaged = process.env.SOP_ARCHIV_EXE;
  return electron.launch({
    executablePath: packaged || require('electron'),
    args: packaged ? ['--no-sandbox'] : [ROOT, '--no-sandbox'],
    env: { ...process.env, SOP_ARCHIV_USERDATA: path.join(tmp, userdata), SOP_ARCHIV_DATA: path.join(tmp, 'archive'), SOP_ARCHIV_NO_TIMERS: '1', LANG: process.env.LANG || 'sk_SK.UTF-8' }
  });
}

async function signIn(page, who) {
  await page.waitForSelector('.profiles');
  await page.click(`.profile:has-text("${who.name}")`);
  await page.fill('#login-pw', who.password);
  await page.click('#login-form button[type=submit]');
  await page.waitForSelector('#nav .nav-item');
}

async function signOut(page) {
  await page.click('#sign-out');
  await page.waitForSelector('.profiles');
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-e2e-'));
  const fixtures = await makeAll(path.join(tmp, 'fixtures'));
  const lawSrv = await startLawServer();
  const ollama = await startOllama();
  const lawBase = `http://127.0.0.1:${lawSrv.address().port}`;

  let app = await launch(tmp, 'userdata-pc1');
  let app2 = null;
  const errors = [];
  let page = null;
  try {
    page = await app.firstWindow();
    const watch = (p) => {
      p.on('pageerror', (e) => errors.push(String(e)));
      p.on('console', (m) => m.type() === 'error' && !/ERR_BLOCKED_BY_CLIENT|Refused to connect|Failed to fetch|Content Security Policy/.test(m.text()) && errors.push(m.text()));
    };
    watch(page);
    await page.setViewportSize({ width: 1360, height: 860 });

    // ---- First-time setup: the administrator profile ----
    await page.waitForSelector('#setup-form');
    await page.selectOption('#setup-lang', 'sk');
    await page.waitForSelector('#setup-form [name=name]');
    await page.fill('#setup-form [name=name]', ADMIN.name);
    await page.fill('#setup-form [name=org]', 'PHARMACOPOLA s.r.o.');
    await page.fill('#setup-form [name=password]', ADMIN.password);
    await page.fill('#setup-form [name=password2]', 'iné heslo');
    await page.click('#setup-form button[type=submit]');
    await page.waitForSelector('#setup-err:has-text("nezhodujú")');
    await page.fill('#setup-form [name=password2]', ADMIN.password);
    await shot(page, '00-setup');
    await page.click('#setup-form button[type=submit]');
    await page.waitForSelector('.hero-empty');
    const info0 = await page.evaluate(() => window.api.app.info());
    assert.equal(info0.session.name, ADMIN.name);
    assert.equal(info0.session.role, 'admin');
    await page.waitForFunction(() => { const i = document.querySelector('#brand-logo img'); return i && /pharmacopola-logo\.svg$/.test(i.src) && i.complete && i.naturalWidth > 0; });
    await shot(page, '01-dashboard-empty');
    console.log('  ✓ first-time setup creates the administrator profile; the PHARMACOPOLA logo is shown');

    // PDFs generated by Chromium itself (with Slovak diacritics).
    const pdfOf = async (html) =>
      Buffer.from(
        await app.evaluate(async ({ BrowserWindow }, h) => {
          const w = new BrowserWindow({ show: false });
          await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(h));
          const buf = await w.webContents.printToPDF({});
          w.destroy();
          return buf.toString('base64');
        }, html),
        'base64'
      );
    const pdfPath = path.join(tmp, 'fixtures', 'SOP-QA-001_Prijem_a_skladovanie.pdf');
    fs.writeFileSync(
      pdfPath,
      await pdfOf(`<html><body style="font-family:sans-serif;font-size:13px"><p>PHARMACOPOLA s.r.o.</p><h1>SOP-QA-001 Príjem a skladovanie liekov</h1>
        <p>Verzia: 3</p><p>Dátum účinnosti: 1. 3. 2024</p><p>Dátum ďalšej revízie: 20. 10. 2026</p><p>Vypracoval: Ing. Ján Novák</p>
        <h2>1. Príjem tovaru</h2><p>Pri príjme sa kontroluje neporušenosť obalov, šarža a dátum exspirácie. Lieky s porušeným obalom sa umiestnia do karantény.</p>
        <h2>2. Teplota</h2><p>Teplota skladovania liekov musí byť 15 – 25 °C. Termolabilné lieky sa skladujú v chladničke pri teplote 2 – 8 °C, v súlade s § 18 ods. 1 zákona č. 362/2011 Z. z.</p>
        <div style="page-break-before:always"><h2>3. Záznamy</h2><p>Záznamy o teplote sa uchovávajú 5 rokov podľa § 18 ods. 1 písm. l) zákona č. 362/2011 Z. z. Veterinárne lieky podľa nariadenia (EÚ) 2019/6.</p></div></body></html>`)
    );

    // ---- Import through the real import dialog ----
    const paths = [pdfPath, fixtures.docx, fixtures.odt, fixtures.rtf, fixtures.txt, fixtures.xlsx];
    await page.evaluate((p) => import('./js/views/importer.js').then((m) => { m.startImport(p); }), paths);
    await page.waitForSelector('.imp-table tbody tr:nth-child(6)', { timeout: 30000 });
    // the QA department (2nd default entry; its name depends on the system language)
    const dept = await page.$eval('.imp-bulk select[data-bulk="department"]', (sel) => sel.options[2].value);
    await page.selectOption('.imp-bulk select[data-bulk="department"]', dept);
    await shot(page, '02-import-dialog');
    assert.match(await page.textContent('.modal-foot .btn-primary'), /6/, 'import button counts 6 files');
    await page.click('.modal-foot .btn-primary');
    await page.waitForSelector('.toast');
    await page.waitForFunction(() => window.api.docs.list().then((d) => d.length === 6));
    const docs = await page.evaluate(() => window.api.docs.list());
    const byCode = Object.fromEntries(docs.map((d) => [d.code || d.title, d]));
    assert.ok(byCode['SOP-QA-001'], 'PDF imported with detected code');
    assert.equal(byCode['SOP-QA-001'].version, '3');
    assert.equal(byCode['SOP-QA-001'].reviewDate, '2026-10-20');
    assert.equal(byCode['SOP-QA-001'].department, dept);
    assert.ok(byCode['SOP-SK-002'], 'DOCX imported');
    assert.ok(byCode['OS 4/2023'], 'ODT imported');
    assert.equal(byCode['OS 4/2023'].review.state, 'overdue');
    const audit1 = await page.evaluate(() => window.api.app.audit({ limit: 50 }));
    assert.ok(audit1.some((r) => r.action === 'doc.imported' && r.user === ADMIN.name), 'audit records the signed-in user');
    console.log("  ✓ import of 6 files with metadata detection, recorded under the user's name");

    await page.evaluate(() => (location.hash = '#/dashboard'));
    await page.waitForSelector('.kpis');
    await shot(page, '03-dashboard');

    await page.click('a.nav-item[href="#/documents"]');
    await page.waitForSelector('.docs-table tbody tr.clickable');
    await shot(page, '04-documents');

    // ---- Document detail ----
    await page.click(`tr[data-id="${byCode['SOP-QA-001'].id}"]`);
    await page.waitForSelector('.doc-head');
    await shot(page, '05-document');
    await page.click('a.tab[href$="tab=legis"]');
    await page.waitForSelector('.secs .sec');
    assert.match(await page.textContent('.secs'), /§ 18/, 'cites § 18');
    await page.click('a.tab[href$="tab=text"]');
    await page.waitForSelector('#doc-text');
    await page.fill('#find-text', 'karantény');
    await page.waitForSelector('#doc-text mark');
    await shot(page, '06-document-text');
    console.log('  ✓ document detail, citations, text view');

    // ---- Search ----
    await page.click('a.nav-item[href="#/search"]');
    await page.fill('#q', 'teplota chladnička');
    await page.waitForSelector('.result mark');
    assert.match(await page.textContent('.result .result-title'), /SOP-QA-001/);
    await page.fill('#q', 'stiahnutie lieku z trhu');
    await page.waitForFunction(() => document.querySelectorAll('.result').length >= 2);
    await shot(page, '07-search');
    console.log('  ✓ full-text search with Slovak word forms');

    // ---- Reviews ----
    await page.click('a.nav-item[href="#/reviews"]');
    await page.waitForSelector('.panel-bad .rows .row');
    await shot(page, '08-reviews');
    await page.click('.panel-bad .rows .row button[data-action="review"]');
    await page.waitForSelector('.modal textarea[name="notes"]');
    assert.equal(await page.inputValue('.modal [name=by]'), ADMIN.name, 'reviewer defaults to the signed-in user');
    await page.fill('.modal textarea[name="notes"]', 'Bez zmien, overené QA.');
    await shot(page, '09-review-dialog');
    await page.click('.modal-foot .btn-primary');
    await page.waitForFunction(() => !document.querySelector('.modal'));
    const os4 = await page.evaluate((id) => window.api.docs.get(id), byCode['OS 4/2023'].id);
    assert.equal(os4.review.state, 'ok');
    assert.equal(os4.reviews.length, 1);
    console.log('  ✓ review recorded, next review date moved');

    // ---- Legislation monitor against a local fake Slov-Lex ----
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
    assert.deepEqual(changes[0].summary.sections.sort(), ['§18', '§19a'], 'only the act is compared, not the page around it');
    assert.deepEqual(changes[0].amendedBy, ['77/2026 Z. z.'], 'the amending act comes from the Slov-Lex version index');
    assert.ok(lawSrv.hits >= 3, 'read through the static Slov-Lex pages');
    const upcomingId = changes[0].id;
    const spaLaw = (await page.evaluate(() => window.api.laws.list())).find((l) => l.short === 'ŠÚKL oznamy');
    assert.equal(spaLaw.state.status, 'ok', 'JS-rendered page read: ' + (spaLaw.state.error || ''));
    let full = await page.evaluate((id) => window.api.changes.get(id), upcomingId);
    const qaAff = full.affected.find((a) => a.docId === byCode['SOP-QA-001'].id);
    assert.equal(qaAff.severity, 'high');
    assert.ok(
      qaAff.analysis.findings.some((f) => f.type === 'quantity' && f.docValue === '5 rokov' && f.lawValues.some((v) => /desať rokov/.test(v))),
      'SOP "5 rokov" vs act "desať rokov"'
    );
    console.log('  ✓ monitor: upcoming version, § diff, and the "5 years vs ten years" mismatch in SOP-QA-001');

    // ---- AI analysis with a local model (a cloud address is refused) ----
    const badAi = await page.evaluate(() => window.api.app.setSettings({ ai: { provider: 'ollama', baseUrl: 'https://api.openai.com' } }).then(() => 'accepted', (e) => e.message));
    assert.match(badAi, /vnútornej sieti|internal/, 'a cloud AI address is refused');
    await page.evaluate((url) => window.api.app.setSettings({ ai: { provider: 'ollama', baseUrl: url, model: 'qwen2.5:7b' } }), `http://127.0.0.1:${ollama.address().port}`);
    await page.evaluate(() => window.__app.reloadInfo());
    await page.evaluate((id) => (location.hash = '#/legislation/change/' + id), upcomingId);
    await page.waitForSelector('.aff');
    await page.click('.aff.sev-high button[data-action="analyze"]');
    await page.waitForSelector('.ai-text', { timeout: 30000 });
    assert.match(ollama.lastPrompt, /§ 18/, 'prompt contains changed section');
    assert.match(ollama.lastPrompt, /5 rokov/, 'prompt contains the automatic finding');
    await page.click('.aff.sev-high .compare summary');
    await shot(page, '11-change');
    await page.$eval('.main', (m) => (m.scrollTop = m.scrollHeight));
    await shot(page, '12-change-diff');
    console.log('  ✓ findings, side-by-side comparison, AI analysis via a local model (cloud address refused)');

    // ---- Check documents against an act: downloaded PDF ----
    const lawPdf = path.join(tmp, 'fixtures', 'zakon-362-2011-od-2027.pdf');
    fs.writeFileSync(
      lawPdf,
      await pdfOf(
        `<html><body style="font-family:serif;font-size:12px"><p>362/2011 Z. z.</p><p><b>ZÁKON</b></p><p>z 13. septembra 2011</p><p>o liekoch a zdravotníckych pomôckach</p><p>Znenie účinné od 1. 1. 2027</p>${LAW_2027.split('\n')
          .slice(1)
          .map((l) => (/^§/.test(l) ? `<p style="text-align:center;margin-top:14px">${l}</p>` : `<p>${l}</p>`))
          .join('')}</body></html>`
      )
    );
    await page.click('a.nav-item[href="#/legislation"]');
    await page.waitForSelector('button[data-action="lawCheck"]');
    await page.evaluate((p) => import('./js/views/lawcheck.js').then((m) => { m.lawCheckDialog({ file: p }); }), lawPdf);
    await page.waitForSelector('.lc-file');
    const lawSel = await page.$eval('[data-lc-law]', (s) => s.options[s.selectedIndex].textContent);
    assert.match(lawSel, /liekoch/i, 'the act is recognised from the file');
    assert.equal(await page.inputValue('.lc-body [name=versionDate]'), '2027-01-01', 'version date recognised');
    await shot(page, '13-check-file');
    await page.click('.modal-foot .btn-primary');
    await page.waitForFunction(() => /legislation\/change\//.test(location.hash), null, { timeout: 30000 });
    await page.waitForSelector('.aff');
    const fileCheckId = decodeURIComponent((await page.evaluate(() => location.hash)).split('/').pop());
    full = await page.evaluate((id) => window.api.changes.get(id), fileCheckId);
    assert.equal(full.source.type, 'file');
    assert.ok(
      full.affected.some((a) => a.docId === byCode['SOP-QA-001'].id && a.analysis && a.analysis.findings.some((f) => f.type === 'quantity')),
      'PDF of the act: mismatch found'
    );
    await shot(page, '14-check-report');
    console.log('  ✓ check against a downloaded PDF of the act (act and version recognised automatically)');

    // ---- Recheck after the SOP is updated ----
    const sopV2 = path.join(tmp, 'fixtures', 'SOP-QA-001_v4.txt');
    fs.writeFileSync(
      sopV2,
      'SOP-QA-001 Príjem a skladovanie liekov\nVerzia: 4\n3. Záznamy\nZáznamy o teplote sa uchovávajú 10 rokov v elektronickej podobe podľa § 18 ods. 1 písm. l) zákona č. 362/2011 Z. z.\nStiahnutie do 24 hodín podľa § 18 ods. 1 písm. k) zákona č. 362/2011 Z. z.'
    );
    await page.evaluate(([id, p]) => window.api.docs.addVersion(id, p, { version: '4' }), [byCode['SOP-QA-001'].id, sopV2]);
    await page.click('button[data-action="recheck"]');
    await page.waitForSelector('.toast');
    full = await page.evaluate((id) => window.api.changes.get(id), fileCheckId);
    const after = full.affected.find((a) => a.docId === byCode['SOP-QA-001'].id);
    assert.equal(after.analysis.findings.filter((f) => f.type === 'quantity').length, 0, 'mismatch gone after the SOP update');
    console.log('  ✓ recheck after updating the SOP clears the finding');

    // ---- Check by web address and by name ----
    for (const [mode, value] of [
      ['url', `${lawBase}/pravne-predpisy/SK/ZZ/2011/362/`],
      ['name', 'zákon o liekoch']
    ]) {
      await page.click('a.nav-item[href="#/legislation"]');
      await page.waitForSelector('button[data-action="lawCheck"]');
      await page.click('button[data-action="lawCheck"]');
      await page.click(`[data-lc-mode="${mode}"]`);
      await page.fill(mode === 'url' ? '.lc-body [name=url]' : '.lc-body [name=query]', value);
      if (mode === 'name') {
        await page.waitForSelector('#lc-resolved.ok');
        await shot(page, '15-check-name');
      }
      const before = await page.evaluate(() => location.hash);
      await page.click('.modal-foot .btn-primary');
      await page.waitForFunction((b) => /legislation\/change\//.test(location.hash) && location.hash !== b, before, { timeout: 60000 });
      await page.waitForSelector('.aff');
      const id = decodeURIComponent((await page.evaluate(() => location.hash)).split('/').pop());
      const rep = await page.evaluate((x) => window.api.changes.get(x), id);
      assert.equal(rep.kind, 'check');
      assert.equal(rep.source.type, mode);
    }
    console.log('  ✓ check by web address and by name');

    // ---- Ask the archive (local AI) ----
    await page.click('a.nav-item[href="#/search"]');
    await page.click('button[data-mode="ask"]');
    await page.fill('#q', 'Čo robíme pri stiahnutí lieku z trhu?');
    await page.click('button[data-action="ask"]');
    await page.waitForSelector('.answer-text');
    console.log('  ✓ question answering over passages');

    // ---- Users: add a reader, sign in as them ----
    await page.click('a.nav-item[href="#/settings"]');
    await page.waitForSelector('#set-users');
    await page.click('button[data-action="addUser"]');
    await page.fill('.modal [name=name]', READER.name);
    await page.selectOption('.modal [name=role]', 'reader');
    await page.fill('.modal [name=password]', READER.password);
    await page.fill('.modal [name=password2]', READER.password);
    await page.click('.modal-foot .btn-primary');
    await page.waitForSelector(`.users-table td:has-text("${READER.name}")`);
    await page.$eval('#set-users', (el) => el.scrollIntoView());
    await shot(page, '16-users');

    // ---- Company logo: stored in the archive folder, shown in the sidebar and at sign-in ----
    const logoFile = path.join(tmp, 'firemne-logo.svg');
    fs.writeFileSync(logoFile, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 60"><rect width="240" height="60" rx="8" fill="#ffffff"/><circle cx="30" cy="30" r="18" fill="#1d4f91"/><text x="58" y="39" font-family="Arial" font-size="24" font-weight="700" fill="#1d4f91">TEST LOGO</text></svg>');
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, logoFile);
    await page.click('button[data-action="setLogo"]');
    await page.waitForSelector('#brand-logo:not([hidden]) img[src^="data:image/svg+xml"]');
    await page.waitForSelector('.logo-preview img[src^="data:image/svg+xml"]');
    assert.ok(fs.existsSync(path.join(tmp, 'archive', 'branding', 'logo.svg')), 'logo is kept in the archive folder');
    await page.$eval('#set-archive', (el) => el.scrollIntoView());
    await shot(page, '16b-logo');
    await page.click('button[data-action="clearLogo"]');
    await page.waitForSelector('#brand-logo img[src$="pharmacopola-logo.svg"]');
    assert.ok(!fs.existsSync(path.join(tmp, 'archive', 'branding', 'logo.svg')));
    console.log('  ✓ company logo: another one can be chosen, and back to the PHARMACOPOLA logo');

    await signOut(page);
    await page.waitForSelector('.auth-logo');
    await shot(page, '17-sign-in');
    await page.click(`.profile:has-text("${READER.name}")`);
    await page.fill('#login-pw', 'zle-heslo');
    await page.click('#login-form button[type=submit]');
    await page.waitForSelector('#login-err:has-text("Nesprávne heslo")');
    await signIn(page, READER);
    await page.click('a.nav-item[href="#/documents"]');
    await page.waitForSelector('.docs-table');
    assert.equal(await page.isVisible('button[data-action="import"]'), false, 'readers do not see Import');
    const denied = await page.evaluate((id) => window.api.docs.update(id, { title: 'X' }).then(() => 'allowed', (e) => e.message), byCode['SOP-SK-002'].id);
    assert.match(denied, /oprávnenie|not allowed/, 'reader cannot change documents (enforced by the app core)');
    const denied2 = await page.evaluate(() => window.api.users.list().then(() => 'allowed', (e) => e.message));
    assert.match(denied2, /oprávnenie|not allowed/);
    await page.click(`tr[data-id="${byCode['SOP-SK-002'].id}"]`);
    await page.waitForSelector('.doc-head');
    assert.equal(await page.isVisible('button[data-action="edit"]'), false);
    await shot(page, '18-reader-view');
    const audit2 = await page.evaluate(() => window.api.app.audit({ limit: 20 }));
    assert.ok(audit2.some((r) => r.action === 'auth.failed'), 'failed sign-in is audited');
    await signOut(page);
    await signIn(page, ADMIN);
    console.log('  ✓ profiles: reader cannot change anything (UI and core), wrong password rejected and audited');

    // ---- A second computer opens the same archive: read-only ----
    app2 = await launch(tmp, 'userdata-pc2');
    const page2 = await app2.firstWindow();
    watch(page2);
    await page2.setViewportSize({ width: 1360, height: 860 });
    await signIn(page2, READER);
    const info2 = await page2.evaluate(() => window.api.app.info());
    assert.ok(info2.readOnly, 'second computer is read-only');
    assert.ok(await page2.isVisible('#brand-logo img'), 'the second computer shows the logo too');
    await page2.click('a.nav-item[href="#/documents"]');
    await page2.waitForSelector('.ro-banner');
    await shot(page2, '19-second-computer-read-only');
    await signOut(page2);
    await signIn(page2, ADMIN);
    const roErr = await page2.evaluate((id) => window.api.docs.update(id, { notes: 'x' }).then(() => 'allowed', (e) => e.message), byCode['SOP-SK-002'].id);
    assert.match(roErr, /len na čítanie|read-only/, 'even an administrator cannot write while the other computer holds the archive');
    // The first computer saves a change; the second sees it after the first closes and it takes over.
    await page.evaluate((id) => window.api.docs.update(id, { notes: 'Zmena z PC1' }), byCode['SOP-SK-002'].id);
    await app.close();
    app = null;
    await page2.click('#ro-retry');
    await page2.waitForFunction(() => !document.querySelector('.ro-banner'));
    const d2 = await page2.evaluate((id) => window.api.docs.get(id), byCode['SOP-SK-002'].id);
    assert.equal(d2.notes, 'Zmena z PC1', 'changes of the first computer are visible');
    assert.equal(await page2.evaluate((id) => window.api.docs.update(id, { notes: 'Zmena z PC2' }).then(() => 'ok'), byCode['SOP-SK-002'].id), 'ok');
    console.log('  ✓ shared archive: second computer read-only, then takes over after the first closes');

    // ---- Privacy: the UI cannot reach the internet ----
    const net = await page2.evaluate(() => fetch('https://example.com/').then(() => 'reached', () => 'blocked'));
    assert.equal(net, 'blocked');
    console.log('  ✓ the user interface cannot reach the internet');

    // ---- English + dark theme (per-user preferences) ----
    page = page2;
    await page.evaluate(() => window.api.auth.setPrefs({ lang: 'en', theme: 'dark' }));
    await page.evaluate(() => window.__app.reloadInfo());
    await page.evaluate((id) => (location.hash = '#/legislation/change/' + id), upcomingId);
    await page.waitForSelector('.aff');
    await shot(page, '20-change-en-dark');

    // ---- Data on disk ----
    const dataDir = path.join(tmp, 'archive');
    const json = JSON.parse(fs.readFileSync(path.join(dataDir, 'archive.json'), 'utf8'));
    assert.equal(json.users.length, 2);
    assert.ok(json.users.every((u) => u.hash && !JSON.stringify(u).includes(ADMIN.password) && !JSON.stringify(u).includes(READER.password)), 'only password hashes are stored');
    assert.ok(fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8').includes('doc.reviewed'));
    console.log('  ✓ archive.json (profiles with hashed passwords) and audit.log written');

    const real = errors.filter((e) => !/favicon|Autofill/i.test(e));
    assert.deepEqual(real, [], 'no renderer errors');
    console.log(`\nAll e2e checks passed. Screenshots: ${OUT}`);
  } catch (e) {
    // Leave evidence for CI: a screenshot and any message the app showed.
    if (page) {
      await page.screenshot({ path: path.join(OUT, 'zz-failure.png') }).catch(() => {});
      const shown = await page.evaluate(() => [...document.querySelectorAll('.modal .err, #login-err, .toast')].map((x) => x.textContent.trim()).filter(Boolean)).catch(() => []);
      if (shown.length) console.error('Messages on screen:', shown);
    }
    if (errors.length) console.error('Renderer errors:', errors);
    throw e;
  } finally {
    if (app) await app.close().catch(() => {});
    if (app2) await app2.close().catch(() => {});
    lawSrv.close();
    ollama.close();
  }
}

main().catch((e) => {
  console.error('E2E FAILED:', e);
  process.exit(1);
});
