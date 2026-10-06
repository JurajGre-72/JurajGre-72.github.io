'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFileName } = require('../../src/main/lib/filenames');

// File names as they are kept at PHARMACOPOLA (from the shared folder).
const CASES = [
  ['_OS1_Prevádzkový poriadok_2026.pdf', { code: 'OS1', type: 'OS', title: 'Prevádzkový poriadok', version: '2026' }],
  ['_OS2_Sanitačný a Hygienický poriadok_2025.pdf', { code: 'OS2', type: 'OS', title: 'Sanitačný a Hygienický poriadok', version: '2025' }],
  ['_OS3_Organizačný poriadok_2025.pdf', { code: 'OS3', type: 'OS', title: 'Organizačný poriadok', version: '2025' }],
  ['_OS4_Metrologický poriadok_2026.pdf', { code: 'OS4', type: 'OS', title: 'Metrologický poriadok', version: '2026' }],
  ['_OS5_Manažment rizík_2026.pdf', { code: 'OS5', type: 'OS', title: 'Manažment rizík', version: '2026' }],
  ['_OS5_Príloha č.1_Núdzové kontakty.pdf', { code: 'OS5 Príloha č. 1', type: 'OS', title: 'Núdzové kontakty', annexOf: 'OS5', annexNo: 1 }],
  ['_OS5_Príloha č.2_Formulár-Hlásenie pracovného úrazu.pdf', { code: 'OS5 Príloha č. 2', type: 'OS', title: 'Formulár-Hlásenie pracovného úrazu', annexOf: 'OS5', annexNo: 2 }],
  ['_OS5_Príloha č.3_Formulár-Hlásenie mimoriadnej udalosti.pdf', { code: 'OS5 Príloha č. 3', type: 'OS', title: 'Formulár-Hlásenie mimoriadnej udalosti', annexOf: 'OS5', annexNo: 3 }],
  ['_OS5_Príloha č.4_Revízia_Protipožiarnych_Zariadení_register.xlsx', { code: 'OS5 Príloha č. 4', type: 'OS', title: 'Revízia Protipožiarnych Zariadení register', annexOf: 'OS5', annexNo: 4 }],
  ['_OS6_Reklamačný poriadok_2025.pdf', { code: 'OS6', type: 'OS', title: 'Reklamačný poriadok', version: '2025' }],
  ['_OS7_Príloha č.1_Org. schéma spoločnosti.pdf', { code: 'OS7 Príloha č. 1', type: 'OS', title: 'Org. schéma spoločnosti', annexOf: 'OS7', annexNo: 1 }],
  ['_OS7_Príloha č.2_Zoznam OS a ŠPP.pdf', { code: 'OS7 Príloha č. 2', type: 'OS', title: 'Zoznam OS a ŠPP', annexOf: 'OS7', annexNo: 2 }],
  ['_OS7_Príloha č.3_Požiadavky na správnu veľkodistribučnú prax.pdf', { code: 'OS7 Príloha č. 3', type: 'OS', title: 'Požiadavky na správnu veľkodistribučnú prax', annexOf: 'OS7', annexNo: 3 }],
  ['_OS7_Príloha č.4_Nákresy priestorov skladu.pdf', { code: 'OS7 Príloha č. 4', type: 'OS', title: 'Nákresy priestorov skladu', annexOf: 'OS7', annexNo: 4 }],
  ['_OS7_Príloha č.5_DNA značky.pdf', { code: 'OS7 Príloha č. 5', type: 'OS', title: 'DNA značky', annexOf: 'OS7', annexNo: 5 }],
  [
    '_OS7_príloha3_k Príručke kvality_Požiadavky na správnu veľkodistribučnú prax_2025.pdf',
    { code: 'OS7 Príloha č. 3', type: 'OS', title: 'k Príručke kvality Požiadavky na správnu veľkodistribučnú prax', annexOf: 'OS7', annexNo: 3, version: '2025' }
  ],
  ['_OS7_Prirucka_kvality_vratane_priloh.pdf', { code: 'OS7', type: 'OS', title: 'Prirucka kvality vratane priloh' }],
  ['ID-04  Validácia počítačového informačného systému.pdf', { code: 'ID-04', type: 'ID', title: 'Validácia počítačového informačného systému' }],
  ['ME_Q_01_2022_Management incidentov v procese overovania HL.pdf', { code: 'ME Q 01', type: 'ME', title: 'Management incidentov v procese overovania HL', version: '2022', area: 'Q', departmentIndex: 1 }],
  ['SM_HR_003_2_Pracovný poriadok_od_01.01.2025.pdf', { code: 'SM HR 003', type: 'SM', title: 'Pracovný poriadok', version: '2', effectiveDate: '2025-01-01', area: 'HR', departmentIndex: 10 }],
  ['SM_Q_01_2022_Predchádzanie vstupu falšovaných liekov.pdf', { code: 'SM Q 01', type: 'SM', title: 'Predchádzanie vstupu falšovaných liekov', version: '2022', area: 'Q', departmentIndex: 1 }],
  ['ŠPP_01_2025_pre tvorbu dokumentácie.pdf', { code: 'ŠPP 01', type: 'ŠPP', title: 'pre tvorbu dokumentácie', version: '2025' }],
  ['ŠPP_02_2025_o školení personálu.pdf', { code: 'ŠPP 02', type: 'ŠPP', title: 'o školení personálu', version: '2025' }],
  ['ŠPP_03_2026_o riadení nákupu.pdf', { code: 'ŠPP 03', type: 'ŠPP', title: 'o riadení nákupu', version: '2026' }],
  ['ŠPP_04_2025_pre prácu s PC systémami a zariadeniami.pdf', { code: 'ŠPP 04', type: 'ŠPP', title: 'pre prácu s PC systémami a zariadeniami', version: '2025' }],
  ['ŠPP_05_2026_pre príjem a skladovanie tovaru.pdf', { code: 'ŠPP 05', type: 'ŠPP', title: 'pre príjem a skladovanie tovaru', version: '2026' }],
  ['ŠPP_06_2025_pre kvalifikáciu zákazníkov.pdf', { code: 'ŠPP 06', type: 'ŠPP', title: 'pre kvalifikáciu zákazníkov', version: '2025' }],
  ['ŠPP_07_2026_pre dodanie a prepravu tovaru.pdf', { code: 'ŠPP 07', type: 'ŠPP', title: 'pre dodanie a prepravu tovaru', version: '2026' }],
  ['ŠPP_08_2025_vratné obaly a kontajnery.pdf', { code: 'ŠPP 08', type: 'ŠPP', title: 'vratné obaly a kontajnery', version: '2025' }],
  ['ŠPP_09_2025_plán údržby.pdf', { code: 'ŠPP 09', type: 'ŠPP', title: 'plán údržby', version: '2025' }],
  ['ŠPP_10_2026_pre kvalifikáciu dodávateľov.pdf', { code: 'ŠPP 10', type: 'ŠPP', title: 'pre kvalifikáciu dodávateľov', version: '2026' }],
  ['ŠPP_12_2026_pre vnútorné inšpekcie.pdf', { code: 'ŠPP 12', type: 'ŠPP', title: 'pre vnútorné inšpekcie', version: '2026' }],
  ['ŠPP_13_2025_preprava termolabilných liekov.pdf', { code: 'ŠPP 13', type: 'ŠPP', title: 'preprava termolabilných liekov', version: '2025' }],
  ['ŠPP_14_2026_pri zistení nedostatkov v kvalite VL, VP, VTP,MdK.pdf', { code: 'ŠPP 14', type: 'ŠPP', title: 'pri zistení nedostatkov v kvalite VL, VP, VTP,MdK', version: '2026' }],
  ['ŠPP_15_2026_hlásenie nežiaducich účinkov VL, VP, VTP,MdK.pdf', { code: 'ŠPP 15', type: 'ŠPP', title: 'hlásenie nežiaducich účinkov VL, VP, VTP,MdK', version: '2026' }],
  ['ŠPP_16_2026_na zaobchádzanie s liekmi a tovarmi pred a po exspirácii.pdf', { code: 'ŠPP 16', type: 'ŠPP', title: 'na zaobchádzanie s liekmi a tovarmi pred a po exspirácii', version: '2026' }],
  ['ŠPP_17_2026_na zaobchádzanie s vyradenými liekmi a tovarmi.pdf', { code: 'ŠPP 17', type: 'ŠPP', title: 'na zaobchádzanie s vyradenými liekmi a tovarmi', version: '2026' }],
  ['ŠPP_18_2026_na zaobchádzanie s teplotne kontrolovanými dodávkami.pdf', { code: 'ŠPP 18', type: 'ŠPP', title: 'na zaobchádzanie s teplotne kontrolovanými dodávkami', version: '2026' }],
  ['ŠPP_19_2026_pre príjem, skladovanie, dodávanie, evidenciu a prepravu OPL.pdf', { code: 'ŠPP 19', type: 'ŠPP', title: 'pre príjem, skladovanie, dodávanie, evidenciu a prepravu OPL', version: '2026' }],
  ['ŠPP_20_2026_pre riadené skladovanie tovarov - WMS.pdf', { code: 'ŠPP 20', type: 'ŠPP', title: 'pre riadené skladovanie tovarov - WMS', version: '2026' }],
  ['ŠPP_21_2026_riadenie nápravných a preventívnych opatrení (CAPA).pdf', { code: 'ŠPP 21', type: 'ŠPP', title: 'riadenie nápravných a preventívnych opatrení (CAPA)', version: '2026' }],
  ['2021.04_Dodávanie HL veľkodistribútormi podľa Prílohy 1_Vyhlášky 82-2012 MZSR.pdf', { title: 'Dodávanie HL veľkodistribútormi podľa Prílohy 1 Vyhlášky 82-2012 MZSR', version: '2021.04' }],
  ['2021.04_Dodávanie hum. očkovacích látok reg.v SR veľkodistribútormi podľa Vyhlášky 82-2012 MZSR.pdf', { title: 'Dodávanie hum. očkovacích látok reg.v SR veľkodistribútormi podľa Vyhlášky 82-2012 MZSR', version: '2021.04' }],
  ['2024.09_DATALOGGER_Pokyny na zaobchádzanie s teplotne kontrol.zásielkami.pdf', { title: 'DATALOGGER Pokyny na zaobchádzanie s teplotne kontrol.zásielkami', version: '2024.09' }],
  ['2024.11_PHV procesy_hlásenie nežiaducich účinkov_hlásenie nedostatku v kvalite lieku.pdf', { title: 'PHV procesy hlásenie nežiaducich účinkov hlásenie nedostatku v kvalite lieku', version: '2024.11' }],
  ['2025.04_Požiadavky na správnu veľkodistribučnú prax pre VL.pdf', { title: 'Požiadavky na správnu veľkodistribučnú prax pre VL', version: '2025.04' }],
  ['2025.06_Pokyny pre jednotlivé oddelenia na zaobchádzanie s OPL.pdf', { title: 'Pokyny pre jednotlivé oddelenia na zaobchádzanie s OPL', version: '2025.06' }],
  ['Smernica Q_01-2017_Spolupráca s dodávateľmi krmív pri označovaní produktov.pdf', { code: 'Q 01-2017', type: 'SM', title: 'Spolupráca s dodávateľmi krmív pri označovaní produktov', area: 'Q', departmentIndex: 1 }],
  ['Smernica Q_02-2017_Etiketa pre krmivá a doplnkové krmivá.pdf', { code: 'Q 02-2017', type: 'SM', title: 'Etiketa pre krmivá a doplnkové krmivá', area: 'Q', departmentIndex: 1 }],
  [
    'Smernica Q_05-2017_Zaobchádzanie s omamnými a psychotropnými látkami_ver.04_21.01.2022.pdf',
    { code: 'Q 05-2017', type: 'SM', title: 'Zaobchádzanie s omamnými a psychotropnými látkami', version: '04', effectiveDate: '2022-01-21', area: 'Q', departmentIndex: 1 }
  ],
  ['Smernica Q_07-2017_Editácia a aktualizácia informácií v B2B.pdf', { code: 'Q 07-2017', type: 'SM', title: 'Editácia a aktualizácia informácií v B2B', area: 'Q', departmentIndex: 1 }],
  [
    'Smernica Q_08-2018_Správne určenie a zaradenie tovarovej položky do legisl.kat._ver.19.03.2025.pdf',
    { code: 'Q 08-2018', type: 'SM', title: 'Správne určenie a zaradenie tovarovej položky do legisl.kat.', effectiveDate: '2025-03-19', area: 'Q', departmentIndex: 1 }
  ],
  ['Smernica Q_09-2018_Etiketa alebo písomná info.pre používateľa pre veterinárne prípravky a pomôcky.pdf', { code: 'Q 09-2018', type: 'SM', title: 'Etiketa alebo písomná info.pre používateľa pre veterinárne prípravky a pomôcky', area: 'Q', departmentIndex: 1 }],
  ['Smernica Q_10-2020_Zaobchádzanie s poškodeným tovarom_ver.01.11.2024.pdf', { code: 'Q 10-2020', type: 'SM', title: 'Zaobchádzanie s poškodeným tovarom', effectiveDate: '2024-11-01', area: 'Q', departmentIndex: 1 }]
];

