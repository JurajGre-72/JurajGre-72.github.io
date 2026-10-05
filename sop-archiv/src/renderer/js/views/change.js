// One detected change of a legal act: what changed, which documents are affected, decisions.
import { t } from '../i18n.js';
import { html, icon, fmtDate, fmtDateTime, openModal, formValues, toast, errorToast } from '../ui.js';
import { app } from '../app.js';
import { secLabel } from './document.js';

const api = window.api;
let ch = null;
const busy = new Set();

function partsHtml(parts) {
  return (parts || []).map((p) => (p.t === 'add' ? html`<ins>${p.s}</ins>` : p.t === 'del' ? html`<del>${p.s}</del>` : html`<span>${p.s}</span>`));
}

function diffHtml(diff) {
  if (!diff || diff.mode === 'none') return html`<p class="muted">${t('ch.diffNone')}</p>`;
  if (diff.mode === 'lines') {
    return html`
      ${diff.added.length ? html`<h4>${t('ch.linesAdded')}</h4><ul class="lines add">${diff.added.map((l) => html`<li>${l}</li>`)}</ul>` : ''}
      ${diff.removed.length ? html`<h4>${t('ch.linesRemoved')}</h4><ul class="lines del">${diff.removed.map((l) => html`<li>${l}</li>`)}</ul>` : ''}`;
  }
  const cited = new Set((ch.affected || []).flatMap((a) => a.direct || []));
  const sec = (s, kind, body) => html`<details class="sec-diff ${cited.has(s.key.replace(/#\d+$/, '')) ? 'cited' : ''}" ${cited.has(s.key.replace(/#\d+$/, '')) ? 'open' : ''} id="sec-${s.key}">
    <summary><span class="sec-label">${s.label}</span><span class="chip chip-${kind === 'changed' ? 'info' : kind === 'added' ? 'good' : 'bad'}">${t(kind === 'changed' ? 'ch.sChanged' : kind === 'added' ? 'ch.sAdded' : 'ch.sRemoved')}</span>
      ${cited.has(s.key.replace(/#\d+$/, '')) ? html`<span class="chip chip-warn">${icon('file')}${t('doc.sections')}</span>` : ''}
      <span class="sec-preview muted small">${(s.newText || s.oldText || '').split('\n')[0].slice(0, 110)}</span></summary>
    <div class="diff-body">${body}</div>
  </details>`;
  return html`
    ${diff.changed.map((s) => sec(s, 'changed', s.parts ? partsHtml(s.parts) : html`<del>${s.oldText}</del><ins>${s.newText}</ins>`))}
    ${diff.added.map((s) => sec(s, 'added', html`<ins>${s.newText}</ins>`))}
    ${diff.removed.map((s) => sec(s, 'removed', html`<del>${s.oldText}</del>`))}`;
}

function affectedHtml() {
  const aiOn = app.info.settings.ai.provider && app.info.settings.ai.provider !== 'none';
  if (!ch.affected.length) return html`<p class="muted">${t('ch.affectedNone')}</p>`;
  return html`<ul class="affected">${ch.affected.map((a) => {
    if (!a.doc) return '';
    const ai = ch.ai && ch.ai[a.docId];
    return html`<li class="aff ${a.direct.length ? 'aff-direct' : ''}">
      <div class="aff-head">
        <a href="#/documents/${a.doc.id}" class="aff-title"><span class="code">${a.doc.code || ''}</span> ${a.doc.title} <span class="muted small">v${a.doc.version}</span></a>
        <select data-change="docStatus" data-doc="${a.docId}" class="st-${a.status}">${['open', 'done', 'na'].map((s) => html`<option value="${s}" ${s === a.status ? 'selected' : ''}>${t(`ch.st.${s}`)}</option>`)}</select>
      </div>
      <div class="aff-why">${a.direct.length
        ? html`${icon('alert')}${t('ch.direct', { secs: '' })}${a.direct.map((s) => html`<a class="sec" href="#sec-${s}" data-action="jump" data-sec="${s}">${secLabel(s)}</a>`)}`
        : html`<span class="muted">${t('ch.indirect')}</span>`}</div>
      <div class="aff-actions">
        ${a.doc.status !== 'review' ? html`<button class="btn btn-sm" data-action="flag" data-doc="${a.docId}">${icon('flag')}${t('ch.flag')}</button>` : html`<span class="chip chip-warn">${t('status.review')}</span>`}
        ${aiOn ? html`<button class="btn btn-sm" data-action="analyze" data-doc="${a.docId}" ${busy.has(a.docId) ? 'disabled' : ''}>${icon('sparkles')}${t('ch.ai')}</button>` : ''}
        <input class="aff-note" placeholder="${t('ch.note')}…" value="${a.note || ''}" data-change="docNote" data-doc="${a.docId}">
      </div>
      ${busy.has(a.docId) ? html`<div class="ai-box"><div class="spinner sm"></div>${t('ch.aiRunning')}</div>` : ''}
      ${ai ? html`<div class="ai-box"><div class="ai-text">${ai.text}</div><div class="muted small">${icon('sparkles')}${ai.model} · ${fmtDateTime(ai.at)} · ${t('ch.aiNote')}${ai.truncated ? ' ' + t('search.truncated') : ''}</div></div>` : ''}
    </li>`;
  })}</ul>
  ${!aiOn ? html`<p class="muted small">${icon('info')}${t('ch.aiOff')}</p>` : app.info.settings.ai.provider === 'anthropic' ? html`<p class="muted small">${icon('info')}${t('ch.aiCloud')}</p>` : ''}`;
}

