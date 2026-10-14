'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { extractQuantities, mismatches, wordToNumber } = require('../../src/main/lib/quantities');
const { analyzeLawAgainstDocs } = require('../../src/main/lib/compliance');
const { stripRunningLines, lawTextFromPages, detectLawIdentity, resolveLawQuery } = require('../../src/main/lib/lawfile');
const { SearchIndex } = require('../../src/main/lib/search');
const { chunkPages } = require('../../src/main/lib/text');
const { detectCitations } = require('../../src/main/lib/metadata');
const { DEFAULT_LAWS } = require('../../src/main/lib/defaults');

const q = (t) => extractQuantities(t).map((x) => `${x.cat}:${x.value}:${x.unit}`);

test('number words', () => {
  assert.equal(wordToNumber('desat'), 10);
  assert.equal(wordToNumber('patnastich'), 15);
  assert.equal(wordToNumber('dvadsatstyri'), 24);
  assert.equal(wordToNumber('dvadsiatich'), 20);
  assert.equal(wordToNumber('liek'), null);
});

test('periods, deadlines and temperatures', () => {
  assert.deepEqual(q('uchovávajú sa 5 rokov'), ['time:5:year']);
  assert.deepEqual(q('uchovávať desať rokov'), ['time:10:year']);
  assert.deepEqual(q('do dvadsiatich štyroch hodín'), ['time:24:hour']);
  assert.deepEqual(q('do 15 pracovných dní'), ['time:15:day']);
  assert.deepEqual(q('v lehote troch mesiacov'), ['time:3:month']);
  assert.deepEqual(q('pri teplote 2 – 8 °C'), ['temp:2:°C', 'temp:8:°C']);
  assert.deepEqual(q('+2 °C až +8 °C'), ['temp:2:°C', 'temp:8:°C']);
  assert.deepEqual(q('§ 18 ods. 1 písm. l) a 5 % roztok'), []);
});

test('mismatches compare like with like', () => {
  const m = mismatches(extractQuantities('uchovávajú 5 rokov, teplota 15 – 25 °C'), extractQuantities('desať rokov'));
  assert.equal(m.length, 1, 'temperature is not compared when the law has none');
  assert.equal(m[0].doc.raw, '5 rokov');
  assert.deepEqual(mismatches(extractQuantities('24 hodín'), extractQuantities('dvadsiatich štyroch hodín')), []);
  assert.deepEqual(mismatches(extractQuantities('1 rok'), extractQuantities('12 mesiacov')), [], '1 year = 12 months');
});

const LAW = { id: 'L', key: 'SK:362/2011', aliases: ['zákon* o liekoch'] };
const LAW_TEXT = `Zákon č. 362/2011 Z. z.
§ 1
Predmet úpravy
(1) Zákon upravuje lieky.
§ 18
Povinnosti veľkodistribútora
(1) Držiteľ je povinný k) zabezpečiť stiahnutie lieku z trhu do dvadsiatich štyroch hodín od doručenia rozhodnutia, l) uchovávať záznamy o dodávkach liekov desať rokov.
§ 19
Skladovanie
(1) Lieky sa skladujú pri teplote 15 – 25 °C, termolabilné lieky v chladničke pri teplote 2 – 8 °C, poškodené balenia v karanténe, kontrola teploty kalibrovanými teplomermi.
§ 20
Preprava
(1) Preprava liekov sa vykonáva vozidlami s monitorovaním teploty.`;

function doc(id, code, text) {
  const pages = [{ page: 1, text }];
  return { doc: { id, code, status: 'effective', citations: detectCitations(text, [LAW]) }, pages };
}

