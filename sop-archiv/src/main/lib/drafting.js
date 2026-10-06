'use strict';
// Writing documents: templates for new SOPs and directives, the next free document code, the parts of
// the acts that concern a topic, and the instructions for the AI (draft a section, rewrite a passage).
//
// The company's own process is the basis: the AI writes down how the company works (from the author's
// description and its documents) and adds only what the law requires for activities the company
// performs. It never invents numbers, deadlines, names or forms – it marks them "[DOPLNIŤ: …]".

const { sectionMap } = require('./compliance');
const { words, processTerm } = require('./text');

// --- Templates --------------------------------------------------------------------------------------

const PROCEDURE = {
  sk: [
    ['Účel', 'Na čo postup slúži a aký výsledok zabezpečuje.'],
    ['Rozsah platnosti', 'Na ktoré činnosti, útvary, priestory a pracovníkov sa vzťahuje; čo nepokrýva.'],
    ['Zodpovednosti', 'Kto (funkcia) za čo zodpovedá – vedúci, vykonávajúci pracovník, odborný zástupca, QA.'],
    ['Pojmy a skratky', 'Vysvetlenie pojmov a skratiek použitých v postupe.'],
    ['Postup', 'Jednotlivé kroky v poradí, ako sa v spoločnosti vykonávajú; kontroly, odchýlky, čo robiť pri problémoch. Podkapitoly 5.1, 5.2 …'],
    ['Záznamy', 'Aké záznamy a formuláre vznikajú, kto ich vedie, kde a ako dlho sa uchovávajú.'],
    ['Súvisiace dokumenty a legislatíva', 'Súvisiace interné dokumenty a právne predpisy s presným označením (§, článok).'],
    ['Prílohy', 'Zoznam príloh (formuláre, schémy).'],
    ['Prehľad zmien', 'Verzia, dátum a stručný popis zmeny oproti predchádzajúcej verzii.']
  ],
  en: [
    ['Purpose', 'What the procedure is for and what it ensures.'],
    ['Scope', 'Which activities, departments, premises and staff it applies to; what it does not cover.'],
    ['Responsibilities', 'Who (position) is responsible for what.'],
    ['Definitions and abbreviations', 'Terms and abbreviations used.'],
    ['Procedure', 'The steps in the order the company performs them; checks, deviations, what to do if something goes wrong. Subsections 5.1, 5.2 …'],
    ['Records', 'Records and forms produced, who keeps them, where and for how long.'],
    ['Related documents and legislation', 'Related internal documents and legal acts with exact references (section, article).'],
    ['Annexes', 'List of annexes (forms, diagrams).'],
    ['Change history', 'Version, date and a short description of the change.']
  ]
};

const DIRECTIVE = {
  sk: [
    ['Úvodné ustanovenia', 'Účel smernice, rozsah platnosti, pre koho je záväzná.'],
    ['Pojmy a skratky', 'Vysvetlenie pojmov a skratiek.'],
    ['Zodpovednosti a právomoci', 'Kto (funkcia) za čo zodpovedá a aké má právomoci.'],
    ['Ustanovenia smernice', 'Pravidlá a postupy, ktoré smernica zavádza, v poradí podľa tém (podkapitoly 4.1, 4.2 …).'],
    ['Kontrola dodržiavania', 'Kto a ako kontroluje dodržiavanie smernice; čo pri porušení.'],
    ['Súvisiace dokumenty a legislatíva', 'Súvisiace interné dokumenty a právne predpisy s presným označením (§, článok).'],
    ['Záverečné ustanovenia', 'Platnosť a účinnosť, zrušenie predchádzajúcej verzie, revízia.'],
    ['Prílohy', 'Zoznam príloh.']
  ],
  en: [
    ['Introductory provisions', 'Purpose, scope, who must follow it.'],
    ['Definitions and abbreviations', 'Terms and abbreviations.'],
    ['Responsibilities and authority', 'Who (position) is responsible for what and their authority.'],
    ['Provisions', 'The rules and procedures the directive introduces, by topic (subsections 4.1, 4.2 …).'],
    ['Monitoring compliance', 'Who checks compliance and how; what happens on a breach.'],
    ['Related documents and legislation', 'Related internal documents and legal acts with exact references.'],
    ['Final provisions', 'Validity and effect, repeal of the previous version, review.'],
    ['Annexes', 'List of annexes.']
  ]
};

