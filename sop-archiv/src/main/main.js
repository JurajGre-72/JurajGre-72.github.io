'use strict';
// SOP Archív – Electron main process.
// Runs entirely on this computer. Company documents never leave it: the only network traffic is
// (a) the legislation check, which downloads public pages of legal acts listed in the register, and
// (b) an optional AI assistant, which is allowed only on this computer or the internal network.
// Every such request is listed in Settings → Privacy → Network activity.

const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, session: electronSession, Notification, Tray, Menu, nativeImage, safeStorage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const { Archive } = require('./archive');
const { LegislationMonitor, createElectronFetcher } = require('./legislation');
const { createOcr } = require('./ocr');
const ai = require('./ai');
const { summarize, buildIcs, buildCsv } = require('./lib/reviews');
const { SUPPORTED, extractFile } = require('./lib/extract');
const { today } = require('./lib/dates');
const { hasRole, ROLES } = require('./lib/auth');
const { ArchiveLock } = require('./lib/lock');
const { lawTextFromPages, detectLawIdentity, resolveLawQuery, urlForKey } = require('./lib/lawfile');
const { sectionMap } = require('./lib/compliance');
const { aliasesFromKey } = require('./lib/metadata');
const { DEFAULT_LAWS } = require('./lib/defaults');
const mainText = require('./i18n-main');

const APP_ID = 'sk.soparchiv.app';
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const ICON = path.join(__dirname, '..', '..', 'build', 'icon.png');
const LAW_FILE_TYPES = ['pdf', 'docx', 'doc', 'odt', 'rtf', 'html', 'htm', 'txt', 'xml'];

if (process.env.SOP_ARCHIV_USERDATA) app.setPath('userData', process.env.SOP_ARCHIV_USERDATA);
const startHidden = process.argv.includes('--hidden');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }]);

// ---------------------------------------------------------------------------
// Computer settings (outside the archive folder)

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
let settings = null;

function loadSettings() {
  let s = {};
  try {
    s = JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8'));
  } catch (_) {
    /* first run */
  }
  const locale = (app.getLocale() || 'en').toLowerCase();
  const ai0 = { provider: 'none', baseUrl: '', model: '', budget: 0, apiKeyEnc: '', ...(s.ai || {}) };
  if (!['none', 'ollama', 'openai'].includes(ai0.provider)) ai0.provider = 'none'; // cloud providers were removed
  settings = {
    dataDir: process.env.SOP_ARCHIV_DATA || s.dataDir || path.join(app.getPath('documents'), 'SOP-Archiv'),
    lang: s.lang || (locale.startsWith('sk') || locale.startsWith('cs') ? 'sk' : 'en'),
    theme: s.theme || 'system',
    offline: !!s.offline,
    notifications: s.notifications !== false,
    launchAtLogin: !!s.launchAtLogin,
    runInBackground: !!s.runInBackground,
    ai: ai0,
    lastNotify: s.lastNotify || null,
    lastUserId: s.lastUserId || null,
    bounds: s.bounds || null
  };
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 1));
  } catch (e) {
    console.error('settings save failed', e);
  }
}

function apiKey() {
  const enc = settings.ai.apiKeyEnc;
  if (!enc) return '';
  try {
    if (enc.startsWith('plain:')) return Buffer.from(enc.slice(6), 'base64').toString('utf8');
    return safeStorage.decryptString(Buffer.from(enc, 'base64'));
  } catch (_) {
    return '';
  }
}

function setApiKey(key) {
  if (!key) {
    settings.ai.apiKeyEnc = '';
    return;
  }
  settings.ai.apiKeyEnc = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key).toString('base64') : 'plain:' + Buffer.from(key, 'utf8').toString('base64');
}

function aiConfig() {
  return { ...settings.ai, apiKey: apiKey() };
}

function publicSettings() {
  const { apiKeyEnc, ...aiRest } = settings.ai;
  return { ...settings, lang: lang(), theme: theme(), ai: { ...aiRest, hasApiKey: !!apiKeyEnc, keyEncrypted: !!apiKeyEnc && !apiKeyEnc.startsWith('plain:') } };
}

function osUser() {
  try {
    return os.userInfo().username;
  } catch (_) {
    return 'user';
  }
}

// ---------------------------------------------------------------------------
// Signed-in user

let session = null; // { userId, name, role, prefs }
const failedLogins = new Map(); // userId -> { count, until }

function lang() {
  return (session && session.prefs && session.prefs.lang) || settings.lang;
}
function theme() {
  return (session && session.prefs && session.prefs.theme) || settings.theme;
}
const tr = (key, vars) => mainText(lang(), key, vars);

function sessionPublic() {
  return session ? { userId: session.userId, name: session.name, role: session.role } : null;
}

function setSession(u) {
  session = u ? { userId: u.id, name: u.name, role: u.role, prefs: { ...(u.prefs || {}) } } : null;
  if (archive) {
    archive.user = session ? session.name : osUser();
    archive.userId = session ? session.userId : null;
  }
  if (lock) lock.setUser(session ? session.name : osUser());
  buildMenu();
  refreshTrayMenu();
}

