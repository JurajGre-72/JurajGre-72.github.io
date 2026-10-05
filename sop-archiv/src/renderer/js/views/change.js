// A detected change of a legal act, or a check of documents against an act:
// what changed, which documents are affected and why, decisions.
import { t } from '../i18n.js';
import { html, icon, fmtDate, fmtDateTime, openModal, formValues, toast, errorToast } from '../ui.js';
import { app } from '../app.js';
import { secLabel } from './document.js';

const api = window.api;
let ch = null;
const busy = new Set();

const SEV_TONE = { high: 'bad', medium: 'warn', low: 'muted', info: 'info' };

function partsHtml(parts) {
  return (parts || []).map((p) => (p.t === 'add' ? html`<ins>${p.s}</ins>` : p.t === 'del' ? html`<del>${p.s}</del>` : html`<span>${p.s}</span>`));
}

function diffHtml(diff) {
  if (!diff || diff.mode === 'none') return '';
  let body;
  if (diff.mode === 'lines') {
    body = html`
      ${diff.added.length ? html`<h4>${t('ch.linesAdded')}</h4><ul class="lines add">${diff.added.map((l) => html`<li>${l}</li>`)}</ul>` : ''}
      ${diff.removed.length ? html`<h4>${t('ch.linesRemoved')}</h4><ul class="lines del">${diff.removed.map((l) => html`<li>${l}</li>`)}</ul>` : ''}`;
  } else {
    const cited = new Set((ch.affected || []).flatMap((a) => a.direct || []));
    const sec = (s, kind, inner) => {
      const isCited = cited.has(s.key.replace(/#\d+$/, ''));
      return html`<details class="sec-diff ${isCited ? 'cited' : ''}" ${isCited ? 'open' : ''} id="sec-${s.key}">
        <summary><span class="sec-label">${s.label}</span><span class="chip chip-${kind === 'changed' ? 'info' : kind === 'added' ? 'good' : 'bad'}">${t(kind === 'changed' ? 'ch.sChanged' : kind === 'added' ? 'ch.sAdded' : 'ch.sRemoved')}</span>
          ${isCited ? html`<span class="chip chip-warn">${icon('file')}${t('doc.sections')}</span>` : ''}
          <span class="sec-preview muted small">${(s.newText || s.oldText || '').split('\n')[0].slice(0, 110)}</span></summary>
        <div class="diff-body">${inner}</div>
      </details>`;
    };
    body = html`
      ${diff.changed.map((s) => sec(s, 'changed', s.parts ? partsHtml(s.parts) : html`<del>${s.oldText}</del><ins>${s.newText}</ins>`))}
      ${diff.added.map((s) => sec(s, 'added', html`<ins>${s.newText}</ins>`))}
      ${diff.removed.map((s) => sec(s, 'removed', html`<del>${s.oldText}</del>`))}`;
  }
  return html`<section class="panel"><h3>${icon('scale')}${t('ch.diff')}</h3>${body}</section>`;
}

function findingText(f) {
  const sec = secLabel(f.section);
  if (f.type === 'changed') return t('lc.f.changed', { sec });
  if (f.type === 'missing') return t('lc.f.missing', { sec });
  if (f.type === 'quantity') return t('lc.f.quantity', { sec, doc: f.docValue, law: (f.lawValues || []).join(', ') });
  if (f.type === 'related') return t('lc.f.related', { sec, terms: (f.terms || []).join(', ') });
  return f.type;
}

function findingsHtml(a) {
  const list = ((a.analysis && a.analysis.findings) || []).filter((f) => f.type !== 'related');
  // Directly cited changed sections are known even without a stored analysis.
  if (!list.some((f) => f.type === 'changed')) for (const s of a.direct || []) list.unshift({ type: 'changed', severity: 'high', section: s });
  if (!list.length) return html`<div class="aff-why muted">${icon('checkCircle')}${a.cites ? t('lc.f.none') : ''}</div>`;
  return html`<ul class="findings">${list.map((f) => html`<li class="finding sev-${f.severity}"><span class="chip chip-${SEV_TONE[f.severity]}">${t(`lc.sev.${f.severity}`)}</span><span>${findingText(f)}</span></li>`)}</ul>`;
}

function compareHtml(a) {
  const refs = (a.analysis && a.analysis.refs) || [];
  const rel = (a.analysis && a.analysis.related) || [];
  if (!refs.length && !rel.length) return '';
  const rows = [
    ...refs.map((r) => ({ label: r.label, docs: r.docExcerpts, law: r.inLaw ? r.lawExcerpt : null, changed: r.changed })),
    ...rel.map((r) => ({ label: r.label, docs: [{ page: r.page, heading: r.heading, text: r.text }], law: r.lawExcerpt }))
  ];
  return html`<details class="compare"><summary>${icon('layers')}${t('lc.compare')}</summary>
    ${rows.map(
      (r) => html`<div class="cmp-row">
        <div class="cmp-head"><span class="sec-label">${r.label}</span>${r.changed ? html`<span class="chip chip-info">${t('ch.sChanged')}</span>` : ''}</div>
        <div class="cmp-cols">
          <div class="cmp-col"><div class="cmp-title">${t('lc.inDoc')}</div>${(r.docs || []).length ? r.docs.map((d) => html`<div class="cmp-text">${d.page ? html`<span class="page-no">${t('doc.page', { n: d.page })}</span> ` : ''}${d.text}</div>`) : html`<div class="muted small">${t('lc.noPassage')}</div>`}</div>
          <div class="cmp-col"><div class="cmp-title">${t('lc.inLaw')}</div>${r.law ? html`<div class="cmp-text">${r.law}</div>` : html`<div class="err small">${t('lc.notInLaw')}</div>`}</div>
        </div>
      </div>`
    )}
  </details>`;
}

function docItem(a, aiOn) {
  if (!a.doc) return '';
  const ai = ch.ai && ch.ai[a.docId];
  return html`<li class="aff sev-${a.severity}">
    <div class="aff-head">
      <a href="#/documents/${a.doc.id}" class="aff-title"><span class="code">${a.doc.code || ''}</span> ${a.doc.title} <span class="muted small">v${a.doc.version}</span></a>
      <select data-change="docStatus" data-doc="${a.docId}" class="st-${a.status}" data-perm="editor">${['open', 'done', 'na'].map((s) => html`<option value="${s}" ${s === a.status ? 'selected' : ''}>${t(`ch.st.${s}`)}</option>`)}</select>
      <span class="chip chip-muted perm-ro">${t(`ch.st.${a.status}`)}</span>
    </div>
    ${findingsHtml(a)}
    ${compareHtml(a)}
    <div class="aff-actions">
      ${a.doc.status !== 'review' ? html`<button class="btn btn-sm" data-action="flag" data-doc="${a.docId}" data-perm="editor">${icon('flag')}${t('ch.flag')}</button>` : html`<span class="chip chip-warn">${t('status.review')}</span>`}
      ${aiOn ? html`<button class="btn btn-sm" data-action="analyze" data-doc="${a.docId}" data-perm="editor" ${busy.has(a.docId) ? 'disabled' : ''}>${icon('sparkles')}${t('ch.ai')}</button>` : ''}
      <input class="aff-note" placeholder="${t('ch.note')}…" value="${a.note || ''}" data-change="docNote" data-doc="${a.docId}" data-perm="editor">
      ${a.note ? html`<span class="muted small perm-ro">${a.note}</span>` : ''}
    </div>
    ${busy.has(a.docId) ? html`<div class="ai-box"><div class="spinner sm"></div>${t('ch.aiRunning')}</div>` : ''}
    ${ai ? html`<div class="ai-box"><div class="ai-text">${ai.text}</div><div class="muted small">${icon('sparkles')}${ai.model} · ${fmtDateTime(ai.at)} · ${t('ch.aiNote')}${ai.truncated ? ' ' + t('search.truncated') : ''}</div></div>` : ''}
  </li>`;
}

function relatedItem(a) {
  if (!a.doc) return '';
  const rel = (a.analysis && a.analysis.related) || [];
  return html`<li class="aff sev-info">
    <div class="aff-head">
      <a href="#/documents/${a.doc.id}" class="aff-title"><span class="code">${a.doc.code || ''}</span> ${a.doc.title} <span class="muted small">v${a.doc.version}</span></a>
      <select data-change="docStatus" data-doc="${a.docId}" class="st-${a.status}" data-perm="editor">${['open', 'done', 'na'].map((s) => html`<option value="${s}" ${s === a.status ? 'selected' : ''}>${t(`ch.st.${s}`)}</option>`)}</select>
    </div>
    <ul class="findings">${rel.map((r) => html`<li class="finding"><span class="chip chip-info">${secLabel(r.key)}</span><span class="muted">${t('lc.relTerms', { terms: (r.terms || []).join(', ') })}</span></li>`)}</ul>
    ${compareHtml(a)}
  </li>`;
}

function affectedHtml() {
  const aiOn = app.info.settings.ai.provider && app.info.settings.ai.provider !== 'none';
  const citing = ch.affected.filter((a) => a.severity !== 'info');
  const related = ch.affected.filter((a) => a.severity === 'info');
  return html`
    <section class="panel">
      <h3>${icon('file')}${t('lc.citing')} <span class="count">${citing.length}</span></h3>
      ${citing.length ? html`<ul class="affected">${citing.map((a) => docItem(a, aiOn))}</ul>` : html`<p class="muted">${t('ch.affectedNone')}</p>`}
      ${aiOn ? '' : html`<p class="muted small">${icon('info')}${t('ch.aiOff')}</p>`}
    </section>
    ${related.length
      ? html`<section class="panel"><h3>${icon('search')}${t('lc.related')} <span class="count">${related.length}</span></h3>
          <p class="muted small">${t('lc.relatedHint')}</p>
          <ul class="affected">${related.map(relatedItem)}</ul></section>`
      : ''}`;
}

function summaryChips() {
  const n = (s) => ch.affected.filter((a) => a.severity === s).length;
  const parts = [];
  if (n('high')) parts.push(html`<span class="chip chip-bad">${t('lc.sum.high', { n: n('high') })}</span>`);
  if (n('medium')) parts.push(html`<span class="chip chip-warn">${t('lc.sum.medium', { n: n('medium') })}</span>`);
  if (n('low')) parts.push(html`<span class="chip chip-muted">${t('lc.sum.low', { n: n('low') })}</span>`);
  if (n('info')) parts.push(html`<span class="chip chip-info">${t('lc.sum.info', { n: n('info') })}</span>`);
  return parts.length ? html`<div class="chips">${parts}</div>` : '';
}

function sourceText() {
  const s = ch.source;
  if (!s) return '';
  return t(`lc.src.${s.type}`, { name: s.name });
}

export async function render(route) {
  ch = await api.changes.get(route.parts[1]);
  const s = ch.diff && ch.diff.stats;
  const tone = ch.kind === 'upcoming' ? 'warn' : ch.kind === 'repealed' ? 'bad' : ch.kind === 'check' ? 'muted' : 'info';
  const hasDiff = ch.diff && ch.diff.mode && ch.diff.mode !== 'none';
  return html`<div class="page">
    <a class="back" href="#/legislation">← ${t('leg.title')}</a>
    <header class="page-head">
      <div>
        <div class="chips"><span class="chip chip-${tone}">${t(`leg.kind.${ch.kind}`)}</span>${ch.toDate ? html`<span class="chip chip-muted">${icon('clock')}${t(ch.kind === 'check' ? 'lc.version' : 'leg.effectiveFrom', { date: fmtDate(ch.toDate) })}</span>` : ''}</div>
        <h1>${ch.law ? ch.law.title : ''}</h1>
        <p class="muted">${ch.fromDate && ch.toDate && hasDiff ? t('leg.versionsCmp', { from: fmtDate(ch.fromDate), to: fmtDate(ch.toDate) }) + ' · ' : ''}
          ${hasDiff && s && ch.diff.mode === 'sections' ? t('leg.stats', s) + ' · ' : hasDiff && s ? t('leg.statsLines', s) + ' · ' : ''}${fmtDateTime(ch.detectedAt)}${ch.source ? ' · ' + sourceText() : ''}</p>
        ${summaryChips()}
        ${ch.notice ? html`<div class="note note-bad">${icon('alert')}${t('ch.notice', { notice: ch.notice })}</div>` : ''}
        ${ch.status === 'resolved' && ch.resolution ? html`<div class="note note-good">${icon('checkCircle')}${t('ch.resolved', { date: fmtDateTime(ch.resolution.date), by: ch.resolution.by })}${ch.resolution.note ? html` – ${ch.resolution.note}` : ''}</div>` : ''}
        ${ch.sectionsInText !== undefined && ch.sectionsInText < 3 ? html`<div class="note note-warn">${icon('alert')}${t('lc.fewSections')}</div>` : ''}
      </div>
      <div class="head-actions">
        ${ch.sourceUrl || (ch.law && ch.law.url) ? html`<button class="btn" data-action="openSource">${icon('external')}${t('leg.openSource')}</button>` : ''}
        ${ch.hasText ? html`<button class="btn" data-action="recheck" data-perm="editor" title="${t('lc.recheckHint')}">${icon('refresh')}${t('lc.recheck')}</button>` : ''}
        ${ch.status === 'resolved'
          ? html`<button class="btn" data-action="reopen" data-perm="editor">${icon('refresh')}${t('ch.reopen')}</button>`
          : html`<button class="btn btn-primary" data-action="resolve" data-perm="editor">${icon('check')}${t('ch.resolve')}</button>`}
      </div>
    </header>
    <div id="affected">${affectedHtml()}</div>
    ${diffHtml(ch.diff)}
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
  async recheck() {
    ch = await api.changes.recheck(ch.id);
    toast(t('lc.rechecked'), 'good');
    app.rerender();
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