const SIMPLE = {
  sk: [
    ['Účel', 'Na čo dokument slúži.'],
    ['Obsah', 'Hlavný obsah dokumentu.'],
    ['Súvisiace dokumenty a legislatíva', 'Súvisiace dokumenty a predpisy.']
  ],
  en: [
    ['Purpose', 'What the document is for.'],
    ['Content', 'The main content.'],
    ['Related documents and legislation', 'Related documents and acts.']
  ]
};

/** Sections of a new document of this type: [{ heading: '1. Účel', title, hint }]. */
function defaultSections(type, lang = 'sk') {
  const l = lang === 'en' ? 'en' : 'sk';
  const set = ['SOP', 'ŠPP', 'PP'].includes(type) ? PROCEDURE : ['OS', 'SM', 'ME', 'MP', 'ID'].includes(type) ? DIRECTIVE : SIMPLE;
  return set[l].map(([title, hint], i) => ({ heading: `${i + 1}. ${title}`, title, hint }));
}

/** Top-level numbered headings of an existing document ("1. Účel", "2. Rozsah …"), to follow its structure. */
function sectionsFromText(text) {
  const out = [];
  const seen = new Set();
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*(\d{1,2})\.?\s+([A-ZÁČĎÉÍĽĹŇÓÔŔŠŤÚÝŽ][^\n]{2,70})\s*$/);
    if (!m) continue;
    const n = Number(m[1]);
    if (n !== out.length + 1 || seen.has(n)) continue;
    if (/[.;:,]$/.test(m[2].trim()) || m[2].split(/\s+/).length > 9) continue;
    seen.add(n);
    out.push({ heading: `${n}. ${m[2].trim()}`, title: m[2].trim(), hint: '' });
  }
  return out.length >= 3 ? out : [];
}

/** The next free code for a type, in the numbering the archive already uses ("ŠPP 21" -> "ŠPP 22"). */
function suggestCode(type, docs) {
  const codes = (docs || []).filter((d) => d.type === type && d.code && !d.annexOf && !/\(EN\)$/.test(d.code)).map((d) => d.code);
  const groups = new Map();
  for (const c of codes) {
    const m = c.match(/^(.*?)(\d+)$/);
    if (!m) continue;
    const g = groups.get(m[1]) || { prefix: m[1], max: 0, width: 0, count: 0 };
    g.max = Math.max(g.max, Number(m[2]));
    g.width = Math.max(g.width, m[2].length);
    g.count++;
    groups.set(m[1], g);
  }
  const best = Array.from(groups.values()).sort((a, b) => b.count - a.count || b.max - a.max)[0];
  if (best) return best.prefix + String(best.max + 1).padStart(best.width, '0');
  const start = { SOP: 'SOP-001', 'ŠPP': 'ŠPP 01', OS: 'OS1', SM: 'SM 01', ME: 'ME 01', ID: 'ID-01', PP: 'PP-01', MP: 'MP-01', F: 'F-01' };
  return start[type] || '';
}

// --- The parts of an act that concern a topic ----------------------------------------------------------

const STOP = new Set(
  ['ktoré', 'ktorý', 'ktorá', 'podľa', 'alebo', 'tohto', 'zákona', 'spoločnosť', 'spoločnosti', 'postup', 'postupu', 'dokument', 'dokumentu', 'liekov', 'lieky', 'pracovník', 'pracovníci', 'zabezpečuje', 'vykonáva']
    .map(processTerm)
    .filter(Boolean)
);

function topicTerms(text) {
  const out = new Set();
  for (const w of words(text)) {
    if (w.length < 5 || /\d/.test(w)) continue;
    const k = processTerm(w);
    if (k && k.length >= 4 && !STOP.has(k)) out.add(k);
  }
  return out;
}

