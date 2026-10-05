'use strict';
// SOP Archív – Electron main process.
// Runs entirely on this computer. The only network traffic is (a) the legislation check, to the
// addresses listed in the legislation register, and (b) an AI provider, if the user configures one.
// Every such request is listed in Settings → Privacy → Network activity.

const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Notification, Tray, Menu, nativeImage, safeStorage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const { Archive } = require('./archive');
const { LegislationMonitor, createElectronFetcher } = require('./legislation');
const ai = require('./ai');
const { summarize, buildIcs, buildCsv } = require('./lib/reviews');
const { SUPPORTED } = require('./lib/extract');
const { today } = require('./lib/dates');
const mainText = require('./i18n-main');

const APP_ID = 'sk.soparchiv.app';
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const ICON = path.join(__dirname, '..', '..', 'build', 'icon.png');

if (process.env.SOP_ARCHIV_USERDATA) app.setPath('userData', process.env.SOP_ARCHIV_USERDATA);
const startHidden = process.argv.includes('--hidden');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }]);

// ---------------------------------------------------------------------------
// App settings (per computer user, outside the archive folder)

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
  settings = {
    dataDir: process.env.SOP_ARCHIV_DATA || s.dataDir || path.join(app.getPath('documents'), 'SOP-Archiv'),
    lang: s.lang || (locale.startsWith('sk') || locale.startsWith('cs') ? 'sk' : 'en'),
    theme: s.theme || 'system',
    userName: s.userName || '',
    offline: !!s.offline,
    notifications: s.notifications !== false,
    launchAtLogin: !!s.launchAtLogin,
    runInBackground: !!s.runInBackground,
    ai: { provider: 'none', baseUrl: '', model: '', budget: 0, apiKeyEnc: '', ...(s.ai || {}) },
    lastNotify: s.lastNotify || null,
    onboarded: !!s.onboarded || !!process.env.SOP_ARCHIV_DATA,
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
  settings.ai.apiKeyEnc = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(key).toString('base64')
    : 'plain:' + Buffer.from(key, 'utf8').toString('base64');
}

function aiConfig() {
  return { ...settings.ai, apiKey: apiKey() };
}

function publicSettings() {
  const { apiKeyEnc, ...aiRest } = settings.ai;
  return { ...settings, ai: { ...aiRest, hasApiKey: !!apiKeyEnc, keyEncrypted: !!apiKeyEnc && !apiKeyEnc.startsWith('plain:') } };
}

function userName() {
  if (settings.userName) return settings.userName;
  try {
    return os.userInfo().username;
  } catch (_) {
    return 'user';
  }
}

const tr = (key, vars) => mainText(settings.lang, key, vars);

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
// Archive

let archive = null;
let monitor = null;
let mainWindow = null;
let tray = null;
let quitting = false;

async function openArchive(dir) {
  const a = new Archive({ dataDir: dir, user: userName(), lang: settings.lang });
  await a.open();
  archive = a;
  monitor = new LegislationMonitor(archive, { fetchPage: createElectronFetcher({ log: logNet }), isOffline: () => settings.offline });
  archive
    .buildIndex()
    .then(() => send('index:ready', { docs: archive.data.docs.length }))
    .catch((e) => console.error('index build failed', e));
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true
    }
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
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: tr('menu.file'),
      submenu: [
        { label: tr('menu.import'), accelerator: 'CmdOrCtrl+O', click: () => showWindow('documents?import=1') },
        { label: tr('menu.openFolder'), click: () => archive && shell.openPath(archive.dir) },
        { type: 'separator' },
        isMac ? { role: 'close' } : { label: tr('tray.quit'), click: () => { quitting = true; app.quit(); } }
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
// Reminders

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
  if (!archive || settings.offline || !monitor || monitor.running) return;
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

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!event.senderFrame || !event.senderFrame.url.startsWith('app://')) throw new Error('forbidden');
    return fn(...args);
  });
}

