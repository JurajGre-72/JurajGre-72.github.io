// App shell: sign-in, routing, sidebar, theme, drag & drop, event delegation.
import { t, setLang, lang } from './i18n.js';
import { html, icon, errorToast, toast } from './ui.js';
import { startImport } from './views/importer.js';
import { lawCheckDialog } from './views/lawcheck.js';
import { authenticate, forcePasswordChange } from './views/login.js';
import { showRecoveryCode } from './views/recovery.js';
import * as dashboard from './views/dashboard.js';
import * as documents from './views/documents.js';
import * as documentView from './views/document.js';
import * as search from './views/search.js';
import * as reviews from './views/reviews.js';
import * as legislation from './views/legislation.js';
import * as change from './views/change.js';
import * as settingsView from './views/settings.js';
import * as compose from './views/compose.js';
import * as trainingView from './views/training.js';
import * as noticesView from './views/notices.js';
import * as auditView from './views/audit.js';
import { inspectionReportDialog } from './views/report.js';

const api = window.api;

export const app = {
  info: null,
  logoUrl: null,
  customLogo: false,
  view: null,
  route: null,
  legisProgress: null,
  async reloadInfo() {
    this.info = await api.app.info();
    setLang(this.info.settings.lang);
    applyTheme(this.info.settings.theme);
    applyRole();
    renderBanner();
    await loadLogo();
    renderOcr(this.info.ocr);
    return this.info;
  },
  /** true if the signed-in user has at least this role */
  can(role) {
    const rank = { reader: 1, editor: 2, admin: 3 };
    const s = this.info && this.info.session;
    return !!s && (rank[s.role] || 0) >= rank[role] && !(this.info.readOnly && role !== 'reader');
  },
  navigate(hash) {
    if (location.hash === `#/${hash}`) render();
    else location.hash = `#/${hash}`;
  },
  rerender: () => render(),
  refreshSidebar: () => renderSidebar(),
  signOut: (reason) => signOut(reason)
};
window.__app = app; // for debugging from DevTools

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

// Buttons carry data-perm="editor" / "admin"; CSS hides what the current user may not use.
function applyRole() {
  const b = document.body;
  const s = app.info && app.info.session;
  b.classList.toggle('role-reader', !!s && s.role === 'reader');
  b.classList.toggle('role-editor', !!s && s.role === 'editor');
  b.classList.toggle('role-admin', !!s && s.role === 'admin');
  b.classList.toggle('read-only', !!(app.info && app.info.readOnly));
}

// Company logo in the sidebar and on the sign-in screen: the PHARMACOPOLA logo that comes with the app,
// or one chosen in Settings → Archive (fetched again only when it changes).
export const DEFAULT_LOGO = 'brand/pharmacopola-logo.svg';
let logoVersion;
async function loadLogo() {
  const v = (app.info.logo && app.info.logo.v) || null;
  if (v === logoVersion) return;
  logoVersion = v;
  app.customLogo = !!v;
  app.logoUrl = (v && (await api.app.logo())) || DEFAULT_LOGO;
  const box = document.getElementById('brand-logo');
  box.querySelector('img').src = app.logoUrl;
  box.hidden = false;
  document.body.classList.add('has-logo');
}

// Text recognition of scanned documents running in the background.
function renderOcr(p) {
  const el = document.getElementById('side-ocr');
  if (!el) return;
  if (!p || p.finished) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.innerHTML = String(html`<span class="spinner sm"></span><div><div>${t('ocr.running')}</div><div class="side-ocr-doc">${p.title}</div><div>${t('ocr.page', { done: p.done, total: p.total })}${p.queue > 1 ? ` · ${t('ocr.queue', { n: p.queue - 1 })}` : ''}</div></div>`);
}

function renderBanner() {
  const el = document.getElementById('banner');
  if (!el || !app.info) return;
  const ro = app.info.readOnly;
  el.innerHTML = ro ? String(html`<div class="ro-banner">${icon('lock')}<span>${t('ro.banner', ro)}</span><button class="btn btn-sm" id="ro-retry">${icon('refresh')}${t('ro.retry')}</button></div>`) : '';
}

const NAV = [
  { name: 'dashboard', icon: 'dashboard' },
  { name: 'documents', icon: 'file' },
  { name: 'search', icon: 'search' },
  { name: 'reviews', icon: 'calendar' },
  { name: 'training', icon: 'users' },
  { name: 'legislation', icon: 'scale' },
  { name: 'notices', icon: 'bell' },
  { name: 'audit', icon: 'history', perm: 'editor' },
  { name: 'settings', icon: 'settings' }
];

function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [pathPart, queryPart] = h.split('?');
  const parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || 'dashboard', parts: parts.slice(1), query: Object.fromEntries(new URLSearchParams(queryPart || '')) };
}

