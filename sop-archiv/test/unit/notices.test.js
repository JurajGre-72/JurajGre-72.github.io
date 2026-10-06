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
});

test('only the authorities’ sites are contacted', () => {
  assert.equal(allowedUrl('https://www.sukl.sk/sk/rss?page_id=1355'), true);
  assert.equal(allowedUrl('https://uskvbl.sk/?page_id=115'), true);
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
  assert.equal(fetched.length, 4);
  assert.ok(fetched.every((u) => allowedUrl(u)), 'only ŠÚKL and ÚŠKVBL');
  assert.deepEqual(r.errors, []);
  assert.equal(r.added.length, 3, 'the recall from both feeds once, the availability notice, the ÚŠKVBL recall; old ones are baseline');
  let list = a.listNotices();
  assert.equal(list.items.length, 5);
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
  assert.equal(list.items.length, 6);
  assert.equal(list.items[0].title, 'Stiahnutie lieku Novotest z trhu', 'newest first');

  await a.reopenNotice(fik.id);
  assert.equal(a.noticeCounts().toAssess, 3);

  // Survives a reload (encrypted or not, the notices are part of the archive).
  const b = new Archive({ dataDir: path.join(dir, 'arch'), user: 'QA Eva' });
  await b.open();
  assert.equal(b.listNotices().items.length, 6);
  assert.equal(b.companyProfile().watchTerms, 'Imaginex');
  assert.ok(b.companyProfile().updatedAt, 'when the profile was changed is kept');

  const audit = fs.readFileSync(path.join(dir, 'arch', 'audit.log'), 'utf8');
  assert.match(audit, /notice\.handled/);
  assert.match(audit, /Liek nemáme v sortimente/);

  // A page that suddenly lists nothing has changed its layout.
  const broken = new NoticesMonitor(b, { fetchText: async (url) => ({ text: '<html><body>Nová stránka</body></html>', url }), pauseMs: 0 });
  r = await broken.checkAll();
  assert.equal(r.errors.length, 4);
  assert.ok(r.errors.every((e) => e.error === 'FORMAT'));
  await assert.rejects(() => new NoticesMonitor(b, { fetchText: async () => ({}), isOffline: () => true }).checkAll(), /OFFLINE/);
});
