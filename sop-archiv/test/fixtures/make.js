'use strict';
// Generates sample documents in several formats for tests (no binary fixtures in git except one PDF).
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

function xmlEsc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function docx(file, paragraphs) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  );
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${xmlEsc(p)}</w:t></w:r></w:p>`).join('');
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  );
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
}

async function xlsx(file, rows) {
  const zip = new JSZip();
  const strings = [];
  const idx = (s) => {
    let i = strings.indexOf(s);
    if (i < 0) i = strings.push(s) - 1;
    return i;
  };
  const sheetRows = rows
    .map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => `<c r="${String.fromCharCode(65 + ci)}${ri + 1}" t="s"><v>${idx(c)}</v></c>`).join('')}</row>`)
    .join('');
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`);
  zip.file('xl/sharedStrings.xml', `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((s) => `<si><t>${xmlEsc(s)}</t></si>`).join('')}</sst>`);
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
}

async function odt(file, paragraphs) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text');
  zip.file(
    'content.xml',
    `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text>${paragraphs
      .map((p) => `<text:p>${xmlEsc(p)}</text:p>`)
      .join('')}</office:text></office:body></office:document-content>`
  );
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
}

function rtf(file, paragraphs) {
  // Encode non-ASCII as \'xx in cp1250, like Word does for Slovak text.
  const table = {};
  const dec = new TextDecoder('windows-1250');
  for (let b = 128; b < 256; b++) table[dec.decode(Uint8Array.of(b))] = b;
  const enc = (s) =>
    Array.from(s)
      .map((ch) => {
        const c = ch.charCodeAt(0);
        if (c < 128) return ch === '\\' || ch === '{' || ch === '}' ? '\\' + ch : ch;
        const b = table[ch];
        return b ? `\\'${b.toString(16)}` : `\\u${c}?`;
      })
      .join('');
  const body = paragraphs.map((p) => enc(p) + '\\par\n').join('');
  fs.writeFileSync(file, `{\\rtf1\\ansi\\ansicpg1250\\deff0{\\fonttbl{\\f0 Calibri;}}{\\*\\generator Test;}\n${body}}`, 'latin1');
}

function txt1250(file, text) {
  const table = {};
  const dec = new TextDecoder('windows-1250');
  for (let b = 0; b < 256; b++) table[dec.decode(Uint8Array.of(b))] = b;
  fs.writeFileSync(file, Buffer.from(Array.from(text).map((ch) => table[ch] ?? 63)));
}

const SOP_DOCX = [
  'PHARMACOPOLA s.r.o.',
  'Štandardný operačný postup',
  'SOP-SK-002 Reklamácie, vratky a stiahnutie liekov z trhu',
  'Verzia: 2',
  'Dátum účinnosti: 1. 2. 2024',
  'Dátum ďalšej revízie: 15. 10. 2026',
  'Vypracoval: Mgr. Peter Horváth',
  'Schválil: PharmDr. Eva Malá',
  '1. Účel',
  'Postup upravuje spracovanie reklamácií a stiahnutie liekov z trhu podľa § 18 ods. 1 písm. k) zákona č. 362/2011 Z. z. o liekoch a zdravotníckych pomôckach.',
  '2. Stiahnutie z trhu',
  'Pri rozhodnutí ŠÚKL o stiahnutí lieku z trhu sa dotknuté šarže okamžite zablokujú v systéme a presunú do karantény. Odberatelia sa informujú do 24 hodín.',
  '3. Vratky',
  'Vrátené lieky sa môžu vrátiť do predajného skladu len ak boli skladované pri teplote 15 – 25 °C a neboli otvorené, v súlade s kapitolou 6 usmernení 2013/C 343/01.'
];

const OS_ODT = [
  'ORGANIZAČNÁ SMERNICA č. 4/2023',
  'Ochrana osobných údajov zamestnancov a zákazníkov',
  'Platnosť od: 1. 6. 2023',
  'Najbližšia revízia: 1. 6. 2025',
  'Osobné údaje sa spracúvajú v súlade s nariadením (EÚ) 2016/679 (GDPR) a zákonom č. 18/2018 Z. z.',
  'Doba uchovávania záznamov o školeniach je 10 rokov.'
];

const RTF_PP = [
  'Pracovný postup PP-07 Sanitácia skladu',
  'Verzia 1.1',
  'Účinnosť od: 01.09.2025',
  'Sanitácia skladových priestorov sa vykonáva raz za mesiac. Deratizácia štvrťročne externou firmou.',
  'Záznam o sanitácii sa vedie vo formulári F-07-01.'
];

const TXT_VET = 'Pokyn pre veterinárne lieky\nVeterinárne lieky sa vydávajú len držiteľom povolenia podľa nariadenia (EÚ) 2019/6, článok 99 a zákona č. 39/2007 Z. z.\nKontrola teploty počas prepravy je povinná.';

async function makeAll(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const files = {
    docx: path.join(dir, 'SOP-SK-002_Reklamacie.docx'),
    odt: path.join(dir, 'OS_4_2023_ochrana_udajov.odt'),
    rtf: path.join(dir, 'PP-07 Sanitacia.rtf'),
    txt: path.join(dir, 'Pokyn veterinarne lieky.txt'),
    xlsx: path.join(dir, 'Plan_skoleni_2026.xlsx')
  };
  await docx(files.docx, SOP_DOCX);
  await odt(files.odt, OS_ODT);
  rtf(files.rtf, RTF_PP);
  txt1250(files.txt, TXT_VET);
  await xlsx(files.xlsx, [
    ['Plán školení 2026', 'Termín', 'Zodpovedný'],
    ['Správna distribučná prax – opakované školenie', 'marec 2026', 'QA manažér'],
    ['Stiahnutie liekov z trhu – cvičenie', 'jún 2026', 'Vedúci skladu']
  ]);
  return files;
}

module.exports = { makeAll };

if (require.main === module) {
  makeAll(process.argv[2] || path.join(__dirname, 'out')).then((f) => console.log(f));
}
