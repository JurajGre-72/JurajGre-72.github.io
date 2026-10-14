'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFileName } = require('../../src/main/lib/filenames');

// Made-up file names in the company's naming scheme (the real document names stay in the company).
const CASES = [
  ['_OS1_Vzorová smernica_2026.pdf', { code: 'OS1', type: 'OS', title: 'Vzorová smernica', version: '2026' }],
  ['_OS2_Druhá vzorová smernica_2025.pdf', { code: 'OS2', type: 'OS', title: 'Druhá vzorová smernica', version: '2025' }],
  ['_OS5_Testovacia smernica_2026.pdf', { code: 'OS5', type: 'OS', title: 'Testovacia smernica', version: '2026' }],
  ['_OS5_Príloha č.1_Zoznam kontaktov.pdf', { code: 'OS5 Príloha č. 1', type: 'OS', title: 'Zoznam kontaktov', annexOf: 'OS5', annexNo: 1 }],
  ['_OS5_Príloha č.2_Formulár-Vzorové hlásenie.pdf', { code: 'OS5 Príloha č. 2', type: 'OS', title: 'Formulár-Vzorové hlásenie', annexOf: 'OS5', annexNo: 2 }],
  ['_OS5_Príloha č.4_Vzorový_Register_Zariadení.xlsx', { code: 'OS5 Príloha č. 4', type: 'OS', title: 'Vzorový Register Zariadení', annexOf: 'OS5', annexNo: 4 }],
  ['_OS7_Príloha č.1_Vzorová schéma.pdf', { code: 'OS7 Príloha č. 1', type: 'OS', title: 'Vzorová schéma', annexOf: 'OS7', annexNo: 1 }],
  ['_OS7_Príloha č.2_Prehľad OS a ŠPP.pdf', { code: 'OS7 Príloha č. 2', type: 'OS', title: 'Prehľad OS a ŠPP', annexOf: 'OS7', annexNo: 2 }],
  ['_OS7_Príloha č.5_Vzor B.pdf', { code: 'OS7 Príloha č. 5', type: 'OS', title: 'Vzor B', annexOf: 'OS7', annexNo: 5 }],
  [
    '_OS7_príloha3_k Vzorovej príručke_Požiadavky na vzorový proces_2025.pdf',
    { code: 'OS7 Príloha č. 3', type: 'OS', title: 'k Vzorovej príručke Požiadavky na vzorový proces', annexOf: 'OS7', annexNo: 3, version: '2025' }
  ],
  ['_OS7_Vzorova_prirucka_vratane_priloh.pdf', { code: 'OS7', type: 'OS', title: 'Vzorova prirucka vratane priloh' }],
  ['ID-04  Vzorový interný dokument.pdf', { code: 'ID-04', type: 'ID', title: 'Vzorový interný dokument' }],
  ['ME_Q_01_2022_Vzorová metodika.pdf', { code: 'ME Q 01', type: 'ME', title: 'Vzorová metodika', version: '2022', area: 'Q', departmentIndex: 1 }],
  ['SM_HR_003_2_Vzorový poriadok_od_01.01.2025.pdf', { code: 'SM HR 003', type: 'SM', title: 'Vzorový poriadok', version: '2', effectiveDate: '2025-01-01', area: 'HR', departmentIndex: 10 }],
  ['SM_Q_01_2022_Vzorová smernica kvality.pdf', { code: 'SM Q 01', type: 'SM', title: 'Vzorová smernica kvality', version: '2022', area: 'Q', departmentIndex: 1 }],
  ['ŠPP_01_2025_pre vzorový proces.pdf', { code: 'ŠPP 01', type: 'ŠPP', title: 'pre vzorový proces', version: '2025' }],
  ['ŠPP_05_2026_pre vzorový príjem.pdf', { code: 'ŠPP 05', type: 'ŠPP', title: 'pre vzorový príjem', version: '2026' }],
  ['ŠPP_09_2025_vzorový plán.pdf', { code: 'ŠPP 09', type: 'ŠPP', title: 'vzorový plán', version: '2025' }],
  ['ŠPP_14_2026_pri vzorovej udalosti A, B, C,D.pdf', { code: 'ŠPP 14', type: 'ŠPP', title: 'pri vzorovej udalosti A, B, C,D', version: '2026' }],
  ['ŠPP_19_2026_pre príjem, výdaj a evidenciu vzorov.pdf', { code: 'ŠPP 19', type: 'ŠPP', title: 'pre príjem, výdaj a evidenciu vzorov', version: '2026' }],
  ['ŠPP_20_2026_vzorový postup - WMS.pdf', { code: 'ŠPP 20', type: 'ŠPP', title: 'vzorový postup - WMS', version: '2026' }],
  ['ŠPP_21_2026_vzorové opatrenia (CAPA).pdf', { code: 'ŠPP 21', type: 'ŠPP', title: 'vzorové opatrenia (CAPA)', version: '2026' }],
  ['2021.04_Vzorový pokyn podľa Prílohy 1_Vyhlášky 82-2012 MZSR.pdf', { title: 'Vzorový pokyn podľa Prílohy 1 Vyhlášky 82-2012 MZSR', version: '2021.04' }],
  ['2024.09_VZOR_Pokyny pre vzor.zásielky.pdf', { title: 'VZOR Pokyny pre vzor.zásielky', version: '2024.09' }],
  ['2024.11_Vzorové procesy_prvý_druhý.pdf', { title: 'Vzorové procesy prvý druhý', version: '2024.11' }],
  ['Smernica Q_01-2017_Vzorová spolupráca.pdf', { code: 'Q 01-2017', type: 'SM', title: 'Vzorová spolupráca', area: 'Q', departmentIndex: 1 }],
  ['Smernica Q_05-2017_Vzorové zaobchádzanie_ver.04_21.01.2022.pdf', { code: 'Q 05-2017', type: 'SM', title: 'Vzorové zaobchádzanie', version: '04', effectiveDate: '2022-01-21', area: 'Q', departmentIndex: 1 }],
  ['Smernica Q_08-2018_Vzorové zaradenie do kat._ver.19.03.2025.pdf', { code: 'Q 08-2018', type: 'SM', title: 'Vzorové zaradenie do kat.', effectiveDate: '2025-03-19', area: 'Q', departmentIndex: 1 }],
  ['Smernica Q_09-2018_Vzorová info.pre používateľa.pdf', { code: 'Q 09-2018', type: 'SM', title: 'Vzorová info.pre používateľa', area: 'Q', departmentIndex: 1 }],
  ['Smernica Q_10-2020_Vzorový tovar_ver.01.11.2024.pdf', { code: 'Q 10-2020', type: 'SM', title: 'Vzorový tovar', effectiveDate: '2024-11-01', area: 'Q', departmentIndex: 1 }]
];