export async function render(route) {
  ch = await api.changes.get(route.parts[1]);
  const s = ch.diff && ch.diff.stats;
  const tone = ch.kind === 'upcoming' ? 'warn' : ch.kind === 'repealed' ? 'bad' : 'info';
  return html`<div class="page">
    <a class="back" href="#/legislation">← ${t('leg.title')}</a>
    <header class="page-head">
      <div>
        <div class="chips"><span class="chip chip-${tone}">${t(`leg.kind.${ch.kind}`)}</span>${ch.toDate ? html`<span class="chip chip-muted">${icon('clock')}${t('leg.effectiveFrom', { date: fmtDate(ch.toDate) })}</span>` : ''}</div>
        <h1>${ch.law ? ch.law.title : ''}</h1>
        <p class="muted">${ch.fromDate && ch.toDate ? t('leg.versionsCmp', { from: fmtDate(ch.fromDate), to: fmtDate(ch.toDate) }) : ''}
          ${s && ch.diff.mode === 'sections' ? html` · ${t('leg.stats', s)}` : s && ch.diff.mode === 'lines' ? html` · ${t('leg.statsLines', s)}` : ''} · ${fmtDateTime(ch.detectedAt)}</p>
        ${ch.notice ? html`<div class="note note-bad">${icon('alert')}${t('ch.notice', { notice: ch.notice })}</div>` : ''}
        ${ch.status === 'resolved' && ch.resolution ? html`<div class="note note-good">${icon('checkCircle')}${t('ch.resolved', { date: fmtDateTime(ch.resolution.date), by: ch.resolution.by })}${ch.resolution.note ? html` – ${ch.resolution.note}` : ''}</div>` : ''}
      </div>
      <div class="head-actions">
        <button class="btn" data-action="openSource">${icon('external')}${t('leg.openSource')}</button>
        ${ch.status === 'resolved'
          ? html`<button class="btn" data-action="reopen">${icon('refresh')}${t('ch.reopen')}</button>`
          : html`<button class="btn btn-primary" data-action="resolve">${icon('check')}${t('ch.resolve')}</button>`}
      </div>
    </header>
    <section class="panel"><h3>${icon('file')}${t('ch.affected')} <span class="count">${ch.affected.length}</span></h3><div id="affected">${affectedHtml()}</div></section>
    <section class="panel"><h3>${icon('scale')}${t('ch.diff')}</h3>${diffHtml(ch.diff)}</section>
  </div>`;
}

function refreshAffected() {
  const el = document.getElementById('affected');
  if (el) el.innerHTML = String(html`${affectedHtml()}`);
}

export const actions = {
  openSource: () => api.app.openExternal(ch.sourceUrl || (ch.law && ch.law.url)),
  async docStatus(el) {
    ch = await api.changes.update(ch.id, { docId: el.dataset.doc, docStatus: el.value });
    refreshAffected();
    app.refreshSidebar();
  },
  async docNote(el) {
    ch = await api.changes.update(ch.id, { docId: el.dataset.doc, docNote: el.value });
    toast(t('saved'), 'good', 1500);
  },
  async flag(el) {
    ch = await api.changes.update(ch.id, { docId: el.dataset.doc, flagForReview: true });
    toast(t('ch.flagged'), 'good');
    refreshAffected();
  },
  async analyze(el) {
    const docId = el.dataset.doc;
    busy.add(docId);
    refreshAffected();
    try {
      ch = await api.changes.analyze(ch.id, docId);
    } catch (e) {
      errorToast(e);
    } finally {
      busy.delete(docId);
      refreshAffected();
    }
  },
  jump(el, e) {
    e.preventDefault();
    const d = document.getElementById(`sec-${el.dataset.sec}`);
    if (d) {
      d.open = true;
      d.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  },
  async resolve() {
    let vals = null;
    const r = await openModal({
      title: t('ch.resolve'),
      size: 'md',
      body: html`<form><div class="field"><label>${t('ch.resolveNote')}</label><textarea name="note" rows="4"></textarea></div></form>`,
      buttons: [
        { label: t('cancel'), value: null },
        { label: t('ch.resolve'), kind: 'primary', value: 'ok', onClick: (m) => ((vals = formValues(m)), true) }
      ]
    });
    if (r !== 'ok') return;
    await api.changes.update(ch.id, { status: 'resolved', note: vals.note });
    app.refreshSidebar();
    app.rerender();
  },
  async reopen() {
    await api.changes.update(ch.id, { status: 'reviewing' });
    app.refreshSidebar();
    app.rerender();
  }
};
