'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const N = require('../../src/main/lib/notices');
const { NoticesMonitor, allowedUrl } = require('../../src/main/notices');
const { Archive } = require('../../src/main/archive');
const { activityHints } = require('../../src/main/lib/company');
const P = require('../fixtures/notices-pages');

const R = '/pre-odbornikov-a-firmy/dostupnost-a-kvalita-liekov/kvalita-liekov/oznamy-o-stiahnuti-liekov';

test('parsers: ŠÚKL RSS, ÚŠKVBL dated notices and the list of new legislation', () => {
  const rss = P.suklRss('Aktuality', [
    { title: 'Stiahnutie lieku Fiktivol 10 mg z trhu', path: `${R}/stiahnutie-fiktivol`, date: '2026-09-25', summary: 'Šarže A1, A2.' },
    { title: 'MSC: Imaginex (tablety): prerušenie dodávky liekov', path: '/pre-odbornikov-a-firmy/dostupnost-a-kvalita-liekov/dostupnost-liekov/msc-imaginex', date: '2026-09-01' },
    { title: 'Závery z Výboru pre hodnotenie rizík liekov (PRAC)', path: '/pre-odbornikov-a-firmy/bezpecnost-liekov/informacie-z-prac/zavery', date: '2026-09-04' },
    { title: 'Usmernenie pre držiteľov povolenia na veľkodistribúciu', path: '/pre-odbornikov-a-firmy/usmernenie-vd', date: '2026-08-03' },
    { title: 'Konferencia 2026: Pozvánka (zmeny v legislatíve)', path: '/o-nas/podujatia-a-udalosti/konferencia', date: '2026-09-02' },
    { title: 'Dňa 15. 9. 2026 bude podateľňa zatvorená', path: '/oznamy/podatelna', date: '2026-09-07' }
  ]);
  const items = N.parseSource(N.sources()[1], rss);
  assert.deepEqual(
    items.map((i) => [i.date, i.category]),
    [
      ['2026-09-25', 'recall'],
      ['2026-09-01', 'availability'],
      ['2026-09-04', 'safety'],
      ['2026-08-03', 'legislation'],
      ['2026-09-02', 'other'],
      ['2026-09-07', 'other']
    ]
  );
  assert.equal(items[0].link, `https://www.sukl.sk${R}/stiahnutie-fiktivol`);
  assert.equal(items[0].summary, 'Šarže A1, A2.');

  const html = P.uskvblNotices([
    { title: 'Oznámenie o zákaze dodávania veterinárneho lieku FIKTIVET 10 mg tablety', file: 'zakaz.docx', date: '2026-06-26' },
    { title: 'Oznámenie pre veľkodistribútorov o dopredaji veterinárneho lieku – Imaginvet', file: 'dopredaj.docx', date: '2022-12-14' },
    { title: 'Rozhodnutie o zrušení registrácie – Vymyslín premix', file: 'zrusenie.pdf', date: '2022-03-17' }
  ]);
  const u = N.parseSource(N.sources()[2], html);
  assert.deepEqual(
    u.map((i) => [i.date, i.category]),
    [
      ['2026-06-26', 'recall'],
      ['2022-12-14', 'availability'],
      ['2022-03-17', 'availability']
    ],
    'menus and the footer are left out; each link gets the date above it'
  );
  assert.equal(u[0].link, 'https://www.uskvbl.sk/wp-content/uploads/zakaz.docx');

  const leg = N.parseSource(N.sources()[3], P.uskvblLegislation([{ title: 'NARIADENIE (EÚ) 2019/6 o veterinárnych liekoch', file: 'r2019-6.pdf' }]));
  assert.deepEqual(leg.map((i) => [i.title, i.category, i.date]), [['NARIADENIE (EÚ) 2019/6 o veterinárnych liekoch', 'legislation', null]]);

  // Ministry of Health: the monthly list of categorised medicines – menus left out, the published date read,
  // the list "for information" and the valid one at the same address are two notices.
  const mzHtml = P.mzList('Zoznam kategorizovaných liekov', [
    { title: 'Zoznam kategorizovaných liekov 1.11.2026 – 30.11.2026 – INFORMATÍVNY MATERIÁL', slug: 'lieky202611', date: '2026-09-30' },
    { title: 'Zoznam kategorizovaných liekov 1.10.2026 – 31.10.2026', slug: 'lieky202610', date: '2026-09-04' }
  ]);
  const mz = N.parseSource(N.sources().find((x) => x.id === 'mzsr-categorized'), mzHtml);
  assert.deepEqual(mz.map((i) => [i.date, i.category, i.link]), [
    ['2026-09-30', 'prices', 'https://www.health.gov.sk/Clanok?lieky202611'],
    ['2026-09-04', 'prices', 'https://www.health.gov.sk/Clanok?lieky202610']
  ]);
  assert.notEqual(N.noticeId('mzsr', mz[0].link, mz[0].title, mz[0].key), N.noticeId('mzsr', mz[0].link, 'Zoznam kategorizovaných liekov 1.11.2026 – 30.11.2026', mz[0].key.replace('#info', '#final')));
  assert.equal(N.skLongDate('(4. septembra 2026)'), '2026-09-04');
  assert.equal(N.skLongDate('30. marca 2025'), '2025-03-30');
  assert.equal(N.skLongDate('bez dátumu'), null);

  // ÚSKVBL ČR (Czech): quality defects, falsified medicines and GMP non-compliance are recalls.
  const cz = N.parseSource(
    N.sources().find((x) => x.id === 'uskvblcz-alerts'),
    P.suklRss('Důležitá upozornění', [
      { title: 'Upozornění - VLP Fiktivet 200 μg tablety pro psy, stažení šarže', path: '/cs/uskvbl/dulezita-upozorneni/a', date: '2026-02-02' },
      { title: 'Upozornění - Padělky VLP Imaginex', path: '/cs/uskvbl/dulezita-upozorneni/b', date: '2026-07-15' },
      { title: 'Upozornění - GMP non-compliance Vymyslená Farma', path: '/cs/uskvbl/dulezita-upozorneni/c', date: '2026-05-27' },
      { title: 'Informace o dostupnosti léčivých přípravků s léčivou látkou fiktivin', path: '/cs/uskvbl/dulezita-upozorneni/d', date: '2026-08-01' }
    ], 'https://www.uskvbl.cz')
  );
  assert.deepEqual(cz.map((i) => i.category), ['recall', 'recall', 'recall', 'availability']);
  const sool = N.parseSource(N.sources().find((x) => x.id === 'sool-news'), P.suklRss('SOOL', [{ title: 'Aktualizovaná verzia Usmernenie k overovaniu bezpečnostných prvkov liekov', path: '/usmernenie/', date: '2026-05-02' }], 'https://sool.sk'));
  assert.deepEqual(sool.map((i) => [i.category, i.link]), [['legislation', 'https://sool.sk/usmernenie/']]);

  assert.equal(N.rssDate('Fri, 02 Oct 2026 00:30:00 +0200'), '2026-10-02', 'the published date, not shifted by the time zone');
  assert.equal(N.skDate('4. 6. 2024'), '2024-06-04');
  assert.equal(N.decodeEntities('a&nbsp;b &#8211; &amp; &#x17E;'), 'a b – & ž');
  assert.deepEqual(N.parseRss('<html>Not a feed</html>'), []);
});

