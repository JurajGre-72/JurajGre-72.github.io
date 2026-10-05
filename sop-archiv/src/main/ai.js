'use strict';
// Optional AI assistance. OFF by default.
//
//   ollama     – local model via Ollama (http://127.0.0.1:11434). Nothing leaves the computer.
//   openai     – any local OpenAI-compatible server (LM Studio, llama.cpp, Jan…). Nothing leaves the computer.
//   anthropic  – Claude API with the user's own key. Text excerpts ARE sent to Anthropic (opt-in, labelled in the UI).

const Anthropic = require('@anthropic-ai/sdk');
const { chunkPages } = require('./lib/text');
const { detectCitations } = require('./lib/metadata');

const AnthropicClient = Anthropic.default || Anthropic;

const DEFAULTS = {
  ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b', budget: 14000 },
  openai: { baseUrl: 'http://127.0.0.1:1234/v1', model: '', budget: 14000 },
  anthropic: { baseUrl: '', model: 'claude-opus-5-5', budget: 200000 }
};

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
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}

/** Send one system+user prompt to the configured provider. Returns { text, model }. */
async function complete(ai, system, user, { effort = 'medium', log } = {}) {
  const c = cfgFor(ai);
  if (!c) throw new Error('AI is not configured');
  if (log) log({ purpose: 'ai', provider: c.provider, url: c.provider === 'anthropic' ? 'https://api.anthropic.com/v1/messages' : c.baseUrl, chars: system.length + user.length });
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
  if (c.provider === 'openai') {
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
  // Claude API (opt-in). Server-side refusal fallback is enabled so a declined request is retried on a fallback model.
  if (!c.apiKey) throw new Error('Missing Claude API key');
  const client = new AnthropicClient({ apiKey: c.apiKey, maxRetries: 2, timeout: 10 * 60 * 1000 });
  let response;
  try {
    response = await client.beta.messages.create({
      model: c.model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort },
      system,
      messages: [{ role: 'user', content: user }]
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new Error('Claude API: invalid API key');
    if (error instanceof Anthropic.RateLimitError) throw new Error('Claude API: rate limited – try again later');
    if (error instanceof Anthropic.BadRequestError) throw new Error(`Claude API: bad request – ${error.message}`);
    if (error instanceof Anthropic.APIConnectionError) throw new Error('Claude API: no connection');
    if (error instanceof Anthropic.APIError) throw new Error(`Claude API error ${error.status}: ${error.message}`);
    throw error;
  }
  if (response.stop_reason === 'refusal') {
    const why = response.stop_details && response.stop_details.explanation;
    throw new Error(`Claude declined the request${why ? `: ${why}` : ''}`);
  }
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  return { text, model: response.model };
}

/** Quick connectivity test; also lists available local models. */
async function test(ai) {
  const c = cfgFor(ai);
  if (!c) throw new Error('AI is not configured');
  if (c.provider === 'ollama') {
    const r = await fetchJson(`${c.baseUrl}/api/tags`, null, { timeoutMs: 8000 });
    return { ok: true, models: (r.models || []).map((m) => m.name) };
  }
  if (c.provider === 'openai') {
    const headers = c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {};
    const r = await fetchJson(`${c.baseUrl}/models`, null, { timeoutMs: 8000, headers });
    return { ok: true, models: (r.data || []).map((m) => m.id) };
  }
  const r = await complete(ai, 'Reply with the single word OK.', 'Test', { effort: 'low' });
  return { ok: /ok/i.test(r.text), models: [r.model] };
}

// ---------------------------------------------------------------------------
// Prompts

const T = {
  sk: {
    impactSystem:
      'Si asistent pre súlad s legislatívou vo farmaceutickej veľkodistribučnej spoločnosti na Slovensku (humánne a veterinárne lieky). ' +
      'Porovnávaš zmeny v právnych predpisoch s internými riadenými dokumentmi (SOP, organizačné smernice) a konkrétne uvádzaš, čo treba v dokumente zmeniť a prečo. ' +
      'Vychádzaj výhradne z poskytnutých textov; nič si nedomýšľaj. Ak zmena dokument neovplyvňuje, jasne to povedz. Odpovedaj po slovensky, stručne a vecne.',
    impactFormat:
      'Odpoveď štruktúruj takto:\n1. Záver: OVPLYVNENÝ / MOŽNO OVPLYVNENÝ / NEOVPLYVNENÝ (jedna veta zdôvodnenia)\n2. Čo treba zmeniť: zoznam – časť dokumentu → navrhovaná úprava\n3. Prečo: odkaz na konkrétny § / článok a čo sa v ňom zmenilo\n4. Termín: od kedy zmena platí\n5. Neistoty: čo treba overiť v plnom znení predpisu',
    qaSystem:
      'Odpovedáš na otázky výhradne z poskytnutých úryvkov interných dokumentov spoločnosti. Pri každom fakte uveď zdroj v tvare [KÓD dokumentu, s. strana]. ' +
      'Ak odpoveď v úryvkoch nie je, povedz to otvorene. Odpovedaj po slovensky a stručne.',
    law: 'Právny predpis',
    versions: 'Porovnávané znenia',
    effective: 'Zmena platí od',
    changes: 'ZMENENÉ ČASTI PREDPISU',
    before: 'PÔVODNÉ ZNENIE',
    after: 'NOVÉ ZNENIE',
    added: 'NOVÁ ČASŤ',
    removed: 'ZRUŠENÁ ČASŤ',
    doc: 'INTERNÝ DOKUMENT',
    excerpts: 'Relevantné časti dokumentu',
    cited: 'Dokument cituje',
    truncated: '[… text skrátený …]',
    question: 'Otázka',
    sources: 'Úryvky z dokumentov'
  },
  en: {
    impactSystem:
      'You are a regulatory-compliance assistant for a pharmaceutical wholesale distributor in Slovakia (human and veterinary medicines). ' +
      "You compare changes in legislation with the company's controlled documents (SOPs, organizational directives) and state concretely what must be changed in the document and why. " +
      'Rely only on the texts provided; do not invent anything. If the change does not affect the document, say so clearly. Answer in English, concisely.',
    impactFormat:
      'Structure the answer as:\n1. Verdict: AFFECTED / POSSIBLY AFFECTED / NOT AFFECTED (one-sentence reason)\n2. What to change: list – document part → proposed change\n3. Why: the specific § / article and what changed in it\n4. Deadline: when the change takes effect\n5. Uncertainties: what to verify in the full text of the law',
    qaSystem:
      "You answer questions only from the provided excerpts of the company's internal documents. For every fact cite the source as [document CODE, p. page]. " +
      'If the answer is not in the excerpts, say so plainly. Answer concisely in the language of the question.',
    law: 'Legal act',
    versions: 'Compared versions',
    effective: 'Change effective from',
    changes: 'CHANGED PARTS OF THE ACT',
    before: 'PREVIOUS TEXT',
    after: 'NEW TEXT',
    added: 'NEW PART',
    removed: 'REPEALED PART',
    doc: 'INTERNAL DOCUMENT',
    excerpts: 'Relevant parts of the document',
    cited: 'Document cites',
    truncated: '[… text shortened …]',
    question: 'Question',
    sources: 'Document excerpts'
  }
};

function lang(l) {
  return T[l] ? l : 'sk';
}

/**
 * Build the impact prompt for one change × one document within a character budget.
 * Returns { system, user, truncated }.
 */
function buildImpactPrompt({ change, law, diff, doc, pages, l, budget }) {
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
  const user = [
    `${t.law}: ${law.title}`,
    `${t.versions}: ${change.fromDate || '?'} → ${change.toDate || '?'}`,
    `${t.effective}: ${change.toDate || '?'}`,
    '',
    `== ${t.changes} ==`,
    lawText.trim(),
    '',
    `== ${t.doc}: ${doc.code ? doc.code + ' – ' : ''}${doc.title} (v${doc.version || '?'}) ==`,
    citation && citation.sections.length ? `${t.cited}: ${citation.sections.join(', ')}` : '',
    `${t.excerpts}:`,
    docText.trim(),
    '',
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

module.exports = { complete, test, buildImpactPrompt, buildQaPrompt, cfgFor, DEFAULTS };
