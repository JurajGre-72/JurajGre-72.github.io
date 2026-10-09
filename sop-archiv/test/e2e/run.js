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
const { makeTinyModel } = require('../fixtures/tiny-gguf');
const NP = require('../fixtures/notices-pages');

// ŠÚKL / ÚŠKVBL notices served by the local server (made-up products).
const RECALLS = '/pre-odbornikov-a-firmy/dostupnost-a-kvalita-liekov/kvalita-liekov/oznamy-o-stiahnuti-liekov';
const NOTICE_RECALLS = [
  { title: 'Stiahnutie lieku Fiktivol 10 mg z trhu', path: `${RECALLS}/fiktivol`, date: NP.isoDaysAgo(3), summary: 'Stiahnutie šarží A123, A124 na úrovni veľkodistribútorov.' },
  { title: 'Stiahnutie lieku Starý liek z trhu', path: `${RECALLS}/stary`, date: NP.isoDaysAgo(200) }
];
const NOTICE_NEWS = [
  { title: 'MSC: Imaginex (tablety): prerušenie dodávky liekov', path: '/pre-odbornikov-a-firmy/dostupnost-a-kvalita-liekov/dostupnost-liekov/msc-imaginex', date: NP.isoDaysAgo(5) },
  { title: 'Závery z Výboru pre hodnotenie rizík liekov (PRAC)', path: '/pre-odbornikov-a-firmy/bezpecnost-liekov/informacie-z-prac/zavery', date: NP.isoDaysAgo(8) },
  { title: 'Dňa 15. 9. bude podateľňa zatvorená', path: '/oznamy/podatelna', date: NP.isoDaysAgo(9) }
];
const NOTICE_VET = [{ title: 'Oznámenie o stiahnutí veterinárneho lieku FIKTIVET 50 mg tablety pre psy', file: 'fiktivet.pdf', date: NP.isoDaysAgo(12) }];

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'sop-archiv-e2e'));
const ADMIN = { name: 'Juraj Gregus', password: 'Tajne-heslo-1' };
const READER = { name: 'Eva Nováková', password: 'citam123', next: 'vlastne-heslo-7' }; // the administrator sets the first password

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

const UPDATE_FILE = Buffer.from('SOP Archív 9.9.0 – test file standing for the installer'.repeat(2000));

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
      if (req.url.startsWith('/releases')) {
        // Fake GitHub release list for "Check for updates", with a file for every kind of computer
        res.setHeader('content-type', 'application/json');
        const base = `http://${req.headers.host}/download/sop-archiv-v9.9.0/`;
        const digest = `sha256:${require('crypto').createHash('sha256').update(UPDATE_FILE).digest('hex')}`;
        const assets = ['SOP-Archiv-9.9.0-mac-arm64.dmg', 'SOP-Archiv-9.9.0-mac-x64.dmg', 'SOP-Archiv-9.9.0-Setup.exe', 'SOP-Archiv-9.9.0-linux-x86_64.AppImage'].map((name) => ({ name, browser_download_url: base + name, size: UPDATE_FILE.length, digest }));
        return res.end(JSON.stringify([{ tag_name: 'sop-archiv-v9.9.0', html_url: 'https://github.com/example/releases/tag/sop-archiv-v9.9.0', published_at: '2027-01-15T09:00:00Z', body: 'Novinky', assets }, { tag_name: 'sop-archiv-v9.10.0-beta', prerelease: true }]));
      }
      if (req.url.startsWith('/download/')) {
        // The new version's file; altered on request (the app must refuse it)
        res.setHeader('content-type', 'application/octet-stream');
        return res.end(srv.tamperUpdate ? Buffer.from(UPDATE_FILE.toString().replace('9.9.0', '6.6.6')) : UPDATE_FILE);
      }
      if (req.url.startsWith('/sk/rss')) {
        res.setHeader('content-type', 'application/rss+xml; charset=utf-8');
        return res.end(req.url.includes('pid=208') ? NP.suklRss('Mimoriadne oznamy', NOTICE_RECALLS) : NP.suklRss('Aktuality', NOTICE_NEWS));
      }
      if (req.url.startsWith('/?page_id=115')) return res.end(NP.uskvblNotices(NOTICE_VET));
      if (req.url.startsWith('/?page_id=4702')) return res.end(NP.uskvblLegislation([{ title: 'NARIADENIE (EÚ) 2019/6 o veterinárnych liekoch', file: 'r2019-6.pdf' }]));
      // Ministry of Health, SOOL, ÚSKVBL ČR (older notices only: they start as the baseline)
      const here = `http://127.0.0.1:${port}`;
      if (req.url.startsWith('/?zoznam-kategorizovanych-liekov') || req.url.startsWith('/?kategorizacia-liekov-1')) return res.end(NP.mzList('Zoznam kategorizovaných liekov', [{ title: 'Zoznam kategorizovaných liekov 1.6.2026 – 30.6.2026', slug: 'lieky202606', date: NP.isoDaysAgo(100) }], here));
      if (req.url.startsWith('/feed/')) return res.end(NP.suklRss('SOOL', [{ title: 'EMVS Master Data Guide – aktualizovaná verzia', path: '/emvs/', date: NP.isoDaysAgo(120) }], here));
      if (req.url.startsWith('/cs/uskvbl/dulezita-upozorneni')) return res.end(NP.suklRss('Důležitá upozornění', [{ title: 'Upozornění - Padělky VLP Vymyslín', path: '/cs/a', date: NP.isoDaysAgo(90) }], here));
      // A product page of the EU veterinary medicines database; its authorisation is suspended on request
      if (req.url.startsWith('/veterinary/sk/600000012345')) return res.end(NP.updProduct({ name: 'FIKTIVET 50 mg tablety pre psy', authStatus: srv.updSuspended ? 'Suspended' : 'Valid', authorisedIn: ['CZ', 'SK'], availableIn: ['SK'], docs: { 'Súhrn charakteristických vlastností lieku': '2026-05-02' } }));
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
          srv.lastSystem = (j.messages.find((m) => m.role === 'system') || {}).content || '';
          const chapter = user.match(/Napíš obsah kapitoly „([^“]+)“/);
          if (chapter) {
            srv.drafts = (srv.drafts || 0) + 1;
            const c = chapter[1].startsWith('5.')
              ? '5.1 Kontrola pri príjme\n- Skladník skontroluje dodací list a záznam z dataloggera.\n- Termolabilné lieky uloží do chladiaceho boxu do [DOPLNIŤ: lehota v minútach].\n5.2 Odchýlky\n- Odchýlku hlási vedúcemu skladu (§ 19 zákona č. 362/2011 Z. z.).'
              : `Text kapitoly ${chapter[1]} podľa postupu spoločnosti.`;
            return res.end(JSON.stringify({ model: j.model, message: { role: 'assistant', content: c } }));
          }
          if (user.includes('== UPRAVOVANÝ TEXT ==')) {
            const orig = user.split('== UPRAVOVANÝ TEXT ==\n')[1].split('\n\n==')[0];
            return res.end(JSON.stringify({ model: j.model, message: { role: 'assistant', content: `NOVÉ ZNENIE:\n${orig.replace(/5 rokov/g, '10 rokov')} Záznamy sa vedú elektronicky.\nZDÔVODNENIE:\n- Doba uchovávania podľa § 18 ods. 1 písm. l) v znení od 1. 1. 2027.\n- Postup spoločnosti ostáva zachovaný.` } }));
          }
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

/** Remove messages still on screen, so that waiting for '.toast' waits for the next one. */
async function clearToasts(page) {
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((el) => el.remove()));
}

