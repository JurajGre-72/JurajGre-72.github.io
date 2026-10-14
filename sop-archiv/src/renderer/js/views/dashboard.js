// Overview: what needs attention today.
import { t } from '../i18n.js';
import { html, raw, icon, reviewChip, fmtDate, fmtDateTime, fmtMonth, todayIso, toast, esc } from '../ui.js';
import { app } from '../app.js';
import { reportButton } from './report.js';
import { recordReview } from './review-dialog.js';
import { authShort, authChip } from './notices.js';

const api = window.api;
let state = { docs: [], laws: [], changes: [] };

function kpi({ label, value, sub, tone, iconName, href }) {
  return html`<a class="kpi ${tone ? 'kpi-' + tone : ''}" href="#/${href}">
    <div class="kpi-label">${iconName ? icon(iconName) : ''}${label}</div>
    <div class="kpi-value">${value}</div>
    ${sub ? html`<div class="kpi-sub">${sub}</div>` : ''}
  </a>`;
}

function monthBuckets(docs) {
  const now = new Date();
  const buckets = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    buckets.push({ y: d.getFullYear(), m: d.getMonth(), docs: [] });
  }
  for (const doc of docs) {
    if (!doc.reviewDate || doc.status === 'obsolete' || doc.review.state === 'overdue') continue;
    const [y, m] = doc.reviewDate.split('-').map(Number);
    const b = buckets.find((x) => x.y === y && x.m === m - 1);
    if (b) b.docs.push(doc);
  }
  return buckets;
}

// Single-series column chart (one hue, 4px rounded caps, hairline grid, hover tooltip).
function workloadChart(buckets) {
  const W = 1000;
  const H = 220;
  const padL = 28;
  const padB = 26;
  const padT = 18;
  const plotW = W - padL - 8;
  const plotH = H - padT - padB;
  const max = Math.max(1, ...buckets.map((b) => b.docs.length));
  const step = max <= 4 ? 1 : max <= 10 ? 2 : Math.ceil(max / 5);
  const top = Math.ceil(max / step) * step;
  const slot = plotW / buckets.length;
  const bw = Math.min(24, slot * 0.56);
  const y = (v) => padT + plotH - (v / top) * plotH;
  const grid = [];
  for (let v = 0; v <= top; v += step) {
    grid.push(`<line x1="${padL}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${padL - 6}" y="${y(v) + 4}" class="axis" text-anchor="end">${v}</text>`);
  }
  const maxIdx = buckets.reduce((bi, b, i) => (b.docs.length > buckets[bi].docs.length ? i : bi), 0);
  const bars = buckets.map((b, i) => {
    const cx = padL + slot * i + slot / 2;
    const v = b.docs.length;
    let bar = '';
    if (v > 0) {
      const x0 = cx - bw / 2;
      const yTop = y(v);
      const h = padT + plotH - yTop;
      const r = Math.min(4, h, bw / 2);
      bar = `<path class="bar" d="M${x0},${padT + plotH} V${yTop + r} Q${x0},${yTop} ${x0 + r},${yTop} H${x0 + bw - r} Q${x0 + bw},${yTop} ${x0 + bw},${yTop + r} V${padT + plotH} Z"/>`;
      if (i === maxIdx) bar += `<text x="${cx}" y="${yTop - 6}" class="val" text-anchor="middle">${v}</text>`;
    }
    const label = `<text x="${cx}" y="${H - 8}" class="axis" text-anchor="middle">${esc(fmtMonth(b.y, b.m))}</text>`;
    const hit = `<rect class="hit" data-bucket="${i}" x="${padL + slot * i}" y="${padT}" width="${slot}" height="${plotH}" />`;
    return bar + label + hit;
  });
  return html`<div class="chart-wrap">
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('dash.workload')}">${raw(grid.join('') + bars.join(''))}</svg>
    <div class="chart-tip" hidden></div>
  </div>`;
}

