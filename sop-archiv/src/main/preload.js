'use strict';
// The only bridge between the user interface and the computer. Exposes a fixed list of calls.

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

const CHANNELS = {
  app: ['info', 'setSettings', 'chooseFolder', 'switchDataDir', 'retryLock', 'openDataDir', 'backup', 'openExternal', 'networkLog', 'audit', 'remindNow', 'logo', 'checkUpdate', 'cloudSync'],
  auth: ['state', 'setup', 'login', 'logout', 'changePassword', 'setPrefs', 'recover', 'pendingRecovery', 'recoveryKept'],
  users: ['list', 'create', 'update', 'resetPassword', 'roles'],
  legis: ['pickFile', 'inspectFile', 'importFile', 'resolve', 'check'],
  archive: ['updateSettings', 'setLogo', 'clearLogo', 'newRecoveryCode'],
  docs: ['list', 'get', 'text', 'pickFiles', 'pickFolder', 'expandPaths', 'analyze', 'import', 'addVersion', 'update', 'delete', 'open', 'markReviewed', 'exportCsv', 'saveCopy'],
  reviews: ['exportIcs'],
  search: ['query', 'ask'],
  laws: ['list', 'add', 'update', 'remove', 'check'],
  changes: ['list', 'get', 'update', 'recheck', 'analyze'],
  company: ['get', 'update'],
  people: ['list', 'save'],
  approval: ['request', 'sign', 'cancel', 'mine'],
  copies: ['issue', 'withdraw', 'toWithdraw'],
  notices: ['list', 'counts', 'check', 'seen', 'handle', 'reopen', 'open'],
  training: ['overview', 'person', 'doc', 'mine', 'record', 'remove', 'confirm', 'exportCsv'],
  decisions: ['list', 'add', 'remove'],
  ai: ['test', 'models', 'download', 'cancelDownload', 'removeModel', 'addModelFile', 'cancel'],
  compose: ['init', 'outlineOf', 'suggestLaws', 'draftSection', 'save', 'saveCopy'],
  rewrite: ['passages', 'propose', 'save', 'update', 'remove', 'exportDocx']
};

const api = {};
for (const [ns, names] of Object.entries(CHANNELS)) {
  api[ns] = {};
  for (const n of names) api[ns][n] = call(`${ns}:${n}`);
}

const EVENTS = ['legis:progress', 'navigate', 'data:changed', 'index:ready', 'lock:changed', 'ocr:progress', 'ai:progress', 'ai:chunk'];
api.on = (event, cb) => {
  if (!EVENTS.includes(event)) throw new Error('unknown event');
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(event, listener);
  return () => ipcRenderer.removeListener(event, listener);
};

// Drag & drop: turn dropped File objects into paths on disk.
api.pathForFile = (file) => webUtils.getPathForFile(file);

contextBridge.exposeInMainWorld('api', api);
