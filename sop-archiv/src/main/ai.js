'use strict';
// Optional AI assistant. OFF by default. Runs only on this computer or the company's internal
// network – company documents are never sent to an internet service.
//
//   ollama  – local model via Ollama (http://127.0.0.1:11434)
//   openai  – any local OpenAI-compatible server (LM Studio, llama.cpp, Jan, an internal server)

const { chunkPages } = require('./lib/text');
const { detectCitations } = require('./lib/metadata');

const DEFAULTS = {
  ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b', budget: 14000 },
  openai: { baseUrl: 'http://127.0.0.1:1234/v1', model: '', budget: 14000 }
};

/**
 * Only this computer or a private (company) network: localhost, 10.x, 172.16–31.x, 192.168.x,
 * IPv6 local addresses, *.local, or a single-label intranet name ("aiserver").
 */
function isLocalUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch (_) {
    return false;
  }
  if (!/^https?:$/.test(u.protocol)) return false;
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '::1' || h.endsWith('.local') || h.endsWith('.lan') || h.endsWith('.internal')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [+m[1], +m[2]];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (/^(fc|fd|fe80)/.test(h) && h.includes(':')) return true;
  return !h.includes('.') && !h.includes(':');
}

function cfgFor(ai) {
  const p = ai && ai.provider;
  if (!p || p === 'none' || !DEFAULTS[p]) return null;
  const d = DEFAULTS[p];
  return {
    provider: p,
    baseUrl: (ai.baseUrl || d.baseUrl).replace(/\/+$/, ''),
    model: ai.model || d.model,
    budget: Number(ai.budget) > 1000 ? Number(ai.budget) : d.budget,
    apiKey: ai.apiKey || ''
  };
}

async function fetchJson(url, body, { timeoutMs = 300000, headers = {} } = {}) {
  if (!isLocalUrl(url)) throw new Error('NOT_LOCAL');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      redirect: 'error'
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}

/** Send one system+user prompt to the configured local provider. Returns { text, model }. */
async function complete(ai, system, user, { log } = {}) {
  const c = cfgFor(ai);
  if (!c) throw new Error('AI is not configured');
  if (!isLocalUrl(c.baseUrl)) throw new Error('NOT_LOCAL');
  if (log) log({ purpose: 'ai', provider: c.provider, url: c.baseUrl, chars: system.length + user.length });
  if (c.provider === 'ollama') {
    const r = await fetchJson(`${c.baseUrl}/api/chat`, {
      model: c.model,
      stream: false,
      options: { temperature: 0.2, num_ctx: 16384 },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    });
    return { text: (r.message && r.message.content) || '', model: r.model || c.model };
  }
  const headers = c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {};
  const r = await fetchJson(
    `${c.baseUrl}/chat/completions`,
    {
      model: c.model || undefined,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    },
    { headers }
  );
  return { text: (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) || '', model: r.model || c.model };
}

/** Quick connectivity test; also lists available models. */
async function test(ai) {
  const c = cfgFor(ai);
  if (!c) throw new Error('AI is not configured');
  if (!isLocalUrl(c.baseUrl)) throw new Error('NOT_LOCAL');
  if (c.provider === 'ollama') {
    const r = await fetchJson(`${c.baseUrl}/api/tags`, null, { timeoutMs: 8000 });
    return { ok: true, models: (r.models || []).map((m) => m.name) };
  }
  const headers = c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {};
  const r = await fetchJson(`${c.baseUrl}/models`, null, { timeoutMs: 8000, headers });
  return { ok: true, models: (r.data || []).map((m) => m.id) };
}

// ---------------------------------------------------------------------------
// Prompts

