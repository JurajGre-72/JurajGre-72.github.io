// Notices of ŠÚKL (human medicines) and ÚŠKVBL (veterinary medicines): recalls, safety information,
// availability and new legislation, read from their public pages. Recalls that concern the company are
// assessed here (not our product / measures taken / noted) – the record is kept for inspections.
import { t, lang } from '../i18n.js';
import { html, icon, openModal, formValues, toast, errorToast, confirmDialog, fmtDate, fmtDateTime } from '../ui.js';
import { app } from '../app.js';

const api = window.api;
const CATS = ['recall', 'safety', 'availability', 'legislation', 'other'];
const OUTCOMES = ['not-ours', 'done', 'noted'];
const PAGE = 150;

let data = null;
let checking = false;
const ui = { filter: 'assess', authority: '', showAll: false, q: '', limit: PAGE };

const fold = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const needsAssessment = (n) => !n.handled && n.rel.forUs && (n.category === 'recall' || n.rel.watch.length > 0);

function visible() {
  const q = fold(ui.q.trim());
  return data.items.filter((n) => {
    if (ui.filter === 'assess') return needsAssessment(n);
    if (ui.authority && n.authority !== ui.authority) return false;
    if (!ui.showAll && !n.rel.forUs) return false;
    if (ui.filter !== 'all' && n.category !== ui.filter) return false;
    if (q && !fold(`${n.title} ${n.summary}`).includes(q)) return false;
    return true;
  });
}

function relNote(n) {
  if (n.rel.watch.length) return html`<div class="nt-rel nt-watch">${icon('alert')}${t('nt.watch', { names: n.rel.watch.join(', ') })}</div>`;
  if (n.rel.forUs) return '';
  const r = n.rel.reason;
  const a = (data.activities || []).find((x) => x.id === r);
  const text = r === 'human' || r === 'vet' ? t(`nt.notForUs.${r}`) : t('nt.notForUs.activity', { activity: a ? (lang() === 'sk' ? a.sk : a.en).toLowerCase() : r });
  return html`<div class="nt-rel muted">${icon('info')}${text}</div>`;
}

function handledNote(n) {
  const h = n.handled;
  if (!h) return '';
  if (h.outcome === 'baseline') return html`<div class="nt-handled muted small">${t('nt.out.baseline')}</div>`;
  return html`<div class="nt-handled">
    <span class="chip chip-${h.outcome === 'done' ? 'good' : 'muted'}">${icon('check')}${t(`nt.out.${h.outcome}`)}</span>
    ${h.note ? html`<span class="nt-note">${h.note}</span>` : ''}
    <span class="muted small">${h.by} · ${fmtDateTime(h.at)}</span>
    <button class="btn btn-sm btn-ghost" data-action="reopen" data-id="${n.id}" data-perm="editor">${icon('refresh')}${t('nt.reopen')}</button>
  </div>`;
}

function card(n) {
  const urgent = needsAssessment(n);
  return html`<article class="nt-card ${urgent ? 'nt-urgent' : ''} ${n.rel.forUs ? '' : 'nt-dim'}" data-id="${n.id}">
    <div class="nt-meta">
      <span class="nt-date">${n.dateKnown ? fmtDate(n.date) : t('nt.found', { date: fmtDate(n.date) })}</span>
      <span class="chip chip-${n.authority === 'sukl' ? 'info' : 'vet'}">${t(`nt.auth.${n.authority}`)}</span>
      <span class="chip chip-${n.category === 'recall' ? 'bad' : n.category === 'safety' ? 'warn' : 'muted'}">${t(`nt.cat.${n.category}`)}</span>
      ${!n.seen ? html`<span class="chip chip-new">${t('nt.new')}</span>` : ''}
    </div>
    <h3 class="nt-title"><a href="#" data-action="open" data-url="${n.link}" title="${t('nt.open')}">${n.title}${icon('external', 'nt-ext')}</a></h3>
    ${n.summary && n.summary !== n.title ? html`<p class="nt-summary small muted">${n.summary.length > 300 ? n.summary.slice(0, 300) + '…' : n.summary}</p>` : ''}
    ${relNote(n)}
    ${n.handled
      ? handledNote(n)
      : html`<div class="nt-actions" data-perm="editor">
          ${OUTCOMES.map((o) => html`<button class="btn btn-sm ${o === 'done' && urgent ? 'btn-primary' : ''}" data-action="assess" data-id="${n.id}" data-outcome="${o}">${t(`nt.out.${o}`)}</button>`)}
        </div>`}
  </article>`;
}

