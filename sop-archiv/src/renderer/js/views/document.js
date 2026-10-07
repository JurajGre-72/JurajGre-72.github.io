// Document detail.
import { t, lang } from '../i18n.js';
import { html, icon, statusChip, reviewChip, fmtDate, fmtDateTime, fmtSize, typeLabel, openModal, formValues, confirmDialog, toast, esc, diffView } from '../ui.js';
import { app } from '../app.js';
import { recordReview } from './review-dialog.js';
import { uploadVersion } from './importer.js';
import { fold } from '../text.js';
import { rewriteDialog } from './rewrite.js';
import { logoPng } from './compose.js';
import { recordTrainingDialog, confirmReadDialog } from './training.js';
import { approvalBanner, controlTab, controlActions } from './control.js';

const api = window.api;
let doc = null;
let laws = [];
let pages = null;

const TABS = ['info', 'reviews', 'legis', 'training', 'control', 'proposals', 'versions', 'text', 'history'];
const TAB_LABEL = { info: 'doc.tabInfo', reviews: 'doc.tabReviews', legis: 'doc.tabLegis', training: 'doc.tabTraining', control: 'doc.tabControl', proposals: 'doc.tabProposals', versions: 'doc.tabVersions', text: 'doc.tabText', history: 'doc.tabHistory' };

// Who must know this document, who is trained on its current version.
function trainingTab(tr, mine) {
  const missing = tr.rows.filter((r) => !r.record);
  const myTurn = mine.docs.some((d) => d.id === doc.id);
  return html`<section class="panel">
    <div class="panel-head">
      <div>${dl([[t('tr.for'), tr.trainingFor.length ? (tr.trainingFor.includes('*') ? t('tr.forAll') : tr.trainingFor.join(', ')) : html`<span class="muted">${t('tr.forNone')}</span> <button class="link" data-action="edit" data-perm="editor">${t('tr.setFor')}</button>`]])}</div>
      <div class="btn-row">
        ${myTurn ? html`<button class="btn btn-primary" data-action="confirmRead">${icon('check')}${t('tr.readOk')}</button>` : ''}
        <button class="btn" data-action="recordTraining" data-perm="editor">${icon('check')}${t('tr.record')}</button>
      </div>
    </div>
    ${tr.rows.length
      ? html`<div class="table-wrap"><table class="table compact"><thead><tr><th>${t('tr.name')}</th><th>${t('f.department')}</th><th>${t('tr.status')}</th></tr></thead>
        <tbody>${tr.rows.map((r) => html`<tr><td>${r.person.name}</td><td>${r.person.department}</td><td>${r.record ? html`<span class="chip chip-good">${icon('check')}${fmtDate(r.record.date)} · ${t(`tr.m.${r.record.method}`)}</span>` : html`<span class="chip chip-warn">${t('tr.missing')}</span>`}</td></tr>`)}</tbody></table></div>
        <p class="muted small">${missing.length ? t('tr.docMissing', { n: missing.length }) : t('tr.docComplete')}</p>`
      : html`<p class="muted small">${t('tr.docNoPeople')}</p>`}
    ${tr.history.length
      ? html`<h3>${t('tr.history')}</h3><div class="table-wrap"><table class="table compact"><thead><tr><th>${t('rv.date')}</th><th>${t('tr.name')}</th><th>${t('f.version')}</th><th>${t('tr.method')}</th><th>${t('tr.trainer')}</th><th></th></tr></thead>
        <tbody>${tr.history.map((h) => html`<tr><td class="nowrap">${fmtDate(h.date)}</td><td>${h.personName}</td><td>${h.version}</td><td>${t(`tr.m.${h.method}`)}${h.confirmedByUser ? html` <span class="chip chip-good">${t('tr.signed')}</span>` : ''}</td><td>${h.trainer || ''}</td>
          <td><button class="btn btn-sm btn-ghost danger" data-action="removeTraining" data-id="${h.id}" data-perm="admin" title="${t('delete')}">${icon('trash')}</button></td></tr>`)}</tbody></table></div>`
      : ''}
  </section>`;
}