function registerIpc() {
  handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    dataDir: archive.dir,
    user: userName(),
    settings: publicSettings(),
    archiveSettings: { ...archive.data.settings, org: archive.data.org },
    indexReady: archive.indexReady,
    supported: SUPPORTED,
    encryptionAvailable: safeStorage.isEncryptionAvailable()
  }));

  handle('app:setSettings', async (patch) => {
    for (const k of ['lang', 'theme', 'userName', 'offline', 'notifications', 'onboarded']) if (patch[k] !== undefined) settings[k] = patch[k];
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
      settings.ai = { ...settings.ai, ...rest };
      if (key) setApiKey(key);
      if (clearKey) setApiKey('');
    }
    if (patch.userName !== undefined && archive) archive.user = userName();
    saveSettings();
    if (patch.lang) {
      buildMenu();
      refreshTrayMenu();
    }
    return publicSettings();
  });

  handle('app:chooseFolder', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  handle('app:switchDataDir', async (dirIn, mode) => {
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
      if (fs.existsSync(path.join(dir, 'archive.json'))) throw new Error(tr('err.targetHasArchive'));
      await archive.saving;
      await fs.promises.cp(archive.dir, dir, { recursive: true });
    }
    await openArchive(dir);
    settings.dataDir = dir;
    saveSettings();
    archive.audit('archive.opened', { dir, mode });
    return { dataDir: dir };
  });

  handle('app:openDataDir', () => shell.openPath(archive.dir));

  handle('app:backup', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: tr('dlg.backupTitle'), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled) return null;
    await archive.saving;
    const dest = path.join(r.filePaths[0], `SOP-Archiv-zaloha-${stampName()}`);
    await fs.promises.cp(archive.dir, dest, { recursive: true, filter: (src) => !src.includes(`${path.sep}trash${path.sep}`) });
    archive.audit('archive.backup', { dest });
    return dest;
  });

  handle('app:openExternal', (url) => {
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url);
    return false;
  });

  handle('app:networkLog', () => readNetLog());
  handle('app:audit', (opts) => archive.readAudit(opts || {}));
  handle('app:remindNow', () => reviewReminder(true));

  handle('archive:updateSettings', (patch) => archive.updateSettings(patch));

  // Documents
  handle('docs:list', () => archive.listDocs());
  handle('docs:get', (id) => archive.getDoc(id));
  handle('docs:text', (id, versionId) => archive.docText(id, versionId));
  handle('docs:pickFiles', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: tr('dlg.documents'), extensions: SUPPORTED.map((e) => e.slice(1)) },
        { name: tr('dlg.allFiles'), extensions: ['*'] }
      ]
    });
    return r.canceled ? [] : r.filePaths;
  });
  handle('docs:pickFolder', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    return r.canceled ? [] : listFilesRecursive(r.filePaths[0]);
  });
  handle('docs:expandPaths', (paths) => {
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
  });
  handle('docs:analyze', (p) => archive.analyzeFile(p));
  handle('docs:import', async (p, meta) => {
    const d = await archive.importFile(p, meta);
    return d;
  });
  handle('docs:addVersion', (id, p, meta) => archive.addVersion(id, p, meta));
  handle('docs:update', (id, patch) => archive.updateDoc(id, patch));
  handle('docs:delete', (id) => archive.deleteDoc(id));
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
  handle('docs:markReviewed', (id, r) => archive.markReviewed(id, r));
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
    await fs.promises.writeFile(
      r.filePath,
      buildIcs(archive.data.docs, { reminderDays: archive.data.settings.reminderDaysIcs, prefix: L.prefix, versionLabel: L.version, ownerLabel: L.owner, org: archive.data.org })
    );
    return r.filePath;
  });

  // Search
  handle('search:query', (q, filters) => archive.search(q, filters || {}));
  handle('search:ask', async (question) => {
    const passages = archive.passages(question, 8);
    const cfg = aiConfig();
    if (!ai.cfgFor(cfg) || settings.offline || !passages.length) return { passages, answer: null };
    const budget = ai.cfgFor(cfg).budget;
    const p = ai.buildQaPrompt({ question, passages, l: settings.lang, budget });
    const r = await ai.complete(cfg, p.system, p.user, { effort: 'medium', log: logNet });
    archive.audit('ai.question', { provider: cfg.provider, model: r.model, question });
    return { passages, answer: { text: r.text, model: r.model, provider: cfg.provider, truncated: p.truncated } };
  });

  // Legislation
  handle('laws:list', () => archive.listLaws());
  handle('laws:add', (l) => archive.addLaw(l));
  handle('laws:update', (id, patch) => archive.updateLaw(id, patch));
  handle('laws:remove', (id) => archive.removeLaw(id));
  handle('laws:check', async (ids) => {
    const r = await monitor.checkAll((p) => send('legis:progress', p), ids || null);
    return r;
  });
  handle('changes:list', () => archive.listChanges());
  handle('changes:get', (id) => archive.getChange(id));
  handle('changes:update', (id, patch) => archive.updateChange(id, patch));
  handle('changes:analyze', async (changeId, docId) => {
    const cfg = aiConfig();
    if (!ai.cfgFor(cfg)) throw new Error(tr('err.noAi'));
    if (settings.offline) throw new Error(tr('err.offline'));
    const ch = await archive.getChange(changeId);
    const doc = archive.getDoc(docId);
    const pages = await archive.docText(docId);
    const p = ai.buildImpactPrompt({ change: ch, law: ch.law, diff: ch.diff, doc, pages, l: settings.lang, budget: ai.cfgFor(cfg).budget });
    const r = await ai.complete(cfg, p.system, p.user, { effort: 'high', log: logNet });
    archive.audit('ai.impact-analysis', { changeId, docId, provider: cfg.provider, model: r.model });
    return archive.updateChange(changeId, { ai: { [docId]: { text: r.text, model: r.model, provider: cfg.provider, at: new Date().toISOString(), truncated: p.truncated } } });
  });
  handle('ai:test', async (cfgPatch) => {
    const cfg = { ...aiConfig(), ...(cfgPatch || {}) };
    if (cfgPatch && cfgPatch.apiKey === undefined) cfg.apiKey = apiKey();
    return ai.test(cfg);
  });
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
    protocol.handle('app', (req) => {
      const u = new URL(req.url);
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
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
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !settings.runInBackground) app.quit();
  });
}
