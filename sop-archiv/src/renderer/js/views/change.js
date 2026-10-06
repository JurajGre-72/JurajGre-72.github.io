// A detected change of a legal act, or a check of documents against an act:
// what changed, which documents are affected and why, decisions.
import { t, lang } from '../i18n.js';
import { html, icon, fmtDate, fmtDateTime, openModal, formValues, toast, errorToast, confirmDialog } from '../ui.js';
import { app } from '../app.js';
import { secLabel } from './document.js';
import { rewriteDialog } from './rewrite.js';

const api = window.api;
let ch = null;
let activities = [];
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

const actLabel = (id) => {
  const a = activities.find((x) => x.id === id);
  return a ? (lang() === 'sk' ? a.sk : a.en) : id;
};

// The company's decision about a provision ("does not apply to us" / "our document applies").
function decisionHtml(d, { reassess = false } = {}) {
  return html`<div class="decision ${reassess ? 'reassess' : ''}">
    ${icon(reassess ? 'alert' : 'shield')}
    <div><b>${t(reassess ? 'dec.reassess' : `dec.kind.${d.kind}`)}</b>${d.docId ? '' : html` <span class="chip chip-muted">${t('dec.companyWide')}</span>`}
      <div class="small">${d.reason}</div>
      <div class="muted small">${d.by} · ${fmtDateTime(d.at)}</div></div>
    <button class="btn btn-sm btn-ghost" data-action="undoDecision" data-id="${d.id}" data-perm="editor">${icon('x')}${t('dec.undo')}</button>
  </div>`;
}

function hintHtml(f) {
  if (!f.hints || !f.hints.length || f.decision) return '';
  return html`<div class="hint-act">${icon('info')}${t('dec.hint', { acts: f.hints.map((h) => actLabel(h.id)).join(', ') })}</div>`;
}

function decideBtn(a, f) {
  if (f.decision) return '';
  return html`<button class="btn btn-sm btn-ghost" data-action="decide" data-doc="${a.docId}" data-sec="${f.section}" data-hints="${(f.hints || []).map((h) => h.id).join(',')}" data-perm="editor">${icon('shield')}${t('dec.btn')}</button>`;
}

