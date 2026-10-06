'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixOcrText, pagesWithoutText } = require('../../src/main/ocr');

test('OCR text: "$" before a number is "§", long dashes in ranges become "–"', () => {
  assert.equal(fixOcrText('Postup je v súlade s $ 18 zákona č. 362/2011 Z. z.'), 'Postup je v súlade s § 18 zákona č. 362/2011 Z. z.');
  assert.equal(fixOcrText('podľa $$ 18 a 19'), 'podľa §§ 18 a 19');
  assert.equal(fixOcrText('($18 ods. 1)'), '(§ 18 ods. 1)');
  assert.equal(fixOcrText('pri teplote 2 — 8 °C'), 'pri teplote 2 – 8 °C');
  assert.equal(fixOcrText('cena 25 $ za kus'), 'cena 25 $ za kus', 'a dollar after a number stays');
});

test('pages without a text layer are found', () => {
  assert.deepEqual(pagesWithoutText([{ page: 1, text: 'Plný text strany s dostatkom znakov na rozpoznanie.' }, { page: 2, text: '  12 ' }, { page: 3, text: '' }, { page: null, text: '' }]), [2, 3]);
});
