'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');

const D = require('../../src/main/lib/drafting');
const { buildDocx } = require('../../src/main/lib/docx');
const { extractFile } = require('../../src/main/lib/extract');

test('templates: procedure and directive outlines, or the outline of an existing document', () => {
  const sop = D.defaultSections('ŠPP');
  assert.equal(sop[4].heading, '5. Postup');
  assert.ok(sop.every((s) => s.hint));
  assert.equal(D.defaultSections('OS')[3].heading, '4. Ustanovenia smernice');
  assert.equal(D.defaultSections('SOP', 'en')[0].heading, '1. Purpose');
  const model = 'ŠPP 05 Vzorový príjem\n1. Účel\nPostup určuje príjem.\n2. Rozsah platnosti\nPre sklad.\n3. Zodpovednosti\nVedúci skladu.\n4. Postup príjmu tovaru\n4.1 Kontrola\nText.\n5. Záznamy\n';
  assert.deepEqual(D.sectionsFromText(model).map((s) => s.heading), ['1. Účel', '2. Rozsah platnosti', '3. Zodpovednosti', '4. Postup príjmu tovaru', '5. Záznamy']);
  assert.deepEqual(D.sectionsFromText('1. Jedna veta, ktorá končí bodkou.\nText'), [], 'sentences are not headings');
});

test('the next free code continues the numbering already in use', () => {
  const docs = [
    { type: 'ŠPP', code: 'ŠPP 01' },
    { type: 'ŠPP', code: 'ŠPP 21' },
    { type: 'ŠPP', code: 'ŠPP 05' },
    { type: 'OS', code: 'OS7' },
    { type: 'OS', code: 'OS5 Príloha č. 1', annexOf: 'OS5' },
    { type: 'OS', code: 'OS5 (EN)' },
    { type: 'OS', code: 'OS3' }
  ];
  assert.equal(D.suggestCode('ŠPP', docs), 'ŠPP 22');
  assert.equal(D.suggestCode('OS', docs), 'OS8', 'annexes and English copies are left out');
  assert.equal(D.suggestCode('SOP', [{ type: 'SOP', code: 'SOP-QA-009' }, { type: 'SOP', code: 'SOP-QA-010' }]), 'SOP-QA-011', 'zero padding kept');
  assert.equal(D.suggestCode('SM', []), 'SM 01');
});

const LAW = `§ 1\nPredmet\n(1) Zákon upravuje lieky.\n§ 18\nPovinnosti držiteľa povolenia\n(1) uchovávať záznamy o dodávkach päť rokov, viesť evidenciu dodávok.\n§ 19\nSkladovanie\n(1) Termolabilné lieky sa skladujú pri teplote 2 – 8 °C v chladiacich zariadeniach s monitorovaním teploty; skladovanie termolabilných liekov sa zaznamenáva.\n§ 20\nPreprava\n(1) Preprava liekov s monitorovaním teploty.`;

test('the parts of an act that concern the topic, best first, within the budget', () => {
  const ex = D.lawExcerpts(LAW, 'Skladovanie termolabilných liekov v chladiacich zariadeniach a monitorovanie teploty');
  assert.equal(ex[0].key, '§19');
  assert.ok(!ex.some((x) => x.key === '§1'));
  assert.deepEqual(D.lawExcerpts(LAW, 'a b c'), [], 'no topic, no excerpts');
  assert.ok(D.lawExcerpts(LAW, 'Skladovanie termolabilných liekov chladiacich zariadeniach monitorovaním teploty preprava', 120).length <= 1, 'budget');
});