function findingsHtml(a) {
  const list = (a.findings || []).filter((f) => f.type !== 'related');
  if (!list.length) return html`<div class="aff-why muted">${icon('checkCircle')}${a.cites ? t('lc.f.none') : ''}</div>`;
  // One decision often covers several findings of the same provision: its box is shown once, after the last of them.
  const lastOf = new Map();
  list.forEach((f, i) => f.decision && lastOf.set(f.decision.id, i));
  return html`<ul class="findings">${list.map(
    (f, i) => html`<li class="finding sev-${f.severity} ${f.decision ? 'decided' : ''}">
      <div class="finding-main">${f.decision ? html`<span class="chip chip-good">${icon('check')}${t('dec.decided')}</span>` : html`<span class="chip chip-${SEV_TONE[f.severity]}">${t(`lc.sev.${f.severity}`)}</span>`}<span>${findingText(f)}</span>${decideBtn(a, f)}</div>
      ${hintHtml(f)}
      ${f.decision ? (lastOf.get(f.decision.id) === i ? decisionHtml(f.decision) : '') : f.reassess ? decisionHtml(f.reassess, { reassess: true }) : ''}
    </li>`
  )}</ul>`;
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
      ${aiOn && (a.analysis && a.analysis.refs || []).some((r) => (r.docExcerpts || []).length) ? html`<button class="btn btn-sm" data-action="rewriteDoc" data-doc="${a.docId}" data-perm="editor">${icon('edit')}${t('ch.rewrite')}</button>` : ''}
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
    <ul class="findings">${rel.map((r) => {
      const f = (a.findings || []).find((x) => x.type === 'related' && x.section === r.key) || { type: 'related', section: r.key };
      return html`<li class="finding ${f.decision ? 'decided' : ''}"><div class="finding-main"><span class="chip chip-${f.decision ? 'good' : 'info'}">${secLabel(r.key)}</span><span class="muted">${t('lc.relTerms', { terms: (r.terms || []).join(', ') })}</span>${decideBtn(a, f)}</div>${hintHtml(f)}${f.decision ? decisionHtml(f.decision) : ''}</li>`;
    })}</ul>
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
      <p class="muted small">${icon('shield')}${t('dec.principle')}</p>
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
  [ch, { activities }] = await Promise.all([api.changes.get(route.parts[1]), api.company.get()]);
  const s = ch.diff && ch.diff.stats;
  const tone = ch.kind === 'upcoming' ? 'warn' : ch.kind === 'repealed' ? 'bad' : ch.kind === 'check' ? 'muted' : 'info';
  const hasDiff = ch.diff && ch.diff.mode && ch.diff.mode !== 'none';
  return html`<div class="page">
    <a class="back" href="#/legislation">← ${t('leg.title')}</a>
    <header class="page-head">
      <div>
        <div class="chips"><span class="chip chip-${tone}">${t(`leg.kind.${ch.kind}`)}</span>${ch.toDate ? html`<span class="chip chip-muted">${icon('clock')}${t(ch.kind === 'check' ? 'lc.version' : 'leg.effectiveFrom', { date: fmtDate(ch.toDate) })}</span>` : ''}</div>
        <h1>${ch.law ? ch.law.title : ''}</h1>
        <p class="muted">${ch.fromDate && ch.toDate && hasDiff ? t('leg.versionsCmp', { from: fmtDate(ch.fromDate), to: fmtDate(ch.toDate) }) + ' · ' : ''}${ch.amendedBy && ch.amendedBy.length ? t('leg.amendedBy', { acts: ch.amendedBy.join(', ') }) + ' · ' : ''}
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
    ${decisionsPanel()}
    ${diffHtml(ch.diff)}
  </div>`;
}

function decisionsPanel() {
  const list = ch.decisions || [];
  if (!list.length) return '';
  return html`<section class="panel" id="decisions"><h3>${icon('shield')}${t('dec.title')} <span class="count">${list.length}</span></h3>
    <p class="muted small">${t('dec.panelHint')}</p>
    <ul class="rows">${list.map(
      (d) => html`<li class="row decision-row">
        <span class="sec-label">${d.section === '*' ? t('dec.wholeAct') : secLabel(d.section)}</span>
        <span class="chip chip-${d.kind === 'na' ? 'muted' : 'good'}">${t(`dec.kind.${d.kind}`)}</span>
        <span class="row-title">${d.reason}</span>
        <span class="muted small">${d.doc ? `${d.doc.code || d.doc.title}` : t('dec.companyWide')} · ${d.by} · ${fmtDate(d.at.slice(0, 10))}</span>
        <button class="btn btn-sm btn-ghost" data-action="undoDecision" data-id="${d.id}" data-perm="editor">${icon('x')}${t('dec.undo')}</button>
      </li>`
    )}</ul></section>`;
}