// ---------------------------------------------------------------------------
// Network activity log (shown to the user)

const netLog = [];
function logNet(entry) {
  const e = { ts: new Date().toISOString(), ...entry };
  netLog.push(e);
  if (netLog.length > 500) netLog.shift();
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'network.log'), JSON.stringify(e) + '\n');
  } catch (_) {
    /* ignore */
  }
}

function readNetLog() {
  try {
    const lines = fs.readFileSync(path.join(app.getPath('userData'), 'network.log'), 'utf8').split('\n').filter(Boolean);
    return lines
      .slice(-300)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  } catch (_) {
    return netLog.slice().reverse();
  }
}

// ---------------------------------------------------------------------------
// Archive + lock (one computer at a time can change a shared archive)

let archive = null;
let monitor = null;
let lock = null;
let lockHolder = null;
let lockTimer = null;
let reloadTimer = null;
let lastArchiveMtime = 0;
let mainWindow = null;
let tray = null;
let quitting = false;

function archiveMtime() {
  try {
    return fs.statSync(path.join(archive.dir, 'archive.json')).mtimeMs;
  } catch (_) {
    return 0;
  }
}

function readOnlyInfo() {
  return archive && archive.readOnly ? { user: (lockHolder && lockHolder.user) || '?', host: (lockHolder && lockHolder.host) || '?', since: lockHolder && lockHolder.since } : null;
}

function startLockTimers() {
  clearInterval(lockTimer);
  clearInterval(reloadTimer);
  lockTimer = setInterval(() => {
    if (!lock || !archive) return;
    if (lock.owned) {
      if (!lock.heartbeat()) {
        // Another computer took over (we were asleep or offline too long): stop writing.
        archive.readOnly = true;
        lockHolder = (lock.read() && { host: lock.read().host, user: lock.read().user, since: lock.read().since }) || null;
        send('lock:changed', readOnlyInfo());
      }
    }
  }, 30000);
  // In read-only mode, pick up changes saved by the other computer.
  reloadTimer = setInterval(async () => {
    if (!archive || !archive.readOnly) return;
    const m = archiveMtime();
    if (m && m !== lastArchiveMtime) {
      lastArchiveMtime = m;
      try {
        await archive.reload();
        send('data:changed', { what: 'reload' });
      } catch (_) {
        /* file being written: try next time */
      }
    }
  }, 20000);
}

async function openArchive(dir) {
  if (lock) lock.release();
  const a = new Archive({ dataDir: dir, user: osUser(), lang: settings.lang });
  const l = new ArchiveLock(dir, { host: os.hostname(), user: osUser() });
  fs.mkdirSync(dir, { recursive: true });
  const got = l.tryAcquire();
  a.readOnly = !got.ok;
  lockHolder = got.ok ? null : got.holder;
  if (a.readOnly && !fs.existsSync(path.join(dir, 'archive.json'))) {
    // Nothing to read yet: should not happen, but never create an archive without the lock.
    throw new Error(tr('err.readOnly', { user: lockHolder.user, host: lockHolder.host }));
  }
  await a.open();
  if (!a.readOnly) await a.watchCitedLaws().catch((e) => console.error('watch cited laws', e)); // acts cited in documents are watched
  archive = a;
  lock = l;
  lastArchiveMtime = archiveMtime();
  monitor = new LegislationMonitor(archive, { fetchPage: createElectronFetcher({ log: logNet }), isOffline: () => settings.offline });
  archive
    .buildIndex()
    .then(() => {
      send('index:ready', { docs: archive.data.docs.length });
      queueOcr(); // scans left unread when the app was last closed
    })
    .catch((e) => console.error('index build failed', e));
  startLockTimers();
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

// ---------------------------------------------------------------------------
// OCR of scanned documents: one at a time, in the background, on this computer only.
let ocr = null;
let ocrRunning = false;
let ocrState = null;

function queueOcr() {
  setImmediate(() => runOcrQueue().catch((e) => console.error('ocr queue', e)));
}

async function runOcrQueue() {
  if (ocrRunning || !archive || archive.readOnly) return;
  ocrRunning = true;
  const failed = new Set();
  try {
    for (;;) {
      const a = archive;
      const job = a.pendingOcr().find((j) => !failed.has(j.versionId));
      if (!job || a.readOnly) break;
      if (!ocr) ocr = createOcr({ dataDir: path.join(app.getPath('userData'), 'ocr'), log: (m) => console.log('ocr:', m) });
      ocrState = { title: job.title, done: 0, total: job.pages.length, queue: a.pendingOcr().length };
      send('ocr:progress', ocrState);
      try {
        const pages = await ocr.readPdf(a.versionFile(job.docId, job.versionId), job.pages, (p) => {
          ocrState = { ...ocrState, done: p.done };
          send('ocr:progress', ocrState);
        });
        if (a !== archive || a.readOnly) break; // the archive was switched or became read-only meanwhile
        await a.applyOcr(job.docId, job.versionId, pages);
      } catch (e) {
        console.error('ocr failed', e);
        failed.add(job.versionId);
        await a.ocrFailed(job.docId, job.versionId, e.message || e).catch(() => {});
      }
      send('data:changed', { what: 'ocr', docId: job.docId });
    }
  } finally {
    ocrRunning = false;
    ocrState = null;
    send('ocr:progress', { finished: true });
    if (ocr) await ocr.close().catch(() => {});
    ocr = null;
  }
}

// ---------------------------------------------------------------------------
// Window

function createWindow() {
  const b = settings.bounds || {};
  mainWindow = new BrowserWindow({
    width: b.width || 1360,
    height: b.height || 880,
    x: b.x,
    y: b.y,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'SOP Archív',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    backgroundColor: '#f4f6f6',
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, webSecurity: true }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.once('ready-to-show', () => {
    if (!startHidden || !settings.runInBackground) mainWindow.show();
  });
  mainWindow.on('close', (e) => {
    settings.bounds = mainWindow.getBounds();
    saveSettings();
    if (!quitting && settings.runInBackground) {
      e.preventDefault();
      mainWindow.hide();
      ensureTray();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.loadURL('app://sop/index.html');
}

function showWindow(route) {
  if (!mainWindow) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (route) send('navigate', route);
}

function ensureTray() {
  if (tray || !settings.runInBackground) return;
  const img = fs.existsSync(ICON) ? nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }) : nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip('SOP Archív');
  tray.on('click', () => showWindow());
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: tr('tray.open'), click: () => showWindow() },
      { label: tr('tray.reviews'), click: () => showWindow('reviews') },
      { type: 'separator' },
      {
        label: tr('tray.quit'),
        click: () => {
          quitting = true;
          app.quit();
        }
      }
    ])
  );
}