function viewFor(route) {
  switch (route.name) {
    case 'documents':
      return route.parts[0] ? documentView : documents;
    case 'search':
      return search;
    case 'reviews':
      return reviews;
    case 'legislation':
      return route.parts[0] === 'change' ? change : legislation;
    case 'settings':
      return settingsView;
    case 'compose':
      return compose;
    case 'training':
      return trainingView;
    case 'notices':
      return noticesView;
    case 'audit':
      return app.can('editor') ? auditView : dashboard;
    default:
      return dashboard;
  }
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

async function renderSidebar() {
  const nav = document.getElementById('nav');
  if (!nav || !app.info || !app.info.session) return;
  let badgeReviews = 0;
  let badgeLegis = 0;
  let badgeTraining = 0;
  let badgeSign = 0;
  let badgeNotices = 0;
  try {
    const [docs, changes, mine, toSign] = await Promise.all([api.docs.list(), api.changes.list(), api.training.mine().catch(() => ({ docs: [] })), api.approval.mine().catch(() => [])]);
    badgeSign = toSign.length;
    badgeReviews = docs.filter((d) => d.review.state === 'overdue' || d.review.state === 'due').length;
    badgeLegis = changes.filter((c) => c.status !== 'resolved').length;
    badgeTraining = mine.docs.length;
    badgeNotices = (await api.notices.counts().catch(() => ({ toAssess: 0 }))).toAssess;
  } catch (_) {
    /* ignore */
  }
  const active = app.route && app.route.name === 'compose' ? 'documents' : (app.route && app.route.name) || 'dashboard';
  nav.innerHTML = String(html`${NAV.filter((n) => !n.perm || app.can(n.perm)).map((n) => {
    const badge = n.name === 'reviews' ? badgeReviews : n.name === 'legislation' ? badgeLegis : n.name === 'training' ? badgeTraining : n.name === 'dashboard' ? badgeSign : n.name === 'notices' ? badgeNotices : 0;
    return html`<a href="#/${n.name}" class="nav-item ${active === n.name ? 'active' : ''}" ${active === n.name ? html`aria-current="page"` : ''}>
      ${icon(n.icon)}<span>${t(`nav.${n.name}`)}</span>${badge ? html`<span class="badge ${n.name === 'notices' ? 'badge-bad' : n.name === 'reviews' || n.name === 'training' || n.name === 'dashboard' ? 'badge-warn' : 'badge-info'}" ${n.name === 'dashboard' ? html`title="${t('apr.toSign')}"` : n.name === 'notices' ? html`title="${t('nt.toAssess')}"` : ''}>${badge}</span>` : ''}
    </a>`;
  })}`);
  const s = app.info.settings;
  const me = app.info.session;
  document.getElementById('side-foot').innerHTML = String(html`
    <div class="me">
      <span class="avatar sm">${initials(me.name)}</span>
      <div class="me-text"><div class="me-name">${me.name}</div><div class="me-role">${t(`role.${me.role}`)}</div></div>
      <button class="icon-btn side-btn" id="sign-out" title="${t('auth.signOut')}" aria-label="${t('auth.signOut')}">${icon('logout')}</button>
    </div>
    ${app.info.readOnly ? html`<div class="side-flag warn">${icon('lock')}${t('ro.short')}</div>` : ''}
    ${s.offline ? html`<div class="side-flag">${icon('wifiOff')}${t('side.offline')}</div>` : html`<div class="side-flag">${icon('lock')}${t('side.local')}</div>`}
    <div class="side-ver">v${app.info.version}</div>`);
  document.getElementById('side-org').textContent = app.info.archiveSettings.org || t('tagline');
  document.getElementById('brand-name').textContent = t('appName');
}

let renderSeq = 0;
async function render() {
  if (!app.info || !app.info.session) return;
  const seq = ++renderSeq;
  const route = parseRoute();
  app.route = route;
  const view = viewFor(route);
  const main = document.getElementById('main');
  if (app.view && app.view !== view && app.view.unmount) app.view.unmount();
  app.view = view;
  renderSidebar();
  try {
    const content = await view.render(route);
    if (seq !== renderSeq) return; // a newer navigation won
    main.innerHTML = String(content);
    main.scrollTop = 0;
    if (view.mount) await view.mount(main, route);
  } catch (e) {
    console.error(e);
    main.innerHTML = String(html`<div class="page"><div class="empty">${icon('alert')}<p>${String(e.message || e)}</p></div></div>`);
  }
}

// --- Sign-in ----------------------------------------------------------------------
async function requireSignIn() {
  const shellEl = document.querySelector('.shell');
  const authEl = document.getElementById('auth');
  shellEl.hidden = true;
  authEl.hidden = false;
  document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove());
  await authenticate(authEl, app.info);
  // A password set by an administrator is replaced by the user's own before going on.
  const st = await api.auth.state();
  if (st.session && st.session.mustChangePassword && !(await forcePasswordChange(authEl, st.session))) {
    await app.reloadInfo();
    return requireSignIn();
  }
  authEl.hidden = true;
  shellEl.hidden = false;
  await app.reloadInfo();
  idle.reset();
  await render();
  // The recovery code of a newly set up (or newly encrypted) archive is shown to an administrator once.
  if (app.info.session && app.info.session.role === 'admin') {
    const code = await api.auth.pendingRecovery().catch(() => null);
    if (code) {
      await showRecoveryCode(code, { org: app.info.archiveSettings.org });
      await api.auth.recoveryKept();
    }
  }
}