test('relevance: company profile, activities not performed, watched product names', () => {
  const company = { activities: { human: 'yes', vet: 'no', pharmacy: 'no' }, watchTerms: 'Fiktivol\nBoehringer Ingelheim\nab' };
  const rel = (it) => N.relevance(it, company, activityHints);
  assert.deepEqual(rel({ authority: 'sukl', category: 'recall', title: 'Stiahnutie lieku Fiktivol 10 mg z trhu' }), { forUs: true, reason: null, watch: ['Fiktivol'] });
  assert.deepEqual(rel({ authority: 'uskvbl', category: 'recall', title: 'Stiahnutie lieku Imaginvet' }), { forUs: false, reason: 'vet', watch: [] });
  assert.equal(rel({ authority: 'sukl', category: 'legislation', title: 'Usmernenie pre poskytovanie lekárenskej starostlivosti vo verejných lekárňach' }).reason, 'pharmacy');
  assert.equal(rel({ authority: 'sukl', category: 'recall', title: 'Stiahnutie lieku Fiktivolex z trhu' }).watch.length, 0, 'whole words only');
  assert.deepEqual(N.watchHits({ title: 'Oznam o dopredaji liekov spoločnosti BOEHRINGER-INGELHEIM' }, company.watchTerms), ['Boehringer Ingelheim'], 'case, hyphens and diacritics do not matter; too short names are ignored');
  // Human medicines: the Ministry's categorisation and SOOL; veterinary: ÚSKVBL ČR. A watched product in the EU database always concerns us.
  const noHuman = { activities: { human: 'no', vet: 'yes' } };
  assert.equal(N.relevance({ authority: 'mzsr', category: 'prices', title: 'Zoznam kategorizovaných liekov' }, noHuman).reason, 'human');
  assert.equal(N.relevance({ authority: 'sool', category: 'other', title: 'CORE 7.00' }, noHuman).reason, 'human');
  assert.equal(N.relevance({ authority: 'uskvblcz', category: 'recall', title: 'Stažení šarže' }, company).reason, 'vet');
  assert.deepEqual(N.relevance({ authority: 'upd', category: 'availability', title: 'EÚ databáza – X', product: 'FIKTIVET 50 mg' }, company), { forUs: true, reason: null, watch: ['FIKTIVET 50 mg'] });
});