function buildMenu() {
  if (!app.isReady()) return;
  const isMac = process.platform === 'darwin';
  const quit = () => {
    quitting = true;
    app.quit();
  };
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: tr('menu.file'),
      submenu: [
        { label: tr('menu.import'), accelerator: 'CmdOrCtrl+O', click: () => showWindow('documents?import=1') },
        { label: tr('menu.openFolder'), click: () => archive && session && shell.openPath(archive.dir) },
        { type: 'separator' },
        isMac ? { role: 'close' } : { label: tr('tray.quit'), click: quit }
      ]
    },
    { role: 'editMenu', label: tr('menu.edit') },
    {
      label: tr('menu.view'),
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Reminders and automatic legislation check

function openChangesCount() {
  return archive ? archive.data.changes.filter((c) => c.status !== 'resolved').length : 0;
}

function reviewReminder(force = false) {
  if (!archive || !settings.notifications || !Notification.isSupported()) return null;
  const s = summarize(archive.data.docs, archive.data.settings.warnDays);
  const legis = openChangesCount();
  const sig = `${s.overdue.length}|${s.due.length}|${legis}`;
  const day = today();
  if (!force && settings.lastNotify && settings.lastNotify.day === day && settings.lastNotify.sig === sig) return null;
  if (!force && s.overdue.length + s.due.length + legis === 0) return null;
  const parts = [];
  if (s.overdue.length) parts.push(tr('notify.overdue', { n: s.overdue.length }));
  if (s.due.length) parts.push(tr('notify.due', { n: s.due.length, days: archive.data.settings.warnDays }));
  if (legis) parts.push(tr('notify.legis', { n: legis }));
  if (!parts.length) parts.push(tr('notify.allGood'));
  const n = new Notification({ title: tr('notify.title'), body: parts.join('\n'), icon: fs.existsSync(ICON) ? ICON : undefined });
  n.on('click', () => showWindow(legis && !s.overdue.length && !s.due.length ? 'legislation' : 'reviews'));
  n.show();
  settings.lastNotify = { day, sig };
  saveSettings();
  return parts;
}

async function autoLegislationCheck() {
  if (!archive || archive.readOnly || settings.offline || !monitor || monitor.running) return;
  const mode = archive.data.settings.legisAutoCheck;
  if (!mode || mode === 'off') return;
  const last = archive.data.settings.legisLastAutoCheck;
  const ageDays = last ? (Date.now() - new Date(last).getTime()) / 86400000 : Infinity;
  const due = mode === 'startup' || (mode === 'daily' && ageDays >= 1) || (mode === 'weekly' && ageDays >= 7);
  if (!due) return;
  archive.data.settings.legisLastAutoCheck = new Date().toISOString();
  await archive.save();
  try {
    const r = await monitor.checkAll((p) => send('legis:progress', p));
    send('data:changed', { what: 'legislation' });
    if (r.changes && Notification.isSupported() && settings.notifications) {
      const n = new Notification({ title: tr('notify.legisTitle'), body: tr('notify.legisFound', { n: r.changes }) });
      n.on('click', () => showWindow('legislation'));
      n.show();
    }
  } catch (e) {
    console.error('auto legislation check failed', e);
  }
}

// ---------------------------------------------------------------------------
// IPC

function listFilesRecursive(dir, out = [], depth = 0) {
  if (depth > 8) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') || ent.name.startsWith('~$')) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) listFilesRecursive(p, out, depth + 1);
    else if (SUPPORTED.includes(path.extname(ent.name).toLowerCase())) out.push(p);
  }
  return out;
}