function attentionList(docs) {
  const list = docs
    .filter((d) => d.review.state === 'overdue' || d.review.state === 'due')
    .sort((a, b) => a.review.daysLeft - b.review.daysLeft)
    .slice(0, 8);
  if (!list.length) return html`<div class="empty-inline">${icon('checkCircle')}${t('dash.attentionEmpty')}</div>`;
  return html`<ul class="rows compact">${list.map(
    (d) => html`<li class="row">
      <a class="row-main" href="#/documents/${d.id}" title="${d.title}">
        <span class="code">${d.code || '—'}</span>
        <span class="row-title">${d.title}</span>
      </a>
      ${reviewChip(d.review)}
      <button class="btn btn-sm" data-action="review" data-perm="editor" data-id="${d.id}" title="${t('doc.markReviewed')} – ${fmtDate(d.reviewDate)}" aria-label="${t('doc.markReviewed')}">${icon('check')}</button>
    </li>`
  )}</ul>`;
}

function legisPanel(laws, changes) {
  const open = changes.filter((c) => c.status !== 'resolved');
  const lastCheck = laws.map((l) => l.state && l.state.lastCheck).filter(Boolean).sort().pop();
  return html`
    <p class="muted small">${lastCheck ? t('dash.legisLast', { when: fmtDateTime(lastCheck) }) : t('dash.legisNever')}</p>
    ${open.length
      ? html`<ul class="rows">${open.slice(0, 6).map(
          (c) => html`<li class="row">
            <a class="row-main" href="#/legislation/change/${c.id}">
              <span class="chip chip-${c.kind === 'upcoming' ? 'warn' : c.kind === 'repealed' ? 'bad' : 'info'}">${t(`leg.kind.${c.kind}`)}</span>
              <span class="row-title">${c.law ? c.law.short || c.law.title : ''}</span>
            </a>
            ${c.toDate ? html`<span class="row-date">${t('leg.effectiveFrom', { date: fmtDate(c.toDate) })}</span>` : ''}
            <span class="muted small">${t('leg.affected', { n: (c.affected || []).length })}</span>
          </li>`
        )}</ul>`
      : html`<div class="empty-inline">${icon('checkCircle')}${t('dash.legisNone')}</div>`}
    <div class="panel-actions"><a class="btn btn-sm" href="#/legislation" data-perm="editor">${icon('refresh')}${t('leg.checkNow')}</a></div>`;
}

function suggestions(docs, laws) {
  const keys = new Set(laws.map((l) => l.key));
  const agg = new Map();
  for (const d of docs) {
    if (d.status === 'obsolete') continue;
    for (const r of d.lawRefs || []) {
      if (keys.has(r.key)) continue;
      const e = agg.get(r.key) || { ...r, docs: 0 };
      e.docs++;
      agg.set(r.key, e);
    }
  }
  const list = Array.from(agg.values()).sort((a, b) => b.docs - a.docs).slice(0, 5);
  if (!list.length) return '';
  return html`<section class="panel">
    <h3>${icon('info')}${t('dash.suggest')}</h3>
    <ul class="rows">${list.map(
      (r) => html`<li class="row">
        <span class="chip chip-muted">${t(`kind.${r.jurisdiction}`)}</span>
        <span class="row-title">${r.label}</span>
        <span class="muted small">${t('docs.count', { n: r.docs })}</span>
        <button class="btn btn-sm" data-action="addSuggested" data-perm="editor" data-key="${r.key}" data-label="${r.label}" data-url="${r.url}" data-j="${r.jurisdiction}">${icon('plus')}${t('dash.suggestAdd')}</button>
      </li>`
    )}</ul>
  </section>`;
}

