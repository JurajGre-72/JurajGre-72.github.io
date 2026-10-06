// Legislation: run checks, see changes to assess, maintain the register of monitored acts.
import { t } from '../i18n.js';
import { html, icon, fmtDate, fmtDateTime, openModal, formValues, confirmDialog, toast } from '../ui.js';
import { app } from '../app.js';

const api = window.api;
let laws = [];
let changes = [];
let lastResult = null;

export function changeCard(c) {
  const s = c.summary && c.summary.stats;
  const aff = c.affected || [];
  const high = aff.filter((a) => a.severity === 'high').length;
  const medium = aff.filter((a) => a.severity === 'medium').length;
  const citing = aff.filter((a) => a.severity !== 'info').length;
  const tone = c.kind === 'upcoming' ? 'warn' : c.kind === 'repealed' ? 'bad' : c.kind === 'check' ? 'muted' : 'info';
  return html`<a class="change-card" href="#/legislation/change/${c.id}">
    <div class="cc-top"><span class="chip chip-${tone}">${t(`leg.kind.${c.kind}`)}</span>
      ${c.toDate ? html`<span class="cc-date">${icon('clock')}${t(c.kind === 'check' ? 'lc.version' : 'leg.effectiveFrom', { date: fmtDate(c.toDate) })}</span>` : ''}
      ${c.status === 'reviewing' ? html`<span class="chip chip-muted">${t('ch.st.open')}</span>` : ''}</div>
    <div class="cc-title">${c.law ? c.law.short || c.law.title : ''}</div>
    <div class="cc-sub muted small">${c.fromDate && c.toDate && c.kind !== 'check' ? t('leg.versionsCmp', { from: fmtDate(c.fromDate), to: fmtDate(c.toDate) }) : c.source ? t(`lc.src.${c.source.type}`, { name: c.source.name }) : ''}
      ${s ? html` · ${c.summary.mode === 'lines' ? t('leg.statsLines', s) : t('leg.stats', s)}` : ''}</div>
    <div class="cc-foot">${icon('file')}${t('lc.card', { n: citing })}
      ${high ? html`<span class="chip chip-bad">${t('lc.sum.high', { n: high })}</span>` : ''}
      ${medium ? html`<span class="chip chip-warn">${t('lc.sum.medium', { n: medium })}</span>` : ''}</div>
  </a>`;
}

function progressHtml() {
  const p = app.legisProgress;
  if (!p) return lastResult ? html`<div class="note note-good">${icon('checkCircle')}${t('leg.checkDone', lastResult)}</div>` : '';
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return html`<div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div><p class="muted small">${t('leg.checking', { done: p.done + 1, total: p.total, law: p.law ? p.law.title : '' })}</p>`;
}

function stateCell(l) {
  const s = l.state;
  if (!s) return html`<span class="muted small">${t('leg.never')}</span>`;
  if (s.status === 'error') return html`<span class="chip chip-bad" title="${s.error}">${icon('alert')}${fmtDateTime(s.lastCheck)}</span><div class="err small">${t('leg.errorAt', { err: s.error })}</div>`;
  return html`<span class="chip chip-good">${icon('check')}${fmtDateTime(s.lastCheck)}</span>`;
}

function lawRow(l) {
  const s = l.state || {};
  return html`<tr class="${l.enabled ? '' : 'disabled'}">
    <td><span class="chip chip-muted">${t(`leg.j.${l.jurisdiction}`)}</span></td>
    <td class="law-cell"><div class="law-short">${l.short || l.title}</div><div class="muted small law-title">${l.title}</div>${s.repealed ? html`<div class="err small">${icon('alert')}${s.repealed}</div>` : ''}</td>
    <td class="nowrap">${s.effectiveDate ? fmtDate(s.effectiveDate) : s.mode === 'page' ? html`<span class="muted small">${t('leg.pageMode')}</span>` : ''}</td>
    <td class="nowrap">${(s.upcoming || []).map((u) => html`<span class="chip chip-warn">${fmtDate(u.date)}</span> `)}</td>
    <td>${stateCell(l)}</td>
    <td class="num">${l.docCount || ''}${l.openChanges ? html` <span class="badge badge-info">${l.openChanges}</span>` : ''}</td>
    <td class="nowrap">
      <button class="btn btn-sm" data-action="checkOne" data-perm="editor" data-id="${l.id}" ${app.legisProgress || app.info.settings.offline ? 'disabled' : ''}>${icon('refresh')}${t('leg.check')}</button>
      <button class="btn btn-sm btn-ghost" data-action="openUrl" data-url="${l.url}" title="${t('leg.openSource')}">${icon('external')}</button>
      <button class="btn btn-sm btn-ghost" data-action="editLaw" data-perm="editor" data-id="${l.id}" title="${t('edit')}">${icon('edit')}</button>
      <button class="btn btn-sm btn-ghost danger" data-action="removeLaw" data-perm="admin" data-id="${l.id}" title="${t('remove')}">${icon('trash')}</button>
    </td>
  </tr>`;
}

