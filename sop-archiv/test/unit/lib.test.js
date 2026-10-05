'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { fold, stem, processTerm, chunkPages } = require('../../src/main/lib/text');
const { parseDate, addMonths, daysBetween, compactToIso } = require('../../src/main/lib/dates');
const { detectMetadata, detectCitations, detectAllLawRefs, aliasesFromKey } = require('../../src/main/lib/metadata');
const { SearchIndex, parseQuery } = require('../../src/main/lib/search');
const { reviewState, buildIcs, buildCsv } = require('../../src/main/lib/reviews');
const { DEFAULT_LAWS } = require('../../src/main/lib/defaults');

test('fold removes diacritics and lower-cases', () => {
  assert.equal(fold('Účinnosť ŠÚKL'), 'ucinnost sukl');
});

test('stemmer maps Slovak inflections to one key', () => {
  for (const w of ['lieky', 'liekov', 'liekmi', 'lieku']) assert.equal(processTerm(w), 'liek');
  assert.equal(processTerm('teplota'), processTerm('teploty'));
  assert.equal(processTerm('reklamácie'), processTerm('reklamácia'));
  assert.equal(processTerm('a'), null, 'stopword');
  assert.equal(stem('2019'), '2019', 'numbers untouched');
});

test('parseDate understands SK and EN formats', () => {
  assert.equal(parseDate('1. 3. 2024'), '2024-03-01');
  assert.equal(parseDate('01.09.2025'), '2025-09-01');
  assert.equal(parseDate('2026-10-15'), '2026-10-15');
  assert.equal(parseDate('15. januára 2024'), '2024-01-15');
  assert.equal(parseDate('March 5, 2026'), '2026-03-05');
  assert.equal(parseDate('5 March 2026'), '2026-03-05');
  assert.equal(parseDate('31.02.2024'), null, 'invalid date');
});

test('date arithmetic', () => {
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2024-03-01', 24), '2026-03-01');
  assert.equal(daysBetween('2026-10-05', '2026-10-15'), 10);
  assert.equal(compactToIso('20270101'), '2027-01-01');
});

test('detectMetadata reads a typical SOP header', () => {
  const t = 'PHARMACOPOLA s.r.o.\nŠtandardný operačný postup\nSOP-QA-001 Príjem a skladovanie liekov\nVerzia: 3\nDátum účinnosti: 1. 3. 2024\nDátum ďalšej revízie: 1.3.2026\nVypracoval: Ing. Ján Novák   Podpis:\nSchválil: PharmDr. Eva Malá';
  const m = detectMetadata(t, 'x.pdf');
  assert.equal(m.code, 'SOP-QA-001');
  assert.equal(m.type, 'SOP');
  assert.equal(m.version, '3');
  assert.equal(m.effectiveDate, '2024-03-01');
  assert.equal(m.reviewDate, '2026-03-01');
  assert.equal(m.title, 'Príjem a skladovanie liekov');
  assert.equal(m.owner, 'Ing. Ján Novák');
  assert.equal(m.approver, 'PharmDr. Eva Malá');
});

test('detectMetadata reads an organizational directive', () => {
  const m = detectMetadata('ORGANIZAČNÁ SMERNICA č. 3/2024\nOchrana osobných údajov\nPlatnosť od: 15. januára 2024\nNext review date: March 5, 2026', 'smernica.docx');
  assert.equal(m.code, 'OS 3/2024');
  assert.equal(m.type, 'OS');
  assert.equal(m.title, 'Ochrana osobných údajov');
  assert.equal(m.effectiveDate, '2024-01-15');
  assert.equal(m.reviewDate, '2026-03-05');
});

test('detectMetadata falls back to the file name', () => {
  const m = detectMetadata('', 'SOP-DIST-04_Preprava_liekov.docx');
  assert.equal(m.code, 'SOP-DIST-04');
  assert.equal(m.title, 'SOP-DIST-04 Preprava liekov');
});

test('aliasesFromKey', () => {
  assert.deepEqual(aliasesFromKey('SK:362/2011'), ['362/2011']);
  assert.deepEqual(aliasesFromKey('EU:32019R0006'), ['2019/6', '32019R0006']);
  assert.deepEqual(aliasesFromKey('EU:32004R0726'), ['726/2004', '32004R0726']);
});

test('detectCitations attributes § and articles to the right act', () => {
  const laws = [
    { id: 'lieky', key: 'SK:362/2011', aliases: ['zákon* o liekoch'] },
    { id: 'gdpr', key: 'SK:18/2018' },
    { id: 'vet', key: 'SK:39/2007' },
    { id: 'reg', key: 'EU:32019R0006' }
  ];
  const t =
    'Teplota podľa § 5 zákona č. 18/2018 Z. z. a § 18 ods. 1 a § 23a zákona č. 362/2011 Z. z.\n' +
    'Podľa nariadenia (EÚ) 2019/6, článok 99 a zákona č. 39/2007 Z. z.\n' +
    'V zmysle zákona o liekoch.\n' +
    'Nesprávne: nariadenie 2019/60 sa nepočíta.';
  const r = Object.fromEntries(detectCitations(t, laws).map((c) => [c.lawId, c]));
  assert.deepEqual(r.lieky.sections, ['§18', '§23a']);
  assert.equal(r.lieky.count, 2);
  assert.deepEqual(r.gdpr.sections, ['§5']);
  assert.deepEqual(r.vet.sections, []);
  assert.deepEqual(r.reg.sections, ['art99']);
  assert.equal(r.reg.count, 1, '2019/60 must not count as 2019/6');
});