const T = {
  sk: {
    impactSystem:
      'Si asistent pre súlad s legislatívou vo farmaceutickej veľkodistribučnej spoločnosti na Slovensku (humánne a veterinárne lieky). ' +
      'Porovnávaš zmeny v právnych predpisoch s internými riadenými dokumentmi (SOP, organizačné smernice) a konkrétne uvádzaš, čo treba v dokumente zmeniť a prečo. ' +
      'Vychádzaj výhradne z poskytnutých textov; nič si nedomýšľaj. Ak zmena dokument neovplyvňuje, jasne to povedz. Odpovedaj po slovensky, stručne a vecne.\n' +
      'Interné dokumenty opisujú, ako spoločnosť skutočne pracuje, a majú prednosť: dokument nemusí opakovať znenie predpisu a nenavrhuj ho prepisovať podľa doslovného textu zákona. ' +
      'Zmenu navrhni len tam, kde predpis pri činnostiach, ktoré spoločnosť vykonáva, niečo prikazuje alebo zakazuje a dokument s tým nie je v súlade. ' +
      'Ustanovenia o činnostiach, ktoré spoločnosť nevykonáva, a ustanovenia, o ktorých spoločnosť rozhodla, že sa na ňu nevzťahujú alebo že platí jej postup, nepovažuj za nesúlad. ' +
      'Prísnejší postup spoločnosti je v poriadku. Nikdy nedopĺňaj činnosti, ktoré spoločnosť nevykonáva. Ak spoločnosť činnosť zabezpečuje externe (napr. prepravu), jej povinnosti voči dodávateľovi platia ďalej.',
    impactFormat:
      'Odpoveď štruktúruj takto:\n1. Záver: OVPLYVNENÝ / MOŽNO OVPLYVNENÝ / NEOVPLYVNENÝ (jedna veta zdôvodnenia)\n2. Čo treba zmeniť: zoznam – časť dokumentu → navrhovaná úprava\n3. Prečo: odkaz na konkrétny § / článok a čo sa v ňom zmenilo\n4. Termín: od kedy zmena platí\n5. Neistoty: čo treba overiť v plnom znení predpisu',
    qaSystem:
      'Odpovedáš na otázky výhradne z poskytnutých úryvkov interných dokumentov spoločnosti. Pri každom fakte uveď zdroj v tvare [KÓD dokumentu, s. strana]. ' +
      'Ak odpoveď v úryvkoch nie je, povedz to otvorene. Odpovedaj po slovensky a stručne.',
    law: 'Právny predpis',
    versions: 'Porovnávané znenia',
    amendedBy: 'Novela (zmena urobená predpisom)',
    effective: 'Zmena platí od',
    changes: 'ZMENENÉ ČASTI PREDPISU',
    before: 'PÔVODNÉ ZNENIE',
    after: 'NOVÉ ZNENIE',
    added: 'NOVÁ ČASŤ',
    removed: 'ZRUŠENÁ ČASŤ',
    doc: 'INTERNÝ DOKUMENT',
    company: 'SPOLOČNOSŤ',
    excerpts: 'Relevantné časti dokumentu',
    cited: 'Dokument cituje',
    truncated: '[… text skrátený …]',
    question: 'Otázka',
    sources: 'Úryvky z dokumentov',
    found: 'Automaticky zistené rozdiely (over a vysvetli)',
    foundQty: 'dokument uvádza',
    foundLaw: 'predpis uvádza',
    foundMissing: 'dokument cituje časť, ktorá v tomto znení predpisu nie je',
    foundChanged: 'dokument cituje časť, ktorá sa zmenila'
  },
  en: {
    impactSystem:
      'You are a regulatory-compliance assistant for a pharmaceutical wholesale distributor in Slovakia (human and veterinary medicines). ' +
      "You compare changes in legislation with the company's controlled documents (SOPs, organizational directives) and state concretely what must be changed in the document and why. " +
      'Rely only on the texts provided; do not invent anything. If the change does not affect the document, say so clearly. Answer in English, concisely.\n' +
      "The internal documents describe how the company actually works and take precedence: a document need not repeat the act, and you must not propose rewriting it to the literal wording of the law. " +
      'Propose a change only where the act requires or forbids something for activities the company performs and the document does not comply. ' +
      'Provisions about activities the company does not perform, and provisions the company decided do not apply to it or where its own process applies, are not non-compliance. ' +
      'A stricter company process is fine. Never add activities the company does not perform. If the company outsources an activity (e.g. transport), its obligations towards the contractor still apply.',
    impactFormat:
      'Structure the answer as:\n1. Verdict: AFFECTED / POSSIBLY AFFECTED / NOT AFFECTED (one-sentence reason)\n2. What to change: list – document part → proposed change\n3. Why: the specific § / article and what changed in it\n4. Deadline: when the change takes effect\n5. Uncertainties: what to verify in the full text of the law',
    qaSystem:
      "You answer questions only from the provided excerpts of the company's internal documents. For every fact cite the source as [document CODE, p. page]. " +
      'If the answer is not in the excerpts, say so plainly. Answer concisely in the language of the question.',
    law: 'Legal act',
    versions: 'Compared versions',
    amendedBy: 'Amended by',
    effective: 'Change effective from',
    changes: 'CHANGED PARTS OF THE ACT',
    before: 'PREVIOUS TEXT',
    after: 'NEW TEXT',
    added: 'NEW PART',
    removed: 'REPEALED PART',
    doc: 'INTERNAL DOCUMENT',
    company: 'THE COMPANY',
    excerpts: 'Relevant parts of the document',
    cited: 'Document cites',
    truncated: '[… text shortened …]',
    question: 'Question',
    sources: 'Document excerpts',
    found: 'Differences found automatically (verify and explain)',
    foundQty: 'the document states',
    foundLaw: 'the act states',
    foundMissing: 'the document cites a part that is not in this version of the act',
    foundChanged: 'the document cites a part that changed'
  }
};

function lang(l) {
  return T[l] ? l : 'sk';
}

/**
 * Build the impact prompt for one change × one document within a character budget.
 * Returns { system, user, truncated }.
 */