export async function render() {
  [laws, changes] = await Promise.all([api.laws.list(), api.changes.list()]);
  const open = changes.filter((c) => c.status !== 'resolved');
  const closed = changes.filter((c) => c.status === 'resolved');
  const offline = app.info.settings.offline;
  const auto = app.info.archiveSettings.legisAutoCheck || 'off';
  return html`<div class="page">
    <header class="page-head">
      <div><h1>${t('leg.title')}</h1></div>
      <div class="head-actions">
        <label class="inline-select" data-perm="admin">${t('leg.auto')}:
          <select data-change="auto">${['off', 'startup', 'daily', 'weekly'].map((m) => html`<option value="${m}" ${m === auto ? 'selected' : ''}>${t(`leg.auto.${m}`)}</option>`)}</select>
        </label>
        <button class="btn" data-action="checkAll" data-perm="editor" ${app.legisProgress || offline ? 'disabled' : ''}>${icon('refresh')}${t('leg.checkNow')}</button>
        <button class="btn btn-primary" data-action="lawCheck" data-perm="editor">${icon('scale')}${t('lc.title')}</button>
      </div>
    </header>
    ${offline ? html`<div class="note note-warn">${icon('wifiOff')}${t('leg.offline')}</div>` : ''}
    <div id="legis-progress">${progressHtml()}</div>
    <details class="how"><summary>${icon('info')}${t('leg.howTitle')}</summary><p>${t('leg.how')}</p></details>

    <section class="section">
      <h2>${t('leg.changes')} <span class="count">${open.length}</span></h2>
      ${open.length ? html`<div class="cards">${open.map(changeCard)}</div>` : html`<div class="empty-inline">${icon('checkCircle')}${t('leg.changesNone')}</div>`}
    </section>

    <section class="section">
      <div class="section-head"><h2>${t('leg.register')} <span class="count">${laws.length}</span></h2>
        <button class="btn" data-action="addLaw" data-perm="editor">${icon('plus')}${t('leg.addLaw')}</button></div>
      <div class="table-wrap"><table class="table laws-table">
        <thead><tr><th></th><th>${t('leg.col.law')}</th><th>${t('leg.col.version')}</th><th>${t('leg.col.upcoming')}</th><th>${t('leg.col.checked')}</th><th>${t('leg.col.docs')}</th><th></th></tr></thead>
        <tbody>${laws.map(lawRow)}</tbody>
      </table></div>
    </section>

    ${closed.length
      ? html`<details class="section"><summary><h2>${t('leg.resolvedChanges')} <span class="count">${closed.length}</span></h2></summary><div class="cards">${closed.map(changeCard)}</div></details>`
      : ''}
  </div>`;
}

async function lawDialog(law) {
  const l = law || { jurisdiction: 'SK', enabled: true, aliases: [] };
  let vals = null;
  const r = await openModal({
    title: law ? `${t('edit')} – ${law.short || law.title}` : t('leg.addLaw'),
    size: 'lg',
    body: html`<form class="form-grid">
      <div class="field full"><label>${t('leg.form.title')}</label><input name="title" value="${l.title || ''}" required></div>
      <div class="field"><label>${t('leg.form.short')}</label><input name="short" value="${l.short || ''}"></div>
      <div class="field"><label>${t('leg.form.jurisdiction')}</label><select name="jurisdiction">${['SK', 'EU', 'OTHER'].map((j) => html`<option value="${j}" ${j === l.jurisdiction ? 'selected' : ''}>${t(`leg.j.${j}`)}</option>`)}</select></div>
      <div class="field"><label>${t('leg.form.key')}</label><input name="key" value="${l.key || ''}" placeholder="SK:362/2011"><span class="hint">${t('leg.form.keyHint')}</span></div>
      <div class="field"><label class="check"><input type="checkbox" name="enabled" ${l.enabled !== false ? 'checked' : ''}> ${t('leg.form.enabled')}</label></div>
      <div class="field full"><label>${t('leg.form.url')}</label><input name="url" value="${l.url || ''}" placeholder="https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/2011/362/"><span class="hint">${t('leg.form.urlHint')}</span></div>
      <div class="field full"><label>${t('leg.form.aliases')}</label><input name="aliases" value="${(l.aliases || []).join(', ')}"><span class="hint">${t('leg.form.aliasesHint')}</span></div>
      <div class="field full"><label>${t('f.notes')}</label><textarea name="notes" rows="2">${l.notes || ''}</textarea></div>
    </form>`,
    buttons: [
      { label: t('cancel'), value: null },
      {
        label: t('save'),
        kind: 'primary',
        value: 'ok',
        onClick: (el) => {
          vals = formValues(el);
          return !!vals.title.trim();
        }
      }
    ]
  });
  if (r !== 'ok') return;
  if (law) await api.laws.update(law.id, vals);
  else await api.laws.add(vals);
  toast(t('saved'), 'good');
  app.rerender();
}

async function runCheck(ids) {
  lastResult = null;
  app.legisProgress = { done: 0, total: ids ? ids.length : laws.filter((l) => l.enabled).length };
  app.rerender();
  try {
    lastResult = await api.laws.check(ids || null);
  } finally {
    app.legisProgress = null;
    app.refreshSidebar();
    if (app.route && app.route.name === 'legislation' && !app.route.parts.length) app.rerender();
  }
}

export const actions = {
  checkAll: () => runCheck(null),
  checkOne: (el) => runCheck([el.dataset.id]),
  openUrl: (el) => api.app.openExternal(el.dataset.url),
  addLaw: () => lawDialog(null),
  editLaw: (el) => lawDialog(laws.find((l) => l.id === el.dataset.id)),
  async removeLaw(el) {
    const l = laws.find((x) => x.id === el.dataset.id);
    if (!(await confirmDialog(t('leg.removeConfirm', { title: l.short || l.title }), { okLabel: t('remove'), danger: true }))) return;
    await api.laws.remove(l.id);
    app.rerender();
  },
  async auto(el) {
    await api.archive.updateSettings({ legisAutoCheck: el.value });
    await app.reloadInfo();
    toast(t('saved'), 'good');
  }
};

export function onLegisProgress(p) {
  const box = document.getElementById('legis-progress');
  if (box && !p.finished) box.innerHTML = String(html`${progressHtml()}`);
}

export function onDataChanged() {
  if (!app.legisProgress) app.rerender();
}
