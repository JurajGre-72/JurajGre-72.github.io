'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const C = require('../../src/main/lib/company');
const ai = require('../../src/main/ai');
const { Archive } = require('../../src/main/archive');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sop-company-'));
}

test('activity hints: only for activities the company does not perform', () => {
  const profile = { activities: { narcotics: 'no', mailorder: 'no', vet: 'yes', cold: 'yes' } };
  const narc = 'Držiteľ povolenia na veľkodistribúciu omamných látok a psychotropných látok vedie osobitnú evidenciu omamných látok.';
  assert.deepEqual(C.activityHints(narc, profile).map((h) => h.id), ['narcotics']);
  assert.deepEqual(C.activityHints('Výdaj sa uskutoční zásielkovo.', profile, 'Zásielkový výdaj').map((h) => h.id), ['mailorder'], 'a heading is enough');
  assert.deepEqual(C.activityHints('Veterinárne lieky a veterinárne lieky.', profile), [], 'activities the company performs give no hint');
  assert.deepEqual(C.activityHints(narc, { activities: {} }), [], 'nothing set, nothing hinted');
  assert.deepEqual(C.activityHints('Preprava liekov a preprava zásielok.', { activities: { transport: 'no' } }), [], 'outsourced transport still has requirements: no hint');
});

test('decisions: company-wide or per document, whole act, and asked again when the provision changes', () => {
  const na = { lawId: 'L', section: '§21', docId: null, kind: 'na', atKey: '20250101', reason: 'Nedistribuujeme omamné látky.' };
  const ours = { lawId: 'L', section: '§18', docId: 'D1', kind: 'ours', atKey: '20250101', reason: 'Prísnejší postup.' };
  const ctx = { lawId: 'L', docId: 'D1', changeKey: '20250101' };
  assert.equal(C.decisionCovers(na, ctx, { type: 'quantity', section: '§21' }), 'covered');
  assert.equal(C.decisionCovers(na, { ...ctx, docId: 'D2' }, { type: 'quantity', section: '§21' }), 'covered', 'company-wide');
  assert.equal(C.decisionCovers(ours, { ...ctx, docId: 'D2' }, { type: 'quantity', section: '§18' }), null, 'only for its document');
  assert.equal(C.decisionCovers(na, { ...ctx, lawId: 'X' }, { type: 'quantity', section: '§21' }), null, 'other act');
  assert.equal(C.decisionCovers({ ...na, section: '*' }, ctx, { type: 'missing', section: '§99' }), 'covered', 'the whole act');
  assert.equal(C.decisionCovers(na, { ...ctx, changeKey: '20270101' }, { type: 'changed', section: '§21' }), 'reassess', 'the provision changed after the decision');
  assert.equal(C.decisionCovers(na, ctx, { type: 'changed', section: '§21' }), 'covered', 'same version as decided');

  const r = C.applyDecisions(
    { findings: [{ type: 'quantity', severity: 'medium', section: '§18' }, { type: 'quantity', severity: 'medium', section: '§21' }, { type: 'missing', severity: 'high', section: '§30' }], direct: ['§21'], cites: true },
    [na, ours],
    ctx
  );
  assert.equal(r.active.length, 1);
  assert.equal(r.active[0].section, '§30');
  assert.equal(r.severity, 'high');
  assert.deepEqual(r.direct, [], 'a changed cited section that does not apply is not escalated');
  const quiet = C.applyDecisions({ findings: [{ type: 'quantity', severity: 'medium', section: '§18' }], cites: true }, [ours], ctx);
  assert.equal(quiet.severity, 'low', 'all findings decided: the document only cites the act');
});

test('company context for the AI: what the company does, does not do, and its decisions', () => {
  const profile = { activities: { human: 'yes', vet: 'yes', narcotics: 'no' }, notes: 'Prepravu zabezpečuje externý dopravca.' };
  const decisions = [{ lawId: 'L', section: '§21', docId: null, kind: 'na', reason: 'Nedistribuujeme omamné látky.' }, { lawId: 'other', section: '§1', docId: null, kind: 'na', reason: 'iný predpis' }];
  const txt = C.companyContext(profile, decisions, { lang: 'sk', lawId: 'L', sectionLabel: (s) => s.replace('§', '§ ') });
  assert.match(txt, /Spoločnosť vykonáva: Veľkodistribúcia humánnych liekov; Veľkodistribúcia veterinárnych liekov\./);
  assert.match(txt, /NEVYKONÁVA: Omamné a psychotropné látky/);
  assert.match(txt, /externý dopravca/);
  assert.match(txt, /§ 21: na spoločnosť sa nevzťahuje – Nedistribuujeme omamné látky\./);
  assert.ok(!txt.includes('iný predpis'), 'only decisions about this act');
  const p = ai.buildImpactPrompt({ change: { touched: [] }, law: { id: 'L', title: 'Zákon' }, diff: null, doc: { title: 'SOP', citations: [] }, pages: [{ page: 1, text: 'Text' }], analysis: null, l: 'sk', budget: 8000, companyText: txt });
  assert.ok(p.user.startsWith('== SPOLOČNOSŤ ==\n'), 'the company comes first');
  assert.match(p.system, /majú prednosť/);
  assert.match(p.system, /Nikdy nedopĺňaj činnosti, ktoré spoločnosť nevykonáva/);
});

