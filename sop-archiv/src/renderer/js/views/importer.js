// Import flow: pick/drop files -> analyse -> review recognised metadata -> import.
import { t } from '../i18n.js';
import { html, icon, openModal, toast, errorToast, typeLabel, fmtSize, formValues } from '../ui.js';
import { app } from '../app.js';

const api = window.api;
const STATUSES = ['draft', 'effective', 'review', 'obsolete'];

function typeOptions(selected) {
  return app.info.archiveSettings.docTypes.map((tp) => html`<option value="${tp.id}" ${tp.id === selected ? 'selected' : ''}>${tp.id} – ${typeLabel(app.info.archiveSettings.docTypes, tp.id)}</option>`);
}

function deptOptions(selected) {
  return [html`<option value="">${t('none')}</option>`, ...app.info.archiveSettings.departments.map((d) => html`<option ${d === selected ? 'selected' : ''}>${d}</option>`)];
}

function statusOptions(selected) {
  return STATUSES.map((s) => html`<option value="${s}" ${s === selected ? 'selected' : ''}>${t(`status.${s}`)}</option>`);
}

function rowHtml(item, i) {
  const m = item.meta || {};
  const scanned = item.ocrPages > 0;
  const textBad = item.textStatus !== 'ok' && !scanned;
  const textNote = item.textStatus === 'unsupported' ? t('imp.unsupported') : scanned ? t('ocr.importNote', { n: item.ocrPages }) : textBad ? t('imp.noText') : `${item.pages ? item.pages + ' ' + t('doc.pages') + ' · ' : ''}${fmtSize(item.size)}`;
  return html`<tr data-row="${i}" class="${item.duplicateOf ? 'is-dup' : ''}">
    <td class="imp-file">
      <div class="imp-fname" title="${item.filePath}">${icon('file')}${item.fileName}</div>
      <div class="imp-sub ${textBad ? 'warn' : ''}">${textBad ? icon('alert') : ''}${textNote}</div>
      ${item.duplicateOf ? html`<div class="imp-sub warn">${icon('alert')}${t('imp.duplicate', { code: item.duplicateOf.code || item.duplicateOf.title })}</div>` : ''}
    </td>
    <td>
      <select name="action">
        <option value="new" ${!item.duplicateOf && !item.sameCode ? 'selected' : ''}>${t('imp.asNew')}</option>
        ${item.sameCode ? html`<option value="version" ${!item.duplicateOf ? 'selected' : ''}>${t('imp.asVersion', { code: item.sameCode.code })}</option>` : ''}
        <option value="skip" ${item.duplicateOf ? 'selected' : ''}>${t('imp.skip')}</option>
      </select>
    </td>
    <td><select name="type">${typeOptions(m.type || 'OTHER')}</select></td>
    <td><input name="code" value="${m.code || ''}" size="10"></td>
    <td><input name="title" value="${m.title || ''}" class="w-title"></td>
    <td><input name="version" value="${m.version || ''}" size="4"></td>
    <td><select name="status">${statusOptions('effective')}</select></td>
    <td><select name="department">${deptOptions('')}</select></td>
    <td><input type="date" name="effectiveDate" value="${m.effectiveDate || ''}"></td>
    <td><input type="date" name="reviewDate" value="${m.reviewDate || ''}"></td>
  </tr>`;
}

function tableHtml(items) {
  return html`
    <div class="imp-bulk">
      <span>${t('imp.applyAll')}:</span>
      <select data-bulk="type"><option value="">${t('f.type')}…</option>${typeOptions('')}</select>
      <select data-bulk="department"><option value="">${t('f.department')}…</option>${app.info.archiveSettings.departments.map((d) => html`<option>${d}</option>`)}</select>
      <select data-bulk="status"><option value="">${t('f.status')}…</option>${statusOptions('')}</select>
    </div>
    <div class="table-wrap imp-table">
      <table class="table">
        <thead><tr>
          <th>${t('f.file')}</th><th></th><th>${t('f.type')}</th><th>${t('f.code')}</th><th>${t('f.title')}</th><th>${t('f.version')}</th>
          <th>${t('f.status')}</th><th>${t('f.department')}</th><th>${t('f.effectiveDate')}</th><th>${t('f.reviewDate')}</th>
        </tr></thead>
        <tbody>${items.map(rowHtml)}</tbody>
      </table>
    </div>`;
}