// Proposals to change the text (from "Rewrite with AI"), until a new version takes them over.
function proposalsTab() {
  const list = (doc.proposals || []).slice().reverse();
  const open = list.filter((p) => p.status === 'open').length;
  return html`<section class="panel">
    <div class="panel-head">
      <p class="muted">${t('pr.intro')}</p>
      <div class="btn-row">
        <button class="btn btn-primary" data-action="rewrite" data-perm="editor">${icon('sparkles')}${t('rw.title')}</button>
        ${open ? html`<button class="btn" data-action="exportProposals">${icon('download')}${t('pr.export')}</button>` : ''}
      </div>
    </div>
    ${list.length
      ? list.map(
          (p) => html`<article class="proposal st-${p.status}">
            <div class="proposal-head">
              <span class="chip chip-${p.status === 'open' ? 'info' : p.status === 'done' ? 'good' : 'muted'}">${t(`pr.st.${p.status}`)}</span>
              <span class="small"><b>${p.instruction}</b></span>
              <span class="muted small">${p.by} · ${fmtDateTime(p.at)}${p.version !== doc.version ? ` · ${t('pr.forVersion', { v: p.version })}` : ''}${p.ai ? ` · ${icon('sparkles')}${p.ai.model}` : ''}</span>
              <span class="spacer"></span>
              <select data-change="proposalStatus" data-id="${p.id}" data-perm="editor">${['open', 'done', 'rejected'].map((x) => html`<option value="${x}" ${x === p.status ? 'selected' : ''}>${t(`pr.st.${x}`)}</option>`)}</select>
              <button class="btn btn-sm btn-ghost danger" data-action="removeProposal" data-id="${p.id}" data-perm="editor" title="${t('delete')}">${icon('trash')}</button>
            </div>
            ${diffView(p.original, p.text)}
            ${p.reasons.length ? html`<ul class="rw-reasons">${p.reasons.map((r) => html`<li>${r}</li>`)}</ul>` : ''}
          </article>`
        )
      : html`<p class="muted">${t('pr.none')}</p>`}
  </section>`;
}

function dl(rows) {
  return html`<dl class="dl">${rows.filter(Boolean).map(([k, v]) => html`<dt>${k}</dt><dd>${v || html`<span class="muted">${t('none')}</span>`}</dd>`)}</dl>`;
}

function infoTab() {
  const types = app.info.archiveSettings.docTypes;
  return html`<div class="grid-2">
    <section class="panel">
      ${dl([
        [t('f.code'), doc.code],
        [t('f.title'), doc.title],
        [t('f.type'), typeLabel(types, doc.type)],
        [t('f.version'), doc.version],
        [t('f.status'), statusChip(doc.status)],
        [t('f.department'), doc.department],
        [t('f.owner'), doc.owner],
        [t('f.approver'), doc.approver],
        [t('f.tags'), (doc.tags || []).length ? html`${doc.tags.map((x) => html`<span class="chip chip-muted">${x}</span>`)}` : '']
      ])}
    </section>
    <section class="panel">
      ${dl([
        [t('f.effectiveDate'), fmtDate(doc.effectiveDate)],
        [t('f.reviewDate'), doc.reviewDate ? html`${fmtDate(doc.reviewDate)} ${reviewChip(doc.review)}` : ''],
        [t('f.interval'), doc.reviewIntervalMonths ? String(doc.reviewIntervalMonths) : ''],
        [t('f.lastReview'), fmtDate(doc.lastReviewDate)],
        [t('f.file'), doc.current ? html`${doc.current.fileName} <span class="muted">(${fmtSize(doc.current.size)})</span>` : ''],
        [t('f.notes'), doc.notes ? html`<span class="pre">${doc.notes}</span>` : '']
      ])}
      ${ocrNote(doc.current)}
    </section>
  </div>`;
}

