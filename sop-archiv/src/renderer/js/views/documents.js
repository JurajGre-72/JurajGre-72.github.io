// Document register: filterable, sortable table.
import { t } from '../i18n.js';
import { html, icon, statusChip, reviewChip, fmtDate, toast, debounce } from '../ui.js';
import { app } from '../app.js';
import { fold } from '../text.js';

const api = window.api;
const filters = { q: '', type: '', status: 'active', department: '', review: '', sort: 'code', dir: 1 };
let docs = [];

function matches(d) {
  if (filters.q) {
    const hay = fold(`${d.code} ${d.title} ${d.owner} ${(d.tags || []).join(' ')}`);
    if (!fold(filters.q).split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  if (filters.type && d.type !== filters.type) return false;
  if (filters.status === 'active' && d.status === 'obsolete') return false;
  if (filters.status && filters.status !== 'active' && d.status !== filters.status) return false;
  if (filters.department && d.department !== filters.department) return false;
  if (filters.review === 'attention') {
    if (!(d.review.state === 'overdue' || d.review.state === 'due')) return false;
  } else if (filters.review === 'legis') {
    if (!d.pendingChanges) return false;
  } else if (filters.review && d.review.state !== filters.review) return false;
  return true;
}

const SORTERS = {
  code: (d) => (d.code || '~').toLowerCase(),
  title: (d) => (d.title || '').toLowerCase(),
  type: (d) => d.type || '',
  version: (d) => parseFloat(d.version) || 0,
  status: (d) => d.status,
  department: (d) => d.department || '~',
  reviewDate: (d) => d.reviewDate || '9999'
};

function sorted(list) {
  const key = SORTERS[filters.sort] || SORTERS.code;
  return list.slice().sort((a, b) => {
    const x = key(a);
    const y = key(b);
    // Natural order for codes and names: OS2 before OS10, ŠPP 09 before ŠPP 10.
    const c = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y, 'sk', { numeric: true }) : x < y ? -1 : x > y ? 1 : 0;
    return c * filters.dir;
  });
}

function th(key, label) {
  const on = filters.sort === key;
  return html`<th><button class="th-sort ${on ? 'on' : ''}" data-action="sort" data-key="${key}">${label}${on ? (filters.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
}

function tableBody() {
  const list = sorted(docs.filter(matches));
  const types = app.info.archiveSettings.docTypes;
  if (!list.length) return html`<tr><td colspan="8" class="empty-cell">${t('docs.empty')}</td></tr>`;
  return list.map(
    (d) => html`<tr class="clickable" data-action="openDoc" data-id="${d.id}">
      <td class="code">${d.code || '—'}</td>
      <td class="title-cell">${d.annexOf ? html`<span class="annex-mark" title="${t('doc.annexOf')} ${d.annexOf}">↳</span>` : ''}${d.title}${(d.tags || []).includes('EN') ? html` <span class="chip chip-muted chip-xs">EN</span>` : ''}${d.pendingChanges ? html` <span class="flag" title="${t('docs.legisFlag')}">${icon('scale')}</span>` : ''}${d.current && d.current.ocr && d.current.ocr.status === 'pending' ? html` <span class="chip chip-muted chip-xs" title="${t('ocr.pendingHint')}">OCR…</span>` : d.current && d.current.textStatus !== 'ok' ? html` <span class="flag warn" title="${t('doc.noText')}">${icon('alert')}</span>` : ''}</td>
      <td><span class="type-tag" title="${(types.find((x) => x.id === d.type) || {}).sk || ''}">${d.type}</span></td>
      <td class="num">${d.version}</td>
      <td>${statusChip(d.status, d.review)}</td>
      <td class="muted">${d.department || ''}</td>
      <td class="nowrap">${fmtDate(d.reviewDate)}</td>
      <td>${d.status !== 'obsolete' && d.reviewDate ? reviewChip(d.review) : d.annexOf ? html`<span class="muted small">${t('doc.reviewWith', { code: d.annexOf })}</span>` : ''}</td>
    </tr>`
  );
}

function countText() {
  return t('docs.count', { n: docs.filter(matches).length });
}

export async function render(route) {
  docs = await api.docs.list();
  if (route.query.review) filters.review = route.query.review;
  const s = app.info.archiveSettings;
  const opt = (v, label, cur) => html`<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;
  return html`<div class="page">
    <header class="page-head">
      <div><h1>${t('docs.title')}</h1><p class="muted" id="doc-count">${countText()}</p></div>
      <div class="head-actions">
        <button class="btn" data-action="exportCsv">${icon('download')}${t('docs.exportCsv')}</button>
        <button class="btn" data-action="importFolder" data-perm="editor">${icon('folder')}${t('docs.importFolder')}</button>
        <a class="btn" href="#/compose" data-perm="editor">${icon('plus')}${t('nd.title')}</a>
        <button class="btn btn-primary" data-action="import" data-perm="editor">${icon('upload')}${t('docs.importFiles')}</button>
      </div>
    </header>
    <div class="toolbar">
      <div class="search-field">${icon('search')}<input type="search" placeholder="${t('docs.filter')}" value="${filters.q}" data-input="q"></div>
      <select data-change="filter" data-key="type">${opt('', t('docs.anyType'), filters.type)}${s.docTypes.map((tp) => opt(tp.id, tp.id, filters.type))}</select>
      <select data-change="filter" data-key="status">
        ${opt('active', t('docs.activeOnly'), filters.status)}${opt('', t('docs.anyStatus'), filters.status)}
        ${['draft', 'effective', 'review', 'obsolete'].map((x) => opt(x, t(`status.${x}`), filters.status))}
      </select>
      <select data-change="filter" data-key="department">${opt('', t('docs.anyDept'), filters.department)}${s.departments.map((d) => opt(d, d, filters.department))}</select>
      <select data-change="filter" data-key="review">
        ${opt('', t('docs.anyReview'), filters.review)}${opt('attention', `${t('review.overdue')} + ${t('review.due')}`, filters.review)}
        ${['overdue', 'due', 'ok', 'none'].map((x) => opt(x, t(`review.${x}`), filters.review))}${opt('legis', t('docs.legisFlag'), filters.review)}
      </select>
    </div>
    <div class="table-wrap">
      <table class="table docs-table">
        <thead><tr>${th('code', t('f.code'))}${th('title', t('f.title'))}${th('type', t('f.type'))}${th('version', t('f.version'))}${th('status', t('f.status'))}${th('department', t('f.department'))}${th('reviewDate', t('f.reviewDate'))}<th></th></tr></thead>
        <tbody id="doc-rows">${tableBody()}</tbody>
      </table>
    </div>
  </div>`;
}

function refreshRows() {
  const body = document.getElementById('doc-rows');
  if (body) body.innerHTML = String(html`${tableBody()}`);
  const c = document.getElementById('doc-count');
  if (c) c.textContent = countText();
}

const onQ = debounce(refreshRows, 120);

export const actions = {
  openDoc: (el) => app.navigate(`documents/${el.dataset.id}`),
  sort(el) {
    const k = el.dataset.key;
    if (filters.sort === k) filters.dir *= -1;
    else {
      filters.sort = k;
      filters.dir = 1;
    }
    app.rerender();
  },
  filter(el) {
    filters[el.dataset.key] = el.value;
    refreshRows();
  },
  q(el) {
    filters.q = el.value;
    onQ();
  },
  async exportCsv() {
    const st = {};
    for (const x of ['draft', 'effective', 'review', 'obsolete']) st[x] = t(`status.${x}`);
    const p = await api.docs.exportCsv({
      code: t('f.code'),
      title: t('f.title'),
      type: t('f.type'),
      version: t('f.version'),
      status: t('f.status'),
      department: t('f.department'),
      owner: t('f.owner'),
      effectiveDate: t('f.effectiveDate'),
      reviewDate: t('f.reviewDate'),
      lastReview: t('f.lastReview'),
      legislation: t('f.legislation'),
      tags: t('f.tags'),
      statuses: st
    });
    if (p) toast(t('docs.exported', { path: p }), 'good');
  }
};

export function onDataChanged() {
  api.docs.list().then((d) => {
    docs = d;
    refreshRows();
  });
}
