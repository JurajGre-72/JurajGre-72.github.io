'use strict';
// The only bridge between the user interface and the computer. Exposes a fixed list of calls.

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

const CHANNELS = {
  app: ['info', 'setSettings', 'chooseFolder', 'switchDataDir', 'retryLock', 'openDataDir', 'backup', 'openExternal', 'networkLog', 'audit', 'remindNow', 'logo'],
  auth: ['state', 'setup', 'login', 'logout', 'changePassword', 'setPrefs'],
  users: ['list', 'create', 'update', 'resetPassword', 'roles'],
  legis: ['pickFile', 'inspectFile', 'importFile', 'resolve', 'check'],
  archive: ['updateSettings', 'setLogo', 'clearLogo'],
  docs: ['list', 'get', 'text', 'pickFiles', 'pickFolder', 'expandPaths', 'analyze', 'import', 'addVersion', 'update', 'delete', 'open', 'reveal', 'markReviewed', 'exportCsv'],
  reviews: ['exportIcs'],
  search: ['query', 'ask'],
  laws: ['list', 'add', 'update', 'remove', 'check'],
  changes: ['list', 'get', 'update', 'recheck', 'analyze'],
  ai: ['test']
};

const api = {};
for (const [ns, names] of Object.entries(CHANNELS)) {
  api[ns] = {};
  for (const n of names) api[ns][n] = call(`${ns}:${n}`);
}

const EVENTS = ['legis:progress', 'navigate', 'data:changed', 'index:ready', 'lock:changed', 'ocr:progress'];
api.on = (event, cb) => {
  if (!EVENTS.includes(event)) throw new Error('unknown event');
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(event, listener);
  return () => ipcRenderer.removeListener(event, listener);
};

// Drag & drop: turn dropped File objects into paths on disk.
api.pathForFile = (file) => webUtils.getPathForFile(file);

contextBridge.exposeInMainWorld('api', api);