test('instructions for drafting a chapter: company first, its own process, the acts, the outline', () => {
  const sections = D.defaultSections('ŠPP');
  const p = D.buildDraftPrompt({
    companyText: 'Spoločnosť NEVYKONÁVA: Omamné a psychotropné látky.',
    doc: { typeLabel: 'Štandardný pracovný postup', code: 'ŠPP 22', title: 'Príjem termolabilných liekov', department: 'Sklad' },
    description: 'Tovar preberá skladník, teplotu kontroluje podľa záznamu z dataloggera.',
    sections,
    index: 4,
    written: [{ heading: '1. Účel', text: 'Postup určuje príjem termolabilných liekov.' }],
    laws: [{ title: 'Zákon č. 362/2011 Z. z.', excerpts: D.lawExcerpts(LAW, 'termolabilných liekov teplote chladiacich') }],
    modelExcerpt: '5.1 Kontrola dokladov\nSkladník skontroluje dodací list.',
    budget: 8000
  });
  assert.match(p.system, /\[DOPLNIŤ/);
  assert.match(p.system, /má prednosť/);
  assert.match(p.system, /Nepridávaj činnosti, ktoré spoločnosť nevykonáva/);
  assert.ok(p.user.startsWith('== SPOLOČNOSŤ =='));
  assert.match(p.user, /datalogger/);
  assert.match(p.user, /→ 5\. Postup/);
  assert.match(p.user, /§ 19/);
  assert.match(p.user, /1\. Účel: Postup určuje/);
  assert.match(p.user, /Napíš obsah kapitoly „5\. Postup“/);
  assert.ok(p.user.length < 9000);
});

test('rewriting a passage: answer parsed into new text and reasons; chapter text cleaned', () => {
  const p = D.buildRewritePrompt({ doc: { code: 'ŠPP 05', title: 'Príjem' }, passage: 'Záznamy sa uchovávajú 3 roky.', instruction: 'Zosúlaď s aktuálnym znením predpisu.', laws: [{ title: 'Zákon', excerpts: [{ text: '§ 18 … päť rokov' }] }] });
  assert.match(p.system, /NOVÉ ZNENIE:/);
  assert.match(p.user, /Záznamy sa uchovávajú 3 roky/);
  const r = D.parseRewrite('NOVÉ ZNENIE:\nZáznamy sa uchovávajú päť rokov.\n\nZDÔVODNENIE:\n- Lehota podľa § 18 ods. 1 písm. l).\n- Bez ďalších zmien.');
  assert.equal(r.text, 'Záznamy sa uchovávajú päť rokov.');
  assert.deepEqual(r.reasons, ['Lehota podľa § 18 ods. 1 písm. l).', 'Bez ďalších zmien.']);
  assert.equal(D.parseRewrite('**NOVÉ ZNENIE:** Text\n**ZDÔVODNENIE:** - dôvod').text.replace(/\*/g, '').trim(), 'Text');
  assert.equal(D.parseRewrite('Len text bez značiek').text, 'Len text bez značiek');
  assert.equal(D.cleanSection('## 5. Postup\n\n5.1 Kontrola\n- krok', '5. Postup'), '5.1 Kontrola\n- krok');
  assert.equal(D.cleanSection('**Postup**\nText', '5. Postup'), 'Text');
});

// a 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('Word file: header with logo, title block, sections, highlighted places to complete', async () => {
  const buf = await buildDocx({
    doc: { org: 'PHARMACOPOLA s.r.o.', typeLabel: 'Štandardný pracovný postup', code: 'ŠPP 22', title: 'Príjem termolabilných liekov', version: '1', department: 'Sklad', preparedBy: 'Juraj Gregus', draft: true },
    sections: [
      { heading: '1. Účel', text: 'Postup určuje **príjem** & kontrolu <teploty>.' },
      { heading: '5. Postup', text: '5.1 Kontrola\n- prvý krok\n- druhý krok [DOPLNIŤ: lehota]' }
    ],
    logoPng: PNG
  });
  const zip = await JSZip.loadAsync(buf);
  for (const f of ['word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/header1.xml', 'word/footer1.xml', 'word/media/logo.png', 'docProps/core.xml']) assert.ok(zip.file(f), f);
  const docXml = await zip.file('word/document.xml').async('string');
  assert.match(docXml, /<w:highlight w:val="yellow"\/><\/w:rPr><w:t xml:space="preserve">\[DOPLNIŤ: lehota\]/);
  assert.match(docXml, /&amp; kontrolu &lt;teploty&gt;/);
  assert.match(await zip.file('word/header1.xml').async('string'), /r:embed="rIdLogo"/);
  assert.match(await zip.file('word/footer1.xml').async('string'), /NÁVRH – neriadená kópia/);
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sop-docx-')), 'x.docx');
  fs.writeFileSync(f, buf);
  const text = (await extractFile(f)).pages.map((p) => p.text).join('\n');
  for (const s of ['Príjem termolabilných liekov', 'ŠPP 22', 'Vypracoval', 'Juraj Gregus', '1. Účel', '5.1 Kontrola', 'druhý krok']) assert.ok(text.includes(s), s);
  const plain = await buildDocx({ doc: { title: 'Bez loga' }, sections: [] });
  assert.ok(!(await JSZip.loadAsync(plain)).file('word/media/logo.png'));
});

test('archive: change proposals are kept with a document (also one imported in this session)', async () => {
  const { Archive } = require('../../src/main/archive');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-prop-'));
  const a = new Archive({ dataDir: path.join(dir, 'arch'), user: 'qa' });
  await a.open();
  await a.buildIndex();
  const f = path.join(dir, 'SOP-QA-001.txt');
  fs.writeFileSync(f, 'SOP-QA-001 Skladovanie\nZáznamy sa uchovávajú 5 rokov podľa § 18 ods. 1 písm. l) zákona č. 362/2011 Z. z.');
  const doc = await a.importFile(f, {});
  const law = a.data.laws.find((l) => l.key === 'SK:362/2011');
  const p = await a.addProposal(doc.id, { original: 'Záznamy sa uchovávajú 5 rokov.', text: 'Záznamy sa uchovávajú 10 rokov.', reasons: ['§ 18 ods. 1 písm. l)'], instruction: 'Zosúlaď', lawIds: [law.id, 'unknown'], ai: { model: 'm', provider: 'builtin' } });
  assert.deepEqual(p.lawIds, [law.id], 'only acts in the register');
  assert.equal(a.getDoc(doc.id).proposals.length, 1);
  await a.updateProposal(doc.id, p.id, { status: 'done' });
  assert.equal(a.getDoc(doc.id).proposals[0].status, 'done');
  await a.removeProposal(doc.id, p.id);
  assert.equal(a.getDoc(doc.id).proposals.length, 0);
  assert.equal(await a.lawText(law.id), null, 'no stored text of the act yet');
});