test('only the authorities’ sites are contacted', () => {
  assert.equal(allowedUrl('https://www.sukl.sk/sk/rss?page_id=1355'), true);
  assert.equal(allowedUrl('https://uskvbl.sk/?page_id=115'), true);
  for (const u of ['https://www.health.gov.sk/?zoznam-kategorizovanych-liekov', 'https://sool.sk/feed/', 'https://www.uskvbl.cz/cs/uskvbl/dulezita-upozorneni', 'https://medicines.health.europa.eu/veterinary/sk/600000012345']) assert.equal(allowedUrl(u), true, u);
  assert.equal(allowedUrl('http://www.sukl.sk/'), false, 'https only');
  assert.equal(allowedUrl('https://www.sukl.sk.evil.example/'), false);
  assert.equal(allowedUrl('https://example.com/?u=https://www.sukl.sk'), false);
  assert.equal(allowedUrl('http://127.0.0.1:5555/sk/rss', 'http://127.0.0.1:5555'), true, 'the local test server');
});

test('monitor: first read keeps older notices as a baseline, new ones are to assess, assessment is recorded', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-nt-'));
  const a = new Archive({ dataDir: path.join(dir, 'arch'), user: 'QA Eva' });
  await a.open();
  await a.updateCompany({ watchTerms: 'Imaginex' });
  const today = new Date();
  const d = (n) => P.isoDaysAgo(n, today);
  let recalls = [
    { title: 'Stiahnutie lieku Fiktivol 10 mg z trhu', path: `${R}/fiktivol`, date: d(3) },
    { title: 'Stiahnutie lieku Starý liek z trhu', path: `${R}/stary`, date: d(200) }
  ];
  const news = [
    { title: 'Stiahnutie lieku Fiktivol 10 mg z trhu', path: `${R}/fiktivol`, date: d(3) },
    { title: 'MSC: Imaginex (tablety): prerušenie dodávky liekov', path: '/dostupnost-liekov/msc-imaginex', date: d(5) }
  ];
  let failVet = false;
  const pages = (url) => {
    if (url.includes('pid=208')) return P.suklRss('Mimoriadne oznamy', recalls);
    if (url.includes('health.gov.sk')) return P.mzList('Zoznam', [{ title: 'Zoznam kategorizovaných liekov 1.1.2024 – 31.1.2024', slug: 'lieky202401', date: d(400) }]);
    if (url.includes('sool.sk')) return P.suklRss('SOOL', [{ title: 'EMVS Master Data Guide – aktualizovaná verzia', path: '/emvs/', date: d(120) }], 'https://sool.sk');
    if (url.includes('uskvbl.cz')) return P.suklRss('Důležitá upozornění', [{ title: 'Upozornění - Padělky VLP Starý', path: '/cs/a', date: d(90) }], 'https://www.uskvbl.cz');
    if (url.includes('rss')) return P.suklRss('Aktuality', news);
    if (url.includes('page_id=115')) {
      if (failVet) throw new Error('HTTP 503');
      return P.uskvblNotices([{ title: 'Oznámenie o stiahnutí veterinárneho lieku FIKTIVET', file: 'fiktivet.pdf', date: d(10) }]);
    }
    return P.uskvblLegislation([{ title: 'NARIADENIE (EÚ) 2019/6 o veterinárnych liekoch', file: 'r2019-6.pdf' }]);
  };
  const fetched = [];
  const m = new NoticesMonitor(a, { fetchText: async (url) => (fetched.push(url), { text: pages(url), url }), pauseMs: 0 });
  let r = await m.checkAll();
  assert.equal(fetched.length, N.sources().length);
  assert.ok(fetched.every((u) => allowedUrl(u)), 'only the authorities’ sites');
  assert.deepEqual(r.errors, []);
  assert.equal(r.added.length, 3, 'the recall from both feeds once, the availability notice, the ÚŠKVBL recall; old ones are baseline');
  let list = a.listNotices();
  assert.equal(list.items.length, 8, '5 + an older notice from the Ministry (both its pages list it), SOOL and ÚSKVBL ČR (baseline)');
  assert.equal(list.items.find((n) => n.title.includes('Starý')).handled.outcome, 'baseline');
  assert.equal(list.items.find((n) => n.title.includes('NARIADENIE')).handled.outcome, 'baseline', 'a list without dates starts as baseline');
  assert.deepEqual(list.counts, { toAssess: 3, unseen: 3 }, 'two recalls + the watched name');
  const imx = list.items.find((n) => n.title.includes('Imaginex'));
  assert.deepEqual(imx.rel.watch, ['Imaginex']);

  // The company does not distribute veterinary medicines: the ÚŠKVBL recall no longer needs assessing.
  await a.updateCompany({ activities: { vet: 'no' } });
  assert.equal(a.noticeCounts().toAssess, 2);

  const fik = list.items.find((n) => n.title.includes('Fiktivol'));
  await assert.rejects(() => a.handleNotice(fik.id, { outcome: 'done', note: ' ' }), /NOTE_REQUIRED/);
  await assert.rejects(() => a.handleNotice(fik.id, { outcome: 'maybe' }), /OUTCOME_REQUIRED/);
  await a.handleNotice(fik.id, { outcome: 'not-ours', note: 'Liek nemáme v sortimente.' });
  await a.seeNotices([imx.id]);
  assert.deepEqual(a.noticeCounts(), { toAssess: 1, unseen: 0 });

  // Next read: a new recall appears; the ÚŠKVBL page fails – the error is kept, nothing is lost.
  recalls = [{ title: 'Stiahnutie lieku Novotest z trhu', path: `${R}/novotest`, date: d(0) }, ...recalls];
  failVet = true;
  r = await m.checkAll();
  assert.equal(r.added.length, 1);
  assert.deepEqual(r.errors, [{ source: 'uskvbl-notices', error: 'HTTP 503' }]);
  list = a.listNotices();
  assert.equal(list.sources['uskvbl-notices'].ok, false);
  assert.equal(list.items.length, 9);
  assert.equal(list.items[0].title, 'Stiahnutie lieku Novotest z trhu', 'newest first');

  await a.reopenNotice(fik.id);
  assert.equal(a.noticeCounts().toAssess, 3);

  // Survives a reload (encrypted or not, the notices are part of the archive).
  const b = new Archive({ dataDir: path.join(dir, 'arch'), user: 'QA Eva' });
  await b.open();
  assert.equal(b.listNotices().items.length, 9);
  assert.equal(b.companyProfile().watchTerms, 'Imaginex');
  assert.ok(b.companyProfile().updatedAt, 'when the profile was changed is kept');

  const audit = JSON.stringify(await b.allAudit());
  assert.match(audit, /notice\.handled/);
  assert.match(audit, /Liek nemáme v sortimente/);

  // A page that suddenly lists nothing has changed its layout.
  const broken = new NoticesMonitor(b, { fetchText: async (url) => ({ text: '<html><body>Nová stránka</body></html>', url }), pauseMs: 0 });
  r = await broken.checkAll();
  assert.equal(r.errors.length, N.sources().length);
  assert.ok(r.errors.every((e) => e.error === 'FORMAT'));
  await assert.rejects(() => new NoticesMonitor(b, { fetchText: async () => ({}), isOffline: () => true }).checkAll(), /OFFLINE/);
});