/** Start an import. paths may be empty when pick is 'files' or 'folder'. */
export async function startImport(paths = [], { pick } = {}) {
  let list = paths;
  if (!list.length && pick === 'files') list = await api.docs.pickFiles();
  if (!list.length && pick === 'folder') list = await api.docs.pickFolder();
  if (!list.length) return;
  list = await api.docs.expandPaths(list);
  if (!list.length) return;

  const items = [];
  let modalEl = null;
  let cancelled = false;
  const progress = () => modalEl && (modalEl.querySelector('.imp-progress').textContent = t('imp.analyzing', { done: items.length, total: list.length }));

  const resultP = openModal({
    title: t('imp.title'),
    size: 'xl',
    body: html`<p class="muted imp-progress">${t('imp.analyzing', { done: 0, total: list.length })}</p><div class="imp-content"><div class="spinner"></div></div>`,
    buttons: [
      { label: t('cancel'), value: null },
      {
        label: t('imp.import', { n: '' }).trim(),
        kind: 'primary',
        value: 'import',
        onClick: (el) => {
          if (items.length < list.length) return false;
          return true;
        }
      }
    ],
    onMount: (el) => {
      modalEl = el;
      el.addEventListener('change', (e) => {
        const b = e.target.closest('[data-bulk]');
        if (!b || !b.value) return;
        el.querySelectorAll(`tbody select[name="${b.dataset.bulk}"]`).forEach((s) => {
          s.value = b.value;
        });
        b.value = '';
      });
    }
  }).then((v) => {
    if (v !== 'import') cancelled = true;
    return v;
  });

  // Analyse files one by one, showing progress.
  for (const p of list) {
    if (cancelled) return;
    try {
      items.push(await api.docs.analyze(p));
    } catch (e) {
      items.push({ filePath: p, fileName: p.split(/[\\/]/).pop(), textStatus: 'error', meta: {}, size: 0, error: String(e.message || e) });
    }
    progress();
  }
  if (cancelled || !modalEl) return;
  // Capture the row values before the modal closes.
  let rows = null;
  modalEl.querySelector('.imp-progress').textContent = t('imp.intro');
  modalEl.querySelector('.imp-content').innerHTML = String(tableHtml(items));
  const btn = modalEl.querySelector('[data-modal-btn="1"]');
  const updateBtn = () => {
    const n = Array.from(modalEl.querySelectorAll('select[name="action"]')).filter((s) => s.value !== 'skip').length;
    btn.textContent = t('imp.import', { n });
    btn.disabled = n === 0;
    rows = Array.from(modalEl.querySelectorAll('tbody tr')).map((tr) => formValues(tr));
  };
  modalEl.addEventListener('change', updateBtn);
  modalEl.addEventListener('input', updateBtn);
  updateBtn();

  const choice = await resultP;
  if (choice !== 'import' || !rows) return;

  let ok = 0;
  for (let i = 0; i < items.length; i++) {
    const r = rows[i];
    if (!r || r.action === 'skip') continue;
    const meta = { type: r.type, code: r.code, title: r.title, version: r.version, status: r.status, department: r.department, effectiveDate: r.effectiveDate || null, reviewDate: r.reviewDate || null };
    try {
      if (r.action === 'version' && items[i].sameCode) await api.docs.addVersion(items[i].sameCode.id, items[i].filePath, meta);
      else await api.docs.import(items[i].filePath, meta);
      ok++;
    } catch (e) {
      toast(t('imp.failed', { file: items[i].fileName, err: String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }), 'bad', 8000);
    }
  }
  toast(t('imp.done', { n: ok }), 'good');
  app.refreshSidebar();
  if (app.route && (app.route.name === 'documents' || app.route.name === 'dashboard')) app.rerender();
  else app.navigate('documents');
}

/** Upload a new version of an existing document. */
export async function uploadVersion(doc) {
  const files = await api.docs.pickFiles();
  if (!files.length) return null;
  const a = await api.docs.analyze(files[0]);
  const m = a.meta || {};
  const v = await openModal({
    title: `${t('doc.newVersion')} – ${doc.code || doc.title}`,
    size: 'md',
    body: html`<form class="form-grid">
      <div class="field full"><label>${t('f.file')}</label><div class="readonly">${icon('file')} ${a.fileName} · ${fmtSize(a.size)}</div></div>
      <div class="field"><label>${t('f.version')}</label><input name="version" value="${m.version || ''}" placeholder="${Number(doc.version) ? Number(doc.version) + 1 : ''}"></div>
      <div class="field"><label>${t('f.status')}</label><select name="status">${statusOptions('effective')}</select></div>
      <div class="field"><label>${t('f.effectiveDate')}</label><input type="date" name="effectiveDate" value="${m.effectiveDate || ''}"></div>
      <div class="field"><label>${t('f.reviewDate')}</label><input type="date" name="reviewDate" value="${m.reviewDate || ''}"></div>
      <div class="field full"><label>${t('f.title')}</label><input name="title" value="${doc.title}"></div>
      ${(doc.trainingFor || []).length ? html`<div class="field full"><label class="check"><input type="checkbox" name="retrain" checked> ${t('tr.retrain')}</label><span class="hint">${t('tr.retrainHint')}</span></div>` : ''}
    </form>`,
    buttons: [
      { label: t('cancel'), value: null },
      { label: t('save'), kind: 'primary', onClick: (el) => ((uploadVersion.vals = formValues(el)), true), value: 'ok' }
    ]
  });
  if (v !== 'ok') return null;
  const vals = uploadVersion.vals;
  const meta = { ...vals };
  for (const k of ['version', 'effectiveDate', 'reviewDate']) if (!meta[k]) delete meta[k];
  if (meta.retrain === undefined) delete meta.retrain;
  try {
    return await api.docs.addVersion(doc.id, a.filePath, meta);
  } catch (e) {
    errorToast(e);
    return null;
  }
}
