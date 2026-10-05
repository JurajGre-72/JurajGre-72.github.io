// App shell: routing, sidebar, theme, drag & drop, event delegation.
import { t, setLang, lang } from './i18n.js';
import { html, icon, errorToast, toast } from './ui.js';
import { startImport } from './views/importer.js';
import * as dashboard from './views/dashboard.js';
import * as documents from './views/documents.js';
import * as documentView from './views/document.js';
import * as search from './views/search.js';
import * as reviews from './views/reviews.js';
import * as legislation from './views/legislation.js';
import * as change from './views/change.js';
import * as settingsView from './views/settings.js';
import { maybeOnboard } from './views/onboarding.js';

const api = window.api;

export const app = {
  info: null,
  view: null,
  route: null,
  legisProgress: null,
  async reloadInfo() {
    this.info = await api.app.info();
    setLang(this.info.settings.lang);
    applyTheme(this.info.settings.theme);
    return this.info;
  },
  navigate(hash) {
    if (location.hash === `#/${hash}`) render();
    else location.hash = `#/${hash}`;
  },
  rerender: () => render(),
  refreshSidebar: () => renderSidebar()
};
window.__app = app; // for debugging from DevTools

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

const NAV = [
  { name: 'dashboard', icon: 'dashboard' },
  { name: 'documents', icon: 'file' },
  { name: 'search', icon: 'search' },
  { name: 'reviews', icon: 'calendar' },
  { name: 'legislation', icon: 'scale' },
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
    default:
      return dashboard;
  }
}

async function renderSidebar() {
  const nav = document.getElementById('nav');
  if (!nav || !app.info) return;
  let badgeReviews = 0;
  let badgeLegis = 0;
  try {
    const [docs, changes] = await Promise.all([api.docs.list(), api.changes.list()]);
    badgeReviews = docs.filter((d) => d.review.state === 'overdue' || d.review.state === 'due').length;
    badgeLegis = changes.filter((c) => c.status !== 'resolved').length;
  } catch (_) {
    /* ignore */
  }
  const active = (app.route && app.route.name) || 'dashboard';
  nav.innerHTML = String(html`${NAV.map((n) => {
    const badge = n.name === 'reviews' ? badgeReviews : n.name === 'legislation' ? badgeLegis : 0;
    return html`<a href="#/${n.name}" class="nav-item ${active === n.name ? 'active' : ''}" ${active === n.name ? html`aria-current="page"` : ''}>
      ${icon(n.icon)}<span>${t(`nav.${n.name}`)}</span>${badge ? html`<span class="badge ${n.name === 'reviews' ? 'badge-warn' : 'badge-info'}">${badge}</span>` : ''}
    </a>`;
  })}`);
  const s = app.info.settings;
  document.getElementById('side-foot').innerHTML = String(html`
    ${s.offline ? html`<div class="side-flag">${icon('wifiOff')}${t('side.offline')}</div>` : html`<div class="side-flag">${icon('lock')}${t('side.local')}</div>`}
    <div class="side-ver">v${app.info.version}</div>`);
  document.getElementById('side-org').textContent = app.info.archiveSettings.org || t('tagline');
  document.getElementById('brand-name').textContent = t('appName');
}

let renderSeq = 0;
async function render() {
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
    main.scrollTop = route.query.keepScroll ? main.scrollTop : 0;
    if (view.mount) await view.mount(main, route);
  } catch (e) {
    console.error(e);
    main.innerHTML = String(html`<div class="page"><div class="empty">${icon('alert')}<p>${String(e.message || e)}</p></div></div>`);
  }
}

// --- Event delegation ------------------------------------------------------------
function dispatch(kind, e) {
  const el = e.target.closest(`[data-${kind}]`);
  if (!el) return;
  const name = el.dataset[kind];
  const handlers = (app.view && app.view.actions) || {};
  const shared = { import: () => startImport([], { pick: 'files' }), importFolder: () => startImport([], { pick: 'folder' }) };
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

  // Drag & drop files anywhere to import them.
  let depth = 0;
  const overlay = document.getElementById('drop-overlay');
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
    depth++;
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
    const paths = Array.from(e.dataTransfer.files || [])
      .map((f) => api.pathForFile(f))
      .filter(Boolean);
    if (paths.length) startImport(paths).catch(errorToast);
  });

  api.on('navigate', (route) => app.navigate(route));
  api.on('data:changed', () => {
    renderSidebar();
    if (app.view && app.view.onDataChanged) app.view.onDataChanged();
  });
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
  document.getElementById('drop-overlay').innerHTML = String(html`<div class="drop-card">${icon('upload')}<p>${t('docs.drop')}</p></div>`);
  bindGlobalEvents();
  await render();
  await maybeOnboard();
  if (new URLSearchParams(location.hash.split('?')[1] || '').get('import')) startImport([], { pick: 'files' }).catch(errorToast);
}

export { toast, lang };
boot();
