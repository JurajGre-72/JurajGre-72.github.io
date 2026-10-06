'use strict';
// Inspection report: what an inspector (ŠÚKL, ÚŠKVBL) or an internal audit asks for, in one place –
// the register of controlled documents, reviews, legislation and the company's decisions about it,
// training, approvals, controlled copies and how recalls announced by the authorities were assessed. As a printable page (PDF) and as an Excel workbook.

const training = require('./training');

function inPeriod(iso, from, to) {
  const d = String(iso || '').slice(0, 10);
  return !!d && (!from || d >= from) && (!to || d <= to);
}

function fmt(iso) {
  const d = String(iso || '').slice(0, 10);
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[1]}` : '';
}

/** Everything the report shows, from the archive's data. period: { from, to } (yyyy-mm-dd, both optional). */
/** notices: the authorities' notices with .rel (as Archive.listNotices gives them) – only recalls and watched names that concern the company. */
function reportData(data, { from = '', to = '', today = new Date().toISOString().slice(0, 10), warnDays = 60, notices = [] } = {}) {
  const docs = data.docs.filter((d) => d.status !== 'obsolete').sort((a, b) => (a.code || a.title).localeCompare(b.code || b.title, 'sk', { numeric: true }));
  const laws = new Map(data.laws.map((l) => [l.id, l]));
  const days = (iso) => Math.round((new Date(`${iso}T12:00:00Z`) - new Date(`${today}T12:00:00Z`)) / 86400000);
  const ov = training.overview(docs.filter((d) => d.status === 'effective' || d.status === 'review'), data.people || [], data.trainings || []);
  const cov = new Map(ov.docs.map((x) => [x.docId, x]));
  const register = docs.map((d) => {
    const approved = (d.approvals || []).filter((a) => a.status === 'approved' && a.versionId === d.currentVersionId).pop();
    const c = cov.get(d.id);
    return {
      code: d.code || '',
      title: d.title,
      type: d.type,
      version: d.version,
      status: d.status,
      department: d.department || '',
      effectiveDate: d.effectiveDate || '',
      reviewDate: d.reviewDate || '',
      lastReviewDate: d.lastReviewDate || '',
      approver: d.approver || '',
      approvedInApp: approved ? approved.closedAt.slice(0, 10) : '',
      training: c ? `${c.required - c.missing.length}/${c.required}` : '',
      laws: (d.citations || []).map((c2) => (laws.get(c2.lawId) || {}).short || (laws.get(c2.lawId) || {}).title).filter(Boolean).join(', ')
    };
  });
  const reviewsDue = docs
    .filter((d) => d.reviewDate && d.status !== 'draft')
    .map((d) => ({ code: d.code || '', title: d.title, reviewDate: d.reviewDate, days: days(d.reviewDate) }))
    .filter((r) => r.days <= warnDays)
    .sort((a, b) => a.days - b.days);
  const reviewsDone = [];
  for (const d of docs) for (const r of d.reviews || []) if (inPeriod(r.date, from, to)) reviewsDone.push({ code: d.code || '', title: d.title, date: r.date, by: r.by, outcome: r.outcome, next: r.nextReviewDate || '', notes: r.notes || '' });
  reviewsDone.sort((a, b) => b.date.localeCompare(a.date));
  const lawRows = data.laws
    .filter((l) => l.enabled !== false)
    .map((l) => ({ title: l.title, key: l.key || '', version: (l.state && (l.state.effectiveDate || l.state.newestDate)) || '', checked: (l.state && l.state.lastCheck) || '', status: (l.state && l.state.status) || '', docs: data.docs.filter((d) => d.status !== 'obsolete' && (d.citations || []).some((c) => c.lawId === l.id)).length }));
  const changes = data.changes
    .filter((c) => inPeriod(c.detectedAt, from, to) || c.status !== 'resolved')
    .map((c) => ({ law: (laws.get(c.lawId) || {}).title || '', kind: c.kind, from: c.toDate || '', detected: c.detectedAt.slice(0, 10), status: c.status, affected: (c.affected || []).filter((a) => a.severity !== 'info').length, resolution: c.resolution ? `${fmt(c.resolution.date)} ${c.resolution.by}${c.resolution.note ? ' – ' + c.resolution.note : ''}` : '' }));
  const docsById = new Map(data.docs.map((d) => [d.id, d]));
  const decisions = (data.decisions || []).map((d) => ({ law: (laws.get(d.lawId) || {}).title || '', section: d.section === '*' ? '*' : d.section, kind: d.kind, scope: d.docId ? (docsById.get(d.docId) || {}).code || (docsById.get(d.docId) || {}).title || '' : '', reason: d.reason, by: d.by, at: d.at.slice(0, 10) }));
  const peopleById = new Map((data.people || []).map((p) => [p.id, p]));
  const trainingRecords = (data.trainings || [])
    .filter((t) => inPeriod(t.date, from, to))
    .map((t) => ({ person: t.personName, department: (peopleById.get(t.personId) || {}).department || '', code: t.code || '', title: t.title, version: t.version, date: t.date, method: t.method, trainer: t.trainer || '', signed: !!t.confirmedByUser }))
    .sort((a, b) => b.date.localeCompare(a.date));
  const trainingMissing = [];
  for (const p of ov.people) for (const id of p.missing) trainingMissing.push({ person: p.person.name, department: p.person.department || '', code: (docsById.get(id) || {}).code || '', title: (docsById.get(id) || {}).title || '', version: (docsById.get(id) || {}).version || '' });
  const approvals = [];
  for (const d of data.docs) for (const a of d.approvals || []) if (inPeriod(a.requestedAt, from, to) || inPeriod(a.closedAt, from, to)) approvals.push({ code: d.code || '', title: d.title, version: a.version, status: a.status, requested: a.requestedAt.slice(0, 10), by: a.requestedBy, signatures: a.steps.filter((s) => s.decision).map((s) => `${s.name} (${s.role}, ${s.decision}, ${fmt(s.at)})`).join('; ') });
  const copies = [];
  for (const d of data.docs) for (const c of d.copies || []) copies.push({ code: d.code || '', title: d.title, no: c.no, version: c.version, to: [c.issuedTo, c.location].filter(Boolean).join(' – '), issued: c.issuedAt.slice(0, 10), status: c.status === 'withdrawn' ? 'withdrawn' : c.versionId !== d.currentVersionId || d.status === 'obsolete' ? 'withdraw' : 'valid', withdrawn: c.withdrawnAt ? c.withdrawnAt.slice(0, 10) : '' });
  const noticeRows = notices
    .filter((n) => n.rel && n.rel.forUs && (n.category === 'recall' || n.rel.watch.length) && (!n.handled ? true : n.handled.outcome !== 'baseline' && inPeriod(n.handled.at, from, to)))
    .map((n) => ({ date: n.date, authority: n.authority === 'sukl' ? 'ŠÚKL' : 'ÚŠKVBL', title: n.title, outcome: n.handled ? n.handled.outcome : 'open', note: n.handled ? n.handled.note : '', by: n.handled ? n.handled.by : '', at: n.handled ? n.handled.at.slice(0, 10) : '' }))
    .sort((a, b) => (b.outcome === 'open') - (a.outcome === 'open') || String(b.date).localeCompare(String(a.date))); // waiting ones first
  return {
    org: data.org || '',
    today,
    from,
    to,
    counts: {
      docs: register.length,
      effective: register.filter((r) => r.status === 'effective').length,
      overdue: reviewsDue.filter((r) => r.days < 0).length,
      dueSoon: reviewsDue.filter((r) => r.days >= 0).length,
      openChanges: data.changes.filter((c) => c.status !== 'resolved').length,
      decisions: decisions.length,
      trainingMissing: trainingMissing.length,
      copiesToWithdraw: copies.filter((c) => c.status === 'withdraw').length,
      noticesOpen: noticeRows.filter((n) => n.outcome === 'open').length
    },
    register,
    reviewsDue,
    reviewsDone,
    laws: lawRows,
    changes,
    decisions,
    trainingRecords,
    trainingMissing,
    approvals,
    copies,
    notices: noticeRows
  };
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The tables of the report: [{ id, title, columns: [{ key, label, width, fmt }], rows }] – shared by PDF and Excel. */
function reportTables(r, L) {
  const st = (k) => L[`status.${k}`] || k;
  return [
    { id: 'register', title: L.register, columns: [['code', L.code, 12], ['title', L.title_, 42], ['version', L.version, 8], ['status', L.status, 12, st], ['department', L.department, 18], ['effectiveDate', L.effective, 12, fmt], ['reviewDate', L.review, 12, fmt], ['approver', L.approver, 20], ['approvedInApp', L.approvedInApp, 13, fmt], ['training', L.trainingCol, 10], ['laws', L.lawsCol, 40]], rows: r.register },
    { id: 'reviewsDue', title: L.reviewsDue, columns: [['code', L.code, 12], ['title', L.title_, 42], ['reviewDate', L.review, 12, fmt], ['days', L.days, 10, (v) => (v < 0 ? L.overdueBy.replace('{n}', -v) : L.inDays.replace('{n}', v))]], rows: r.reviewsDue },
    { id: 'reviewsDone', title: L.reviewsDone, columns: [['date', L.date, 12, fmt], ['code', L.code, 12], ['title', L.title_, 36], ['by', L.by, 18], ['outcome', L.outcome, 16, (v) => L[`outcome.${v}`] || v], ['next', L.next, 12, fmt], ['notes', L.notes, 30]], rows: r.reviewsDone },
    { id: 'laws', title: L.laws, columns: [['title', L.law, 60], ['version', L.lawVersion, 14, fmt], ['checked', L.checked, 14, fmt], ['status', L.checkStatus, 10], ['docs', L.citingDocs, 10]], rows: r.laws },
    { id: 'changes', title: L.changes, columns: [['law', L.law, 50], ['kind', L.kind, 14, (v) => L[`kind.${v}`] || v], ['from', L.effectiveFrom, 12, fmt], ['detected', L.detected, 12, fmt], ['affected', L.affected, 10], ['status', L.status, 12, (v) => L[`chst.${v}`] || v], ['resolution', L.resolution, 40]], rows: r.changes },
    { id: 'decisions', title: L.decisions, columns: [['law', L.law, 44], ['section', L.section, 10, (v) => (v === '*' ? L.wholeAct : String(v).replace(/^§/, '§ ').replace(/^art/, L.art))], ['kind', L.decision, 22, (v) => L[`dec.${v}`] || v], ['scope', L.scope, 16, (v) => v || L.companyWide], ['reason', L.reason, 50], ['by', L.by, 16], ['at', L.date, 12, fmt]], rows: r.decisions },
    { id: 'trainingMissing', title: L.trainingMissing, columns: [['person', L.person, 24], ['department', L.department, 18], ['code', L.code, 12], ['title', L.title_, 40], ['version', L.version, 8]], rows: r.trainingMissing },
    { id: 'trainingRecords', title: L.trainingRecords, columns: [['date', L.date, 12, fmt], ['person', L.person, 24], ['department', L.department, 16], ['code', L.code, 12], ['title', L.title_, 34], ['version', L.version, 8], ['method', L.method, 18, (v) => L[`method.${v}`] || v], ['trainer', L.trainer, 20], ['signed', L.signed, 10, (v) => (v ? L.yes : '')]], rows: r.trainingRecords },
    { id: 'approvals', title: L.approvals, columns: [['code', L.code, 12], ['title', L.title_, 34], ['version', L.version, 8], ['status', L.status, 12, (v) => L[`apr.${v}`] || v], ['requested', L.requested, 12, fmt], ['by', L.by, 18], ['signatures', L.signatures, 60]], rows: r.approvals },
    { id: 'copies', title: L.copies, columns: [['code', L.code, 12], ['title', L.title_, 34], ['no', L.copyNo, 6], ['version', L.version, 8], ['to', L.issuedTo, 30], ['issued', L.issued, 12, fmt], ['status', L.status, 14, (v) => L[`copy.${v}`] || v], ['withdrawn', L.withdrawnAt, 12, fmt]], rows: r.copies },
    { id: 'notices', title: L.notices, columns: [['date', L.date, 12, fmt], ['authority', L.authority, 10], ['title', L.title_, 50], ['outcome', L.assessment, 18, (v) => L[`nt.${v}`] || v], ['note', L.measures, 44], ['by', L.by, 18], ['at', L.assessedAt, 12, fmt]], rows: r.notices }
  ].map((t) => ({ ...t, columns: t.columns.map(([key, label, width, f]) => ({ key, label, width, custom: !!f, fmt: f || ((v) => (v === null || v === undefined ? '' : String(v))) })) }));
}

/** The report as a page to print to PDF (A4, landscape tables). */
function reportHtml(r, L) {
  const tables = reportTables(r, L);
  const period = r.from || r.to ? `${L.period}: ${fmt(r.from) || '…'} – ${fmt(r.to) || '…'}` : L.periodAll;
  const k = r.counts;
  const summary = [
    [L.sumDocs, `${k.docs} (${L.sumEffective.replace('{n}', k.effective)})`],
    [L.sumOverdue, k.overdue],
    [L.sumDue, k.dueSoon],
    [L.sumChanges, k.openChanges],
    [L.sumDecisions, k.decisions],
    [L.sumTraining, k.trainingMissing],
    [L.sumCopies, k.copiesToWithdraw],
    [L.sumNotices, k.noticesOpen]
  ];
  // Codes, versions and dates stay on one line; long texts wrap.
  const NW = new Set(['code', 'version', 'date', 'at', 'effectiveDate', 'reviewDate', 'approvedInApp', 'next', 'from', 'detected', 'requested', 'issued', 'withdrawn', 'checked', 'no', 'training', 'days', 'section', 'authority', 'docs', 'affected']);
  const table = (t) => `<section><h2>${esc(t.title)} <span class="n">(${t.rows.length})</span></h2>${
    t.rows.length
      ? `<table><thead><tr>${t.columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${t.rows.map((row) => `<tr>${t.columns.map((c) => `<td${NW.has(c.key) ? ' class="nw"' : ''}>${esc(c.fmt(row[c.key]))}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      : `<p class="none">${esc(L.none)}</p>`
  }</section>`;
  return `<!doctype html><html lang="${L.lang}"><head><meta charset="utf-8"><title>${esc(L.title)}</title><style>
    @page { size: A4 landscape; margin: 14mm 12mm; }
    body { font-family: "Segoe UI", Calibri, Arial, sans-serif; color: #14202b; font-size: 9pt; }
    h1 { color: #003a5b; font-size: 18pt; margin: 0 0 4px; }
    h2 { color: #003a5b; font-size: 12pt; margin: 18px 0 6px; border-bottom: 2px solid #00a78f; padding-bottom: 2px; }
    h2 .n { color: #5b6e7a; font-weight: normal; font-size: 10pt; }
    h2 { break-after: avoid; page-break-after: avoid; }
    td.nw { white-space: nowrap; }
    thead { display: table-header-group; }
    .meta { color: #5b6e7a; margin-bottom: 10px; }
    table { border-collapse: collapse; width: 100%; page-break-inside: auto; }
    tr { page-break-inside: avoid; }
    th { background: #003a5b; color: #fff; text-align: left; padding: 4px 5px; font-weight: 600; }
    td { border-bottom: 1px solid #d3dee3; padding: 3px 5px; vertical-align: top; }
    tbody tr:nth-child(even) td { background: #f4f7f8; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 10px 0; }
    .summary div { border: 1px solid #d3dee3; border-radius: 6px; padding: 6px 8px; }
    .summary b { display: block; font-size: 14pt; color: #003a5b; }
    .none { color: #5b6e7a; font-style: italic; }
    .note { color: #5b6e7a; font-size: 8pt; margin-top: 16px; }
    section { page-break-inside: auto; }
  </style></head><body>
  <h1>${esc(L.title)}</h1>
  <div class="meta">${esc(r.org)} · ${esc(period)} · ${esc(L.generated.replace('{date}', fmt(r.today)))}</div>
  <div class="summary">${summary.map(([l, v]) => `<div><b>${esc(v)}</b>${esc(l)}</div>`).join('')}</div>
  ${tables.map(table).join('')}
  <p class="note">${esc(L.footer)}</p>
  </body></html>`;
}

/** The report as Excel sheets (for lib/xlsx): a summary, then one sheet per table. */
function reportSheets(r, L) {
  const k = r.counts;
  const period = r.from || r.to ? `${fmt(r.from) || '…'} – ${fmt(r.to) || '…'}` : L.periodAll;
  const summary = {
    name: L['sheet.summary'],
    columns: [
      { label: L.title, width: 48 },
      { label: '', width: 40 }
    ],
    rows: [
      [r.org, ''],
      [L.period, period],
      [L.generated.replace('{date}', fmt(r.today)), ''],
      [L.sumDocs, k.docs],
      [L.sumEffective.replace('{n}', '').trim(), k.effective],
      [L.sumOverdue, k.overdue],
      [L.sumDue, k.dueSoon],
      [L.sumChanges, k.openChanges],
      [L.sumDecisions, k.decisions],
      [L.sumTraining, k.trainingMissing],
      [L.sumCopies, k.copiesToWithdraw],
      [L.sumNotices, k.noticesOpen],
      ['', ''],
      [L.footer, '']
    ]
  };
  return [
    summary,
    ...reportTables(r, L).map((t) => ({
      name: L[`sheet.${t.id}`] || t.title,
      columns: t.columns.map((c) => ({ label: c.label, width: c.width })),
      rows: t.rows.map((row) => t.columns.map((c) => (typeof row[c.key] === 'number' && !c.custom ? row[c.key] : c.fmt(row[c.key])))) // counts stay numbers
    }))
  ];
}

module.exports = { reportData, reportTables, reportHtml, reportSheets, fmt };