async function signOut(reason) {
  try {
    await api.auth.logout(reason);
  } catch (_) {
    /* already signed out */
  }
  await app.reloadInfo();
  if (reason === 'idle') toast(t('auth.idleOut'), 'info', 6000);
  await requireSignIn();
}

// Sign out automatically after a period without activity.
const idle = {
  last: Date.now(),
  reset() {
    this.last = Date.now();
  },
  check() {
    const mins = app.info && app.info.archiveSettings.autoLockMinutes;
    if (!app.info || !app.info.session || !mins) return;
    if (Date.now() - this.last > mins * 60000) signOut('idle');
  }
};

// --- Event delegation ------------------------------------------------------------
function dispatch(kind, e) {
  const el = e.target.closest(`[data-${kind}]`);
  if (!el) return;
  const name = el.dataset[kind];
  const handlers = (app.view && app.view.actions) || {};
  const shared = {
    import: () => startImport([], { pick: 'files' }),
    importFolder: () => startImport([], { pick: 'folder' }),
    lawCheck: () => lawCheckDialog(),
    inspectionReport: () => inspectionReportDialog()
  };
  const fn = handlers[name] || (kind === 'action' ? shared[name] : null);
  if (!fn) return;
  if (kind === 'action') e.preventDefault();
  Promise.resolve(fn(el, e)).catch(errorToast);
}

function bindGlobalEvents() {
  const main = document.getElementById('main');
  main.addEventListener('click', (e) => dispatch('action', e));
  main.addEventListener('change', (e) => dispatch('change', e));
  main.addEventListener('input', (e) => dispatch('input', e));
  main.addEventListener('submit', (e) => {
    e.preventDefault();
    dispatch('submit', e);
  });
  main.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-enter]')) {
      const fn = app.view.actions && app.view.actions[e.target.dataset.enter];
      if (fn) Promise.resolve(fn(e.target, e)).catch(errorToast);
    }
  });
  window.addEventListener('hashchange', render);
  document.getElementById('side-foot').addEventListener('click', (e) => {
    if (e.target.closest('#sign-out')) signOut('user');
  });
  document.getElementById('banner').addEventListener('click', async (e) => {
    if (!e.target.closest('#ro-retry')) return;
    try {
      const ro = await api.app.retryLock();
      await app.reloadInfo();
      toast(ro ? t('ro.still', ro) : t('ro.gotLock'), ro ? 'info' : 'good');
      render();
    } catch (err) {
      errorToast(err);
    }
  });
  for (const ev of ['mousemove', 'keydown', 'mousedown', 'wheel', 'touchstart']) window.addEventListener(ev, () => idle.reset(), { passive: true });
  setInterval(() => idle.check(), 30000);

  // Drag & drop: documents anywhere; on the Legislation page a dropped file is a legal act to check against.
  let depth = 0;
  const overlay = document.getElementById('drop-overlay');
  const allowed = () => app.info && app.info.session && app.can('editor');
  window.addEventListener('dragenter', (e) => {
    if (!allowed() || !e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
    depth++;
    overlay.innerHTML = String(html`<div class="drop-card">${icon(app.route && app.route.name === 'legislation' ? 'scale' : 'upload')}<p>${t(app.route && app.route.name === 'legislation' ? 'lc.drop' : 'docs.drop')}</p></div>`);
    overlay.classList.add('show');
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) overlay.classList.remove('show');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    overlay.classList.remove('show');
    if (!allowed()) return;
    const paths = Array.from(e.dataTransfer.files || [])
      .map((f) => api.pathForFile(f))
      .filter(Boolean);
    if (!paths.length) return;
    if (app.route && app.route.name === 'legislation') lawCheckDialog({ file: paths[0] }).catch(errorToast);
    else startImport(paths).catch(errorToast);
  });

  api.on('navigate', (route) => {
    if (!app.info || !app.info.session) return;
    app.navigate(route.replace(/\?import=1$/, ''));
    if (/import=1/.test(route) && app.can('editor')) startImport([], { pick: 'files' }).catch(errorToast);
  });
  api.on('data:changed', () => {
    if (!app.info || !app.info.session) return;
    renderSidebar();
    if (app.view && app.view.onDataChanged) app.view.onDataChanged();
  });
  api.on('lock:changed', async () => {
    await app.reloadInfo();
    renderSidebar();
  });
  api.on('ocr:progress', renderOcr);
  api.on('index:ready', () => {
    if (app.info) app.info.indexReady = true;
    if (app.view && app.view.onIndexReady) app.view.onIndexReady();
  });
  api.on('legis:progress', (p) => {
    app.legisProgress = p.finished ? null : p;
    if (app.view && app.view.onLegisProgress) app.view.onLegisProgress(p);
  });
}

async function boot() {
  try {
    await app.reloadInfo();
  } catch (e) {
    document.body.textContent = String(e.message || e);
    return;
  }
  bindGlobalEvents();
  if (!app.info.session) await requireSignIn();
  else await render();
  if (new URLSearchParams(location.hash.split('?')[1] || '').get('import')) startImport([], { pick: 'files' }).catch(errorToast);
}

export { toast, lang };
boot();