test('PHARMACOPOLA file names: code, type, title, edition, annexes', () => {
  for (const [name, expected] of CASES) assert.deepEqual(parseFileName(name), expected, name);
});

test('a newer edition of a file gets the same code (so it becomes a new version)', () => {
  assert.equal(parseFileName('ŠPP_05_2027_pre príjem a skladovanie tovaru.docx').code, parseFileName('ŠPP_05_2026_pre príjem a skladovanie tovaru.pdf').code);
  assert.equal(parseFileName('_OS1_Prevádzkový poriadok_2027.pdf').code, 'OS1');
});

test('copies in the "Anglické verzie" folder are marked as English', () => {
  assert.equal(parseFileName('_OS1_Operating rules_2026.pdf', 'C:\\Dokumenty\\OS\\Anglické verzie').lang, 'en');
  assert.equal(parseFileName('_OS1_Prevádzkový poriadok_2026.pdf', 'C:\\Dokumenty\\OS').lang, undefined);
  assert.equal(parseFileName('ŠPP_05_2026_Receipt and storage_EN.pdf').lang, 'en');
});

test('names outside the house pattern are left to the other rules', () => {
  for (const n of ['Plán školení 2026.xlsx', 'Zmluva o kvalite Medivet.pdf', 'scan0001.pdf', 'SOP-QA-001_Prijem.pdf']) assert.equal(parseFileName(n), null, n);
});
