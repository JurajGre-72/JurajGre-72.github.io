'use strict';
// The company's own rules take precedence over the literal text of the law.
//
// SOPs and directives describe how the company actually works. A law regulates many activities the
// company does not do (narcotics, mail-order sale, manufacturing, …), and a document may deliberately
// differ from a provision (stricter, or a different way that still meets the requirement). The archive
// keeps:
//   • a company profile: which activities the company performs and which it does not;
//   • decisions "does not apply to us" / "our document applies" for a provision of an act
//     (company-wide or for one document), each with a reason – shown to an inspector on request.
// Findings covered by a decision no longer count as findings. When the provision itself changes in a
// later version of the act, the earlier decision is shown again for a new assessment.

function fold(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// Activities of a wholesale distributor of human and veterinary medicines. `re` finds provisions that
// deal with the activity (diacritics removed, lower case); null = no automatic hint (e.g. outsourced
// transport still has requirements for the company).
const ACTIVITIES = [
  { id: 'human', sk: 'Veľkodistribúcia humánnych liekov', en: 'Wholesale of human medicines', re: null },
  { id: 'vet', sk: 'Veľkodistribúcia veterinárnych liekov', en: 'Wholesale of veterinary medicines', re: /veterinarn\w* liek/g },
  { id: 'devices', sk: 'Zdravotnícke pomôcky a diagnostiká in vitro', en: 'Medical devices and in vitro diagnostics', re: /zdravotnick\w* pomoc|diagnostick\w* zdravotnick|in vitro/g },
  { id: 'other', sk: 'Iný tovar (doplnky výživy, kozmetika, biocídy …)', en: 'Other goods (food supplements, cosmetics, biocides …)', re: null },
  { id: 'cold', sk: 'Lieky s chladovým reťazcom (2 – 8 °C)', en: 'Cold-chain medicines (2 – 8 °C)', re: /chladov\w* retaz|termolabil|\b2\s*[–-]\s*8\s*°?\s*c\b/g },
  { id: 'narcotics', sk: 'Omamné a psychotropné látky', en: 'Narcotic and psychotropic substances', re: /omamn\w*|psychotropn\w*/g },
  { id: 'precursors', sk: 'Drogové prekurzory', en: 'Drug precursors', re: /prekurzor\w*/g },
  { id: 'import', sk: 'Dovoz z tretích krajín', en: 'Import from third countries', re: /dovoz\w*[^.]{0,40}tret\w* krajin|tret\w* krajin[^.]{0,40}dovoz/g },
  { id: 'export', sk: 'Vývoz do tretích krajín', en: 'Export to third countries', re: /vyvoz\w*|vyvaz\w*/g },
  { id: 'parallel', sk: 'Paralelný dovoz / paralelná distribúcia', en: 'Parallel import / distribution', re: /paraleln\w* (dovoz|distribuc|obchod)/g },
  { id: 'brokering', sk: 'Sprostredkovanie (brokering) liekov', en: 'Brokering of medicines', re: /sprostredkov\w*|\bbroker\w*/g },
  { id: 'transport', sk: 'Vlastná preprava (vlastné vozidlá)', en: 'Own transport (own vehicles)', re: null },
  { id: 'mailorder', sk: 'Zásielkový / internetový predaj', en: 'Mail-order / online sale', re: /zasielkov\w*|internetov\w* (predaj|vydaj)|predaj\w* na dialku/g },
  { id: 'pharmacy', sk: 'Lekáreň / výdaj liekov pacientom', en: 'Pharmacy / dispensing to patients', re: /vydaj\w* liek\w* (pacient|na lekarsk)|lekarensk\w* starostlivost/g },
  { id: 'manufacture', sk: 'Výroba, balenie alebo označovanie liekov', en: 'Manufacture, packaging or labelling of medicines', re: /vyrob\w* liek|spravn\w* vyrobn\w* prax|povoleni\w* na vyrob/g },
  { id: 'feed', sk: 'Medikované krmivá', en: 'Medicated feed', re: /medikovan\w* krmiv/g },
  { id: 'clinical', sk: 'Skúšané lieky (klinické skúšanie)', en: 'Investigational medicines (clinical trials)', re: /skusan\w* (liek|produkt)|klinick\w* skusan/g }
];

// The two activities the company was set up for; everything else is left for the administrator.
function defaultCompany() {
  return { activities: { human: 'yes', vet: 'yes', other: 'yes' }, notes: '', updatedAt: null, updatedBy: null };
}

function cleanCompany(c) {
  const out = defaultCompany();
  out.activities = {};
  for (const a of ACTIVITIES) {
    const v = c && c.activities && c.activities[a.id];
    if (v === 'yes' || v === 'no') out.activities[a.id] = v;
  }
  out.notes = String((c && c.notes) || '').slice(0, 4000);
  return out;
}

/** Activities the company does not perform that a provision deals with: [{ id, hits }]. */
function activityHints(text, company, heading = '') {
  const not = ACTIVITIES.filter((a) => a.re && company && company.activities && company.activities[a.id] === 'no');
  if (!not.length || !text) return [];
  const body = fold(text);
  const head = fold(heading);
  const out = [];
  for (const a of not) {
    const hits = (body.match(a.re) || []).length;
    const inHead = !!head && (head.match(a.re) || []).length > 0;
    if (hits >= 2 || inHead) out.push({ id: a.id, hits });
  }
  return out.sort((x, y) => y.hits - x.hits);
}

const KINDS = ['na', 'ours']; // na = the provision does not apply to the company; ours = our document applies (deliberate difference)

/**
 * Does a decision cover a finding?
 * decision: { lawId, section ('*' = whole act), docId (null = company-wide), kind, atKey }
 * ctx: { lawId, docId, changeKey }   finding: { type, section }
 * Returns 'covered', 'reassess' (the provision changed since the decision) or null.
 */
function decisionCovers(d, ctx, f) {
  if (!d || d.lawId !== ctx.lawId) return null;
  if (d.docId && d.docId !== ctx.docId) return null;
  if (d.section !== '*' && d.section !== f.section) return null;
  if (f.type === 'changed' && ctx.changeKey && d.atKey !== ctx.changeKey) return 'reassess';
  return 'covered';
}

const SEV = { high: 3, medium: 2, low: 1, info: 0 };

/**
 * Apply the decisions to the findings of one document.
 * Returns { findings (each with .decision / .reassess when a decision applies), active, severity, direct }.
 *   active   – findings that still need attention
 *   direct   – cited sections changed by the act's new version that still need attention
 *   severity – from the active findings ('low' when the document cites the act, else 'info')
 */
function applyDecisions({ findings = [], direct = [], cites = false }, decisions, ctx) {
  const pick = (f) => {
    let reassess = null;
    for (const d of decisions || []) {
      const r = decisionCovers(d, ctx, f);
      if (r === 'covered') return { decision: d };
      if (r === 'reassess' && !reassess) reassess = d;
    }
    return reassess ? { reassess } : {};
  };
  const out = findings.map((f) => ({ ...f, ...pick(f) }));
  const active = out.filter((f) => !f.decision);
  const directActive = direct.filter((s) => !pick({ type: 'changed', section: s }).decision);
  let severity = cites ? 'low' : 'info';
  for (const f of active) if (SEV[f.severity] > SEV[severity]) severity = f.severity;
  if (directActive.length) severity = 'high';
  return { findings: out, active, severity, direct: directActive };
}

/** Text for the AI: what the company does and does not do, and its decisions about this act. */
function companyContext(company, decisions, { lang = 'sk', lawId = null, docId = null, sectionLabel = (s) => s } = {}) {
  const en = lang === 'en';
  const label = (a) => (en ? a.en : a.sk);
  const acts = (company && company.activities) || {};
  const yes = ACTIVITIES.filter((a) => acts[a.id] === 'yes').map(label);
  const no = ACTIVITIES.filter((a) => acts[a.id] === 'no').map(label);
  const rel = (decisions || []).filter((d) => (!lawId || d.lawId === lawId) && (!d.docId || !docId || d.docId === docId));
  const lines = [];
  if (yes.length) lines.push(`${en ? 'The company performs' : 'Spoločnosť vykonáva'}: ${yes.join('; ')}.`);
  if (no.length) lines.push(`${en ? 'The company does NOT perform' : 'Spoločnosť NEVYKONÁVA'}: ${no.join('; ')}.`);
  if (company && company.notes) lines.push(`${en ? 'Company specifics' : 'Špecifiká spoločnosti'}: ${company.notes}`);
  if (rel.length) {
    lines.push(en ? 'Decisions of the company about provisions:' : 'Rozhodnutia spoločnosti o ustanoveniach:');
    for (const d of rel.slice(0, 40)) {
      const what = d.section === '*' ? (en ? 'the whole act' : 'celý predpis') : sectionLabel(d.section);
      const kind = d.kind === 'na' ? (en ? 'does not apply to the company' : 'na spoločnosť sa nevzťahuje') : en ? "the company's document applies (deliberate difference)" : 'platí dokument spoločnosti (zámerný rozdiel)';
      lines.push(`- ${what}: ${kind}${d.docId ? (en ? ' (this document)' : ' (tento dokument)') : ''} – ${d.reason}`);
    }
  }
  return lines.join('\n');
}

module.exports = { ACTIVITIES, KINDS, defaultCompany, cleanCompany, activityHints, decisionCovers, applyDecisions, companyContext, fold };
