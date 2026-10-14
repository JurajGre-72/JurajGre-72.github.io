// Small UI toolkit: safe HTML templating, icons, modals, toasts and formatting helpers.
import { t, lang, days } from './i18n.js';

// --- Safe HTML ---------------------------------------------------------------
class Safe {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

export const raw = (s) => new Safe(String(s));

export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function val(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(val).join('');
  return esc(v);
}

/** Tagged template: interpolations are escaped unless wrapped in raw()/html``. */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += val(vals[i]) + strings[i + 1];
  return new Safe(out);
}

// --- Icons (24×24 stroke icons, Lucide-style) --------------------------------
const P = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="m9 15 2 2 4-4"/>',
  scale: '<path d="M12 3v18M7 21h10"/><path d="M5 7h14"/><path d="m5 7-3 7a3.5 3.5 0 0 0 6 0z"/><path d="m19 7-3 7a3.5 3.5 0 0 0 6 0z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  external: '<path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  wifiOff: '<path d="M2 2l20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 12.9a10 10 0 0 1 5.2-2.8"/><path d="M19 12.9a10 10 0 0 0-2.1-1.6"/><path d="M12 20h.01"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  flag: '<path d="M4 22V4"/><path d="M4 4h12l-2 4 2 4H4"/>',
  message: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3"/><path d="m16 6 3 3"/><path d="m14 8 2 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>'
};

export function icon(name, cls = '') {
  return raw(`<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`);
}

// --- Formatting -----------------------------------------------------------------
export function fmtDate(iso, opts = {}) {
  if (!iso) return '';
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso);
  if (isNaN(d)) return iso;
  const loc = lang() === 'sk' ? 'sk-SK' : 'en-GB';
  return d.toLocaleDateString(loc, { day: 'numeric', month: opts.long ? 'long' : lang() === 'sk' ? 'numeric' : 'short', year: 'numeric' });
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const loc = lang() === 'sk' ? 'sk-SK' : 'en-GB';
  return `${d.toLocaleDateString(loc, { day: 'numeric', month: lang() === 'sk' ? 'numeric' : 'short', year: 'numeric' })} ${d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })}`;
}

export function fmtMonth(y, m) {
  const loc = lang() === 'sk' ? 'sk-SK' : 'en-GB';
  return new Date(y, m, 1).toLocaleDateString(loc, { month: 'short' }).replace('.', '');
}