test('default register aliases are valid', () => {
  const laws = DEFAULT_LAWS.map((l, i) => ({ ...l, id: String(i) }));
  const r = detectCitations('Overovanie ochranných prvkov podľa nariadenia 2016/161. GDPR. Usmernenia 2013/C 343/01.', laws);
  const shorts = r.map((c) => laws[Number(c.lawId)].short);
  assert.ok(shorts.includes('Ochranné prvky (FMD)'));
  assert.ok(shorts.includes('GDPR'));
  assert.ok(shorts.includes('Usmernenia SDP (GDP)'));
});

test('detectAllLawRefs builds Slov-Lex / EUR-Lex identifiers', () => {
  const refs = detectAllLawRefs('podľa zákona č. 18/2018 Z. z., smernice 2001/83/ES, nariadenia (ES) č. 726/2004 a nariadenia (EÚ) 2019/6');
  const keys = refs.map((r) => r.key).sort();
  assert.deepEqual(keys, ['EU:32001L0083', 'EU:32004R0726', 'EU:32019R0006', 'SK:18/2018']);
  assert.equal(refs.find((r) => r.key === 'SK:18/2018').url, 'https://www.slov-lex.sk/pravne-predpisy/SK/ZZ/2018/18/');
});

test('chunkPages keeps headings and page numbers', () => {
  const ch = chunkPages([{ page: 2, text: '1. Účel\nText účelu.\n2. Teplota\nTeplota skladovania liekov musí byť 15 – 25 °C.' }], 40);
  assert.ok(ch.every((c) => c.page === 2));
  assert.ok(ch.some((c) => c.heading === '2. Teplota'));
  assert.ok(!ch.some((c) => c.text === '2. Teplota'), 'no heading-only chunk');
});

test('search: inflections, diacritics, phrases, grouping', () => {
  const ix = new SearchIndex();
  ix.setDocument({ id: 'd1', code: 'SOP-QA-001', title: 'Príjem a skladovanie liekov', currentVersionId: 'v1' }, chunkPages([{ page: 1, text: 'Termolabilné lieky sa skladujú v chladničke pri teplote 2 – 8 °C.' }, { page: 2, text: 'Poškodené balenia sa umiestnia do karanténneho priestoru.' }]));
  ix.setDocument({ id: 'd2', code: 'OS 3/2024', title: 'Ochrana osobných údajov', currentVersionId: 'v2' }, chunkPages([{ page: null, text: 'Osobné údaje sa uchovávajú 10 rokov.' }]));
  const r1 = ix.search('chladnicka teplota');
  assert.equal(r1.results[0].docId, 'd1');
  assert.equal(r1.results[0].hits[0].page, 1);
  assert.ok(r1.results[0].hits[0].snippet.some((s) => s.hit && /chladničke/.test(s.text)));
  assert.equal(ix.search('karanténa').results[0].hits[0].page, 2);
  assert.equal(ix.search('osobne udaje').results[0].docId, 'd2');
  assert.equal(ix.search('"2 – 8 °C"').results.length, 1);
  assert.equal(ix.search('"8 – 2 °C"').results.length, 0);
  assert.equal(ix.search('SOP-QA-001').results[0].docId, 'd1');
  ix.removeDocument('d1');
  assert.equal(ix.search('chladnicka').results.length, 0);
  assert.deepEqual(parseQuery('"presná fráza" lieky').phrases, ['presná fráza']);
});

test('reviewState', () => {
  assert.equal(reviewState({ reviewDate: '2026-10-01' }, 60, '2026-10-05').state, 'overdue');
  assert.equal(reviewState({ reviewDate: '2026-11-01' }, 60, '2026-10-05').state, 'due');
  assert.equal(reviewState({ reviewDate: '2027-11-01' }, 60, '2026-10-05').state, 'ok');
  assert.equal(reviewState({ reviewDate: null }, 60, '2026-10-05').state, 'none');
  assert.equal(reviewState({ reviewDate: '2020-01-01', status: 'obsolete' }, 60, '2026-10-05').state, 'none');
});

test('ICS export is valid iCalendar with alarms and folded lines', () => {
  const ics = buildIcs([{ id: 'a', code: 'SOP-QA-001', title: 'Príjem a skladovanie liekov – veľmi dlhý názov dokumentu, ktorý presahuje sedemdesiatpäť bajtov', reviewDate: '2026-10-20', version: '3', owner: 'Ján' }, { id: 'b', title: 'Bez dátumu' }], { reminderDays: 14, prefix: 'Revízia' });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261020/);
  assert.match(ics, /DTEND;VALUE=DATE:20261021/);
  assert.match(ics, /TRIGGER:-P14D/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, `line too long: ${line}`);
});

test('CSV export escapes and has a BOM for Excel', () => {
  const csv = buildCsv([{ a: 'x;y', b: 'he said "hi"' }], [{ label: 'A', key: 'a' }, { label: 'B', key: 'b' }]);
  assert.equal(csv, '﻿A;B\r\n"x;y";"he said ""hi"""\r\n');
});