function stampName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function needsSetup() {
  return !!archive && archive.data.users.length === 0;
}

class UserError extends Error {}

/**
 * Register an IPC handler.
 *   perm:  'public' (no sign-in) | 'reader' | 'editor' | 'admin'
 *   write: the call changes the archive (refused while another computer holds it)
 */
function handle(channel, fn, { perm = 'reader', write = false } = {}) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!event.senderFrame || !event.senderFrame.url.startsWith('app://')) throw new Error('forbidden');
    if (perm !== 'public') {
      if (!session) throw new UserError(tr('err.signIn'));
      if (!hasRole(session.role, perm)) throw new UserError(tr('err.permission'));
    }
    if (write && archive.readOnly) {
      const ro = readOnlyInfo();
      throw new UserError(tr('err.readOnly', { user: ro.user, host: ro.host }));
    }
    try {
      return await fn(...args);
    } catch (e) {
      // Known error codes from the archive get a translated message.
      const code = String((e && e.message) || e);
      if (/^[A-Z_]+$/.test(code)) throw new UserError(tr(`err.${code}`));
      throw e;
    }
  });
}

const lawFileCache = new Map();

async function lawTextOf(p) {
  const st = await fs.promises.stat(p);
  const key = `${p}|${st.size}|${st.mtimeMs}`;
  if (lawFileCache.has(key)) return lawFileCache.get(key);
  const ex = await extractFile(p);
  const text = lawTextFromPages(ex.pages);
  const r = { status: ex.status, text };
  lawFileCache.clear();
  lawFileCache.set(key, r);
  return r;
}

