// Help: the company's SOP for using SOP Archív – readable here, as a Word file, or added to the archive as a
// draft so it is reviewed and approved like any other SOP.
import { t } from '../i18n.js';
import { html, icon, toast, errorToast } from '../ui.js';
import { app } from '../app.js';
import { logoPng } from './compose.js';

const api = window.api;
let sop = null;

/** Section text → paragraphs, "- " bullets and "5.1 …" sub-headings (as in the Word file). */
function body(text) {
  const out = [];
  let list = [];
  const flush = () => {
    if (list.length) out.push(html`<ul>${list.map((l) => html`<li>${mark(l)}</li>`)}</ul>`);
    list = [];
  };
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const b = line.match(/^[-–•]\s+(.*)$/);
    if (b) list.push(b[1]);
    else if (/^\d+\.\d+\.?\s/.test(line)) {
      flush();
      out.push(html`<h3>${line}</h3>`);
    } else {
      flush();
      out.push(html`<p>${mark(line)}</p>`);
    }
  }
  flush();
  return out;
}

/** [DOPLNIŤ: …] stands out – the company fills it in before approval. */
function mark(s) {
  const parts = String(s).split(/(\[DOPLNIŤ[^\]]*\])/);
  return parts.map((p) => (/^\[DOPLNIŤ/.test(p) ? html`<mark>${p}</mark>` : p));
}

export async function render() {
  sop = await api.help.sop();
  return html`<div class="page help">
    <header class="page-head">
      <div><h1>${t('help.title')}</h1><p class="muted">${t('help.intro')}</p></div>
      <div class="head-actions">
        <button class="btn" data-action="saveWord">${icon('download')}${t('help.saveWord')}</button>
        <button class="btn btn-primary" data-action="addDraft" data-perm="editor">${icon('plus')}${t('help.addDraft')}</button>
      </div>
    </header>
    <article class="panel sop-doc">
      <p class="sop-kind">${sop.doc.typeLabel} · ${sop.doc.code} · ${t('f.version')} ${sop.doc.version}</p>
      <h2>${sop.doc.title}</h2>
      <p class="muted small">${t('help.fill')}</p>
      ${sop.sections.map((s) => html`<section><h2 class="sop-h">${s.heading}</h2>${body(s.text)}</section>`)}
    </article>
  </div>`;
}

export const actions = {
  async saveWord() {
    try {
      const p = await api.help.saveSop({ logoPng: await logoPng() });
      if (p) toast(t('doc.copySaved', { path: p }), 'good', 6000);
    } catch (e) {
      errorToast(e);
    }
  },
  async addDraft() {
    const doc = await api.help.importSop({ logoPng: await logoPng() });
    toast(t('help.added', { code: doc.code }), 'good', 6000);
    app.navigate(`documents/${doc.id}`);
  }
};