function reviewsTab() {
  const rows = (doc.reviews || []).slice().reverse();
  return html`<section class="panel">
    <div class="panel-head">
      <div>${dl([
        [t('f.reviewDate'), doc.reviewDate ? html`${fmtDate(doc.reviewDate)} ${reviewChip(doc.review)}` : ''],
        [t('f.interval'), doc.reviewIntervalMonths ? t('doc.reviewEvery', { n: doc.reviewIntervalMonths }) : '']
      ])}</div>
      <button class="btn btn-primary" data-action="review" data-perm="editor">${icon('check')}${t('doc.markReviewed')}</button>
    </div>
    <h3>${t('doc.reviewHistory')}</h3>
    ${rows.length
      ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th>${t('rv.date')}</th><th>${t('rv.by')}</th><th>${t('rv.outcome')}</th><th>${t('rv.next')}</th><th>${t('rv.notes')}</th></tr></thead>
        <tbody>${rows.map((r) => html`<tr><td class="nowrap">${fmtDate(r.date)}</td><td>${r.by}</td><td>${t(`rv.o.${r.outcome}`)}</td><td class="nowrap">${fmtDate(r.nextReviewDate)}</td><td class="pre">${r.notes}</td></tr>`)}</tbody>
      </table></div>`
      : html`<p class="muted">${t('doc.reviewNone')}</p>`}
  </section>`;
}

function legisTab(changes) {
  const lawById = new Map(laws.map((l) => [l.id, l]));
  const mine = changes.filter((c) => c.status !== 'resolved' && (c.affected || []).some((a) => a.docId === doc.id));
  return html`
    ${mine.length
      ? html`<section class="panel panel-accent"><h3>${icon('scale')}${t('doc.pendingChanges')}</h3>
        <ul class="rows">${mine.map((c) => {
          const a = c.affected.find((x) => x.docId === doc.id);
          return html`<li class="row"><a class="row-main" href="#/legislation/change/${c.id}"><span class="chip chip-${c.kind === 'upcoming' ? 'warn' : 'info'}">${t(`leg.kind.${c.kind}`)}</span><span class="row-title">${c.law ? c.law.short || c.law.title : ''}</span></a>
            ${c.toDate ? html`<span class="row-date">${t('leg.effectiveFrom', { date: fmtDate(c.toDate) })}</span>` : ''}
            ${a.direct.length ? html`<span class="chip chip-bad">${t('ch.direct', { secs: a.direct.map(secLabel).join(', ') })}</span>` : ''}
            <span class="chip chip-muted">${t(`ch.st.${a.status}`)}</span></li>`;
        })}</ul></section>`
      : ''}
    <section class="panel">
      <h3>${t('doc.citations')}</h3>
      ${doc.citations.length
        ? html`<ul class="rows">${doc.citations.map((c) => {
            const l = lawById.get(c.lawId);
            if (!l) return '';
            return html`<li class="row"><span class="chip chip-muted">${t(`leg.j.${l.jurisdiction}`)}</span><span class="row-title" title="${l.title}">${l.short || l.title}</span>
              <span class="muted small">${c.count}×</span>${c.sections.length ? html`<span class="secs">${c.sections.map((s) => html`<span class="sec">${secLabel(s)}</span>`)}</span>` : ''}</li>`;
          })}</ul>`
        : html`<p class="muted">${t('doc.citationsNone')}</p>`}
      ${(doc.lawRefs || []).length
        ? html`<h3>${t('doc.otherRefs')}</h3><ul class="rows">${doc.lawRefs.map(
            (r) => html`<li class="row"><span class="chip chip-muted">${t(`kind.${r.jurisdiction}`)}</span><span class="row-title">${r.label}</span><span class="muted small">${r.count}×</span>
            <button class="btn btn-sm" data-action="monitor" data-perm="editor" data-key="${r.key}" data-label="${r.label}" data-url="${r.url}" data-j="${r.jurisdiction}">${icon('plus')}${t('dash.suggestAdd')}</button></li>`
          )}</ul>`
        : ''}
    </section>`;
}

export function secLabel(k) {
  const m = String(k).match(/^(§|art|annex)(.+)$/);
  if (!m) return k;
  if (m[1] === '§') return `§ ${m[2]}`;
  if (m[1] === 'art') return `${lang() === 'sk' ? 'čl.' : 'Art.'} ${m[2]}`;
  return `${lang() === 'sk' ? 'príl.' : 'Annex'} ${m[2]}`;
}

function versionsTab() {
  const vs = doc.versions.slice().reverse();
  return html`<section class="panel"><div class="table-wrap"><table class="table">
    <thead><tr><th>#</th><th>${t('f.version')}</th><th>${t('f.file')}</th><th>${t('doc.imported')}</th><th>${t('doc.tabText')}</th><th></th></tr></thead>
    <tbody>${vs.map(
      (v) => html`<tr>
        <td class="num">${v.seq}</td>
        <td>${v.label} ${v.status === 'current' ? html`<span class="chip chip-good">${t('doc.versionCurrent')}</span>` : html`<span class="chip chip-muted">${t('doc.versionSuperseded')}</span>`}</td>
        <td>${v.fileName} <span class="muted">· ${fmtSize(v.size)}</span></td>
        <td class="muted small nowrap">${fmtDateTime(v.importedAt)} · ${t('doc.importedBy', { who: v.importedBy })}</td>
        <td>${v.ocr && v.ocr.status === 'pending' ? html`<span class="chip chip-muted">${t('ocr.pendingShort')}</span>` : v.textStatus !== 'ok' ? html`<span class="chip chip-warn">${t('imp.noText')}</span>` : html`<span class="muted small">${v.chars} ${t('doc.chars')}${v.ocr && v.ocr.status === 'done' ? ' · OCR' : ''}</span>`}</td>
        <td class="nowrap"><button class="btn btn-sm" data-action="openFile" data-vid="${v.id}">${icon('external')}${t('open')}</button> <button class="btn btn-sm btn-ghost" data-action="saveCopy" data-vid="${v.id}" title="${t('doc.saveCopy')}">${icon('download')}</button></td>
      </tr>`
    )}</tbody></table></div></section>`;
}

function textTab() {
  if (!pages) return html`<div class="spinner"></div>`;
  const total = pages.reduce((n, p) => n + p.text.length, 0);
  if (!total) return html`<div class="note note-warn">${icon('alert')}${t('doc.noText')}</div>`;
  return html`<section class="panel">
    <div class="toolbar"><div class="search-field">${icon('search')}<input type="search" placeholder="${t('doc.textFilter')}" data-input="findText" id="find-text"></div><span class="muted small" id="find-count"></span></div>
    <div class="doc-text" id="doc-text">${pages.map((p) => html`${p.page ? html`<div class="page-mark">${t('doc.page', { n: p.page })}</div>` : ''}<div class="page-text">${p.text}</div>`)}</div>
  </section>`;
}

function auditLabel(a) {
  return t(`audit.${a}`) === `audit.${a}` ? a : t(`audit.${a}`);
}

async function historyTab() {
  const rows = await api.app.audit({ docId: doc.id });
  if (!rows.length) return html`<p class="muted">${t('none')}</p>`;
  return html`<section class="panel"><div class="table-wrap"><table class="table">
    <thead><tr><th>${t('rv.date')}</th><th>${t('rv.by')}</th><th>${t('audit.action')}</th><th>${t('audit.details')}</th></tr></thead>
    <tbody>${rows.map(
      (r) => html`<tr><td class="nowrap">${fmtDateTime(r.ts)}</td><td>${r.user}</td><td>${auditLabel(r.action)}</td><td class="small">${auditDetails(r)}</td></tr>`
    )}</tbody></table></div></section>`;
}

export function auditDetails(r) {
  if (r.changes && typeof r.changes === 'object') {
    return Object.entries(r.changes).map(
      ([k, v]) => html`<div><b>${t(`f.${k}`) === `f.${k}` ? k : t(`f.${k}`)}</b>: ${k === 'status' ? fmtStatus(v.from) : fmtVal(v.from)} → ${k === 'status' ? fmtStatus(v.to) : fmtVal(v.to)}</div>`
    );
  }
  if (r.userChanges) {
    return Object.entries(r.userChanges).map(([k, v]) => html`<div><b>${k === 'role' ? t('auth.role') : k === 'name' ? t('auth.name') : t('usr.disabled')}</b>: ${k === 'role' ? t(`role.${v.from}`) : String(v.from)} → ${k === 'role' ? t(`role.${v.to}`) : String(v.to)}</div>`);
  }
  if (r.action === 'notice.handled' || r.action === 'notice.reopened') return [r.title, r.outcome ? t(`nt.out.${r.outcome}`) : '', r.note].filter(Boolean).join(' · ');
  if (r.action === 'report.exported') return [String(r.format || '').toUpperCase(), r.from || r.to ? `${fmtDate(r.from) || '…'} – ${fmtDate(r.to) || '…'}` : '', r.file].filter(Boolean).join(' · ');
  if (r.action === 'notices.new') return [`+${r.n}`, ...(r.titles || [])].join(' · ');
  const parts = [];
  if (r.role) parts.push(t(`role.${r.role}`));
  if (r.source) parts.push(r.source);
  if (r.file) parts.push(r.file);
  if (r.from || r.to) parts.push(`${fmtVal(r.from)} → ${fmtVal(r.to)}`);
  if (r.outcome) parts.push(t(`rv.o.${r.outcome}`));
  if (r.next) parts.push(`${t('rv.next')}: ${fmtDate(r.next)}`);
  if (r.action === 'legislation.doc-assessed' && r.status) parts.push(t(`ch.st.${r.status}`));
  else if (r.action === 'legislation.change-status' && r.status) parts.push(r.status === 'resolved' ? t('ch.resolve') : t('ch.reopen'));
  if (r.action === 'legislation.change-detected' && r.affected !== undefined) parts.push(t('leg.affected', { n: r.affected }));
  if (r.action === 'legislation.checked' && r.newChanges) parts.push(`+${r.newChanges}`);
  if (r.notes || r.note) parts.push(r.notes || r.note);
  if (r.error) parts.push(r.error);
  if (r.question) parts.push(r.question);
  return parts.join(' · ');
}

function fmtStatus(v) {
  return v ? t(`status.${v}`) : '—';
}

function fmtVal(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.join(', ');
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return fmtDate(v);
  return String(v);
}

/** Text of a scanned document: waiting for OCR, read by OCR, or not readable. */
function ocrNote(cur) {
  if (!cur) return '';
  const o = cur.ocr;
  if (o && o.status === 'pending') return html`<div class="note">${icon('clock')}${t('ocr.pendingNote')}</div>`;
  if (o && o.status === 'done' && cur.textStatus === 'ok') return html`<div class="note">${icon('info')}${t('ocr.doneNote')}</div>`;
  if (cur.textStatus !== 'ok') return html`<div class="note note-warn">${icon('alert')}${o && o.status === 'error' ? t('ocr.failedNote') : t('doc.noText')}</div>`;
  return '';
}

export function onDataChanged() {
  if (doc && app.route && app.route.name === 'documents') app.rerender();
}

export async function render(route) {
  const id = route.parts[0];
  const [d, l, changes] = await Promise.all([api.docs.get(id), api.laws.list(), api.changes.list()]);
  if (!d) return html`<div class="page"><p>${t('docs.empty')}</p></div>`;
  doc = d;
  laws = l;
  const tab = TABS.includes(route.query.tab) ? route.query.tab : 'info';
  pages = tab === 'text' ? await api.docs.text(id) : null;
  let body;
  if (tab === 'info') body = infoTab();
  else if (tab === 'reviews') body = reviewsTab();
  else if (tab === 'legis') body = legisTab(changes);
  else if (tab === 'proposals') body = proposalsTab();
  else if (tab === 'control') body = controlTab(doc, await api.copies.toWithdraw());
  else if (tab === 'training') {
    const [tr, mine] = await Promise.all([api.training.doc(id), api.training.mine()]);
    body = trainingTab(tr, mine);
  }
  else if (tab === 'versions') body = versionsTab();
  else if (tab === 'text') body = textTab();
  else body = await historyTab();
  const legisCount = changes.filter((c) => c.status !== 'resolved' && (c.affected || []).some((a) => a.docId === doc.id)).length;
  const openProposals = (doc.proposals || []).filter((p) => p.status === 'open').length;

  return html`<div class="page">
    <a class="back" href="#/documents">← ${t('docs.title')}</a>
    <header class="page-head doc-head">
      <div>
        <div class="doc-code">${doc.code || ''} <span class="type-tag">${doc.type}</span></div>
        <h1>${doc.title}</h1>
        <div class="chips">${statusChip(doc.status)} <span class="chip chip-muted">v${doc.version}</span> ${doc.status !== 'obsolete' ? (doc.annexOf && !doc.reviewDate ? html`<span class="chip chip-muted">${t('doc.reviewWith', { code: doc.annexOf })}</span>` : reviewChip(doc.review)) : ''}${(doc.tags || []).includes('EN') ? html` <span class="chip chip-muted">EN</span>` : ''}</div>
        ${doc.annexOf ? html`<p class="annex-of">${icon('layers')}${t('doc.annexOf')} ${doc.parent ? html`<a href="#/documents/${doc.parent.id}"><b>${doc.parent.code}</b> ${doc.parent.title}</a>` : html`<b>${doc.annexOf}</b> <span class="muted">(${t('doc.parentMissing')})</span>`}</p>` : ''}
        ${approvalBanner(doc)}
        ${(doc.annexes || []).length ? html`<div class="annex-list"><span class="muted">${icon('layers')}${t('doc.annexes', { n: doc.annexes.length })}:</span> ${doc.annexes.map((x) => html`<a class="chip chip-link" href="#/documents/${x.id}">${x.code.replace(/^.*?(Príloha)/, '$1')} – ${x.title}</a>`)}</div>` : ''}
      </div>
      <div class="head-actions wrap">
        <button class="btn btn-primary" data-action="openFile">${icon('external')}${t('doc.openFile')}</button>
        <button class="btn" data-action="review" data-perm="editor">${icon('check')}${t('doc.markReviewed')}</button>
        <button class="btn" data-action="newVersion" data-perm="editor">${icon('upload')}${t('doc.newVersion')}</button>
        <button class="btn" data-action="rewrite" data-perm="editor">${icon('sparkles')}${t('rw.title')}</button>
        ${doc.status === 'draft' && !(doc.approvals || []).some((a) => a.status === 'pending') ? html`<button class="btn" data-action="aprRequest" data-perm="editor">${icon('shield')}${t('apr.request')}</button>` : ''}
        <button class="btn" data-action="edit" data-perm="editor">${icon('edit')}${t('edit')}</button>
        <button class="btn btn-ghost" data-action="saveCopy" title="${t('doc.saveCopy')}">${icon('download')}</button>
        <button class="btn btn-ghost danger" data-action="remove" data-perm="admin" title="${t('delete')}">${icon('trash')}</button>
      </div>
    </header>
    <nav class="tabs">${TABS.map(
      (k) => html`<a href="#/documents/${doc.id}?tab=${k}" class="tab ${k === tab ? 'active' : ''}">${t(TAB_LABEL[k])}${k === 'legis' && legisCount ? html`<span class="badge badge-info">${legisCount}</span>` : ''}${k === 'proposals' && openProposals ? html`<span class="badge badge-info">${openProposals}</span>` : ''}${k === 'versions' ? html`<span class="count">${doc.versions.length}</span>` : ''}</a>`
    )}</nav>
    ${body}
  </div>`;
}

async function editDialog() {
  const s = app.info.archiveSettings;
  let vals = null;
  const r = await openModal({
    title: `${t('edit')} – ${doc.code || doc.title}`,
    size: 'lg',
    body: html`<form class="form-grid">
      <div class="field"><label>${t('f.code')}</label><input name="code" value="${doc.code}"></div>
      <div class="field"><label>${t('f.type')}</label><select name="type">${s.docTypes.map((tp) => html`<option value="${tp.id}" ${tp.id === doc.type ? 'selected' : ''}>${tp.id} – ${typeLabel(s.docTypes, tp.id)}</option>`)}</select></div>
      <div class="field full"><label>${t('f.title')}</label><input name="title" value="${doc.title}"></div>
      <div class="field"><label>${t('f.annexOf')}</label><input name="annexOf" value="${doc.annexOf || ''}" placeholder="${t('f.annexOfHint')}"></div>
      <div class="field"><label>${t('f.version')}</label><input name="version" value="${doc.version}"></div>
      <div class="field"><label>${t('f.status')}</label><select name="status">${['draft', 'effective', 'review', 'obsolete'].map((x) => html`<option value="${x}" ${x === doc.status ? 'selected' : ''}>${t(`status.${x}`)}</option>`)}</select></div>
      <div class="field"><label>${t('f.department')}</label><select name="department"><option value="">${t('none')}</option>${Array.from(new Set([...s.departments, doc.department].filter(Boolean))).map((d) => html`<option ${d === doc.department ? 'selected' : ''}>${d}</option>`)}</select></div>
      <div class="field"><label>${t('f.owner')}</label><input name="owner" value="${doc.owner}"></div>
      <div class="field"><label>${t('f.approver')}</label><input name="approver" value="${doc.approver}"></div>
      <div class="field"><label>${t('f.tags')} <span class="muted">(${t('f.tagsHint')})</span></label><input name="tags" value="${(doc.tags || []).join(', ')}"></div>
      <div class="field"><label>${t('f.effectiveDate')}</label><input type="date" name="effectiveDate" value="${doc.effectiveDate || ''}"></div>
      <div class="field"><label>${t('f.reviewDate')}</label><input type="date" name="reviewDate" value="${doc.reviewDate || ''}"></div>
      <div class="field"><label>${t('f.interval')}</label><input type="number" min="0" max="120" name="reviewIntervalMonths" value="${doc.reviewIntervalMonths || ''}"></div>
      <div class="field full"><label>${t('tr.for')}</label><div class="tf-list">
        <label class="check"><input type="checkbox" data-tf="*" ${(doc.trainingFor || []).includes('*') ? 'checked' : ''}> <b>${t('tr.forAll')}</b></label>
        ${s.departments.map((d) => html`<label class="check"><input type="checkbox" data-tf="${d}" ${(doc.trainingFor || []).includes(d) ? 'checked' : ''}> ${d}</label>`)}
      </div><span class="hint">${t('tr.forHint')}</span></div>
      <div class="field full"><label>${t('f.notes')}</label><textarea name="notes" rows="3">${doc.notes}</textarea></div>
    </form>`,
    buttons: [
      { label: t('cancel'), value: null },
      { label: t('save'), kind: 'primary', value: 'ok', onClick: (el) => ((vals = { ...formValues(el), trainingFor: Array.from(el.querySelectorAll('[data-tf]:checked')).map((x) => x.dataset.tf) }), true) }
    ]
  });
  if (r !== 'ok') return;
  await api.docs.update(doc.id, vals);
  toast(t('saved'), 'good');
  app.refreshSidebar();
  app.rerender();
}

export function mount(root) {
  const input = root.querySelector('#find-text');
  if (input) input.focus();
}

export const actions = {
  ...controlActions(() => doc),
  openFile: (el) => api.docs.open(doc.id, el.dataset.vid || undefined),
  async saveCopy(el) {
    const p = await api.docs.saveCopy(doc.id, el.dataset.vid || undefined);
    if (p) toast(t('doc.copySaved', { path: p }), 'good', 6000);
  },
  async review() {
    if (await recordReview(doc)) app.rerender();
  },
  async newVersion() {
    const d = await uploadVersion(doc);
    if (d) {
      toast(t('saved'), 'good');
      app.rerender();
    }
  },
  edit: () => editDialog(),
  rewrite: () => rewriteDialog({ doc }),
  async recordTraining() {
    if (await recordTrainingDialog(doc.id)) app.rerender();
  },
  async confirmRead() {
    if (await confirmReadDialog(doc)) {
      app.refreshSidebar();
      app.rerender();
    }
  },
  async removeTraining(el) {
    if (!(await confirmDialog(t('tr.removeConfirm'), { okLabel: t('delete'), danger: true }))) return;
    await api.training.remove(el.dataset.id);
    app.rerender();
  },
  async proposalStatus(el) {
    await api.rewrite.update(doc.id, el.dataset.id, { status: el.value });
    app.rerender();
  },
  async removeProposal(el) {
    if (!(await confirmDialog(t('pr.removeConfirm'), { okLabel: t('delete'), danger: true }))) return;
    await api.rewrite.remove(doc.id, el.dataset.id);
    app.rerender();
  },
  async exportProposals() {
    const p = await api.rewrite.exportDocx(doc.id, { original: t('pr.original'), proposed: t('pr.proposed'), reasons: t('rw.reasons'), proposal: t('pr.one'), title: t('pr.docTitle'), logoPng: await logoPng() });
    if (p) toast(t('doc.copySaved', { path: p }), 'good', 6000);
  },
  async remove() {
    // A document used as a controlled record is withdrawn, not deleted (it stays in the archive).
    const blockers = await api.docs.deletionBlockers(doc.id);
    if (blockers.length) {
      const r = await openModal({
        title: t('doc.cannotDelete'),
        body: html`<p>${t('doc.cannotDeleteText')}</p><ul>${blockers.map((b) => html`<li>${t(`doc.blocker.${b}`)}</li>`)}</ul>${doc.status !== 'obsolete' ? html`<p class="muted small">${t('doc.withdrawHint')}</p>` : ''}`,
        buttons: [{ label: t('close'), value: null }, ...(doc.status !== 'obsolete' ? [{ label: t('doc.withdraw'), kind: 'primary', value: 'withdraw' }] : [])]
      });
      if (r === 'withdraw') {
        await api.docs.update(doc.id, { status: 'obsolete' });
        toast(t('doc.withdrawn'), 'good');
        app.rerender();
      }
      return;
    }
    let reason = '';
    const r = await openModal({
      title: t('doc.deleteTitle'),
      body: html`<p>${t('doc.deleteConfirm', { title: doc.title })}</p>
        <div class="field"><label>${t('doc.deleteReason')}</label><textarea id="del-reason" rows="2" placeholder="${t('doc.deleteReasonPh')}"></textarea></div>`,
      buttons: [
        { label: t('cancel'), value: null },
        {
          label: t('doc.deleteNext'),
          kind: 'danger',
          value: 'ok',
          onClick: (el) => {
            reason = el.querySelector('#del-reason').value.trim();
            if (reason.length < 5) {
              toast(t('doc.deleteReasonNeeded'), 'warn');
              return false;
            }
            return true;
          }
        }
      ]
    });
    if (r !== 'ok') return;
    // Second step: a separate, explicit confirmation.
    if (!(await confirmDialog(t('doc.deleteFinal', { title: doc.title }), { okLabel: t('doc.deleteYes'), danger: true }))) return;
    await api.docs.delete(doc.id, reason);
    toast(t('doc.deleted'), 'good');
    app.navigate('documents');
  },
  async monitor(el) {
    await api.laws.add({ key: el.dataset.key, title: el.dataset.label, short: el.dataset.label, url: el.dataset.url, jurisdiction: el.dataset.j });
    toast(t('saved'), 'good');
    app.rerender();
  },
  findText(el) {
    const box = document.getElementById('doc-text');
    if (!box) return;
    const q = el.value.trim();
    const blocks = box.querySelectorAll('.page-text');
    let count = 0;
    blocks.forEach((b, i) => {
      const txt = pages[i] ? pages[i].text : b.textContent;
      if (!q) {
        b.innerHTML = esc(txt);
        return;
      }
      const f = fold(txt);
      const nq = fold(q);
      let out = '';
      let pos = 0;
      let idx = f.indexOf(nq);
      while (idx >= 0) {
        out += esc(txt.slice(pos, idx)) + '<mark>' + esc(txt.slice(idx, idx + q.length)) + '</mark>';
        pos = idx + q.length;
        count++;
        idx = f.indexOf(nq, pos);
      }
      b.innerHTML = out + esc(txt.slice(pos));
    });
    document.getElementById('find-count').textContent = q ? String(count) : '';
    const first = box.querySelector('mark');
    if (first) first.scrollIntoView({ block: 'center' });
  }
};
