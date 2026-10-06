'use strict';
// Writing with the AI: a new document from a template (chapter by chapter), and proposals to rewrite
// a passage of an existing document according to the acts and the company's own rules.
// The AI's answer streams to the window ("ai:chunk"); every use is recorded in the audit trail.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const D = require('./lib/drafting');
const { buildDocx } = require('./lib/docx');
const { companyContext } = require('./lib/company');
const { detectCitations } = require('./lib/metadata');
const { sectionMap } = require('./lib/compliance');

function register({ handle, getArchive, ai, aiConfig, send, logNet, lang, tr, UserError, dialog, getWindow }) {
  const jobs = new Map(); // request id -> AbortController

  const typeLabel = (type) => {
    const t = (getArchive().data.settings.docTypes || []).find((x) => x.id === type);
    return t ? (lang() === 'en' ? t.en : t.sk) : type || '';
  };
  const sectionText = (k) => String(k).replace(/^§/, '§ ').replace(/^art/, lang() === 'en' ? 'Art. ' : 'čl. ');

  async function needAi() {
    const cfg = aiConfig();
    if (!ai.cfgFor(cfg)) throw new UserError(tr('err.noAi'));
    await ai.prepare(cfg);
    return cfg;
  }

  async function run(reqId, cfg, prompt, maxTokens) {
    const ctrl = new AbortController();
    jobs.set(reqId, ctrl);
    try {
      return await ai.complete(cfg, prompt.system, prompt.user, { log: logNet, signal: ctrl.signal, maxTokens, onChunk: (text) => send('ai:chunk', { reqId, text }) });
    } finally {
      jobs.delete(reqId);
    }
  }

  /** Relevant sections of the chosen acts for a topic: [{ lawId, title, excerpts }]. */
  async function lawsFor(lawIds, topic, perLaw, extraKeys = new Map()) {
    const a = getArchive();
    const out = [];
    for (const lawId of lawIds || []) {
      const law = a.data.laws.find((l) => l.id === lawId);
      if (!law) continue;
      const text = await a.lawText(lawId);
      if (!text) continue;
      const ex = D.lawExcerpts(text, topic, perLaw);
      // Sections cited in the text itself come first.
      const cited = extraKeys.get(lawId) || [];
      if (cited.length) {
        const map = sectionMap(text);
        for (const k of cited.slice().reverse()) {
          const sec = map.get(k);
          if (sec && !ex.some((x) => x.key === k)) ex.unshift({ key: k, label: sec.label, text: `${sec.heading || ''}\n${sec.text}`.trim().slice(0, 2500), score: 99 });
        }
      }
      if (ex.length) out.push({ lawId, title: law.title, excerpts: ex });
    }
    return out;
  }

  handle('ai:cancel', (reqId) => {
    const c = jobs.get(reqId);
    if (c) c.abort();
    return true;
  });

  // --- New document ------------------------------------------------------------------------------
  handle(
    'compose:init',
    async (type) => {
      const a = getArchive();
      const docs = a.data.docs.filter((d) => d.status !== 'obsolete');
      const laws = [];
      for (const l of a.data.laws) {
        const st = l.state || {};
        const hasText = [st.newestKey, st.snapshotKey, st.lastImport && st.lastImport.key].some((k) => k && a.hasSnapshot(l.id, k));
        laws.push({ id: l.id, title: l.title, short: l.short, hasText });
      }
      return {
        code: D.suggestCode(type, docs),
        sections: D.defaultSections(type, lang()),
        laws,
        models: docs.filter((d) => !d.annexOf).map((d) => ({ id: d.id, code: d.code, title: d.title, type: d.type })),
        user: a.user
      };
    },
    { perm: 'editor' }
  );

  handle(
    'compose:outlineOf',
    async (docId) => {
      const a = getArchive();
      const pages = await a.docText(docId);
      return D.sectionsFromText(pages.map((p) => p.text).join('\n'));
    },
    { perm: 'editor' }
  );

  /** Acts whose stored text deals with the topic: [{ lawId, title, sections: ['§ 19', …] }], best first. */
  handle(
    'compose:suggestLaws',
    async (topic) => {
      const a = getArchive();
      const ids = a.data.laws.map((l) => l.id);
      const found = await lawsFor(ids, topic, 4000);
      return found
        .map((f) => ({ lawId: f.lawId, title: f.title, score: f.excerpts.reduce((n, x) => n + x.score, 0), sections: f.excerpts.slice(0, 6).map((x) => x.label) }))
        .sort((x, y) => y.score - x.score)
        .slice(0, 8);
    },
    { perm: 'editor' }
  );

  handle(
    'compose:draftSection',
    async (reqId, p) => {
      const cfg = await needAi();
      const a = getArchive();
      const budget = ai.cfgFor(cfg).budget;
      const s = p.sections[p.index];
      const topic = `${p.doc.title || ''} ${p.description || ''} ${s.title || s.heading || ''} ${s.hint || ''}`;
      const laws = await lawsFor(p.lawIds, topic, Math.floor(budget * 0.4));
      let modelExcerpt = '';
      if (p.modelDocId) {
        const pages = await a.docText(p.modelDocId).catch(() => []);
        modelExcerpt = pages.map((x) => x.text).join('\n').slice(0, 2500);
      }
      const companyText = companyContext(a.companyProfile(), a.data.decisions, { lang: lang(), sectionLabel: sectionText });
      const prompt = D.buildDraftPrompt({ lang: lang(), companyText, doc: { ...p.doc, typeLabel: typeLabel(p.doc.type) }, description: p.description, sections: p.sections, index: p.index, written: p.written || [], laws, modelExcerpt, budget });
      const r = await run(reqId, cfg, prompt, 1600);
      a.audit('ai.draft', { code: p.doc.code, title: p.doc.title, section: s.heading, provider: cfg.provider, model: r.model });
      return { text: D.cleanSection(r.text, s.heading), model: r.model, provider: cfg.provider, aborted: !!r.aborted };
    },
    { perm: 'editor' }
  );

  async function docxFor(p) {
    const a = getArchive();
    const logo = p.logoPng ? Buffer.from(String(p.logoPng).replace(/^data:image\/png;base64,/, ''), 'base64') : null;
    return buildDocx({
      lang: lang(),
      logoPng: logo,
      doc: { org: a.data.org || '', typeLabel: typeLabel(p.doc.type), code: p.doc.code, title: p.doc.title, version: p.doc.version || '1', effectiveDate: p.doc.effectiveDate || '', department: p.doc.department || '', preparedBy: p.doc.owner || a.user, approvedBy: p.doc.approver || '', draft: true },
      sections: (p.sections || []).map((s) => ({ heading: s.heading, text: s.text || '' }))
    });
  }

  const fileNameFor = (doc) => `${[doc.code, doc.title].filter(Boolean).join('_').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_').slice(0, 120) || 'dokument'}.docx`;

  /** Save the new document into the archive as a draft (status "draft"), as a Word file. */
  handle(
    'compose:save',
    async (p) => {
      const a = getArchive();
      if (!p.doc || !String(p.doc.title || '').trim()) throw new UserError(tr('err.titleRequired'));
      const buf = await docxFor(p);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-new-'));
      const file = path.join(dir, fileNameFor(p.doc));
      try {
        fs.writeFileSync(file, buf, { mode: 0o600 });
        const doc = await a.importFile(file, { type: p.doc.type, code: p.doc.code, title: p.doc.title, department: p.doc.department, owner: p.doc.owner, approver: p.doc.approver, version: p.doc.version || '1', status: 'draft', effectiveDate: p.doc.effectiveDate || null });
        a.audit('doc.created', { docId: doc.id, code: doc.code, title: doc.title, ai: p.aiUsed ? p.aiModel || true : undefined, sections: (p.sections || []).length });
        return doc;
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    { perm: 'editor', write: true }
  );

  handle(
    'compose:saveCopy',
    async (p) => {
      const r = await dialog.showSaveDialog(getWindow(), { defaultPath: fileNameFor(p.doc), filters: [{ name: 'Word', extensions: ['docx'] }] });
      if (r.canceled || !r.filePath) return null;
      fs.writeFileSync(r.filePath, await docxFor(p));
      getArchive().audit('doc.copy-saved', { code: p.doc.code, title: p.doc.title, file: path.basename(r.filePath), draft: true });
      return r.filePath;
    },
    { perm: 'editor' }
  );

  // --- Rewriting a passage of an existing document -------------------------------------------------
  /** The document's text in passages (headings kept), to choose what to rewrite. */
  handle(
    'rewrite:passages',
    async (docId) => {
      const a = getArchive();
      const doc = a.getDoc(docId);
      const pages = await a.docText(docId);
      const out = [];
      for (const pg of pages) {
        for (const block of String(pg.text || '').split(/\n\s*\n|\n(?=\s*\d{1,2}(?:\.\d{1,2})*\.?\s+[A-ZÁČĎÉÍĽĹŇÓÔŔŠŤÚÝŽ])/)) {
          const t = block.trim();
          if (t.length < 25) continue;
          out.push({ page: pg.page || null, text: t.length > 4000 ? t.slice(0, 4000) : t });
        }
      }
      return { passages: out.slice(0, 400), cites: (doc.citations || []).map((c) => c.lawId) };
    },
    { perm: 'editor' }
  );

  handle(
    'rewrite:propose',
    async (reqId, p) => {
      const cfg = await needAi();
      const a = getArchive();
      const doc = a.getDoc(p.docId);
      if (!doc) throw new Error('Document not found');
      const budget = ai.cfgFor(cfg).budget;
      const lawIds = p.lawIds && p.lawIds.length ? p.lawIds : (doc.citations || []).map((c) => c.lawId);
      // Sections the passage itself cites are always included.
      const cited = new Map(detectCitations(p.passage, a.data.laws).map((c) => [c.lawId, c.sections]));
      const laws = await lawsFor(lawIds, `${p.passage}\n${p.instruction || ''}`, Math.floor(budget * 0.45), cited);
      const companyText = companyContext(a.companyProfile(), a.data.decisions, { lang: lang(), docId: doc.id, sectionLabel: sectionText });
      const prompt = D.buildRewritePrompt({ lang: lang(), companyText, doc, passage: p.passage, instruction: p.instruction, context: p.context || '', laws, budget });
      const r = await run(reqId, cfg, prompt, 2000);
      a.audit('ai.rewrite', { docId: doc.id, code: doc.code, provider: cfg.provider, model: r.model });
      const parsed = D.parseRewrite(r.text);
      return { ...parsed, raw: r.text, model: r.model, provider: cfg.provider, aborted: !!r.aborted, laws: laws.map((l) => ({ lawId: l.lawId, title: l.title, sections: l.excerpts.map((x) => x.label) })) };
    },
    { perm: 'editor' }
  );

  handle('rewrite:save', (docId, proposal) => getArchive().addProposal(docId, proposal), { perm: 'editor', write: true });
  handle('rewrite:update', (docId, proposalId, patch) => getArchive().updateProposal(docId, proposalId, patch), { perm: 'editor', write: true });
  handle('rewrite:remove', (docId, proposalId) => getArchive().removeProposal(docId, proposalId), { perm: 'editor', write: true });

  /** The open proposals of a document as a Word file for the person who edits the original. */
  handle(
    'rewrite:exportDocx',
    async (docId, labels = {}) => {
      const a = getArchive();
      const doc = a.getDoc(docId);
      const props = (doc.proposals || []).filter((x) => x.status === 'open');
      if (!props.length) return null;
      const L = { original: 'Pôvodné znenie', proposed: 'Navrhované znenie', reasons: 'Dôvod', proposal: 'Návrh', title: 'Návrh zmien', ...labels };
      const r = await dialog.showSaveDialog(getWindow(), { defaultPath: `${L.title} – ${fileNameFor(doc)}`, filters: [{ name: 'Word', extensions: ['docx'] }] });
      if (r.canceled || !r.filePath) return null;
      const buf = await buildDocx({
        lang: lang(),
        logoPng: labels.logoPng ? Buffer.from(String(labels.logoPng).replace(/^data:image\/png;base64,/, ''), 'base64') : null,
        doc: { org: a.data.org || '', typeLabel: L.title, code: doc.code, title: doc.title, version: doc.version, department: doc.department, preparedBy: a.user, draft: true },
        sections: props.map((x, i) => ({
          heading: `${i + 1}. ${L.proposal}${x.instruction ? ` – ${x.instruction.slice(0, 80)}` : ''}`,
          text: `**${L.original}:**\n${x.original}\n\n**${L.proposed}:**\n${x.text}${x.reasons.length ? `\n\n**${L.reasons}:**\n${x.reasons.map((y) => `- ${y}`).join('\n')}` : ''}`
        }))
      });
      fs.writeFileSync(r.filePath, buf);
      a.audit('doc.proposals-exported', { docId, code: doc.code, count: props.length, file: path.basename(r.filePath) });
      return r.filePath;
    },
    { perm: 'editor' }
  );

  return { cancelAll: () => jobs.forEach((c) => c.abort()), newId: () => crypto.randomUUID() };
}

module.exports = { register };