test('analyzeLawAgainstDocs: changed, missing, quantity and related findings', () => {
  const a = doc('A', 'SOP-SK-002', '2. Stiahnutie z trhu\nŠarže sa stiahnu do 48 hodín podľa § 18 ods. 1 písm. k) zákona č. 362/2011 Z. z.\n3. Záznamy\nZáznamy sa uchovávajú 5 rokov podľa § 18 ods. 1 písm. l) zákona č. 362/2011 Z. z. a § 23a zákona č. 362/2011 Z. z.');
  const b = doc('B', 'SOP-QA-001', '4. Skladovanie\nLieky skladujeme pri teplote 15 – 25 °C. Termolabilné lieky v chladničke, karanténa pre poškodené balenia, kontrola teploty teplomermi s kalibráciou.');
  const c = doc('C', 'OS 1/2024', 'Dovolenky zamestnancov sa plánujú v personálnom systéme.');
  const ix = new SearchIndex();
  for (const d of [a, b, c]) ix.setDocument(d.doc, chunkPages(d.pages));
  const r = analyzeLawAgainstDocs({ law: LAW, lawText: LAW_TEXT, touched: ['§18'], docs: [a, b, c], searchFn: (w, m) => ix.relatedChunks(w, { minTerms: m }) });
  const byId = Object.fromEntries(r.docs.map((d) => [d.docId, d]));
  assert.equal(r.docs[0].docId, 'A', 'most severe first');
  const types = byId.A.findings.map((f) => `${f.type}:${f.section}`);
  assert.ok(types.includes('changed:§18'));
  assert.ok(types.includes('missing:§23a'));
  assert.deepEqual(byId.A.findings.filter((f) => f.type === 'quantity').map((f) => f.docValue).sort(), ['48 hodín', '5 rokov']);
  const ref18 = byId.A.refs.find((x) => x.key === '§18');
  assert.ok(ref18.lawExcerpt.includes('desať rokov'));
  assert.ok(ref18.docExcerpts[0].text.includes('5 rokov'));
  assert.equal(byId.B.severity, 'info');
  assert.equal(byId.B.related[0].key, '§19');
  assert.ok(byId.B.related[0].terms.includes('termolabilné'));
  assert.ok(!byId.C, 'unrelated document not listed');
});

test('stripRunningLines keeps § headings, removes headers and page numbers', () => {
  const pages = [1, 2, 3, 4].map((n) => ({ page: n, text: `362/2011 Z. z.\nZbierka zákonov SR\n§ ${n + 10}\nText ${n}\nStrana ${n} / 4` }));
  assert.equal(lawTextFromPages(pages), '§ 11\nText 1\n§ 12\nText 2\n§ 13\nText 3\n§ 14\nText 4');
  assert.equal(stripRunningLines(pages.slice(0, 2)).length, 2, 'too few pages: untouched');
});

test('detectLawIdentity: Slov-Lex and EUR-Lex documents', () => {
  const laws = DEFAULT_LAWS.map((l, i) => ({ ...l, id: `L${i}` }));
  const sk = detectLawIdentity('362/2011 Z. z.\nZÁKON\nz 13. septembra 2011\no liekoch a zdravotníckych pomôckach\nZnenie účinné od 1. 1. 2027\n§ 1', laws);
  assert.equal(sk.key, 'SK:362/2011');
  assert.equal(sk.lawId, 'L0');
  assert.equal(sk.versionDate, '2027-01-01');
  const eu = detectLawIdentity('02019R0006 — SK — 28.01.2022 — 001.001\nNARIADENIE EURÓPSKEHO PARLAMENTU A RADY (EÚ) 2019/6\nz 11. decembra 2018\no veterinárnych liekoch', laws);
  assert.equal(eu.key, 'EU:32019R0006');
  assert.equal(eu.versionDate, '2022-01-28');
  const vy = detectLawIdentity('VYHLÁŠKA\nMinisterstva zdravotníctva Slovenskej republiky\nz 2. mája 2012\nktorou sa ustanovujú požiadavky\n129/2012', []);
  assert.equal(vy.key, 'SK:129/2012');
  assert.match(vy.title, /Ministerstva zdravotníctva/);
});

test('resolveLawQuery: names, numbers, CELEX, URLs', () => {
  const laws = DEFAULT_LAWS.slice(0, 3).map((l, i) => ({ ...l, id: `L${i}` }));
  assert.deepEqual(resolveLawQuery('zákon o liekoch', laws, DEFAULT_LAWS), { lawId: 'L0' });
  assert.deepEqual(resolveLawQuery('362/2011', laws, DEFAULT_LAWS), { lawId: 'L0' });
  assert.equal(resolveLawQuery('nariadenie 2019/6', laws, DEFAULT_LAWS).spec.key, 'EU:32019R0006');
  assert.equal(resolveLawQuery('smernica 2001/83/ES', laws, DEFAULT_LAWS).spec.key, 'EU:32001L0083');
  assert.equal(resolveLawQuery('32016R0161', laws, DEFAULT_LAWS).spec.key, 'EU:32016R0161');
  assert.equal(resolveLawQuery('zákon o odpadoch', laws, DEFAULT_LAWS).spec.key, 'SK:79/2015');
  const unknown = resolveLawQuery('100/2020', laws, DEFAULT_LAWS).spec;
  assert.equal(unknown.url, 'https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/2020/100/');
  assert.equal(resolveLawQuery('zákon o rodine', laws, DEFAULT_LAWS), null);
  assert.equal(resolveLawQuery('https://www.sukl.sk/oznamy', laws, DEFAULT_LAWS).spec.url, 'https://www.sukl.sk/oznamy');
});