function emptyState() {
  return html`<section class="hero-empty">
    <div class="hero-drop">
      ${icon('upload', 'big')}
      <h2>${t('dash.empty.title')}</h2>
      <p>${t('dash.empty.text')}</p>
      <div class="btn-row">
        <button class="btn btn-primary" data-action="import" data-perm="editor">${icon('upload')}${t('dash.empty.files')}</button>
        <button class="btn" data-action="importFolder" data-perm="editor">${icon('folder')}${t('dash.empty.folder')}</button>
      </div>
    </div>
    <ol class="steps">
      <li><span>1</span>${t('dash.step1')}</li>
      <li><span>2</span>${t('dash.step2')}</li>
      <li><span>3</span>${t('dash.step3')}</li>
    </ol>
  </section>`;
}

export async function render() {
  const [docs, laws, changes, trainingOv, toSign, toWithdraw, notices] = await Promise.all([api.docs.list(), api.laws.list(), api.changes.list(), api.training.overview().catch(() => ({ missing: 0 })), api.approval.mine().catch(() => []), api.copies.toWithdraw().catch(() => []), api.notices.list().catch(() => ({ items: [] }))]);
  // Recalls (and watched names) from ŠÚKL / ÚŠKVBL that concern the company and wait for an assessment.
  const noticesToAssess = notices.items.filter((n) => !n.handled && n.rel.forUs && (n.category === 'recall' || n.rel.watch.length));
  state = { docs, laws, changes };
  const trainingMissing = trainingOv.missing;
  const warn = app.info.archiveSettings.warnDays;
  const active = docs.filter((d) => d.status !== 'obsolete');
  const overdue = docs.filter((d) => d.review.state === 'overdue').length;
  const due = docs.filter((d) => d.review.state === 'due').length;
  const openChanges = changes.filter((c) => c.status !== 'resolved').length;
  const recent = docs
    .slice()
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0, 6);

  return html`<div class="page">
    <header class="page-head">
      <div><h1>${t('dash.title')}</h1><p class="muted">${app.info.archiveSettings.org || t('tagline')} · ${fmtDate(todayIso(), { long: true })}</p></div>
      <div class="head-actions">${reportButton()}<a class="btn" href="#/compose" data-perm="editor">${icon('plus')}${t('nd.title')}</a><button class="btn btn-primary" data-action="import" data-perm="editor">${icon('upload')}${t('docs.importFiles')}</button></div>
    </header>
    ${toSign.length
      ? html`<section class="panel panel-warn"><h3>${icon('shield')}${t('apr.toSign')} <span class="count">${toSign.length}</span></h3>
          <ul class="rows">${toSign.map((d) => html`<li class="row"><a class="row-main" href="#/documents/${d.id}"><span class="code">${d.code || '—'}</span><span class="row-title">${d.title}</span></a><span class="muted small">v${d.version} · ${t(`apr.role.${d.role}`)} · ${d.requestedBy}</span></li>`)}</ul></section>`
      : ''}
    ${noticesToAssess.length
      ? html`<section class="panel panel-warn"><h3>${icon('bell')}${t('dash.notices')} <span class="count">${noticesToAssess.length}</span></h3>
          <ul class="rows">${noticesToAssess.slice(0, 5).map((n) => html`<li class="row"><a class="row-main" href="#/notices"><span class="chip chip-${authChip(n.authority)}">${authShort(n.authority)}</span><span class="row-title">${n.title}</span></a>${n.rel.watch.length ? html`<span class="chip chip-bad">${n.rel.watch.join(', ')}</span>` : ''}<span class="row-date">${fmtDate(n.date)}</span></li>`)}</ul>
          ${noticesToAssess.length > 5 ? html`<a class="small" href="#/notices">${t('dash.noticesAll')} →</a>` : ''}</section>`
      : ''}
    ${toWithdraw.length ? html`<div class="note note-warn">${icon('alert')}<div>${t('cp.toWithdrawAll', { n: toWithdraw.length, list: Array.from(new Set(toWithdraw.map((c) => c.code || c.title))).join(', ') })}</div></div>` : ''}
    ${!docs.length
      ? emptyState()
      : html`
      <section class="kpis">
        ${kpi({ label: t('dash.kpiDocs'), value: docs.filter((d) => d.status === 'effective').length, sub: t('dash.kpiDocsSub', { n: docs.length }), href: 'documents', iconName: 'file' })}
        ${kpi({ label: t('dash.kpiOverdue'), value: overdue, tone: overdue ? 'bad' : '', iconName: 'alert', href: 'reviews' })}
        ${kpi({ label: t('dash.kpiDue', { days: warn }), value: due, tone: due ? 'warn' : '', iconName: 'clock', href: 'reviews' })}
        ${kpi({ label: t('dash.kpiLegis'), value: openChanges, tone: openChanges ? 'info' : '', iconName: 'scale', href: 'legislation' })}
        ${trainingMissing ? kpi({ label: t('dash.kpiTraining'), value: trainingMissing, tone: 'warn', iconName: 'users', href: 'training' }) : ''}
      </section>
      <div class="grid-2">
        <section class="panel"><h3>${icon('bell')}${t('dash.attention')}</h3>${attentionList(docs)}</section>
        <section class="panel"><h3>${icon('scale')}${t('dash.legis')}</h3>${legisPanel(laws, changes)}</section>
      </div>
      <section class="panel">
        <h3>${icon('calendar')}${t('dash.workload')}</h3>
        <p class="muted small">${t('dash.workloadSub')}</p>
        ${workloadChart(monthBuckets(active))}
      </section>
      ${suggestions(docs, laws)}
      <section class="panel">
        <h3>${icon('history')}${t('dash.recent')}</h3>
        <ul class="rows">${recent.map(
          (d) => html`<li class="row"><a class="row-main" href="#/documents/${d.id}"><span class="code">${d.code || '—'}</span><span class="row-title">${d.title}</span></a><span class="muted small">v${d.version}${d.updatedBy ? ` · ${d.updatedBy}` : ''}</span><span class="row-date">${fmtDateTime(d.updatedAt)}</span></li>`
        )}</ul>
      </section>`}
  </div>`;
}