function buildImpactPrompt({ change, law, diff, doc, pages, analysis, l, budget, companyText = '' }) {
  const t = T[lang(l)];
  let truncated = false;
  const citation = (doc.citations || []).find((c) => c.lawId === law.id);
  const cited = new Set(citation ? citation.sections : []);
  const sections = [];
  if (diff && diff.mode === 'sections') {
    for (const s of diff.changed) sections.push({ key: s.key, text: `### ${s.label}\n${t.before}:\n${s.oldText}\n\n${t.after}:\n${s.newText}` });
    for (const s of diff.added) sections.push({ key: s.key, text: `### ${s.label} (${t.added})\n${s.newText}` });
    for (const s of diff.removed) sections.push({ key: s.key, text: `### ${s.label} (${t.removed})\n${s.oldText}` });
    sections.sort((a, b) => Number(cited.has(b.key.replace(/#\d+$/, ''))) - Number(cited.has(a.key.replace(/#\d+$/, ''))));
  } else if (diff) {
    sections.push({ key: 'lines', text: `${t.removed}:\n${diff.removed.join('\n')}\n\n${t.added}:\n${diff.added.join('\n')}` });
  }

  // Document excerpts: the beginning (scope/purpose) + every chunk citing the law or a touched section.
  const chunks = chunkPages(pages, 900);
  const touched = new Set(change.touched || []);
  const relevant = [];
  chunks.forEach((c, i) => {
    const cites = detectCitations(c.text, [law]).length > 0;
    const secHit = Array.from(touched).some((k) => k.startsWith('§') && new RegExp(`§\\s*${k.slice(1)}(?![0-9a-z])`, 'i').test(c.text));
    if (i < 2 || cites || secHit) relevant.push(c);
  });

  const docBudget = Math.floor(budget * 0.45);
  const lawBudget = budget - docBudget;
  let docText = '';
  for (const c of relevant) {
    const piece = `${c.page ? `[s. ${c.page}] ` : ''}${c.heading && !c.text.startsWith(c.heading) ? c.heading + '\n' : ''}${c.text}\n\n`;
    if (docText.length + piece.length > docBudget) {
      truncated = true;
      break;
    }
    docText += piece;
  }
  let lawText = '';
  for (const s of sections) {
    if (lawText.length + s.text.length > lawBudget) {
      truncated = true;
      const room = lawBudget - lawText.length;
      if (room > 500) lawText += s.text.slice(0, room) + `\n${t.truncated}\n`;
      break;
    }
    lawText += s.text + '\n\n';
  }
  // Findings the app already computed (numbers / deadlines that differ, cited § missing).
  const found = ((analysis && analysis.findings) || [])
    .filter((f) => f.type !== 'related')
    .map((f) =>
      f.type === 'quantity'
        ? `- ${f.section}: ${t.foundQty} „${f.docValue}“, ${t.foundLaw}: ${f.lawValues.join(', ')}`
        : f.type === 'missing'
        ? `- ${f.section}: ${t.foundMissing}`
        : `- ${f.section}: ${t.foundChanged}`
    );
  const user = [
    ...(companyText ? [`== ${t.company} ==`, companyText, ''] : []),
    `${t.law}: ${law.title}`,
    `${t.versions}: ${change.fromDate || '?'} → ${change.toDate || '?'}`,
    `${t.effective}: ${change.toDate || '?'}`,
    ...(change.amendedBy && change.amendedBy.length ? [`${t.amendedBy}: ${change.amendedBy.join(', ')}`] : []),
    '',
    `== ${t.changes} ==`,
    lawText.trim(),
    '',
    `== ${t.doc}: ${doc.code ? doc.code + ' – ' : ''}${doc.title} (v${doc.version || '?'}) ==`,
    citation && citation.sections.length ? `${t.cited}: ${citation.sections.join(', ')}` : '',
    `${t.excerpts}:`,
    docText.trim(),
    '',
    found.length ? `${t.found}:\n${found.join('\n')}\n` : '',
    t.impactFormat
  ].join('\n');
  return { system: t.impactSystem, user, truncated };
}

function buildQaPrompt({ question, passages, l, budget }) {
  const t = T[lang(l)];
  let ctx = '';
  let truncated = false;
  for (const p of passages) {
    const piece = `[${p.doc.code || p.doc.title}${p.page ? `, s. ${p.page}` : ''}] ${p.doc.title}\n${p.text}\n\n`;
    if (ctx.length + piece.length > budget) {
      truncated = true;
      break;
    }
    ctx += piece;
  }
  return { system: t.qaSystem, user: `${t.sources}:\n\n${ctx.trim()}\n\n${t.question}: ${question}`, truncated };
}

module.exports = { complete, test, buildImpactPrompt, buildQaPrompt, cfgFor, isLocalUrl, DEFAULTS };