/** Record the company's decision about a provision for one document or for the whole company. */
export async function decisionDialog({ lawId, lawTitle, section, docId, docLabel, hints = [], changeId, activityList = activities }) {
  let vals = null;
  const label = (id) => {
    const a = activityList.find((x) => x.id === id);
    return a ? (lang() === 'sk' ? a.sk : a.en) : id;
  };
  const suggested = hints.length ? t('dec.reasonFromProfile', { acts: hints.map(label).join(', ') }) : '';
  const r = await openModal({
    title: `${t('dec.dialogTitle')} – ${secLabel(section)}`,
    size: 'md',
    body: html`<form class="form-grid dec-form">
      <p class="field full muted small">${lawTitle}</p>
      <div class="field full"><label>${t('dec.what')}</label><div class="radio-col">
        <label class="radio"><input type="radio" name="kind" value="na" ${hints.length || !docId ? 'checked' : ''}> <span><b>${t('dec.kind.na')}</b><br><span class="muted small">${t('dec.kind.na.help')}</span></span></label>
        <label class="radio"><input type="radio" name="kind" value="ours" ${!hints.length && docId ? 'checked' : ''}> <span><b>${t('dec.kind.ours')}</b><br><span class="muted small">${t('dec.kind.ours.help')}</span></span></label>
      </div></div>
      <div class="field full"><label>${t('dec.scope')}</label><div class="radio-col">
        ${docId ? html`<label class="radio"><input type="radio" name="scope" value="doc" ${hints.length ? '' : 'checked'}> ${t('dec.scope.doc', { doc: docLabel })}</label>` : ''}
        <label class="radio"><input type="radio" name="scope" value="company" ${hints.length || !docId ? 'checked' : ''}> ${t('dec.scope.company')}</label>
      </div></div>
      <div class="field full"><label>${t('dec.provision')}</label><div class="radio-col">
        <label class="radio"><input type="radio" name="whole" value="sec" checked> ${secLabel(section)}</label>
        <label class="radio"><input type="radio" name="whole" value="all"> ${t('dec.wholeActOf')}</label>
      </div></div>
      <div class="field full"><label>${t('dec.reason')}</label><textarea name="reason" rows="3" required placeholder="${t('dec.reasonPh')}">${suggested}</textarea></div>
      <p class="field full muted small">${icon('info')}${t('dec.note')}</p>
      <div class="field full err small" id="dec-err"></div>
    </form>`,
    buttons: [
      { label: t('cancel'), value: null },
      {
        label: t('save'),
        kind: 'primary',
        value: 'ok',
        onClick: async (el) => {
          vals = formValues(el);
          if ((vals.reason || '').trim().length < 3) {
            el.querySelector('#dec-err').textContent = t('dec.reasonMissing');
            return false;
          }
          try {
            await api.decisions.add({ lawId, section: vals.whole === 'all' ? '*' : section, docId: vals.scope === 'doc' ? docId : null, kind: vals.kind, reason: vals.reason, changeId });
            return true;
          } catch (e) {
            el.querySelector('#dec-err').textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
            return false;
          }
        }
      }
    ]
  });
  if (r === 'ok') toast(t('dec.saved'), 'good');
  return r === 'ok';
}

function refreshAffected() {
  const el = document.getElementById('affected');
  if (el) el.innerHTML = String(html`${affectedHtml()}`);
}

export const actions = {
  openSource: () => api.app.openExternal(ch.sourceUrl || (ch.law && ch.law.url)),
  async decide(el) {
    const a = ch.affected.find((x) => x.docId === el.dataset.doc);
    const ok = await decisionDialog({
      lawId: ch.lawId,
      lawTitle: ch.law ? ch.law.title : '',
      section: el.dataset.sec,
      docId: el.dataset.doc,
      docLabel: a && a.doc ? a.doc.code || a.doc.title : '',
      hints: (el.dataset.hints || '').split(',').filter(Boolean),
      changeId: ch.id
    });
    if (ok) {
      app.refreshSidebar();
      app.rerender();
    }
  },
  /** Propose new wording for the passages of the document that cite the changed provisions. */
  async rewriteDoc(el) {
    const a = ch.affected.find((x) => x.docId === el.dataset.doc);
    const refs = (a.analysis && a.analysis.refs) || [];
    const first = refs.filter((r) => r.changed).concat(refs).find((r) => (r.docExcerpts || []).length);
    const doc = await api.docs.get(a.docId);
    await rewriteDialog({ doc, passage: first ? first.docExcerpts.map((x) => x.text.replace(/ …$/, '')).join('\n\n') : '', lawIds: [ch.lawId], instruction: 'align', changeId: ch.id });
  },
  async undoDecision(el) {
    if (!(await confirmDialog(t('dec.undoConfirm'), { okLabel: t('dec.undo') }))) return;
    await api.decisions.remove(el.dataset.id);
    app.refreshSidebar();
    app.rerender();
  },
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