function sourcesLine() {
  const names = ['sukl-recalls', 'sukl-news', 'uskvbl-notices', 'uskvbl-legislation'];
  return html`<ul class="nt-sources">${names.map((id) => {
    const s = data.sources[id];
    const state = !s ? html`<span class="muted">${t('nt.notYet')}</span>` : s.ok ? html`<span class="ok">${icon('check')}${fmtDateTime(s.lastCheck)}</span>` : html`<span class="warn">${icon('alert')}${s.error === 'FORMAT' ? t('nt.srcFormat') : t('nt.srcError', { error: s.error })}</span>`;
    return html`<li><span>${t(`nt.src.${id}`)}</span>${state}</li>`;
  })}</ul>`;
}

export async function render() {
  data = await api.notices.list();
  const offline = app.info.settings.offline;
  const auto = app.info.archiveSettings.noticesAuto || 'on';
  const list = visible();
  const shown = list.slice(0, ui.limit);
  const tabs = ['assess', 'all', ...CATS];
  return html`<div class="page notices">
    <header class="page-head">
      <div><h1>${t('nt.title')}</h1><p class="muted">${t('nt.intro')}</p></div>
      <div class="head-actions">
        <label class="inline-select" data-perm="admin">${t('nt.auto')}:
          <select data-change="auto">${['on', 'off'].map((m) => html`<option value="${m}" ${m === auto ? 'selected' : ''}>${t(`nt.auto.${m}`)}</option>`)}</select>
        </label>
        <button class="btn btn-primary" data-action="check" data-perm="editor" ${checking || offline ? 'disabled' : ''}>${icon('refresh')}${checking ? t('nt.checking') : t('nt.checkNow')}</button>
      </div>
    </header>
    ${offline ? html`<div class="note note-warn">${icon('wifiOff')}${t('nt.offline')}</div>` : ''}
    ${!data.lastCheck && !offline ? html`<div class="note">${icon('info')}${t('nt.never')}</div>` : ''}
    <details class="how"><summary>${icon('info')}${t('nt.howTitle')}</summary><p>${t('nt.privacy')}</p>${sourcesLine()}</details>

    <div class="tabs nt-tabs" role="tablist">${tabs.map(
      (f) => html`<button class="tab ${ui.filter === f ? 'active' : ''}" role="tab" aria-selected="${ui.filter === f}" data-action="filter" data-f="${f}">${f === 'assess' ? t('nt.f.assess') : f === 'all' ? t('nt.f.all') : t(`nt.cat.${f}`)}${f === 'assess' && data.counts.toAssess ? html` <span class="badge badge-warn">${data.counts.toAssess}</span>` : ''}</button>`
    )}</div>
    ${ui.filter !== 'assess'
      ? html`<div class="nt-filters">
          <input type="search" placeholder="${t('nt.search')}" value="${ui.q}" data-input="search" aria-label="${t('nt.search')}">
          <select data-change="authority" aria-label="${t('nt.allAuth')}"><option value="">${t('nt.allAuth')}</option><option value="sukl" ${ui.authority === 'sukl' ? 'selected' : ''}>ŠÚKL</option><option value="uskvbl" ${ui.authority === 'uskvbl' ? 'selected' : ''}>ÚŠKVBL</option></select>
          <label class="check small"><input type="checkbox" data-change="showAll" ${ui.showAll ? 'checked' : ''}> ${t('nt.showNotForUs')}</label>
        </div>`
      : ''}
    <div id="nt-list">
      ${shown.length ? html`<div class="nt-list">${shown.map(card)}</div>` : html`<div class="empty-inline">${icon('checkCircle')}${ui.filter === 'assess' ? t('nt.noneAssess') : t('nt.none')}</div>`}
      ${list.length > shown.length ? html`<button class="btn" data-action="more">${t('nt.more', { n: list.length - shown.length })}</button>` : ''}
    </div>
  </div>`;
}

export async function mount(root) {
  // Notices shown on the screen count as seen (the "new" mark stays until the next visit).
  const ids = Array.from(root.querySelectorAll('.nt-card'))
    .map((el) => el.dataset.id)
    .filter((id) => {
      const n = data.items.find((x) => x.id === id);
      return n && !n.seen;
    });
  if (ids.length && !app.info.readOnly) {
    await api.notices.seen(ids).catch(() => {});
    app.refreshSidebar();
  }
}