test('EU veterinary medicines database: the watched products’ pages are compared with the last reading', async () => {
  const U = require('../../src/main/lib/upd');
  assert.deepEqual(
    U.updIds('https://medicines.health.europa.eu/veterinary/sk/600000012345\nhttps://medicines.health.europa.eu/veterinary/en/600000012345?x=1\n600000099999\nhttps://example.com/veterinary/sk/600000000001\n123'),
    ['600000012345', '600000099999'],
    'addresses or bare numbers; each once; other sites ignored'
  );
  assert.equal(U.parseProduct('<html><body>Stránka sa zmenila</body></html>'), null);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-upd-'));
  const a = new Archive({ dataDir: path.join(dir, 'arch'), user: 'QA Eva' });
  await a.open();
  await a.updateCompany({ updWatch: 'https://medicines.health.europa.eu/veterinary/sk/600000012345\n600000099999' });
  const docs = { 'Súhrn charakteristických vlastností lieku': '2026-05-02', 'Písomná informácia pre používateľa': '2026-05-02' };
  const products = {
    600000012345: { name: 'FIKTIVET 50 mg tablety pre psy', authorisedIn: ['CZ', 'SK'], availableIn: ['SK'], docs: { ...docs } },
    600000099999: { name: 'IMAGINVET premix', authorisedIn: ['SK'], availableIn: ['SK'], docs: {} }
  };
  const quiet = (url) => /health\.gov\.sk|sool\.sk|uskvbl\.cz|sukl|uskvbl\.sk/.test(url);
  const fetched = [];
  const fetchText = async (url) => {
    fetched.push(url);
    if (quiet(url)) throw new Error('HTTP 503'); // the other sources do not matter here
    const id = url.match(/(\d+)$/)[1];
    if (!products[id]) throw new Error('HTTP 404');
    return { text: P.updProduct(products[id]), url };
  };
  const m = new NoticesMonitor(a, { fetchText, pauseMs: 0 });

  // First reading: remembered only.
  let r = await m.checkAll();
  assert.deepEqual(fetched.filter((u) => !quiet(u)), ['https://medicines.health.europa.eu/veterinary/sk/600000012345', 'https://medicines.health.europa.eu/veterinary/sk/600000099999']);
  assert.ok(fetched.every((u) => allowedUrl(u)));
  assert.equal(r.added.length, 0);
  let list = a.listNotices();
  assert.deepEqual(list.watched.map((w) => [w.name, w.authorisedSk, w.availableSk]), [['FIKTIVET 50 mg tablety pre psy', true, true], ['IMAGINVET premix', true, true]]);
  assert.equal(list.sources['upd-watch'].watched, 2);

  // Within a day the products are not read again – unless asked.
  products[600000012345].authStatus = 'Suspended';
  fetched.length = 0;
  r = await m.checkAll();
  assert.equal(fetched.filter((u) => !quiet(u)).length, 0, 'once a day');

  // A change: suspended authorisation, Slovakia no longer listed as available, a new SPC; the other product is gone.
  products[600000012345].availableIn = ['CZ'];
  products[600000012345].docs['Súhrn charakteristických vlastností lieku'] = '2026-10-01';
  delete products[600000099999];
  r = await m.checkAll({ force: true });
  assert.equal(r.added.length, 2);
  list = a.listNotices();
  const fik = list.items.find((n) => n.product === 'FIKTIVET 50 mg tablety pre psy');
  assert.equal(fik.title, 'EÚ databáza – FIKTIVET 50 mg tablety pre psy: stav registrácie: Valid → Suspended');
  assert.match(fik.summary, /na Slovensku už nie je uvedený ako dostupný/);
  assert.match(fik.summary, /nová verzia: Súhrn charakteristických vlastností lieku \(1\. 10\. 2026\)/);
  assert.equal(fik.link, 'https://medicines.health.europa.eu/veterinary/sk/600000012345');
  assert.deepEqual(fik.rel.watch, ['FIKTIVET 50 mg tablety pre psy'], 'to assess: a product the company watches');
  assert.match(list.items.find((n) => n.product === 'IMAGINVET premix').title, /liek sa v databáze už nenachádza/);
  assert.equal(list.items.find((n) => n.product === 'IMAGINVET premix').summary, '', 'one change: said once, in the title');
  assert.equal(a.noticeCounts().toAssess, 2);
  assert.ok(list.watched[1].gone);

  // Nothing new on the next reading; a page that cannot be read keeps the last reading and is reported.
  products[600000099999] = { name: 'IMAGINVET premix' };
  const failing = new NoticesMonitor(a, { fetchText: async (url) => (url.endsWith('600000012345') ? { text: '<html>údržba</html>', url } : fetchText(url)), pauseMs: 0 });
  r = await failing.checkAll({ force: true });
  assert.equal(r.added.length, 0, 'a product back in the database is remembered again, not reported');
  assert.deepEqual(r.errors.find((e) => e.source === 'upd-watch'), { source: 'upd-watch', error: '1/2' });
  list = a.listNotices();
  assert.equal(list.sources['upd-watch'].failed, 1);
  assert.equal(list.watched[0].authStatus, 'Suspended', 'the last reading is kept');

  // English archive: the notice is written in English.
  assert.deepEqual(U.changes({ authStatus: 'Valid', docs: {} }, { authStatus: 'Withdrawn', docs: {} }, 'en'), ['authorisation status: Valid → Withdrawn']);
});