/** Poll an async check in the page (waitForFunction does not wait for a returned promise). */
async function until(page, fn, what, arg = undefined, timeout = 30000) {
  const end = Date.now() + timeout;
  while (!(await page.evaluate(fn, arg))) {
    if (Date.now() > end) throw new Error(`Timed out waiting: ${what}`);
    await page.waitForTimeout(200);
  }
}

// What the app itself reported (main process), printed when the test fails.
const appLog = [];

async function launch(tmp, userdata, host = 'PC-QA', locale = 'sk_SK.UTF-8') {
  // SOP_ARCHIV_EXE=path/to/packaged/binary tests a built app instead of the sources.
  const packaged = process.env.SOP_ARCHIV_EXE;
  const app = await electron.launch({
    executablePath: packaged || require('electron'),
    args: packaged ? ['--no-sandbox'] : [ROOT, '--no-sandbox'],
    // Two "computers" on one machine: each has its own name. STRICT_TX: a save outside a write transaction fails the test.
    env: { ...process.env, SOP_ARCHIV_USERDATA: path.join(tmp, userdata), SOP_ARCHIV_DATA: path.join(tmp, 'archive'), SOP_ARCHIV_NO_TIMERS: '1', SOP_ARCHIV_HOST: host, SOP_ARCHIV_STRICT_TX: '1', LANG: locale, LANGUAGE: locale.slice(0, 2), SOP_ARCHIV_UPDATE_DRYRUN: '1', ...(process.platform === 'linux' ? { APPIMAGE: path.join(tmp, 'SOP-Archiv.AppImage') } : {}) }
  });
  app.process().stderr.on('data', (d) => {
    for (const line of String(d).split('\n')) if (line.trim()) appLog.push(`[${host}] ${line}`);
    if (appLog.length > 400) appLog.splice(0, appLog.length - 400);
  });
  return app;
}