test('company file names: code, type, title, edition, annexes', () => {
  for (const [name, expected] of CASES) assert.deepEqual(parseFileName(name), expected, name);
});

test('a newer edition of a file gets the same code (so it becomes a new version)', () => {
  assert.equal(parseFileName('ŠPP_05_2027_pre vzorový príjem.docx').code, parseFileName('ŠPP_05_2026_pre vzorový príjem.pdf').code);
  assert.equal(parseFileName('_OS1_Vzorová smernica_2027.pdf').code, 'OS1');
});

test('copies in the "Anglické verzie" folder are marked as English', () => {
  assert.equal(parseFileName('_OS1_Sample directive_2026.pdf', 'C:\\Dokumenty\\OS\\Anglické verzie').lang, 'en');
  assert.equal(parseFileName('_OS1_Vzorová smernica_2026.pdf', 'C:\\Dokumenty\\OS').lang, undefined);
  assert.equal(parseFileName('ŠPP_05_2026_Sample receipt_EN.pdf').lang, 'en');
});

test('names outside the house pattern are left to the other rules', () => {
  for (const n of ['Plán školení 2026.xlsx', 'Zmluva o kvalite Dodávateľ.pdf', 'scan0001.pdf', 'SOP-QA-001_Prijem.pdf']) assert.equal(parseFileName(n), null, n);
});
