// Audit trail for an inspector or an internal audit: every action in the app (who, when, what), with
// filters by period, person, area, document and text, and an export of exactly what is shown (PDF / Excel).
import { t } from '../i18n.js';
import { html, icon, toast, errorToast, fmtDate, fmtDateTime, debounce } from '../ui.js';
import { app } from '../app.js';
import { auditDetails, auditLabel } from './document.js';

const api = window.api;
const AREAS = ['documents', 'approval', 'training', 'legislation', 'notices', 'users', 'archive', 'ai'];
const LIMIT = 1000;

let res = null;
let docs = [];
const f = { from: '', to: '', user: '', area: '', docId: '', q: '', changesOnly: false };

function filters() {
  return { ...f, limit: LIMIT };
}

function docLabel(id) {
  const d = docs.find((x) => x.id === id);
  return d ? `${d.code || ''} ${d.title}`.trim() : '';
}

function rowsHtml() {
  if (!res.rows.length) return html`<div class="empty-inline">${icon('info')}${t('au.none')}</div>`;
  return html`<div class="table-wrap"><table class="table au-table">
    <thead><tr><th>${t('au.when')}</th><th>${t('au.who')}</th><th>${t('audit.action')}</th><th>${t('au.doc')}</th><th>${t('audit.details')}</th></tr></thead>
    <tbody>${res.rows.map(
      (r) => html`<tr><td class="nowrap">${fmtDateTime(r.ts)}</td><td class="nowrap">${r.user || ''}${r.host ? html`<div class="muted small">${r.host}</div>` : ''}</td><td>${auditLabel(r.action)}</td>
        <td class="small">${r.docId ? html`<a href="#/documents/${r.docId}?tab=history">${r.code || docLabel(r.docId) || '—'}</a>` : ''}</td><td class="small">${auditDetails(r)}</td></tr>`
    )}</tbody></table></div>`;
}

function summary() {
  return html`<p class="muted small" id="au-count">${t('au.count', { n: res.total })}${res.total > res.rows.length ? ` · ${t('au.shown', { n: res.rows.length })}` : ''}</p>`;
}

export async function render() {
  [res, docs] = await Promise.all([api.audit.query(filters()), api.docs.list().catch(() => [])]);
  return html`<div class="page audit">
    <header class="page-head">
      <div><h1>${t('au.title')}</h1><p class="muted">${t('au.intro')}</p></div>
      <div class="head-actions">
        <button class="btn" data-action="exportXlsx">${icon('download')}${t('au.exportXlsx')}</button>
        <button class="btn btn-primary" data-action="exportPdf">${icon('file')}${t('au.exportPdf')}</button>
      </div>
    </header>
    <form class="au-filters panel" data-submit="noop">
      <div class="field"><label>${t('rep.from')}</label><input type="date" name="from" value="${f.from}" data-change="set"></div>
      <div class="field"><label>${t('rep.to')}</label><input type="date" name="to" value="${f.to}" data-change="set"></div>
      <div class="field"><label>${t('au.user')}</label><select name="user" data-change="set"><option value="">${t('au.anyone')}</option>${res.users.map((u) => html`<option value="${u}" ${u === f.user ? 'selected' : ''}>${u}</option>`)}</select></div>
      <div class="field"><label>${t('au.area')}</label><select name="area" data-change="set"><option value="">${t('au.allAreas')}</option>${AREAS.map((a) => html`<option value="${a}" ${a === f.area ? 'selected' : ''}>${t(`au.area.${a}`)}</option>`)}</select></div>
      <div class="field"><label>${t('au.doc')}</label><select name="docId" data-change="set"><option value="">${t('au.allDocs')}</option>${docs.map((d) => html`<option value="${d.id}" ${d.id === f.docId ? 'selected' : ''}>${`${d.code || ''} ${d.title}`.trim()}</option>`)}</select></div>
      <div class="field"><label>${t('au.search')}</label><input type="search" name="q" value="${f.q}" placeholder="${t('au.searchPh')}" data-input="search"></div>
      <div class="field au-check"><label class="check"><input type="checkbox" name="changesOnly" ${f.changesOnly ? 'checked' : ''} data-change="set"> ${t('au.changesOnly')}</label></div>
      <div class="field au-reset"><button type="button" class="btn btn-ghost" data-action="reset">${icon('x')}${t('au.reset')}</button></div>
    </form>
    <div id="au-results">${summary()}${rowsHtml()}</div>
    <p class="muted small">${t('au.integrity')}</p>
  </div>`;
}

async function refresh() {
  res = await api.audit.query(filters());
  const box = document.getElementById('au-results');
  if (box) box.innerHTML = String(html`${summary()}${rowsHtml()}`);
}

/** The filter as a sentence, printed on the export (so the reader knows what is and is not included). */
function filterText() {
  const parts = [];
  if (f.from || f.to) parts.push(`${t('au.period')}: ${f.from ? fmtDate(f.from) : '…'} – ${f.to ? fmtDate(f.to) : '…'}`);
  if (f.user) parts.push(`${t('au.user')}: ${f.user}`);
  if (f.area) parts.push(`${t('au.area')}: ${t(`au.area.${f.area}`)}`);
  if (f.docId) parts.push(`${t('au.doc')}: ${docLabel(f.docId)}`);
  if (f.q) parts.push(`${t('au.search')}: „${f.q}“`);
  if (f.changesOnly) parts.push(t('au.changesOnly'));
  return parts.length ? parts.join(' · ') : t('au.noFilter');
}

const plain = (v) => {
  const div = document.createElement('div');
  div.innerHTML = String(v);
  return div.textContent.replace(/\s+/g, ' ').trim();
};
const formatRows = (list) => list.map((r) => [fmtDateTime(r.ts), [r.user, r.host].filter(Boolean).join(' / '), plain(auditLabel(r.action)), r.docId ? r.code || docLabel(r.docId) : '', plain(auditDetails(r))]);

/** The whole audit trail as text columns (for the readable export of the archive). */
export async function auditTable() {
  docs = await api.docs.list().catch(() => []);
  const all = await api.audit.query({ limit: 0 });
  return { columns: [t('au.when'), t('au.who'), t('audit.action'), t('au.doc'), t('audit.details')], rows: formatRows(all.rows) };
}

async function exportAs(format) {
  // All matching records (not only those on the screen), formatted as on the screen.
  const all = await api.audit.query({ ...filters(), limit: 0 });
  const rows = formatRows(all.rows);
  try {
    const file = await api.audit.export({
      format,
      title: t('au.title'),
      subtitle: `${filterText()} · ${t('au.count', { n: all.total })}`,
      columns: [t('au.when'), t('au.who'), t('audit.action'), t('au.doc'), t('audit.details')],
      rows,
      filter: { ...f, docLabel: f.docId ? docLabel(f.docId) : undefined }
    });
    if (file) toast(t('rep.saved', { file }), 'good', 6000);
  } catch (e) {
    errorToast(e);
  }
}

const later = debounce(refresh, 250);

export const actions = {
  noop() {},
  set(el) {
    f[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    refresh().catch(errorToast);
  },
  search(el) {
    f.q = el.value;
    later();
  },
  reset() {
    Object.assign(f, { from: '', to: '', user: '', area: '', docId: '', q: '', changesOnly: false });
    app.rerender();
  },
  exportPdf: () => exportAs('pdf'),
  exportXlsx: () => exportAs('xlsx')
};

/** Open the audit trail filtered to one document (from the document's history tab). */
export function forDocument(docId) {
  Object.assign(f, { from: '', to: '', user: '', area: '', docId, q: '', changesOnly: false });
  app.navigate('audit');
}