/** "2026-10" -> "október 2026" / "October 2026" */
export function fmtMonthYear(ym) {
  const [y, m] = ym.split('-').map(Number);
  const loc = lang() === 'sk' ? 'sk-SK' : 'en-GB';
  const s = new Date(y, m - 1, 1).toLocaleDateString(loc, { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addMonthsIso(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + Number(n);
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(ny, nm, 0).getDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function relDays(daysLeft) {
  if (daysLeft === 0) return t('rev.today');
  if (daysLeft > 0) return t('rev.daysLeft', { d: days(daysLeft) });
  return t('rev.daysOver', { d: days(daysLeft) });
}

// --- Chips -------------------------------------------------------------------------
const STATUS_TONE = { draft: 'info', effective: 'good', review: 'warn', obsolete: 'muted' };
/** A valid document whose review is overdue stays valid (a review date is not an expiry), but is not shown as "all fine". */
export function statusChip(status, review) {
  if (status === 'effective' && review && review.state === 'overdue') return html`<span class="chip chip-warn">${t('status.effectiveOverdue')}</span>`;
  return html`<span class="chip chip-${STATUS_TONE[status] || 'muted'}">${t(`status.${status}`)}</span>`;
}

const REVIEW_TONE = { overdue: 'bad', due: 'warn', ok: 'good', none: 'muted' };
const REVIEW_ICON = { overdue: 'alert', due: 'clock', ok: 'checkCircle', none: 'info' };
export function reviewChip(review, withText = true) {
  if (!review) return '';
  const label = review.state === 'none' ? t('review.none') : relDays(review.daysLeft);
  return html`<span class="chip chip-${REVIEW_TONE[review.state]}" title="${t(`review.${review.state}`)}">${icon(REVIEW_ICON[review.state])}${withText ? label : ''}</span>`;
}

export function typeLabel(types, id) {
  const tp = (types || []).find((x) => x.id === id);
  if (!tp) return id || '';
  return lang() === 'sk' ? tp.sk : tp.en;
}

// --- Toasts -------------------------------------------------------------------------
export function toast(message, tone = 'info', ms = 4200) {
  let host = document.getElementById('toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    host.setAttribute('role', 'status');
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${tone}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, ms);
  return el;
}

export function errorToast(e) {
  const msg = String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  toast(msg, 'bad', 7000);
}

// --- Modals --------------------------------------------------------------------------
/**
 * openModal({ title, body: html, size: 'sm'|'md'|'lg'|'xl', buttons: [{ label, kind, value }], onMount(el, close) })
 * Resolves with the clicked button's value (or null when dismissed).
 */
export function openModal({ title, body, size = 'md', buttons = [], onMount, dismissable = true }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = String(html`
      <div class="modal modal-${size}" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="modal-head">
          <h2>${title}</h2>
          ${dismissable ? html`<button class="icon-btn" data-modal-close aria-label="${t('close')}">${icon('x')}</button>` : ''}
        </div>
        <div class="modal-body">${body}</div>
        ${buttons.length ? html`<div class="modal-foot">${buttons.map((b, i) => html`<button class="btn ${b.kind ? 'btn-' + b.kind : ''}" data-modal-btn="${i}">${b.label}</button>`)}</div>` : ''}
      </div>`);
    document.body.appendChild(wrap);
    const close = (v = null) => {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && dismissable) close(null);
    };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', async (e) => {
      if (e.target === wrap && dismissable) return close(null);
      if (e.target.closest('[data-modal-close]')) return close(null);
      const b = e.target.closest('[data-modal-btn]');
      if (b) {
        const def = buttons[Number(b.dataset.modalBtn)];
        if (def.onClick) {
          const r = await def.onClick(wrap.querySelector('.modal'), close);
          if (r === false) return;
        }
        close(def.value !== undefined ? def.value : def.label);
      }
    });
    if (onMount) onMount(wrap.querySelector('.modal'), close);
    // Focus at once: a delayed focus could jump into the first field while the user is already typing in another.
    const first = wrap.querySelector('input, select, textarea');
    if (first && !wrap.contains(document.activeElement)) first.focus();
  });
}

export async function confirmDialog(message, { okLabel, danger = false } = {}) {
  const r = await openModal({
    title: t('confirm'),
    size: 'sm',
    body: html`<p>${message}</p>`,
    buttons: [
      { label: t('cancel'), value: false },
      { label: okLabel || t('confirm'), kind: danger ? 'danger' : 'primary', value: true }
    ]
  });
  return r === true;
}

/** Read all [name] fields of a form-like element into an object. */
export function formValues(root) {
  const out = {};
  root.querySelectorAll('[name]').forEach((el) => {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') {
      if (el.checked) out[el.name] = el.value;
    } else out[el.name] = el.value;
  });
  return out;
}

export function debounce(fn, ms = 200) {
  let h;
  return (...a) => {
    clearTimeout(h);
    h = setTimeout(() => fn(...a), ms);
  };
}

/** Render text segments [{text, hit}] as highlighted HTML. */
export function snippetHtml(segs) {
  return (segs || []).map((s) => (s.hit ? html`<mark>${s.text}</mark>` : html`${s.text}`));
}

// --- Word-level comparison of two texts (old -> new) ---------------------------------------------------
/** [{ t: 'same' | 'add' | 'del', s }] – longest common subsequence of words (and spaces). */
export function wordDiff(a, b) {
  const A = String(a || '').split(/(\s+)/).filter((x) => x !== '');
  const B = String(b || '').split(/(\s+)/).filter((x) => x !== '');
  if (A.length * B.length > 4e6) return [{ t: 'del', s: a }, { t: 'add', s: b }];
  const n = A.length;
  const m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  const push = (t, s) => {
    const last = out[out.length - 1];
    if (last && last.t === t) last.s += s;
    else out.push({ t, s });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      push('same', A[i]);
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) push('del', A[i++]);
    else push('add', B[j++]);
  }
  while (i < n) push('del', A[i++]);
  while (j < m) push('add', B[j++]);
  return out;
}

export function diffView(a, b) {
  return html`<div class="word-diff">${wordDiff(a, b).map((p) => (p.t === 'add' ? html`<ins>${p.s}</ins>` : p.t === 'del' ? html`<del>${p.s}</del>` : html`<span>${p.s}</span>`))}</div>`;
}