async function signIn(page, who) {
  await page.waitForSelector('.profiles');
  await page.click(`.profile:has-text("${who.name}")`);
  await page.fill('#login-pw', who.password);
  await page.click('#login-form button[type=submit]');
  await page.waitForSelector('#nav .nav-item, #pwchange-form');
  // A password set by the administrator: the user sets their own first (it is also their signature).
  if (await page.$('#pwchange-form')) {
    assert.ok(who.next, `${who.name} must set an own password`);
    await page.fill('#pwchange-form [name=old]', who.password);
    await page.fill('#pwchange-form [name=pw]', who.password);
    await page.fill('#pwchange-form [name=pw2]', who.password);
    await page.click('#pwchange-form button[type=submit]');
    await page.waitForFunction(() => document.querySelector('#pwchange-err').textContent.trim().length > 0); // "must differ from the current one" (any language)
    await page.fill('#pwchange-form [name=pw]', who.next);
    await page.fill('#pwchange-form [name=pw2]', who.next);
    await page.click('#pwchange-form button[type=submit]');
    who.password = who.next;
    delete who.next;
    await page.waitForSelector('#nav .nav-item');
  }
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
  process.env.SOP_ARCHIV_UPDATE_URL = `${lawBase}/releases`;
  process.env.SOP_ARCHIV_NOTICES_BASE = lawBase;

  let app = await launch(tmp, 'userdata-pc1');
  let app2 = null;
  const errors = [];
  const watched = []; // every window (both computers), for the evidence when a check fails
  let page = null;
  try {
    page = await app.firstWindow();
    const watch = (p) => {
      watched.push(p);
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
    // The archive is encrypted from the start: the recovery code is shown once and must be confirmed.
    await page.waitForSelector('#rec-code');
    const recoveryCode = (await page.textContent('#rec-code')).trim();
    assert.match(recoveryCode, /^[0-9A-Z]{5}(-[0-9A-Z]{5}){5}$/);
    await shot(page, '00b-recovery-code');
    await page.click('.modal-foot .btn-primary'); // not confirmed yet: stays open
    assert.ok(await page.isVisible('#rec-code'));
    await page.check('#rec-kept');
    await page.click('.modal-foot .btn-primary');
    await page.waitForFunction(() => !document.querySelector('#rec-code'));
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
    await clearToasts(page); // e.g. the recovery code reminder may still be on screen
    await page.click('.modal-foot .btn-primary');
    await page.waitForSelector('.toast');
    await until(page, () => window.api.docs.list().then((d) => d.length === 6), 'all 6 files imported');
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

    // ---- The company's document applies: a deliberate difference is recorded with a reason ----
    const qaId = byCode['SOP-QA-001'].id;
    const qaBefore = full.affected.find((a) => a.docId === qaId);
    const qFinding = qaBefore.findings.find((f) => f.type === 'quantity' && !f.decision);
    await page.click(`button[data-action="decide"][data-doc="${qaId}"][data-sec="${qFinding.section}"]`);
    await page.waitForSelector('.dec-form');
    await page.check('.dec-form input[name=kind][value=ours]');
    await page.check('.dec-form input[name=scope][value=doc]');
    await page.fill('.dec-form textarea[name=reason]', '');
    await page.click('.modal-foot .btn-primary');
    await page.waitForSelector('#dec-err:has-text("dôvod")');
    await page.fill('.dec-form textarea[name=reason]', 'Záznamy uchovávame dlhšie, než vyžaduje zákon – postup schválený vedením.');
    await page.click('.modal-foot .btn-primary');
    await page.waitForSelector('.finding.decided .decision');
    full = await page.evaluate((id) => window.api.changes.get(id), fileCheckId);
    const qaAfter = full.affected.find((a) => a.docId === qaId);
    assert.ok(qaAfter.findings.filter((f) => f.section === qFinding.section && f.type !== 'related').every((f) => f.decision && f.decision.kind === 'ours'), 'findings at the provision are covered by the decision');
    assert.equal(full.decisions.length, 1);
    assert.equal(full.decisions[0].docId, qaId);
    await shot(page, '14b-decision');
    // the company profile: an activity the company does not perform
    await page.evaluate(() => (location.hash = '#/settings'));
    await page.waitForSelector('#set-company');
    await page.click('#set-company label.seg-opt:has(input[name="act-narcotics"][value="no"])');
    await clearToasts(page);
    await page.click('#set-company button.btn-primary');
    await page.waitForSelector('.toast');
    assert.equal((await page.evaluate(() => window.api.company.get())).profile.activities.narcotics, 'no');
    await page.$eval('#set-company', (el) => el.scrollIntoView());
    await shot(page, '14c-company-profile');
    await page.evaluate((id) => (location.hash = `#/legislation/change/${id}`), fileCheckId);
    await page.waitForSelector('.aff');
    console.log("  ✓ company precedence: a deliberate difference recorded with a reason, company profile saved");

    // ---- Recheck after the SOP is updated ----
    const sopV2 = path.join(tmp, 'fixtures', 'SOP-QA-001_v4.txt');
    fs.writeFileSync(
      sopV2,
      'SOP-QA-001 Príjem a skladovanie liekov\nVerzia: 4\n3. Záznamy\nZáznamy o teplote sa uchovávajú 10 rokov v elektronickej podobe podľa § 18 ods. 1 písm. l) zákona č. 362/2011 Z. z.\nStiahnutie do 24 hodín podľa § 18 ods. 1 písm. k) zákona č. 362/2011 Z. z.'
    );
    await page.evaluate(([id, p]) => window.api.docs.addVersion(id, p, { version: '4' }), [byCode['SOP-QA-001'].id, sopV2]);
    await clearToasts(page);
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

    // ---- A scanned document (text only as a picture) is read by OCR in the background ----
    const scanPng = await app.evaluate(async ({ BrowserWindow }, lines) => {
      const w = new BrowserWindow({ show: false });
      await w.loadURL('data:text/html;charset=utf-8,<canvas id=c width=1240 height=1754></canvas>');
      const url = await w.webContents.executeJavaScript(`(() => { const c = document.getElementById('c'), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 1240, 1754); x.fillStyle = '#111'; x.font = '30px serif'; ${JSON.stringify(lines)}.forEach((l, i) => x.fillText(l, 110, 160 + i * 52)); return c.toDataURL('image/png'); })()`);
      w.destroy();
      return url;
    }, ['PHARMACOPOLA s.r.o.', 'ŠPP 31 Vzorová preprava chladených liekov', 'Verzia: 2     Dátum účinnosti: 1. 3. 2026', '', 'Termolabilné lieky sa prepravujú v chladiacich boxoch', 'pri teplote 2 – 8 °C s kalibrovaným dataloggerom.', 'Postup je v súlade s § 18 zákona č. 362/2011 Z. z.']);
    const scanPath = path.join(tmp, 'fixtures', 'ŠPP_31_2025_vzorová preprava.pdf');
    fs.writeFileSync(scanPath, await pdfOf(`<html><body style="margin:0"><img src="${scanPng}" style="width:210mm"></body></html>`));
    const scanDoc = await page.evaluate((p) => window.api.docs.import(p, {}), scanPath);
    assert.equal(scanDoc.code, 'ŠPP 31');
    assert.equal(scanDoc.current.ocr.status, 'pending', 'no text layer: waits for OCR');
    let scanned = null;
    for (let i = 0; i < 180; i++) {
      scanned = await page.evaluate((id) => window.api.docs.get(id), scanDoc.id);
      if (scanned.current.ocr.status !== 'pending') break;
      await page.waitForTimeout(500);
    }
    assert.equal(scanned.current.ocr.status, 'done', scanned.current.ocr.error || '');
    assert.equal(scanned.effectiveDate, '2026-03-01', 'dates read from the scan fill empty fields');
    const lieky = (await page.evaluate(() => window.api.laws.list())).find((l) => l.key === 'SK:362/2011');
    const scanText = (await page.evaluate((id) => window.api.docs.text(id), scanDoc.id)).map((p) => p.text).join('\n');
    assert.ok(scanned.citations.some((c) => c.lawId === lieky.id && c.sections.includes('§18')), `the scan is linked to the act and section it cites: ${JSON.stringify(scanned.citations)} / ${scanText}`);
    const hits = await page.evaluate(() => window.api.search.query('dataloggerom chladiacich', {}));
    assert.ok(hits.results.some((r) => r.docId === scanDoc.id), 'recognised text is searchable');
    await page.evaluate((id) => (location.hash = '#/documents/' + id), scanDoc.id);
    await page.waitForSelector('.doc-head');
    await shot(page, '15b-scanned-ocr');
    console.log('  ✓ scanned PDF: text recognised on this computer (OCR), searchable, dates filled in');

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

    // ---- Appearance and language: a click changes them at once, the window's own parts too ----
    await page.$eval('#set-me', (el) => el.scrollIntoView());
    const BG = { dark: 'rgb(10, 20, 28)', light: 'rgb(242, 245, 247)' };
    for (const th of ['dark', 'light', 'system']) {
      await page.click(`[data-action="setTheme"][data-theme="${th}"]`);
      await page.waitForFunction((x) => (document.documentElement.dataset.theme || 'system') === x && document.querySelector(`.seg-btn.on[data-theme="${x}"]`), th);
      if (BG[th]) assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), BG[th], `the page is ${th}`);
      const end = Date.now() + 10000;
      while ((await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)) !== th) {
        assert.ok(Date.now() < end, `the window's own parts are ${th}`);
        await page.waitForTimeout(100);
      }
      assert.equal((await page.evaluate(() => window.api.app.info())).settings.theme, th, 'remembered');
      if (th === 'dark') await shot(page, '16-appearance-dark');
    }
    assert.match(await page.textContent('#theme-hint'), /teraz je (svetlý|tmavý)/, '"like the system" says what the system shows now');
    await page.selectOption('#set-prefs [name=lang]', 'en');
    await page.waitForSelector('.page-head h1:has-text("Settings")');
    await page.selectOption('#set-prefs [name=lang]', 'sk');
    await page.waitForSelector('.page-head h1:has-text("Nastavenia")');
    console.log('  ✓ appearance (light, dark, like the system) and language change at once on a click');

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
    // Check for updates: only the list of published versions is read
    await page.click('button[data-action="checkUpdate"]');
    await page.waitForSelector('#upd-result .note-good:has-text("9.9.0")');
    const netUpd = await page.evaluate(() => window.api.app.networkLog());
    assert.ok(netUpd.some((e) => e.purpose === 'update' && e.url.endsWith('/releases')), 'the update check is in the network log');
    console.log('  ✓ check for updates: newer version shown, logged, nothing else sent');
    // One click: the file for this computer is downloaded and accepted only with the published fingerprint
    // (the tests stop before installing).
    lawSrv.tamperUpdate = true;
    await page.click('#upd-result button[data-action="installUpdate"]');
    await page.waitForSelector('#upd-progress.err:has-text("nezhoduje")');
    lawSrv.tamperUpdate = false;
    await page.click('#upd-result button[data-action="installUpdate"]');
    await page.waitForSelector('#upd-progress:has-text("stiahnutá a overená")');
    const netDl = await page.evaluate(() => window.api.app.networkLog());
    assert.ok(netDl.some((e) => e.purpose === 'update' && /\/download\/sop-archiv-v9\.9\.0\/SOP-Archiv-9\.9\.0-/.test(e.url)), 'the download is in the network log');
    console.log('  ✓ one-click update: the file for this computer downloaded; an altered file refused by its fingerprint');
    // What changed in each version is in the app, the version in use is marked
    const appVersion = require(path.join(ROOT, 'package.json')).version;
    await page.click('.ver-history summary');
    await page.waitForSelector(`.ver-history .ver-head:has-text("${appVersion}") .chip`);
    assert.ok((await page.$$('.ver-history .ver')).length >= 3, 'every version is listed');
    await page.$eval('#set-about', (el) => el.scrollIntoView());
    await shot(page, '16d-update-history');
    // Drawn again (a saved setting, a colleague's change): the page stays where it was
    await page.click('.ver-history summary'); // collapsed again: the page has its usual length
    await page.$eval('#set-archive', (el) => el.scrollIntoView());
    const before = await page.$eval('#main', (m) => m.scrollTop);
    assert.ok(before > 200, 'scrolled down');
    await page.evaluate(() => window.__app.rerender());
    await page.waitForFunction((b) => document.querySelector('#set-about') && Math.abs(document.getElementById('main').scrollTop - b) < 5, before);
    console.log('  ✓ a page drawn again keeps its place (no jump to the top)');
    console.log('  ✓ version history: what changed in every version, the one in use marked');

    // ---- Built-in AI: a model file from this computer, runs in a process without network ----
    const tinyModel = makeTinyModel(path.join(tmp, 'tiny-test-model.gguf'));
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, tinyModel);
    await page.$eval('#set-ai', (el) => el.scrollIntoView());
    await page.check('#ai-form input[name=provider][value=builtin]');
    await page.waitForSelector('#ai-form .model-list');
    await page.click('button[data-action="aiAddFile"]');
    await page.waitForSelector('#ai-form .model.chosen input[name=model][value="file:tiny-test-model.gguf"]:checked');
    assert.equal((await page.evaluate(() => window.api.app.info())).settings.ai.provider, 'builtin');
    await page.click('#ai-form button[data-action="aiTest"]');
    await page.waitForSelector('#ai-test .ai-text, #ai-test .err', { timeout: 120000 });
    assert.ok(await page.isVisible('#ai-test .ai-text'), 'test answer: ' + ((await page.textContent('#ai-test')) || '').trim());
    assert.ok(await page.isVisible('#ai-test .ok'), 'the AI process cannot reach the network');
    await page.$eval('#set-ai', (el) => el.scrollIntoView());
    await shot(page, '16c-builtin-ai');
    const aiNet = async () => (await page.evaluate(() => window.api.app.networkLog())).filter((e) => e.purpose === 'ai').length;
    const aiNetBefore = await aiNet();
    const viaBuiltin = await page.evaluate(([cid, did]) => window.api.changes.analyze(cid, did), [upcomingId, byCode['SOP-QA-001'].id]);
    assert.equal(viaBuiltin.ai[byCode['SOP-QA-001'].id].provider, 'builtin', 'the impact analysis ran on the built-in model');
    assert.equal(await aiNet(), aiNetBefore, 'the built-in AI makes no network requests');
    console.log('  ✓ built-in AI: model from a file, test answer, no network in the AI process, impact analysis on it');

    // ---- New document: template, the company's own process, the acts, AI draft, saved as a draft (Word) ----
    await page.evaluate((url) => window.api.app.setSettings({ ai: { provider: 'ollama', baseUrl: url, model: 'qwen2.5:7b' } }), `http://127.0.0.1:${ollama.address().port}`);
    await page.evaluate(() => window.__app.reloadInfo());
    await page.evaluate(() => (location.hash = '#/documents'));
    await page.click('a[href="#/compose"]');
    await page.waitForSelector('.compose #nd-title');
    assert.equal(await page.inputValue('.compose input[data-k="code"]'), 'ŠPP 32', 'the next free ŠPP number');
    await page.fill('#nd-title', 'Príjem a skladovanie termolabilných liekov');
    await page.fill('.compose textarea[data-input="description"]', 'Termolabilné lieky preberá skladník podľa dodacieho listu a záznamu z dataloggera. Skladovanie v chladiacich zariadeniach pri teplote 2 – 8 °C, teplotu sleduje monitorovací systém.');
    await page.click('button[data-action="suggest"]');
    await page.waitForSelector('.nd-laws .chip-good');
    assert.ok(await page.isChecked(`.nd-laws input[value="${lieky.id}"]`), 'the act on medicines is suggested for the topic');
    await page.click('#nd-all');
    await page.waitForFunction(() => !document.querySelector('#nd-stop') || document.querySelector('#nd-stop').hidden, null, { timeout: 60000 });
    const ch5 = await page.inputValue('.cmp-sec[data-i="4"] textarea');
    assert.match(ch5, /5\.1 Kontrola pri príjme/);
    assert.ok(ollama.drafts >= 9, 'every chapter drafted');
    assert.match(ollama.lastPrompt, /dataloggera/, "the company's own description is the basis");
    assert.match(ollama.lastPrompt, /NEVYKONÁVA: Omamné a psychotropné látky/, 'the company profile is given');
    assert.match(ollama.lastSystem, /má prednosť/);
    await page.$eval('.cmp-sec[data-i="4"]', (el) => el.scrollIntoView({ block: 'center' }));
    await shot(page, '21-new-document');
    await page.click('#nd-save');
    await page.waitForFunction(() => /#\/documents\/[\w-]+$/.test(location.hash), null, { timeout: 30000 });
    const newDoc = await page.evaluate(() => window.api.docs.get(decodeURIComponent(location.hash.split('/').pop())));
    assert.equal(newDoc.code, 'ŠPP 32');
    assert.equal(newDoc.status, 'draft');
    assert.equal(newDoc.type, 'ŠPP');
    assert.match(newDoc.current.fileName, /\.docx$/);
    const newText = (await page.evaluate((id) => window.api.docs.text(id), newDoc.id)).map((p) => p.text).join('\n');
    assert.match(newText, /Vypracoval/);
    assert.match(newText, /5\.1 Kontrola pri príjme/);
    assert.ok(newDoc.citations.some((c) => c.lawId === lieky.id), 'the new document cites the act');
    console.log('  ✓ new document: next code, acts suggested for the topic, AI draft from the company process, saved as a Word draft');

    // ---- Rewrite with AI: a proposal with the changes and reasons, kept with the document, exported to Word ----
    await page.evaluate((id) => (location.hash = `#/documents/${id}`), byCode['SOP-QA-001'].id);
    await page.waitForSelector('button[data-action="rewrite"]');
    await page.click('.head-actions button[data-action="rewrite"]');
    await page.waitForSelector('.rw #rw-passage');
    await page.click('.rw-pick summary');
    await page.fill('#rw-find', 'uchovávajú');
    await page.click('.rw-passages li:not([hidden]) .rw-p');
    assert.match(await page.inputValue('#rw-passage'), /uchovávajú/);
    await page.click('#rw-go');
    await page.waitForSelector('.rw .word-diff ins');
    assert.match(ollama.lastPrompt, /== UPRAVOVANÝ TEXT ==/);
    assert.match(ollama.lastPrompt, /§ 18/, 'the provisions the passage cites are given');
    await shot(page, '22-rewrite');
    await page.click('#rw-save');
    await page.waitForFunction(() => !document.querySelector('.rw'));
    await page.click('a.tab[href$="tab=proposals"]');
    await page.waitForSelector('.proposal .word-diff');
    const exportFile = path.join(tmp, 'navrh-zmien.docx');
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, exportFile);
    await page.click('button[data-action="exportProposals"]');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.toast')).some((x) => /navrh-zmien/.test(x.textContent)));
    const { extractFile } = require('../../src/main/lib/extract');
    const exported = (await extractFile(exportFile)).pages.map((p) => p.text).join('\n');
    assert.match(exported, /Navrhované znenie/);
    assert.match(exported, /10 rokov/);
    await shot(page, '23-proposals');
    console.log('  ✓ rewrite with AI: changes and reasons shown, proposal kept with the document, exported to Word');

    // ---- Training: employees, who must know a document, a training session ----
    const readerUser = (await page.evaluate(() => window.api.users.list())).find((u) => u.name === READER.name);
    await page.evaluate(() => (location.hash = '#/training'));
    await page.waitForSelector('.training button[data-action="addPerson"]');
    await page.click('.training button[data-action="addPerson"]');
    await page.fill('.modal [name=name]', READER.name);
    await page.selectOption('.modal [name=department]', { index: 3 }); // the warehouse (3rd default department)
    await page.fill('.modal [name=position]', 'skladníčka');
    await page.selectOption('.modal [name=userId]', readerUser.id);
    await page.click('.modal-foot .btn-primary');
    await page.waitForSelector(`.training td:has-text("${READER.name}")`);
    const warehouse = (await page.evaluate(() => window.api.people.list()))[0].department;
    // who must know which document: set in the document's edit dialog
    await page.evaluate((id) => (location.hash = `#/documents/${id}`), byCode['SOP-QA-001'].id);
    await page.click('.head-actions button[data-action="edit"]');
    await page.check(`.modal [data-tf="${warehouse}"]`);
    await page.click('.modal-foot .btn-primary');
    await page.waitForFunction((id) => window.api.docs.get(id).then((d) => d.trainingFor.length === 1), byCode['SOP-QA-001'].id).catch(() => {});
    await page.evaluate((id) => window.api.docs.update(id, { trainingFor: ['*'] }), byCode['SOP-SK-002'].id);
    await page.evaluate(() => (location.hash = '#/training'));
    await page.waitForSelector('.training .tr-bar');
    assert.equal((await page.evaluate(() => window.api.training.overview())).missing, 2);
    await page.click(`.training tr:has-text("SOP-QA-001") button[data-action="record"]`);
    await page.waitForSelector('.tr-form [data-person]:checked');
    await page.fill('.tr-form [name=trainer]', 'QA manažér');
    await page.click('.modal-foot .btn-primary');
    await until(page, () => window.api.training.overview().then((o) => o.missing === 1), 'training recorded');
    await shot(page, '24-training');
    console.log('  ✓ training: employee linked to a profile, who must know a document, a training session recorded');

    // ---- Approval with signatures (own password), controlled copy with a stamp ----
    await page.evaluate((id) => (location.hash = `#/documents/${id}`), newDoc.id);
    await page.click('.head-actions button[data-action="aprRequest"]');
    const adminUser = (await page.evaluate(() => window.api.auth.state())).users.find((u) => u.name === ADMIN.name);
    await page.check(`.modal [data-apr="${adminUser.id}"]`);
    await page.fill('.modal [name=note]', 'Prvé vydanie');
    await page.click('.modal-foot .btn-primary');
    await page.waitForSelector('.apr-banner button[data-action="aprSign"]');
    await page.click('.apr-banner button[data-action="aprSign"]');
    await page.fill('#apr-pw', 'zle-heslo');
    await page.click('.modal-foot .btn-primary');
    await page.waitForSelector('#apr-sign-err:has-text("Nesprávne heslo")');
    await page.fill('#apr-pw', ADMIN.password);
    await page.click('.modal-foot .btn-primary');
    await until(page, (id) => window.api.docs.get(id).then((d) => d.status === 'effective'), 'approved and effective', newDoc.id);
    const approved = await page.evaluate((id) => window.api.docs.get(id), newDoc.id);
    assert.equal(approved.approver, ADMIN.name);
    assert.equal(approved.approvals[0].steps[0].decision, 'approved');
    // a controlled copy of the scanned PDF, stamped
    const copyFile = path.join(tmp, 'riadena-kopia.pdf');
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, copyFile);
    await page.evaluate((id) => (location.hash = `#/documents/${id}?tab=control`), scanDoc.id);
    await page.click('button[data-action="cpIssue"]');
    await page.fill('.modal [name=issuedTo]', 'Sklad – vedúci skladu');
    await page.check('.modal [name=format][value=pdf]');
    await page.click('.modal-foot .btn-primary');
    await page.waitForSelector('.table td:has-text("Sklad – vedúci skladu")');
    const { extractFile: readPdf } = require('../../src/main/lib/extract');
    assert.match((await readPdf(copyFile)).pages.map((p) => p.text).join('\n'), /RIADENÁ KÓPIA č\. 1/);
    // A PDF opened or saved from the archive is marked as an uncontrolled copy on every page.
    const freeCopy = path.join(tmp, 'neriadena-kopia.pdf');
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, freeCopy);
    await page.evaluate((id) => window.api.docs.saveCopy(id), scanDoc.id);
    const freeText = (await readPdf(freeCopy)).pages.map((p) => p.text).join('\n');
    assert.match(freeText, /NERIADENÁ KÓPIA/);
    assert.match(freeText, /Platná len v deň tlače/);
    await shot(page, '26-controlled-copy');
    console.log('  ✓ approval signed with the own password makes the version effective; controlled copy stamped on every page; other copies marked uncontrolled');

    // ---- Signature sheet: the electronic signature on it, an employee without the app signs by hand ----
    // (another department than the reader's, so the reading list checked later stays as it is)
    const transport = (await page.evaluate(() => window.__app.info.archiveSettings.departments)).find((d) => d !== warehouse && /doprav|transport/i.test(d));
    const skladnik = await page.evaluate((dep) => window.api.people.save({ name: 'Ján Skladník', department: dep, position: 'vodič' }), transport);
    await page.evaluate(([id, dep]) => window.api.docs.update(id, { trainingFor: [dep] }), [newDoc.id, transport]);
    await page.evaluate((id) => (location.hash = `#/documents/${id}?tab=control`), newDoc.id);
    await page.click('button[data-action="shPrint"]');
    await page.waitForSelector('.modal .sh-form:has-text("ešte nepotvrdili oboznámenie (1)")');
    const sheetFile = path.join(tmp, 'podpisovy-harok.pdf');
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, sheetFile);
    await page.click('.modal-foot button:has-text("Uložiť PDF")');
    await page.waitForSelector('.toast:has-text("podpisovy-harok.pdf")');
    const sheetText = (await readPdf(sheetFile)).pages.map((p) => p.text).join('\n').replace(/\s+/g, ' ');
    for (const s of ['PODPISOVÝ HÁROK', `Schválil(a) ${ADMIN.name}`, 'elektronicky (heslom)', 'Ján Skladník', 'Svojím podpisom potvrdzujem']) assert.ok(sheetText.includes(s), `signature sheet: ${s}`);
    // The signed paper comes back, with its scan.
    const scanFile = path.join(tmp, 'sken-harku.pdf');
    fs.copyFileSync(sheetFile, scanFile);
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, scanFile);
    await clearToasts(page);
    await page.click('button[data-action="shRecord"]');
    await page.check(`.modal [data-person="${skladnik.id}"]`);
    await page.click('#sh-pick');
    await page.waitForSelector('#sh-file:has-text("sken-harku.pdf")');
    await page.click('.modal-foot .btn-primary');
    await page.waitForSelector('.sh-table td:has-text("Ján Skladník")');
    await page.waitForSelector('.sh-table button[data-action="shOpenScan"]');
    const sheetTr = await page.evaluate((id) => window.api.training.doc(id), newDoc.id);
    assert.equal(sheetTr.rows.find((r) => r.person.id === skladnik.id).record.method, 'signed', 'acknowledged by the signature on the sheet');
    await shot(page, '26b-signature-sheet');
    console.log('  ✓ signature sheet: electronic signatures on it, an employee without the app pre-filled; the signed sheet recorded with its scan');
    // ---- Authority notices: recalls to assess, watched product names, a product watched in the EU database ----
    await page.evaluate(() => (location.hash = '#/settings'));
    await page.fill('textarea[name=watchTerms]', 'Imaginex\nIný výrobok');
    await page.fill('textarea[name=updWatch]', 'https://medicines.health.europa.eu/veterinary/sk/600000012345');
    await page.click('form[data-submit="saveCompany"] button.btn-primary');
    await page.waitForSelector('.toast:has-text("Profil spoločnosti uložený")');
    await clearToasts(page);
    await page.evaluate(() => (location.hash = '#/notices'));
    await page.waitForSelector('.notices button[data-action="check"]');
    await page.click('.notices button[data-action="check"]');
    await page.waitForSelector('.toast:has-text("nových: 5")');
    await page.waitForSelector('.nt-card:has-text("Fiktivol")');
    const nt = await page.evaluate(() => window.api.notices.list());
    assert.equal(nt.counts.toAssess, 3, 'two recalls and the watched product; the old recall and the office hours are not counted');
    assert.equal(nt.items.find((n) => n.title.includes('Starý')).handled.outcome, 'baseline');
    await page.waitForSelector('.nt-card:has-text("Imaginex") .nt-watch');
    await page.waitForSelector('#nav a[href="#/notices"] .badge:has-text("3")');
    await page.click('.nt-card:has-text("Fiktivol") button[data-outcome="done"]');
    await page.waitForSelector('.modal:has-text("Váš postup:") a:has-text("SOP-SK-002")');
    await page.click('.modal-foot .btn-primary');
    await page.waitForSelector('.toast:has-text("Opíšte vykonané opatrenia")');
    await page.fill('.modal [name=note]', 'Šarža A123 – 20 bal. v karanténe, 2 odberatelia informovaní.');
    await page.click('.modal-foot .btn-primary');
    await until(page, () => window.api.notices.counts().then((c) => c.toAssess === 2), 'recall assessed');
    await page.click('.nt-tabs button[data-f="all"]');
    await page.waitForSelector('.nt-card:has-text("Fiktivol") .nt-handled:has-text("20 bal. v karanténe")');
    await shot(page, '27-notices');
    const netNt = (await page.evaluate(() => window.api.app.networkLog())).filter((e) => e.purpose === 'notices');
    assert.equal(netNt.length, 9, 'eight public pages of five authorities and the page of the watched product');
    assert.ok(netNt.every((e) => e.url.startsWith(lawBase)), 'only the (test) authority sites');
    assert.deepEqual(nt.watched.map((w) => [w.name, w.authStatus, w.authorisedSk]), [['FIKTIVET 50 mg tablety pre psy', 'Valid', true]], 'the first reading of the product is remembered');
    // The product's authorisation is suspended: the next check shows it as a notice to assess.
    lawSrv.updSuspended = true;
    await clearToasts(page);
    await page.click('.notices button[data-action="check"]');
    await page.waitForSelector('.toast:has-text("nových: 1")');
    await page.waitForSelector('.nt-card:has-text("EÚ databáza – FIKTIVET 50 mg tablety pre psy: stav registrácie: Valid → Suspended") .nt-watch');
    assert.equal((await page.evaluate(() => window.api.notices.counts())).toAssess, 3);
    await page.click('.notices details.how summary');
    await page.waitForSelector('.nt-watched li:has-text("FIKTIVET 50 mg"):has-text("Suspended")');
    await shot(page, '27b-notices-sources');
    await page.evaluate(() => (location.hash = '#/dashboard'));
    await page.waitForSelector('.panel:has-text("Oznamy úradov na posúdenie") .row:has-text("Imaginex")');
    await page.waitForSelector('.panel:has-text("Oznamy úradov na posúdenie") .row:has-text("EÚ UPD")');
    console.log('  ✓ authority notices (ŠÚKL, ÚŠKVBL, MZ SR, SOOL, ÚSKVBL ČR): read from the public pages only, recall assessed with measures, watched product highlighted');
    console.log('  ✓ EU database: a watched product’s page read, a suspended authorisation shown as a notice to assess');

    // ---- Inspection report: PDF and Excel ----
    for (const format of ['pdf', 'xlsx']) {
      const out = path.join(tmp, `sprava.${format}`);
      await app.evaluate(({ dialog }, p) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
      }, out);
      await clearToasts(page);
      await page.click('.head-actions button[data-action="inspectionReport"]');
      await page.waitForSelector('.modal .rep-form');
      await page.check(`.modal [name=format][value=${format}]`);
      await page.click('.modal-foot .btn-primary');
      await page.waitForSelector('.toast:has-text("Správa uložená")');
      const text = (await readPdf(out)).pages.map((p) => p.text).join('\n');
      for (const re of [/SOP-QA-001/, /Fiktivol/, /Šarža A123/, /Juraj\s+Gregus/, /platí dokument\s+spoločnosti/]) assert.match(text, re, `${format}: ${re}`);
      if (format === 'pdf') {
        assert.match(text, /Správa o riadenej dokumentácii/);
        assert.match(text, /Oznamy úradov o stiahnutí liekov, zmeny sledovaných liekov a ich posúdenie/);
        fs.copyFileSync(out, path.join(OUT, 'inspection-report.pdf'));
      }
    }
    const repAudit = await page.evaluate(() => window.api.app.audit({ limit: 20 }));
    assert.ok(repAudit.filter((x) => x.action === 'report.exported').length === 2, 'both reports in the audit trail');
    console.log('  ✓ inspection report: PDF (A4 landscape) and Excel with register, reviews, legislation, decisions, training, approvals, copies and recall assessments');

    // ---- Delete a document, then empty the trash for good ----
    const pp07 = (await page.evaluate(() => window.api.docs.list())).find((d) => d.code === 'PP-07');
    await page.evaluate((id) => (location.hash = `#/documents/${id}`), pp07.id);
    await page.click('.head-actions button[data-action="remove"]');
    await page.click('.modal-foot .btn-danger');
    await page.waitForSelector('.toast:has-text("Napíšte dôvod odstránenia")');
    await page.fill('#del-reason', 'Omylom importovaný súbor.');
    await page.click('.modal-foot .btn-danger');
    // Second step: a separate confirmation; "Cancel" there keeps the document.
    await page.waitForSelector('.modal:has-text("Posledné potvrdenie")');
    await page.click('.modal-foot .btn-danger');
    await page.waitForSelector('.toast:has-text("Dokument bol odstránený")'); // shown when the deletion is saved and in the audit trail
    assert.ok(!(await page.evaluate(() => window.api.docs.list())).some((d) => d.id === pp07.id), 'document deleted');
    const delAudit = (await page.evaluate(() => window.api.app.audit({ limit: 30 }))).find((x) => x.action === 'doc.deleted');
    assert.equal(delAudit && delAudit.reason, 'Omylom importovaný súbor.', 'the deletion and its reason are in the audit trail');
    // A document with training records, signatures and reviews cannot be deleted – only withdrawn.
    const qa1 = (await page.evaluate(() => window.api.docs.list())).find((d) => d.code === 'SOP-QA-001');
    await page.evaluate((id) => (location.hash = `#/documents/${id}`), qa1.id);
    await page.click('.head-actions button[data-action="remove"]');
    await page.waitForSelector('.modal:has-text("Dokument sa nedá odstrániť") li:has-text("záznamy o školení")');
    await page.click('.modal-foot button:has-text("Zavrieť")');
    await assert.rejects(() => page.evaluate((id) => window.api.docs.delete(id, 'Pokus o obídenie'), qa1.id), /nedá odstrániť/, 'the app core refuses it too');
    await page.evaluate(() => (location.hash = '#/settings'));
    await page.waitForSelector('.trash-row:has-text("1 odstránených")');
    await page.click('.trash-row button[data-action="emptyTrash"]');
    await page.click('.modal-foot .btn-danger');
    await page.waitForSelector('.modal:has-text("Posledné potvrdenie")');
    await page.click('.modal-foot .btn-danger');
    await page.waitForSelector('.trash-row:has-text("Kôš je prázdny")');
    assert.deepEqual(fs.readdirSync(path.join(tmp, 'archive', 'trash')), []);
    console.log('  ✓ delete a document (administrator), then empty the trash: its files are gone for good');

    // ---- Audit trail: filters an inspector needs, export of exactly what is filtered ----
    await page.evaluate(() => (location.hash = '#/audit'));
    await page.waitForSelector('.audit .au-table');
    await page.selectOption('.au-filters [name=docId]', qa1.id);
    await page.check('.au-filters [name=changesOnly]');
    await until(page, () => Array.from(document.querySelectorAll('.au-table tbody tr td:nth-child(4)')).every((td) => td.textContent.includes('SOP-QA-001')) && !document.querySelector('.au-table').textContent.includes('Dokument otvorený'), 'only changes of SOP-QA-001');
    const auRows = await page.$$eval('.au-table tbody tr', (trs) => trs.length);
    assert.ok(auRows >= 3, `changes of SOP-QA-001 listed (${auRows})`);
    await shot(page, '28-audit');
    for (const format of ['pdf', 'xlsx']) {
      const out = path.join(tmp, `audit.${format}`);
      await app.evaluate(({ dialog }, p) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
      }, out);
      await clearToasts(page);
      await page.click(`.audit button[data-action="${format === 'pdf' ? 'exportPdf' : 'exportXlsx'}"]`);
      await page.waitForSelector('.toast:has-text("uložená")');
      const text = (await readPdf(out)).pages.map((p) => p.text).join('\n');
      assert.match(text, /SOP-QA-001/, `${format}: the document`);
      assert.match(text, /Dokument: SOP-QA-001/, `${format}: the filter is printed`);
      assert.match(text, /Juraj\s+Gregus/, `${format}: who`);
    }
    const auExp = (await page.evaluate(() => window.api.audit.query({ area: 'archive' }))).rows.find((r) => r.action === 'audit.exported');
    assert.equal(auExp.filter.docId, qa1.id, 'the export and its filter are themselves in the audit trail');
    console.log('  ✓ audit trail: filtered by document and changes only, exported to PDF and Excel with the filter printed');

    // ---- Readable export of the whole archive (for an audit; opens without the app) ----
    const exportParent = path.join(tmp, 'pre-audit');
    fs.mkdirSync(exportParent);
    await app.evaluate(({ dialog, shell }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
      shell.openPath = async () => '';
    }, exportParent);
    await page.evaluate(() => (location.hash = '#/settings'));
    await clearToasts(page);
    await page.click('button[data-action="exportAll"]');
    await page.waitForSelector('.modal .ex-form');
    await page.click('.modal-foot .btn-primary');
    await page.waitForSelector('.toast:has-text("Export je hotový")', { timeout: 120000 });
    const [expDir] = fs.readdirSync(exportParent).map((d) => path.join(exportParent, d));
    const expFiles = [];
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : expFiles.push(path.relative(expDir, path.join(d, e.name)));
    })(expDir);
    for (const f of ['ČÍTAJ MA.txt', 'Register dokumentov.xlsx', 'Správa o dokumentácii.pdf', 'Správa o dokumentácii.xlsx', 'Auditný záznam.xlsx']) assert.ok(expFiles.includes(f), `export contains ${f}`);
    const expDocs = expFiles.filter((f) => f.startsWith('Dokumenty'));
    assert.ok(expDocs.length >= 6, `document files exported (${expDocs.length})`);
    const expQa = expDocs.find((f) => /SOP-QA-001/.test(f) && !/\(stará\)/.test(f));
    assert.ok(expQa, 'the valid version of SOP-QA-001 is there');
    const auditX = (await readPdf(path.join(expDir, 'Auditný záznam.xlsx'))).pages.map((p) => p.text).join('\n');
    assert.match(auditX, /Dokument odstránený/, 'the whole audit trail, in words');
    console.log('  ✓ readable export: every document as an ordinary file, register, report and the audit trail – for an auditor, without the app');

    // ---- Help: the SOP for using the app – read in the app, saved as Word, added to the archive as a draft ----
    await page.click('a.side-help');
    await page.waitForSelector('.sop-doc h2:has-text("Používanie aplikácie SOP Archív")');
    assert.equal((await page.$$('.sop-doc mark')).length, 0, 'nothing left to fill in');
    await page.waitForSelector('.sop-doc li:has-text("postupuje podľa SOP-SK-002 Reklamácie, vratky a stiahnutie liekov z trhu")'); // the company's own recall SOP
    await shot(page, '29-help-sop');
    const sopFile = path.join(OUT, 'SOP-SA-01 Používanie aplikácie SOP Archív.docx');
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, sopFile);
    await clearToasts(page);
    await page.click('.help button[data-action="saveWord"]');
    await page.waitForSelector('.toast:has-text("SOP-SA-01")');
    const sopText = (await readPdf(sopFile)).pages.map((p) => p.text).join('\n');
    assert.match(sopText, /Používanie aplikácie SOP Archív na riadenie dokumentácie/);
    assert.match(sopText, /5\.12 Auditný záznam, inšpekcia a audit/);
    assert.doesNotMatch(sopText, /\[DOPLNIŤ/, 'complete, no places to fill in');
    await page.click('.help button[data-action="addDraft"]');
    await page.waitForSelector('.page-head:has-text("SOP-SA-01")');
    const sopDoc = (await page.evaluate(() => window.api.docs.list())).find((d) => d.code === 'SOP-SA-01');
    assert.equal(sopDoc.status, 'draft', 'added as a draft, to be approved like any SOP');
    console.log('  ✓ help: the SOP for using the app – shown in the app, saved as Word, added to the archive as a draft');

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
    // "read and understood", confirmed with the employee's own password
    await page.click('a.nav-item[href="#/training"]');
    await page.waitForSelector('.training button[data-action="confirmRead"]');
    assert.equal(await page.textContent('a.nav-item[href="#/training"] .badge'), '1', 'one document to read');
    await page.click('.training button[data-action="confirmRead"]');
    await page.fill('#tr-pw', 'zle-heslo');
    await page.click('.modal-foot .btn-primary');
    await page.waitForSelector('#tr-pw-err:has-text("Nesprávne heslo")');
    await page.fill('#tr-pw', READER.password);
    await page.click('.modal-foot .btn-primary');
    await page.waitForSelector('.training .panel:not(.panel-warn) p:has-text("prečítané")');
    const ovRead = await page.evaluate(() => window.api.training.overview());
    assert.equal(ovRead.people.find((p) => p.name === READER.name).missing.length, 0, 'the reader has read everything');
    assert.deepEqual(ovRead.people.filter((p) => p.missing.length).map((p) => [p.name, p.missing.map((d) => d.code)]), [['Ján Skladník', ['SOP-SK-002']]], 'only the employee without the app, who signs on paper');
    await shot(page, '25-read-confirmed');
    const audit2 = await page.evaluate(() => window.api.app.audit({ limit: 20 }));
    assert.ok(audit2.some((r) => r.action === 'auth.failed'), 'failed sign-in is audited');
    await signOut(page);
    await signIn(page, ADMIN);
    console.log('  ✓ profiles: reader cannot change anything (UI and core), wrong password rejected and audited; reading confirmed with the own password');

    // ---- A second computer opens the same archive: both work at the same time ----
    const PETER = { name: 'Peter Novák', password: 'Docasne-heslo-1', next: 'Peter-vlastne-2' };
    // The warehouse computer has an English system (as on the Windows test machines): the archive is still in Slovak.
    app2 = await launch(tmp, 'userdata-pc2', 'PC-SKLAD', 'en_US.UTF-8');
    const page2 = await app2.firstWindow();
    watch(page2);
    await page2.setViewportSize({ width: 1360, height: 860 });
    await signIn(page2, READER);
    const info2 = await page2.evaluate(() => window.api.app.info());
    assert.ok(!info2.readOnly, 'the second computer can work too (no read-only mode)');
    assert.ok(await page2.isVisible('#brand-logo img'), 'the second computer shows the logo too');
    // Each computer sees who else is working.
    await until(page, () => window.api.app.presence().then((p) => p.some((x) => x.name === 'Eva Nováková' && x.host === 'PC-SKLAD')), 'PC-QA sees Eva on PC-SKLAD');
    await page.evaluate(() => window.__app.refreshSidebar());
    await page.waitForSelector('#side-presence:has-text("Eva Nováková")');
    // A new colleague (editor) is added on the first computer; the second computer knows them within seconds.
    await page.evaluate((u) => window.api.users.create({ name: u.name, role: 'editor', password: u.password }), PETER);
    await until(page2, () => window.api.auth.state().then((s) => s.users.some((u) => u.name === 'Peter Novák')), 'PC-SKLAD knows Peter');
    await signOut(page2);
    await signIn(page2, PETER);
    assert.equal((await page2.evaluate(() => window.api.app.info())).settings.lang, 'sk', 'a new colleague sees the company\'s language, whatever the language of their Windows');
    // Both change the same document at the same moment – different things; nothing is lost.
    const sk2 = byCode['SOP-SK-002'].id;
    await Promise.all([
      page.evaluate((id) => window.api.docs.markReviewed(id, { outcome: 'no-change', notes: 'Revízia z PC-QA' }), sk2),
      page2.evaluate((id) => window.api.docs.update(id, { notes: 'Poznámka od Petra' }), sk2)
    ]);
    await until(page, (id) => window.api.docs.get(id).then((d) => d.notes === 'Poznámka od Petra' && d.reviews.some((r) => r.notes === 'Revízia z PC-QA')), 'PC-QA has both changes', sk2);
    await until(page2, (id) => window.api.docs.get(id).then((d) => d.notes === 'Poznámka od Petra' && d.reviews.some((r) => r.notes === 'Revízia z PC-QA')), 'PC-SKLAD has both changes', sk2);
    // Two people edit the details of one document from the same starting point: the second one is stopped, not overwritten.
    const seen = (await page.evaluate((id) => window.api.docs.get(id), sk2)).updatedAt;
    await page2.evaluate((id) => window.api.docs.update(id, { owner: 'Vedúci skladu' }), sk2);
    await until(page, (id) => window.api.docs.get(id).then((d) => d.owner === 'Vedúci skladu'), 'PC-QA sees the new owner', sk2);
    const conflict = await page.evaluate(([id, exp]) => window.api.docs.update(id, { owner: 'Niekto iný' }, exp).then(() => 'saved', (e) => e.message), [sk2, seen]);
    assert.match(conflict, /Peter Novák.*medzitým|medzitým zmenil/, 'a stale edit is refused and says who changed it');
    assert.equal((await page.evaluate((id) => window.api.docs.get(id), sk2)).owner, 'Vedúci skladu', 'Peter\'s change was kept');
    // The name of who changed it is shown with the document.
    await page.evaluate((id) => (location.hash = `#/documents/${id}`), sk2);
    await page.waitForSelector('.panel:has-text("Naposledy zmenil(a)"):has-text("Peter Novák")');
    await page2.evaluate((id) => (location.hash = `#/documents/${id}`), sk2);
    await page2.waitForSelector('.panel:has-text("Naposledy zmenil(a)")');
    await shot(page2, '19-second-computer');
    // The audit trail has both computers and both people, and its chain is intact.
    const both = (await page.evaluate((id) => window.api.audit.query({ docId: id, changesOnly: true }), sk2)).rows;
    assert.ok(both.some((r) => r.host === 'PC-SKLAD' && r.user === 'Peter Novák') && both.some((r) => r.host === 'PC-QA'), 'who and on which computer');
    assert.equal((await page.evaluate(() => window.api.audit.integrity())).ok, true, 'audit trail chain intact');
    // The first computer closes; the second keeps working without any take-over.
    await signOut(page2);
    await signIn(page2, ADMIN);
    await app.close();
    app = null;
    assert.equal(await page2.evaluate((id) => window.api.docs.update(id, { notes: 'Zmena z PC2' }).then(() => 'ok'), sk2), 'ok');
    console.log('  ✓ shared archive: two computers change it at the same time, see each other\'s changes with names, a stale edit is refused');

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

    // ---- All administrators forgot their password: the recovery code restores access ----
    const NEW_ADMIN_PW = 'Nove-heslo-2027';
    await signOut(page);
    await page.click('#go-recover');
    await page.fill('#recover-form [name=code]', 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF');
    await page.fill('#recover-form [name=pw]', NEW_ADMIN_PW);
    await page.fill('#recover-form [name=pw2]', NEW_ADMIN_PW);
    await page.click('#recover-form button[type=submit]');
    await page.waitForFunction(() => (document.querySelector('#login-err') || {}).textContent);
    await page.fill('#recover-form [name=code]', recoveryCode.toLowerCase().replace(/-/g, ' '));
    await page.click('#recover-form button[type=submit]');
    await page.waitForSelector('#nav .nav-item');
    assert.equal((await page.evaluate(() => window.api.app.info())).session.name, ADMIN.name);
    await signOut(page);
    await page.click(`.profile:has-text("${ADMIN.name}")`);
    await page.fill('#login-pw', ADMIN.password);
    await page.click('#login-form button[type=submit]');
    await page.waitForFunction(() => (document.querySelector('#login-err') || {}).textContent, null, { timeout: 15000 });
    await signIn(page, { name: ADMIN.name, password: NEW_ADMIN_PW });
    console.log('  ✓ recovery code: wrong code refused, right code sets a new administrator password');

    // ---- Data on disk: encrypted, nothing readable without signing in ----
    const dataDir = path.join(tmp, 'archive');
    const words = ['Reklamácie', 'karantén', 'Príjem a skladovanie', 'termolabil', ADMIN.password, READER.password, NEW_ADMIN_PW];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    let checked = 0;
    for (const f of walk(dataDir)) {
      const rel = path.relative(dataDir, f);
      if (rel === '.sop-archiv.lock' || rel.startsWith('branding')) continue;
      const txt = fs.readFileSync(f).toString('utf8');
      for (const w of words) if (w !== READER.name) assert.ok(!txt.includes(w), `${rel} contains "${w}"`);
      if (rel !== 'keyring.json') assert.ok(!/Reklam|Prijem|SOP-QA/i.test(path.basename(f)), `file name ${rel} shows a title`);
      checked++;
    }
    assert.ok(checked > 20);
    assert.equal(fs.readFileSync(path.join(dataDir, 'archive.json')).subarray(0, 7).toString('latin1'), 'SOPARC1', 'archive.json is encrypted');
    const keyring = JSON.parse(fs.readFileSync(path.join(dataDir, 'keyring.json'), 'utf8'));
    assert.deepEqual(keyring.users.map((u) => u.name).sort(), [READER.name, ADMIN.name, 'Peter Novák'].sort());
    const auditFiles = fs.readdirSync(path.join(dataDir, 'audit'));
    assert.equal(auditFiles.length, 2, 'one audit file per computer');
    for (const f of auditFiles) assert.ok(fs.readFileSync(path.join(dataDir, 'audit', f), 'utf8').split('\n').filter(Boolean).every((l) => l.startsWith('E1:')), 'audit log lines are encrypted');
    const auditRows = await page.evaluate(() => window.api.app.audit({ limit: 500 }));
    assert.ok(auditRows.some((r) => r.action === 'doc.reviewed') && auditRows.some((r) => r.action === 'auth.recovered'), 'the app still reads its audit log');
    console.log(`  ✓ archive folder encrypted: ${checked} files, no document text, titles or passwords readable`);

    const real = errors.filter((e) => !/favicon|Autofill/i.test(e));
    assert.deepEqual(real, [], 'no renderer errors');
    console.log(`\nAll e2e checks passed. Screenshots: ${OUT}`);
  } catch (e) {
    // Leave evidence for CI: a screenshot and any message the app showed.
    for (const [i, p] of watched.entries()) {
      if (p.isClosed()) continue;
      await p.screenshot({ path: path.join(OUT, `zz-failure-${i + 1}.png`) }).catch(() => {});
      const shown = await p
        .evaluate(() => ({
          at: location.hash,
          messages: [...document.querySelectorAll('.modal .err, #login-err, .toast')].map((x) => x.textContent.trim()).filter(Boolean),
          main: ((document.getElementById('main') || {}).innerText || '').replace(/\s+/g, ' ').slice(0, 400)
        }))
        .catch(() => null);
      if (shown) console.error(`Window ${i + 1} on screen:`, shown);
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
  if (appLog.length) console.error('--- the app reported (last lines) ---\n' + appLog.slice(-80).join('\n'));
  process.exit(1);
});