test('archive: company profile and decisions – findings covered, kept on recheck, asked again after a change, audited', async () => {
  const dir = tmpDir();
  const a = new Archive({ dataDir: path.join(dir, 'arch'), user: 'qa' });
  await a.open();
  await a.buildIndex();
  assert.deepEqual(a.companyProfile().activities, { human: 'yes', vet: 'yes', other: 'yes' }, 'starts with the two kinds of medicines');
  await a.updateCompany({ activities: { narcotics: 'no', other: '' }, notes: 'Jeden sklad.' });
  assert.deepEqual(a.companyProfile().activities, { human: 'yes', vet: 'yes', narcotics: 'no' });

  const src = path.join(dir, 'in');
  fs.mkdirSync(src);
  const f = path.join(src, 'SOP-SK-002.txt');
  fs.writeFileSync(
    f,
    'SOP-SK-002 Stiahnutie a evidencia\nVerzia: 1\n2. Stiahnutie\nŠarže sa stiahnu z trhu do 48 hodín podľa § 18 ods. 1 písm. k) zákona č. 362/2011 Z. z.\n3. Evidencia\nEvidencia sa uchováva 5 rokov podľa § 21 zákona č. 362/2011 Z. z.'
  );
  const sop = await a.importFile(f, {});
  const law = a.data.laws.find((l) => l.key === 'SK:362/2011');
  const v2025 =
    '§ 1\nPredmet\n(1) Zákon upravuje lieky.\n§ 18\nPovinnosti\n(1) k) stiahnuť liek z trhu do 24 hodín.\n§ 21\nOmamné látky\n(1) Evidencia omamných látok a psychotropných látok sa uchováva desať rokov; omamné látky sa skladujú oddelene.\n§ 22\nPreprava\n(1) Preprava liekov s monitorovaním teploty.';
  const c1 = await a.importLawText({ lawId: law.id, text: v2025, versionDate: '2025-01-01', source: { type: 'file', name: 'z.pdf' } });
  let full = await a.getChange(c1.id);
  let s = full.affected.find((x) => x.docId === sop.id);
  assert.equal(s.severity, 'medium');
  const q21 = s.findings.find((x) => x.type === 'quantity' && x.section === '§21');
  assert.ok(q21, 'different value at § 21');
  assert.deepEqual(q21.hints.map((h) => h.id), ['narcotics'], 'the provision is about an activity the company does not perform');

  // § 21 does not apply to the company; at § 18 the SOP applies (for this document)
  await assert.rejects(() => a.addDecision({ lawId: law.id, section: '§21', kind: 'na', reason: '' }), /REASON_REQUIRED/);
  const d21 = await a.addDecision({ lawId: law.id, section: '§21', kind: 'na', reason: 'Spoločnosť nedistribuuje omamné látky.', changeId: c1.id });
  assert.equal(d21.atKey, '20250101');
  assert.equal(d21.docId, null);
  full = await a.getChange(c1.id);
  s = full.affected.find((x) => x.docId === sop.id);
  assert.equal(s.findings.find((x) => x.section === '§21').decision.id, d21.id);
  assert.equal(s.severity, 'medium', '§ 18 still open');
  const d18 = await a.addDecision({ lawId: law.id, section: '§18', docId: sop.id, kind: 'ours', reason: 'Postup spoločnosti je overený a schválený.', changeId: c1.id });
  full = await a.getChange(c1.id);
  s = full.affected.find((x) => x.docId === sop.id);
  assert.equal(s.severity, 'low', 'nothing left to assess but the citation itself');
  assert.equal(a.data.changes.find((x) => x.id === c1.id).affected.find((x) => x.docId === sop.id).severity, 'low', 'stored state updated too');
  assert.equal(full.decisions.length, 2);

  // a recheck keeps the decisions
  full = await a.recheckChange(c1.id);
  assert.equal(full.affected.find((x) => x.docId === sop.id).severity, 'low');

  // § 21 changes in a newer version: the decision is shown again for a new assessment
  const v2027 = v2025.replace('desať rokov', 'pätnásť rokov');
  const c2 = await a.importLawText({ lawId: law.id, text: v2027, versionDate: '2027-01-01', source: { type: 'file', name: 'z2.pdf' } });
  full = await a.getChange(c2.id);
  s = full.affected.find((x) => x.docId === sop.id);
  const ch21 = s.findings.find((x) => x.type === 'changed' && x.section === '§21');
  assert.ok(ch21 && ch21.reassess && !ch21.decision, 'asked again');
  assert.equal(s.severity, 'high');
  // a new decision for the new version settles it
  await a.addDecision({ lawId: law.id, section: '§21', kind: 'na', reason: 'Stále nedistribuujeme omamné látky.', changeId: c2.id });
  assert.equal(a.data.decisions.filter((x) => x.section === '§21').length, 1, 'replaces the earlier decision');
  full = await a.getChange(c2.id);
  assert.equal(full.affected.find((x) => x.docId === sop.id).severity, 'low');

  // withdrawing a decision brings the finding back
  await a.removeDecision(d18.id);
  full = await a.getChange(c1.id);
  assert.equal(full.affected.find((x) => x.docId === sop.id).severity, 'medium');

  await new Promise((r) => setTimeout(r, 50));
  const log = await a.readAudit({ limit: 100 });
  assert.ok(log.some((r) => r.action === 'decision.added' && r.reason === 'Spoločnosť nedistribuuje omamné látky.'));
  assert.ok(log.some((r) => r.action === 'decision.removed'));
  assert.ok(log.some((r) => r.action === 'company.updated'));
});
