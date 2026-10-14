'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { extractFile, decodeText } = require('../../src/main/lib/extract');
const { makeAll } = require('../fixtures/make');

let fx;
test.before(async () => {
  fx = await makeAll(fs.mkdtempSync(path.join(os.tmpdir(), 'sop-extract-')));
});

const all = (r) => r.pages.map((p) => p.text).join('\n');

test('PDF (pages, diacritics, paragraphs)', async () => {
  const r = await extractFile(path.join(__dirname, '..', 'fixtures', 'sample-sop.pdf'));
  assert.equal(r.status, 'ok');
  assert.equal(r.pages.length, 2);
  assert.match(r.pages[0].text, /SOP-QA-001 Príjem a skladovanie liekov/);
  assert.match(r.pages[0].text, /Verzia: 3\n\n?Dátum účinnosti/);
  assert.doesNotMatch(r.pages[0].text, /\n{3,}/);
  assert.match(r.pages[1].text, /chladiaci reťazec 2–8 °C/);
});

test('DOCX', async () => {
  const r = await extractFile(fx.docx);
  assert.equal(r.status, 'ok');
  assert.match(all(r), /Reklamácie, vratky a stiahnutie liekov z trhu/);
});

test('ODT', async () => {
  const r = await extractFile(fx.odt);
  assert.match(all(r), /ORGANIZAČNÁ SMERNICA č\. 4\/2023/);
});

test('RTF with cp1250 escapes', async () => {
  const r = await extractFile(fx.rtf);
  assert.match(all(r), /Sanitácia skladových priestorov/);
  assert.match(all(r), /štvrťročne/);
});

test('TXT in Windows-1250', async () => {
  const r = await extractFile(fx.txt);
  assert.match(all(r), /Veterinárne lieky sa vydávajú/);
});

test('XLSX', async () => {
  const r = await extractFile(fx.xlsx);
  assert.match(all(r), /Stiahnutie liekov z trhu – cvičenie \| jún 2026/);
});

test('unsupported and broken files never throw', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-bad-'));
  fs.writeFileSync(path.join(dir, 'a.png'), Buffer.from([1, 2, 3]));
  fs.writeFileSync(path.join(dir, 'b.pdf'), 'not a pdf');
  assert.equal((await extractFile(path.join(dir, 'a.png'))).status, 'unsupported');
  assert.equal((await extractFile(path.join(dir, 'b.pdf'))).status, 'error');
});

test('decodeText handles BOM and UTF-8', () => {
  assert.equal(decodeText(Buffer.from('﻿ľščť', 'utf8')), 'ľščť');
});