/** Sections of an act that deal with the topic, best first, within a character budget: [{ key, label, text, score }]. */
function lawExcerpts(lawText, topic, budget = 6000) {
  const terms = topicTerms(topic);
  if (!terms.size) return [];
  const scored = [];
  for (const s of sectionMap(lawText).values()) {
    const body = `${s.heading || ''}\n${s.text || ''}`;
    const have = topicTerms(body);
    let score = 0;
    for (const k of terms) if (have.has(k)) score++;
    if (score >= 2 || (score >= 1 && terms.size <= 3)) scored.push({ key: s.key, label: s.label, text: body.trim(), score });
  }
  scored.sort((a, b) => b.score - a.score);
  const out = [];
  let used = 0;
  for (const s of scored) {
    const text = s.text.length > 2500 ? s.text.slice(0, 2500).replace(/\s+\S*$/, '') + ' …' : s.text;
    if (used + text.length > budget) break;
    out.push({ ...s, text });
    used += text.length;
  }
  return out;
}

// --- Instructions for the AI -------------------------------------------------------------------------

const P = {
  sk: {
    draftSystem:
      'Si skúsený manažér kvality (QA) vo farmaceutickej veľkodistribučnej spoločnosti na Slovensku (humánne a veterinárne lieky). ' +
      'Píšeš interné riadené dokumenty (SOP, štandardné pracovné postupy, organizačné smernice) po slovensky: vecne, presne, v neosobnom štýle bežnom v riadenej dokumentácii, s krátkymi vetami a odrážkami pri krokoch. ' +
      'Základom je skutočný postup spoločnosti, ako ho opísal autor – dokument opisuje, ako spoločnosť pracuje, a má prednosť pred doslovným znením predpisov. ' +
      'Z predpisov dopĺňaj len to, čo vyžadujú pre činnosti, ktoré spoločnosť vykonáva, a uveď presný odkaz (napr. § 18 ods. 1 písm. l) zákona č. 362/2011 Z. z.). Nepridávaj činnosti, ktoré spoločnosť nevykonáva. ' +
      'Nikdy si nevymýšľaj čísla, lehoty, teploty, mená, funkcie, názvy formulárov ani systémov, ktoré nie sú v podkladoch – na ich miesto napíš [DOPLNIŤ: čo treba doplniť]. ' +
      'Píš len obsah požadovanej kapitoly, bez jej nadpisu a bez úvodných či záverečných poznámok.',
    rewriteSystem:
      'Si skúsený manažér kvality (QA) vo farmaceutickej veľkodistribučnej spoločnosti na Slovensku. Upravuješ časť interného riadeného dokumentu podľa pokynu. ' +
      'Dokument opisuje, ako spoločnosť skutočne pracuje, a má prednosť: zachovaj jej postupy, funkcie, lehoty a formuláre; meň len to, čo vyžaduje pokyn alebo predpis pre činnosti, ktoré spoločnosť vykonáva. ' +
      'Prísnejší postup spoločnosti je v poriadku. Nepridávaj činnosti, ktoré spoločnosť nevykonáva. Nevymýšľaj údaje – kde chýbajú, napíš [DOPLNIŤ: …]. Pri požiadavke z predpisu uveď presný odkaz (§, článok). ' +
      'Odpovedz presne v tvare:\nNOVÉ ZNENIE:\n<upravený text>\nZDÔVODNENIE:\n- <čo si zmenil a prečo, s odkazom na predpis>\nAk netreba nič meniť, v časti NOVÉ ZNENIE zopakuj pôvodný text a v ZDÔVODNENÍ to napíš.',
    company: 'SPOLOČNOSŤ',
    doc: 'DOKUMENT',
    type: 'Druh',
    code: 'Kód',
    title: 'Názov',
    dept: 'Útvar',
    description: 'AKO TO V SPOLOČNOSTI FUNGUJE (popis od autora)',
    laws: 'PREDPISY – SÚVISIACE USTANOVENIA',
    model: 'VZOR ŠTÝLU – ukážka z existujúceho dokumentu spoločnosti',
    outline: 'OSNOVA DOKUMENTU',
    written: 'UŽ NAPÍSANÉ KAPITOLY (stručne)',
    task: (h, hint) => `Napíš obsah kapitoly „${h}“.${hint ? ` Kapitola má obsahovať: ${hint}` : ''}`,
    passage: 'UPRAVOVANÝ TEXT',
    context: 'OKOLIE TEXTU V DOKUMENTE',
    instruction: 'POKYN',
    newText: 'NOVÉ ZNENIE:',
    reasons: 'ZDÔVODNENIE:'
  },
  en: {
    draftSystem:
      'You are an experienced quality manager (QA) at a pharmaceutical wholesale distributor in Slovakia (human and veterinary medicines). ' +
      'You write internal controlled documents (SOPs, working procedures, directives) in English: factual, precise, impersonal, short sentences and bullet points for steps. ' +
      "The basis is the company's actual process as described by the author – the document describes how the company works and takes precedence over the literal text of the law. " +
      'From the acts add only what they require for activities the company performs, with exact references (e.g. § 18(1)(l) of Act No. 362/2011). Do not add activities the company does not perform. ' +
      'Never invent numbers, deadlines, temperatures, names, positions, form or system names that are not in the material – write [COMPLETE: what is needed] instead. ' +
      'Write only the content of the requested chapter, without its heading and without introductory or closing remarks.',
    rewriteSystem:
      'You are an experienced quality manager (QA) at a pharmaceutical wholesale distributor in Slovakia. You revise part of an internal controlled document as instructed. ' +
      "The document describes how the company actually works and takes precedence: keep its processes, positions, deadlines and forms; change only what the instruction or the law requires for activities the company performs. " +
      'A stricter company process is fine. Do not add activities the company does not perform. Do not invent data – write [COMPLETE: …] where it is missing. Give exact references (section, article) for legal requirements. ' +
      'Answer exactly in the form:\nNEW TEXT:\n<revised text>\nREASONS:\n- <what you changed and why, with the legal reference>\nIf nothing needs to change, repeat the original text under NEW TEXT and say so under REASONS.',
    company: 'THE COMPANY',
    doc: 'DOCUMENT',
    type: 'Type',
    code: 'Code',
    title: 'Title',
    dept: 'Department',
    description: 'HOW IT WORKS IN THE COMPANY (author’s description)',
    laws: 'LEGAL ACTS – RELATED PROVISIONS',
    model: 'STYLE EXAMPLE – from an existing company document',
    outline: 'DOCUMENT OUTLINE',
    written: 'CHAPTERS ALREADY WRITTEN (brief)',
    task: (h, hint) => `Write the content of the chapter "${h}".${hint ? ` It should contain: ${hint}` : ''}`,
    passage: 'TEXT TO REVISE',
    context: 'SURROUNDING TEXT IN THE DOCUMENT',
    instruction: 'INSTRUCTION',
    newText: 'NEW TEXT:',
    reasons: 'REASONS:'
  }
};