export function mount(root) {
  const wrap = root.querySelector('.chart-wrap');
  if (!wrap) return;
  const tip = wrap.querySelector('.chart-tip');
  const buckets = monthBuckets(state.docs.filter((d) => d.status !== 'obsolete'));
  const svg = wrap.querySelector('svg');
  svg.addEventListener('mousemove', (e) => {
    const r = e.target.closest('.hit');
    if (!r) {
      tip.hidden = true;
      return;
    }
    const b = buckets[Number(r.dataset.bucket)];
    svg.querySelectorAll('.hit').forEach((h) => h.classList.toggle('on', h === r));
    const codes = b.docs.slice(0, 6).map((d) => d.code || d.title);
    tip.innerHTML = String(html`<strong>${fmtMonth(b.y, b.m)} ${b.y}</strong><span>${t('docs.count', { n: b.docs.length })}</span>${codes.length ? html`<span class="muted">${codes.join(', ')}${b.docs.length > 6 ? ' …' : ''}</span>` : ''}`);
    tip.hidden = false;
    const box = wrap.getBoundingClientRect();
    const x = Math.min(e.clientX - box.left + 12, box.width - 180);
    tip.style.left = `${x}px`;
    tip.style.top = `${e.clientY - box.top - 10}px`;
  });
  svg.addEventListener('mouseleave', () => {
    tip.hidden = true;
    svg.querySelectorAll('.hit').forEach((h) => h.classList.remove('on'));
  });
  svg.addEventListener('click', (e) => {
    if (e.target.closest('.hit')) app.navigate('reviews');
  });
}

export const actions = {
  async review(el) {
    const doc = state.docs.find((d) => d.id === el.dataset.id);
    if (await recordReview(doc)) app.rerender();
  },
  async addSuggested(el) {
    await api.laws.add({ key: el.dataset.key, title: el.dataset.label, short: el.dataset.label, url: el.dataset.url, jurisdiction: el.dataset.j });
    toast(t('saved'), 'good');
    app.rerender();
  }
};

export function onDataChanged() {
  app.rerender();
}