/** Documents that describe how the company handles recalls – offered next to a recall. */
async function recallSops() {
  const docs = await api.docs.list().catch(() => []);
  return docs.filter((d) => d.status !== 'obsolete' && /stiahnut|recall|reklamac|vratk/.test(fold(`${d.title} ${(d.tags || []).join(' ')}`))).slice(0, 3);
}

async function assessDialog(n, preset) {
  const sops = n.category === 'recall' ? await recallSops() : [];
  let vals = null;
  const r = await openModal({
    title: t('nt.assessTitle'),
    size: 'lg',
    body: html`<form class="nt-assess">
      <p class="nt-assess-title"><b>${n.title}</b><br><span class="muted small">${t(`nt.auth.${n.authority}`)} · ${fmtDate(n.date)}</span></p>
      ${n.category === 'recall' ? html`<div class="note">${icon('info')}<span>${t('nt.recallHow')}</span></div>` : ''}
      ${sops.length ? html`<p class="small">${t('nt.yourSop')} ${sops.map((d, i) => html`${i ? ', ' : ''}<a href="#/documents/${d.id}" data-modal-close>${d.code || ''} ${d.title}</a>`)}</p>` : ''}
      <fieldset class="field"><legend>${t('nt.outcome')}</legend>
        ${OUTCOMES.map((o) => html`<label class="radio-row"><input type="radio" name="outcome" value="${o}" ${o === preset ? 'checked' : ''}> <span><b>${t(`nt.out.${o}`)}</b><br><span class="muted small">${t(`nt.outHint.${o}`)}</span></span></label>`)}
      </fieldset>
      <div class="field"><label>${t('nt.note')}</label><textarea name="note" rows="3" placeholder="${t('nt.notePh')}"></textarea></div>
    </form>`,
    buttons: [
      { label: t('cancel'), value: null },
      {
        label: t('save'),
        kind: 'primary',
        onClick: async (el, close) => {
          vals = formValues(el);
          try {
            await api.notices.handle(n.id, vals.outcome, vals.note);
            close('ok');
          } catch (e) {
            errorToast(e);
          }
          return false;
        }
      }
    ]
  });
  return r === 'ok';
}

async function runCheck() {
  checking = true;
  app.rerender();
  try {
    const r = await api.notices.check();
    toast(t('nt.checked', { n: r.added }), 'good');
    if (r.errors.length) toast(t('nt.checkedErr', { list: r.errors.map((e) => t(`nt.src.${e.source}`)).join(', ') }), 'warn', 8000);
  } finally {
    checking = false;
    app.refreshSidebar();
    if (app.route && app.route.name === 'notices') app.rerender();
  }
}

let searchTimer = null;

export const actions = {
  check: () => runCheck(),
  open: (el) => api.notices.open(el.dataset.url),
  filter(el) {
    ui.filter = el.dataset.f;
    ui.limit = PAGE;
    app.rerender();
  },
  more() {
    ui.limit += PAGE;
    app.rerender();
  },
  search(el) {
    ui.q = el.value;
    ui.limit = PAGE;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const box = document.getElementById('nt-list');
      if (!box) return;
      const list = visible();
      const shown = list.slice(0, ui.limit);
      box.innerHTML = String(html`${shown.length ? html`<div class="nt-list">${shown.map(card)}</div>` : html`<div class="empty-inline">${icon('checkCircle')}${t('nt.none')}</div>`}
        ${list.length > shown.length ? html`<button class="btn" data-action="more">${t('nt.more', { n: list.length - shown.length })}</button>` : ''}`);
    }, 200);
  },
  authority(el) {
    ui.authority = el.value;
    app.rerender();
  },
  showAll(el) {
    ui.showAll = el.checked;
    app.rerender();
  },
  async assess(el) {
    const n = data.items.find((x) => x.id === el.dataset.id);
    if (n && (await assessDialog(n, el.dataset.outcome))) {
      toast(t('saved'), 'good');
      app.refreshSidebar();
      app.rerender();
    }
  },
  async reopen(el) {
    if (!(await confirmDialog(t('nt.reopenConfirm'), { okLabel: t('nt.reopen') }))) return;
    await api.notices.reopen(el.dataset.id);
    app.refreshSidebar();
    app.rerender();
  },
  async auto(el) {
    await api.archive.updateSettings({ noticesAuto: el.value });
    await app.reloadInfo();
    toast(t('saved'), 'good');
  }
};

export function onDataChanged() {
  if (app.route && app.route.name === 'notices' && !checking) app.rerender();
}
