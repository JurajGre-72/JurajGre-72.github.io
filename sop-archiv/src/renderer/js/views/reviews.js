// Review planner: overdue, due soon, later (by month), no date.
import { t } from '../i18n.js';
import { html, icon, reviewChip, fmtDate, fmtMonthYear, toast } from '../ui.js';
import { app } from '../app.js';
import { recordReview } from './review-dialog.js';

const api = window.api;
let docs = [];

function row(d) {
  return html`<li class="row">
    <a class="row-main" href="#/documents/${d.id}"><span class="code">${d.code || '—'}</span><span class="row-title">${d.title}</span></a>
    <span class="muted small">${d.owner || d.department || ''}</span>
    <span class="row-date">${fmtDate(d.reviewDate)}</span>
    ${d.reviewDate ? reviewChip(d.review) : ''}
    ${d.reviewDate
      ? html`<button class="btn btn-sm" data-action="review" data-perm="editor" data-id="${d.id}">${icon('check')}${t('doc.markReviewed')}</button>`
      : html`<a class="btn btn-sm" href="#/documents/${d.id}" data-perm="editor">${icon('edit')}${t('edit')}</a>`}
  </li>`;
}

function group(title, list, tone, hint) {
  return html`<section class="panel ${tone ? 'panel-' + tone : ''}">
    <h3>${title} <span class="count">${list.length}</span></h3>
    ${hint ? html`<p class="muted small">${hint}</p>` : ''}
    ${list.length ? html`<ul class="rows">${list.map(row)}</ul>` : html`<p class="muted small">${t('rev.empty')}</p>`}
  </section>`;
}

export async function render() {
  docs = (await api.docs.list()).filter((d) => d.status !== 'obsolete');
  const warn = app.info.archiveSettings.warnDays;
  const by = (s) => docs.filter((d) => d.review.state === s).sort((a, b) => a.review.daysLeft - b.review.daysLeft);
  const later = by('ok');
  // Group "later" by month
  const months = new Map();
  for (const d of later) {
    const k = d.reviewDate.slice(0, 7);
    if (!months.has(k)) months.set(k, []);
    months.get(k).push(d);
  }
  return html`<div class="page">
    <header class="page-head">
      <div><h1>${t('rev.title')}</h1><p class="muted">${t('rev.exportIcsHint')}</p></div>
      <div class="head-actions">
        <button class="btn" data-action="remind">${icon('bell')}${t('rev.testNotify')}</button>
        <button class="btn btn-primary" data-action="ics">${icon('calendar')}${t('rev.exportIcs')}</button>
      </div>
    </header>
    ${group(t('rev.overdue'), by('overdue'), 'bad')}
    ${group(t('rev.due', { days: warn }), by('due'), 'warn')}
    <section class="panel">
      <h3>${t('rev.later')} <span class="count">${later.length}</span></h3>
      ${later.length
        ? Array.from(months.entries()).map(
            ([k, list]) => html`<h4 class="month">${fmtMonthYear(k)}</h4><ul class="rows">${list.map(row)}</ul>`
          )
        : html`<p class="muted small">${t('rev.empty')}</p>`}
    </section>
    ${group(t('rev.noDate'), by('none'), '', t('rev.noDateHint'))}
  </div>`;
}

export const actions = {
  async review(el) {
    const d = docs.find((x) => x.id === el.dataset.id);
    if (await recordReview(d)) app.rerender();
  },
  async ics() {
    const p = await api.reviews.exportIcs({ prefix: t('rev.icsPrefix'), version: t('f.version'), owner: t('f.owner') });
    if (p) toast(t('rev.saved', { path: p }), 'good');
  },
  remind: () => api.app.remindNow()
};

export function onDataChanged() {
  app.rerender();
}