function clip(text, max) {
  const t = String(text || '').trim();
  return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') + ' …' : t;
}

function lawsBlock(laws, budget) {
  let out = '';
  for (const l of laws || []) {
    const head = `### ${l.title}\n`;
    let body = '';
    for (const x of l.excerpts || []) {
      const piece = `${x.text}\n\n`;
      if (out.length + head.length + body.length + piece.length > budget) break;
      body += piece;
    }
    if (body) out += head + body;
  }
  return out.trim();
}

/**
 * One chapter of a new document.
 * { lang, companyText, doc: { typeLabel, code, title, department }, description, sections, index, written: [{ heading, text }], laws: [{ title, excerpts }], modelExcerpt, budget }
 */
function buildDraftPrompt({ lang = 'sk', companyText = '', doc = {}, description = '', sections = [], index = 0, written = [], laws = [], modelExcerpt = '', budget = 12000 }) {
  const t = P[lang] || P.sk;
  const s = sections[index];
  const outline = sections.map((x, i) => `${i === index ? '→ ' : ''}${x.heading}`).join('\n');
  const done = written
    .filter((w) => w && w.text && w.text.trim())
    .map((w) => `${w.heading}: ${clip(w.text.replace(/\s+/g, ' '), 300)}`)
    .join('\n');
  const parts = [
    companyText ? `== ${t.company} ==\n${companyText}` : '',
    `== ${t.doc} ==\n${t.type}: ${doc.typeLabel || ''}\n${t.code}: ${doc.code || ''}\n${t.title}: ${doc.title || ''}${doc.department ? `\n${t.dept}: ${doc.department}` : ''}`,
    description ? `== ${t.description} ==\n${clip(description, 4000)}` : '',
    `== ${t.outline} ==\n${outline}`,
    done ? `== ${t.written} ==\n${done}` : ''
  ].filter(Boolean);
  const fixed = parts.join('\n\n').length + 600;
  const lawText = lawsBlock(laws, Math.max(1500, Math.floor((budget - fixed) * 0.7)));
  if (lawText) parts.push(`== ${t.laws} ==\n${lawText}`);
  if (modelExcerpt) parts.push(`== ${t.model} ==\n${clip(modelExcerpt, Math.max(600, Math.min(2000, budget - fixed - lawText.length)))}`);
  parts.push(t.task(s.heading, s.hint));
  return { system: t.draftSystem, user: parts.join('\n\n') };
}