function registerIpc() {
  // --- app & sign-in ---------------------------------------------------------
  handle(
    'app:info',
    () => ({
      version: app.getVersion(),
      platform: process.platform,
      dataDir: archive.dir,
      user: session ? session.name : osUser(),
      session: sessionPublic(),
      needsSetup: needsSetup(),
      readOnly: readOnlyInfo(),
      settings: publicSettings(),
      archiveSettings: { ...archive.data.settings, org: archive.data.org },
      logo: archive.logoInfo(),
      indexReady: archive.indexReady,
      ocr: ocrState,
      supported: SUPPORTED,
      encryptionAvailable: safeStorage.isEncryptionAvailable()
    }),
    { perm: 'public' }
  );

  handle('auth:state', () => ({ needsSetup: needsSetup(), users: archive.publicUsers(), session: sessionPublic(), lastUserId: settings.lastUserId, readOnly: readOnlyInfo() }), { perm: 'public' });

  handle(
    'auth:setup',
    async ({ name, password, org, lang: l }) => {
      if (!needsSetup()) throw new UserError(tr('err.permission'));
      const u = await archive.createUser({ name, role: 'admin', password });
      if (org !== undefined) await archive.updateSettings({ org });
      const full = archive.data.users.find((x) => x.id === u.id);
      if (l) {
        full.prefs = { lang: l };
        settings.lang = l;
      }
      setSession(full);
      await archive.recordLogin(full.id);
      archive.audit('auth.login', { first: true });
      settings.lastUserId = full.id;
      saveSettings();
      return sessionPublic();
    },
    { perm: 'public', write: true }
  );

  handle(
    'auth:login',
    async (userId, password) => {
      const f = failedLogins.get(userId);
      if (f && f.until > Date.now()) throw new UserError(tr('err.tooMany'));
      const u = archive.verifyLogin(userId, password);
      if (!u) {
        const n = ((f && f.count) || 0) + 1;
        failedLogins.set(userId, { count: n, until: n >= 5 ? Date.now() + 60000 : 0 });
        const target = archive.data.users.find((x) => x.id === userId);
        archive.audit('auth.failed', { targetUser: target ? target.name : '?' });
        throw new UserError(tr('err.badPassword'));
      }
      failedLogins.delete(userId);
      setSession(u);
      if (!archive.readOnly) await archive.recordLogin(u.id);
      archive.audit('auth.login', {});
      settings.lastUserId = u.id;
      saveSettings();
      return sessionPublic();
    },
    { perm: 'public' }
  );

  handle('auth:logout', (reason) => {
    archive.audit('auth.logout', { reason: reason || undefined });
    setSession(null);
    return true;
  });

  handle(
    'auth:changePassword',
    async (oldPw, newPw) => {
      if (!archive.verifyLogin(session.userId, oldPw)) throw new UserError(tr('err.badPassword'));
      await archive.setPassword(session.userId, newPw, { self: true });
      return true;
    },
    { write: true }
  );

  handle('auth:setPrefs', async (prefs) => {
    const p = {};
    if (prefs.lang === 'sk' || prefs.lang === 'en') p.lang = prefs.lang;
    if (['system', 'light', 'dark'].includes(prefs.theme)) p.theme = prefs.theme;
    session.prefs = { ...session.prefs, ...p };
    if (!archive.readOnly) await archive.setPrefs(session.userId, p);
    buildMenu();
    refreshTrayMenu();
    return publicSettings();
  });

  // --- user management (administrator) ----------------------------------------
  handle('users:list', () => archive.listUsers(), { perm: 'admin' });
  handle('users:create', (u) => archive.createUser(u), { perm: 'admin', write: true });
  handle(
    'users:update',
    async (userId, patch) => {
      const r = await archive.updateUser(userId, patch);
      if (session && userId === session.userId) {
        const me = archive.data.users.find((x) => x.id === userId);
        session.name = me.name;
        session.role = me.role;
        archive.user = me.name;
      }
      return r;
    },
    { perm: 'admin', write: true }
  );
  handle('users:resetPassword', (userId, pw) => archive.setPassword(userId, pw), { perm: 'admin', write: true });
  handle('users:roles', () => ROLES, { perm: 'public' });

  // --- computer settings -----------------------------------------------------
  handle(
    'app:setSettings',
    async (patch) => {
      const admin = session && session.role === 'admin';
      const setup = needsSetup() && !session;
      const allowed = admin ? ['lang', 'theme', 'offline', 'notifications', 'launchAtLogin', 'runInBackground', 'ai'] : setup ? ['lang', 'theme', 'launchAtLogin', 'runInBackground'] : ['lang', 'theme'];
      for (const k of Object.keys(patch)) if (!allowed.includes(k)) throw new UserError(tr('err.permission'));
      for (const k of ['lang', 'theme', 'offline', 'notifications']) if (patch[k] !== undefined) settings[k] = patch[k];
      if (patch.runInBackground !== undefined) {
        settings.runInBackground = !!patch.runInBackground;
        if (settings.runInBackground) ensureTray();
        else if (tray) {
          tray.destroy();
          tray = null;
        }
      }
      if (patch.launchAtLogin !== undefined) {
        settings.launchAtLogin = !!patch.launchAtLogin;
        if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, args: ['--hidden'] });
      }
      if (patch.ai) {
        const { apiKey: key, clearKey, ...rest } = patch.ai;
        if (rest.provider && !['none', 'ollama', 'openai'].includes(rest.provider)) throw new UserError(tr('err.permission'));
        if (rest.baseUrl && !ai.isLocalUrl(rest.baseUrl)) throw new UserError(tr('err.NOT_LOCAL'));
        settings.ai = { ...settings.ai, ...rest };
        if (key) setApiKey(key);
        if (clearKey) setApiKey('');
      }
      saveSettings();
      if (patch.lang) {
        buildMenu();
        refreshTrayMenu();
      }
      return publicSettings();
    },
    { perm: 'public' }
  );

  handle(
    'app:chooseFolder',
    async () => {
      if (!(needsSetup() && !session) && !(session && hasRole(session.role, 'editor'))) throw new UserError(tr('err.permission'));
      const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
      return r.canceled ? null : r.filePaths[0];
    },
    { perm: 'public' }
  );

  handle(
    'app:switchDataDir',
    async (dirIn, mode) => {
      if (!(needsSetup() && !session) && !(session && session.role === 'admin')) throw new UserError(tr('err.permission'));
      if (!dirIn) throw new Error('No folder');
      // A folder that is not empty and is not an archive (e.g. "Documents") gets an SOP-Archiv subfolder.
      let dir = dirIn;
      try {
        if (!fs.existsSync(path.join(dir, 'archive.json')) && fs.readdirSync(dir).filter((f) => !f.startsWith('.')).length) dir = path.join(dir, 'SOP-Archiv');
      } catch (_) {
        /* folder does not exist yet */
      }
      if (path.resolve(dir) === path.resolve(archive.dir)) return { dataDir: archive.dir };
      if (mode === 'copy') {
        if (fs.existsSync(path.join(dir, 'archive.json'))) throw new UserError(tr('err.targetHasArchive'));
        await archive.saving;
        await fs.promises.cp(archive.dir, dir, { recursive: true, filter: (src) => path.basename(src) !== '.sop-archiv.lock' });
      }
      const prev = session && archive.data.users.find((u) => u.id === session.userId);
      await openArchive(dir);
      settings.dataDir = dir;
      saveSettings();
      // Profiles belong to an archive: keep the session only when the same profile exists there (a copy).
      const same = prev && archive.data.users.find((u) => u.id === prev.id && !u.disabled);
      setSession(same || null);
      archive.audit('archive.opened', { dir, mode });
      return { dataDir: dir, session: sessionPublic(), needsSetup: needsSetup() };
    },
    { perm: 'public' }
  );

  handle('app:retryLock', async () => {
    if (!archive.readOnly) return null;
    const got = lock.tryAcquire();
    if (!got.ok) {
      lockHolder = got.holder;
      return readOnlyInfo();
    }
    await archive.reload(); // pick up everything the other computer saved
    archive.readOnly = false;
    lockHolder = null;
    lastArchiveMtime = archiveMtime();
    send('data:changed', { what: 'lock' });
    queueOcr();
    return null;
  });

  handle('app:openDataDir', () => shell.openPath(archive.dir));
  handle(
    'app:backup',
    async () => {
      const r = await dialog.showOpenDialog(mainWindow, { title: tr('dlg.backupTitle'), properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled) return null;
      await archive.saving;
      const dest = path.join(r.filePaths[0], `SOP-Archiv-zaloha-${stampName()}`);
      await fs.promises.cp(archive.dir, dest, { recursive: true, filter: (src) => !src.includes(`${path.sep}trash${path.sep}`) && path.basename(src) !== '.sop-archiv.lock' });
      archive.audit('archive.backup', { dest });
      return dest;
    },
    { perm: 'editor' }
  );
  handle('app:openExternal', (url) => (/^https?:\/\//i.test(url) ? shell.openExternal(url) : false));
  handle('app:networkLog', () => readNetLog());
  handle('app:audit', (opts) => archive.readAudit(opts || {}));
  handle('app:remindNow', () => reviewReminder(true));
  handle('archive:updateSettings', (patch) => archive.updateSettings(patch), { perm: 'admin', write: true });
  handle('app:logo', () => archive.logoDataUrl(), { perm: 'public' });
  handle(
    'archive:setLogo',
    async () => {
      const r = await dialog.showOpenDialog(mainWindow, { title: tr('dlg.logoTitle'), properties: ['openFile'], filters: [{ name: tr('dlg.images'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }] });
      if (r.canceled) return false;
      return archive.setLogo(r.filePaths[0]);
    },
    { perm: 'admin', write: true }
  );
  handle('archive:clearLogo', () => archive.clearLogo(), { perm: 'admin', write: true });

  // --- documents ---------------------------------------------------------------
  handle('docs:list', () => archive.listDocs());
  handle('docs:get', (id) => archive.getDoc(id));
  handle('docs:text', (id, versionId) => archive.docText(id, versionId));
  handle(
    'docs:pickFiles',
    async () => {
      const r = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: tr('dlg.documents'), extensions: SUPPORTED.map((e) => e.slice(1)) },
          { name: tr('dlg.allFiles'), extensions: ['*'] }
        ]
      });
      return r.canceled ? [] : r.filePaths;
    },
    { perm: 'editor' }
  );
  handle(
    'docs:pickFolder',
    async () => {
      const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
      return r.canceled ? [] : listFilesRecursive(r.filePaths[0]);
    },
    { perm: 'editor' }
  );
  handle(
    'docs:expandPaths',
    (paths) => {
      const out = [];
      for (const p of paths || []) {
        try {
          if (fs.statSync(p).isDirectory()) listFilesRecursive(p, out);
          else out.push(p);
        } catch (_) {
          /* skip */
        }
      }
      return out;
    },
    { perm: 'editor' }
  );
  handle('docs:analyze', (p) => archive.analyzeFile(p), { perm: 'editor' });
  const thenOcr = (r) => {
    queueOcr();
    return r;
  };
  handle('docs:import', (p, meta) => archive.importFile(p, meta).then(thenOcr), { perm: 'editor', write: true });
  handle('docs:addVersion', (id, p, meta) => archive.addVersion(id, p, meta).then(thenOcr), { perm: 'editor', write: true });
  handle('docs:update', (id, patch) => archive.updateDoc(id, patch), { perm: 'editor', write: true });
  handle('docs:delete', (id) => archive.deleteDoc(id), { perm: 'admin', write: true });
  handle('docs:open', async (id, versionId) => {
    // Open a read-only working copy, so the archived (controlled) original can't be changed by accident.
    // Changes are brought back with "Upload new version".
    const src = archive.filePath(id, versionId);
    const doc = archive.getDoc(id);
    const v = doc.versions.find((x) => x.id === (versionId || doc.currentVersionId));
    const dir = path.join(app.getPath('temp'), 'SOP-Archiv');
    await fs.promises.mkdir(dir, { recursive: true });
    const prefix = `${(doc.code || 'doc').replace(/[<>:"/\\|?*\s]+/g, '_')}_v${String(v.label).replace(/[^\w.-]+/g, '_')}_`;
    const dest = path.join(dir, prefix + v.fileName.replace(/[<>:"/\\|?*]+/g, '_'));
    try {
      await fs.promises.chmod(dest, 0o644);
    } catch (_) {
      /* no previous copy */
    }
    await fs.promises.copyFile(src, dest);
    await fs.promises.chmod(dest, 0o444).catch(() => {});
    const err = await shell.openPath(dest);
    if (err) throw new Error(err);
    return true;
  });
  handle('docs:reveal', (id, versionId) => shell.showItemInFolder(archive.filePath(id, versionId)));
  handle('docs:markReviewed', (id, r) => archive.markReviewed(id, r), { perm: 'editor', write: true });
  handle('docs:exportCsv', async (labels) => {
    const r = await dialog.showSaveDialog(mainWindow, { defaultPath: `SOP-Archiv-dokumenty-${today()}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled) return null;
    const docs = archive.listDocs();
    const L = labels || {};
    const cols = [
      { label: L.code || 'Code', key: 'code' },
      { label: L.title || 'Title', key: 'title' },
      { label: L.type || 'Type', key: 'type' },
      { label: L.version || 'Version', key: 'version' },
      { label: L.status || 'Status', get: (d) => (L.statuses && L.statuses[d.status]) || d.status },
      { label: L.department || 'Department', key: 'department' },
      { label: L.owner || 'Owner', key: 'owner' },
      { label: L.effectiveDate || 'Effective', key: 'effectiveDate' },
      { label: L.reviewDate || 'Review', key: 'reviewDate' },
      { label: L.lastReview || 'Last review', key: 'lastReviewDate' },
      { label: L.legislation || 'Legislation', get: (d) => d.citations.map((c) => (archive.data.laws.find((l) => l.id === c.lawId) || {}).short).filter(Boolean).join(', ') },
      { label: L.tags || 'Tags', get: (d) => d.tags.join(', ') }
    ];
    await fs.promises.writeFile(r.filePath, buildCsv(docs, cols));
    return r.filePath;
  });
  handle('reviews:exportIcs', async (labels) => {
    const r = await dialog.showSaveDialog(mainWindow, { defaultPath: `SOP-Archiv-revizie-${today()}.ics`, filters: [{ name: 'iCalendar', extensions: ['ics'] }] });
    if (r.canceled) return null;
    const L = labels || {};
    await fs.promises.writeFile(r.filePath, buildIcs(archive.data.docs, { reminderDays: archive.data.settings.reminderDaysIcs, prefix: L.prefix, versionLabel: L.version, ownerLabel: L.owner, org: archive.data.org }));
    return r.filePath;
  });

  // --- search ------------------------------------------------------------------
  handle('search:query', (q, filters) => archive.search(q, filters || {}));
  handle('search:ask', async (question) => {
    const passages = archive.passages(question, 8);
    const cfg = aiConfig();
    if (!ai.cfgFor(cfg) || !passages.length) return { passages, answer: null };
    const p = ai.buildQaPrompt({ question, passages, l: lang(), budget: ai.cfgFor(cfg).budget });
    const r = await ai.complete(cfg, p.system, p.user, { log: logNet });
    archive.audit('ai.question', { provider: cfg.provider, model: r.model, question });
    return { passages, answer: { text: r.text, model: r.model, provider: cfg.provider, truncated: p.truncated } };
  });

  // --- legislation register ----------------------------------------------------
  handle('laws:list', () => archive.listLaws());
  handle('laws:add', (l) => archive.addLaw(l), { perm: 'editor', write: true });
  handle('laws:update', (id, patch) => archive.updateLaw(id, patch), { perm: 'editor', write: true });
  handle('laws:remove', (id) => archive.removeLaw(id), { perm: 'admin', write: true });
  handle(
    'laws:check',
    async (ids) => {
      if (settings.offline) throw new UserError(tr('err.offline'));
      return monitor.checkAll((p) => send('legis:progress', p), ids || null);
    },
    { perm: 'editor', write: true }
  );

  // --- check documents against an act the user brings ---------------------------
  handle(
    'legis:pickFile',
    async () => {
      const r = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: tr('dlg.lawFiles'), extensions: LAW_FILE_TYPES }] });
      return r.canceled ? null : r.filePaths[0];
    },
    { perm: 'editor' }
  );
  handle(
    'legis:inspectFile',
    async (p) => {
      const { status, text } = await lawTextOf(p);
      const identity = detectLawIdentity(text, archive.data.laws);
      return { path: p, fileName: path.basename(p), status, chars: text.length, sections: sectionMap(text).size, identity, preview: text.slice(0, 500) };
    },
    { perm: 'editor' }
  );
  handle(
    'legis:importFile',
    async (p, opts = {}) => {
      const { text } = await lawTextOf(p);
      let spec = null;
      if (!opts.lawId) {
        const key = (opts.key || '').trim() || null;
        const title = (opts.title || '').trim() || (key ? key.slice(3) : path.basename(p));
        spec = { key: key || '', title, short: opts.short || title, url: key ? urlForKey(key) : '', jurisdiction: key ? key.slice(0, 2) : 'OTHER', aliases: key ? aliasesFromKey(key) : [] };
      }
      const ch = await archive.importLawText({ lawId: opts.lawId || null, spec, text, versionDate: opts.versionDate || null, source: { type: 'file', name: path.basename(p) } });
      send('data:changed', { what: 'legislation' });
      return { changeId: ch.id };
    },
    { perm: 'editor', write: true }
  );
  handle('legis:resolve', (query) => {
    const r = resolveLawQuery(query, archive.data.laws, DEFAULT_LAWS);
    if (!r) return null;
    if (r.lawId) {
      const l = archive.data.laws.find((x) => x.id === r.lawId);
      return { lawId: l.id, title: l.title, short: l.short, url: l.url, inRegister: true };
    }
    return { ...r.spec, inRegister: false };
  });
  handle(
    'legis:check',
    async (query) => {
      if (settings.offline) throw new UserError(tr('err.offline'));
      const r = resolveLawQuery(query, archive.data.laws, DEFAULT_LAWS);
      if (!r) throw new UserError(tr('err.lawNotFound'));
      const law = await archive.ensureLaw(r);
      if (!/^https?:\/\//i.test(law.url || '')) throw new UserError(tr('err.lawNoUrl'));
      const res = await monitor.checkAndReport(law.id, { type: /^https?:/i.test(query) ? 'url' : 'name', name: String(query).trim() });
      send('data:changed', { what: 'legislation' });
      return res;
    },
    { perm: 'editor', write: true }
  );

  handle('changes:list', () => archive.listChanges());
  handle('changes:get', (id) => archive.getChange(id));
  handle('changes:update', (id, patch) => archive.updateChange(id, patch), { perm: 'editor', write: true });
  handle('changes:recheck', (id) => archive.recheckChange(id), { perm: 'editor', write: true });
  handle(
    'changes:analyze',
    async (changeId, docId) => {
      const cfg = aiConfig();
      if (!ai.cfgFor(cfg)) throw new UserError(tr('err.noAi'));
      const ch = await archive.getChange(changeId);
      const doc = archive.getDoc(docId);
      const pages = await archive.docText(docId);
      const aff = ch.affected.find((a) => a.docId === docId);
      const p = ai.buildImpactPrompt({ change: ch, law: ch.law, diff: ch.diff, doc, pages, analysis: aff && aff.analysis, l: lang(), budget: ai.cfgFor(cfg).budget });
      const r = await ai.complete(cfg, p.system, p.user, { log: logNet });
      archive.audit('ai.impact-analysis', { changeId, docId, provider: cfg.provider, model: r.model });
      return archive.updateChange(changeId, { ai: { [docId]: { text: r.text, model: r.model, provider: cfg.provider, at: new Date().toISOString(), truncated: p.truncated } } });
    },
    { perm: 'editor', write: true }
  );
  handle(
    'ai:test',
    async (cfgPatch) => {
      const cfg = { ...aiConfig(), ...(cfgPatch || {}) };
      if (cfgPatch && cfgPatch.apiKey === undefined) cfg.apiKey = apiKey();
      return ai.test(cfg);
    },
    { perm: 'admin' }
  );
}

// ---------------------------------------------------------------------------
// Lifecycle

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(async () => {
    app.setAppUserModelId(APP_ID);
    loadSettings();
    // The user interface itself never talks to the internet (only app:// files are allowed).
    electronSession.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_d, cb) => cb({ cancel: true }));
    electronSession.defaultSession.setSpellCheckerEnabled(false); // no dictionary downloads
    protocol.handle('app', (req) => {
      const u = new URL(req.url);
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
      // PDF.js for the hidden OCR page (only its scripts and image decoders).
      const vendor = rel.match(/^vendor\/(pdfjs|pdfjs-wasm)\/([\w.-]+\.(?:mjs|wasm))$/);
      if (vendor) {
        const dir = vendor[1] === 'pdfjs' ? path.dirname(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')) : path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'wasm');
        const type = vendor[2].endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
        return fs.promises.readFile(path.join(dir, vendor[2])).then(
          (b) => new Response(b, { headers: { 'content-type': type } }),
          () => new Response('Not found', { status: 404 })
        );
      }
      const file = path.normalize(path.join(RENDERER_DIR, rel));
      if (!file.startsWith(RENDERER_DIR + path.sep)) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    });
    try {
      await openArchive(settings.dataDir);
    } catch (e) {
      dialog.showErrorBox('SOP Archív', `${tr('err.openArchive')}\n${settings.dataDir}\n\n${e.message}`);
      settings.dataDir = path.join(app.getPath('documents'), 'SOP-Archiv');
      await openArchive(settings.dataDir);
    }
    saveSettings();
    registerIpc();
    buildMenu();
    createWindow();
    if (settings.runInBackground) ensureTray();
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, args: ['--hidden'] });
    if (!process.env.SOP_ARCHIV_NO_TIMERS) {
      setTimeout(() => reviewReminder(false), 5000);
      setInterval(() => reviewReminder(false), 60 * 60 * 1000);
      setTimeout(() => autoLegislationCheck(), 20000);
      setInterval(() => autoLegislationCheck(), 6 * 60 * 60 * 1000);
    }
  });

  app.on('activate', () => showWindow());
  app.on('before-quit', () => {
    quitting = true;
    if (archive && session) archive.audit('auth.logout', { reason: 'quit' });
    if (lock) lock.release();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !settings.runInBackground) app.quit();
  });
}
