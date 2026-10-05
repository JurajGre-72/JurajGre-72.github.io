// Full-text search across the archive, and question answering over the best passages.
import { t } from '../i18n.js';
import { html, icon, statusChip, snippetHtml, debounce } from '../ui.js';
import { app } from '../app.js';

const api = window.api;
const st = { q: '', mode: 'search', type: '', department: '', includeObsolete: false, last: null, answer: null, busy: false };

function resultsHtml() {
  if (st.busy) return html`<div class="spinner"></div>`;
  if (!app.info.indexReady && !st.last) return html`<p class="muted">${t('search.indexing')}</p>`;
  if (st.mode === 'ask') return askHtml();
  const r = st.last;
  if (!r) return html`<p class="muted tips">${icon('info')}${t('search.tips')}</p>`;
  if (!r.results.length) return html`<div class="empty-inline">${icon('search')}${t('search.none')}</div>`;
  return html`<p class="muted small">${t('search.results', { n: r.results.length })}</p>
    <ol class="results">${r.results.map(
      (g) => html`<li class="result">
        <div class="result-head">
          <a href="#/documents/${g.doc.id}" class="result-title"><span class="code">${g.doc.code || ''}</span> ${g.doc.title}</a>
          <span class="chip chip-muted">v${g.doc.version}</span>${statusChip(g.doc.status)}
          <button class="btn btn-sm btn-ghost" data-action="open" data-id="${g.doc.id}" title="${t('doc.openFile')}">${icon('external')}</button>
        </div>
        ${g.hits.length
          ? g.hits.map(
              (h) => html`<a class="hit" href="#/documents/${g.doc.id}?tab=text">
                <div class="hit-meta">${h.page ? html`<span class="page-no">${t('doc.page', { n: h.page })}</span>` : ''}${h.heading ? html`<span class="heading">${h.heading}</span>` : ''}</div>
                <div class="snippet">${snippetHtml(h.snippet)}</div>
              </a>`
            )
          : html`<div class="hit muted small">${t('search.metaMatch')}</div>`}
      </li>`
    )}</ol>`;
}

function askHtml() {
  const a = st.answer;
  if (!a) return html`<p class="muted tips">${icon('info')}${t('search.tips')}</p>`;
  if (!a.passages.length) return html`<div class="empty-inline">${icon('search')}${t('search.none')}</div>`;
  return html`
    ${a.answer
      ? html`<section class="panel answer">
          <h3>${icon('sparkles')}${t('search.answer')}</h3>
          <div class="answer-text">${a.answer.text}</div>
          <p class="muted small">${t('search.answerBy', { model: a.answer.model, provider: a.answer.provider })}${a.answer.truncated ? ' ' + t('search.truncated') : ''}</p>
        </section>`
      : html`<div class="note">${icon('info')}${t('search.noAi')}</div>`}
    <h3 class="section-title">${t('search.sources')}</h3>
    <ol class="results">${a.passages.map(
      (p) => html`<li class="result">
        <div class="result-head"><a href="#/documents/${p.doc.id}" class="result-title"><span class="code">${p.doc.code || ''}</span> ${p.doc.title}</a><span class="chip chip-muted">v${p.doc.version}</span>
          ${p.page ? html`<span class="page-no">${t('doc.page', { n: p.page })}</span>` : ''}</div>
        <a class="hit" href="#/documents/${p.doc.id}?tab=text">${p.heading ? html`<div class="hit-meta"><span class="heading">${p.heading}</span></div>` : ''}<div class="snippet">${snippetHtml(p.snippet)}</div></a>
      </li>`
    )}</ol>`;
}

function refresh() {
  const box = document.getElementById('results');
  if (box) box.innerHTML = String(html`${resultsHtml()}`);
}

async function runSearch() {
  if (st.mode !== 'search') return;
  if (!st.q.trim()) {
    st.last = null;
    return refresh();
  }
  st.last = await api.search.query(st.q, { type: st.type, department: st.department, includeObsolete: st.includeObsolete });
  refresh();
}

const runSearchDebounced = debounce(() => runSearch().catch(() => {}), 180);

async function runAsk() {
  if (!st.q.trim()) return;
  st.busy = true;
  refresh();
  try {
    st.answer = await api.search.ask(st.q);
  } finally {
    st.busy = false;
    refresh();
  }
}

export async function render(route) {
  if (route.query.q) st.q = route.query.q;
  const s = app.info.archiveSettings;
  const opt = (v, label, cur) => html`<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;
  return html`<div class="page">
    <header class="page-head"><div><h1>${t('search.title')}</h1></div></header>
    <div class="seg" role="tablist">
      <button class="seg-btn ${st.mode === 'search' ? 'on' : ''}" data-action="mode" data-mode="search">${icon('search')}${t('search.modeSearch')}</button>
      <button class="seg-btn ${st.mode === 'ask' ? 'on' : ''}" data-action="mode" data-mode="ask">${icon('message')}${t('search.modeAsk')}</button>
    </div>
    <div class="big-search">
      ${icon(st.mode === 'ask' ? 'message' : 'search')}
      <input id="q" type="search" value="${st.q}" placeholder="${st.mode === 'ask' ? t('search.askPlaceholder') : t('search.placeholder')}" data-input="q" data-enter="enter" autocomplete="off">
      ${st.mode === 'ask' ? html`<button class="btn btn-primary" data-action="ask">${icon('sparkles')}${t('search.modeAsk')}</button>` : ''}
    </div>
    ${st.mode === 'search'
      ? html`<div class="toolbar">
          <select data-change="filter" data-key="type">${opt('', t('docs.anyType'), st.type)}${s.docTypes.map((tp) => opt(tp.id, tp.id, st.type))}</select>
          <select data-change="filter" data-key="department">${opt('', t('docs.anyDept'), st.department)}${s.departments.map((d) => opt(d, d, st.department))}</select>
          <label class="check"><input type="checkbox" data-change="obsolete" ${st.includeObsolete ? 'checked' : ''}> ${t('search.includeObsolete')}</label>
        </div>`
      : ''}
    <div id="results">${resultsHtml()}</div>
  </div>`;
}

export function mount(root) {
  const q = root.querySelector('#q');
  q.focus();
  q.setSelectionRange(q.value.length, q.value.length);
  if (st.q && st.mode === 'search') runSearch();
}

export const actions = {
  q(el) {
    st.q = el.value;
    runSearchDebounced();
  },
  enter() {
    if (st.mode === 'ask') return runAsk();
    return runSearch();
  },
  ask: () => runAsk(),
  mode(el) {
    st.mode = el.dataset.mode;
    app.rerender();
  },
  filter(el) {
    st[el.dataset.key] = el.value;
    runSearch();
  },
  obsolete(el) {
    st.includeObsolete = el.checked;
    runSearch();
  },
  open: (el) => api.docs.open(el.dataset.id)
};

export function onIndexReady() {
  app.info.indexReady = true;
  if (st.q) runSearch();
  else refresh();
}