/** Clean an AI chapter: no repeated heading, no "Here is …" lines, placeholders kept. */
function cleanSection(text, heading) {
  let t = String(text || '').replace(/\r/g, '').trim();
  const title = String(heading || '').replace(/^\d+\.\s*/, '').trim().toLowerCase();
  const lines = t.split('\n');
  while (lines.length && (!lines[0].trim() || lines[0].replace(/^[#*\s\d.]+/, '').replace(/\*+$/, '').trim().toLowerCase() === title)) lines.shift();
  t = lines.join('\n').replace(/^#+\s*/gm, '').trim();
  return t;
}

/**
 * Revise a passage. { lang, companyText, doc, passage, instruction, context, laws }
 */
function buildRewritePrompt({ lang = 'sk', companyText = '', doc = {}, passage = '', instruction = '', context = '', laws = [], budget = 12000 }) {
  const t = P[lang] || P.sk;
  const parts = [
    companyText ? `== ${t.company} ==\n${companyText}` : '',
    `== ${t.doc} ==\n${[doc.code, doc.title].filter(Boolean).join(' – ')}${doc.version ? ` (v${doc.version})` : ''}`,
    `== ${t.instruction} ==\n${instruction}`,
    `== ${t.passage} ==\n${clip(passage, 6000)}`
  ].filter(Boolean);
  const fixed = parts.join('\n\n').length + 400;
  const lawText = lawsBlock(laws, Math.max(1500, Math.floor((budget - fixed) * 0.75)));
  if (lawText) parts.push(`== ${t.laws} ==\n${lawText}`);
  if (context) parts.push(`== ${t.context} ==\n${clip(context, Math.max(500, Math.min(2500, budget - fixed - lawText.length)))}`);
  return { system: t.rewriteSystem, user: parts.join('\n\n') };
}

/** { text, reasons: [] } from an answer in the "NOVÉ ZNENIE / ZDÔVODNENIE" form (tolerant of small deviations). */
function parseRewrite(answer) {
  const a = String(answer || '').replace(/\r/g, '');
  const nt = a.search(/(NOVÉ ZNENIE|NOVE ZNENIE|NEW TEXT)\s*:/i);
  const rs = a.search(/(ZDÔVODNENIE|ZDOVODNENIE|REASONS)\s*:/i);
  let text = a;
  let reasons = '';
  if (nt >= 0) text = a.slice(a.indexOf(':', nt) + 1, rs > nt ? rs : undefined);
  else if (rs >= 0) text = a.slice(0, rs);
  if (rs >= 0) reasons = a.slice(a.indexOf(':', rs) + 1);
  return {
    text: text.replace(/^\s*\*+\s*$/gm, '').trim(),
    reasons: reasons
      .split('\n')
      .map((l) => l.replace(/^\s*[-–•*]\s*/, '').trim())
      .filter(Boolean)
  };
}

module.exports = { defaultSections, sectionsFromText, suggestCode, lawExcerpts, topicTerms, buildDraftPrompt, buildRewritePrompt, parseRewrite, cleanSection };
