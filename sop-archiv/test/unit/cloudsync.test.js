'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cloudSyncProvider } = require('../../src/main/lib/cloudsync');

test('archive folders synchronised to a cloud service are recognised', () => {
  const none = { roots: [] };
  // Windows: "Documents" moved into OneDrive (company or personal)
  assert.equal(cloudSyncProvider('C:\\Users\\jana\\OneDrive - PHARMACOPOLA s.r.o\\Dokumenty\\SOP-Archiv', none), 'OneDrive');
  assert.equal(cloudSyncProvider('C:\\Users\\jana\\OneDrive\\Documents\\SOP-Archiv', none), 'OneDrive');
  assert.equal(cloudSyncProvider('D:\\Firma\\SOP', { roots: [['OneDrive', 'D:\\Firma']] }), 'OneDrive', 'the folder OneDrive reports');
  assert.equal(cloudSyncProvider('/Users/jana/Library/CloudStorage/OneDrive-Personal/SOP', none), 'OneDrive');
  assert.equal(cloudSyncProvider('/Users/jana/Library/CloudStorage/GoogleDrive-jana@firma.sk/My Drive/SOP', none), 'Google Drive');
  assert.equal(cloudSyncProvider('/home/jana/Dropbox/SOP-Archiv', none), 'Dropbox');
  assert.equal(cloudSyncProvider('C:\\Users\\jana\\Dropbox (PHARMACOPOLA)\\SOP', none), 'Dropbox');
  assert.equal(cloudSyncProvider('/Users/jana/Library/Mobile Documents/com~apple~CloudDocs/SOP', none), 'iCloud Drive');
  // local disk or the company server: fine
  assert.equal(cloudSyncProvider('C:\\Users\\jana\\Documents\\SOP-Archiv', none), null);
  assert.equal(cloudSyncProvider('\\\\server\\QA\\SOP-Archiv', none), null);
  assert.equal(cloudSyncProvider('/home/jana/OneDriveBackup-old/SOP', none), null, 'only the folder itself, not a similar name');
});

test('a new archive is offered in a folder no cloud service synchronises', () => {
  const { localDefault } = require('../../src/main/lib/cloudsync');
  const none = { roots: [] };
  const docs = 'C:\\Users\\jana\\Documents\\SOP-Archiv';
  const home = 'C:\\Users\\jana\\SOP-Archiv';
  assert.equal(localDefault([docs, home], none), docs, 'Documents when it stays on the computer');
  const kfm = { roots: [['OneDrive', 'C:\\Users\\jana\\Documents']] }; // OneDrive has taken over "Documents"
  assert.equal(localDefault([docs, home], kfm), home, 'the own folder instead');
  const all = { roots: [['OneDrive', 'C:\\Users\\jana']] };
  assert.equal(localDefault([docs, home], all), docs, 'everything synchronised: the first, and the setup screen warns');
});

test('Mac: "Desktop & Documents Folders" in iCloud is recognised, though the folders keep their usual place', () => {
  const { localDefault } = require('../../src/main/lib/cloudsync');
  const home = '/Users/jujugregre';
  const drive = `${home}/Library/Mobile Documents/com~apple~CloudDocs`;
  const on = { env: {}, platform: 'darwin', home, exists: (p) => p === `${drive}/Documents` || p === `${drive}/Desktop` };
  const off = { env: {}, platform: 'darwin', home, exists: () => false };
  assert.equal(cloudSyncProvider(`${home}/Documents/SOP-Archiv`, on), 'iCloud Drive');
  assert.equal(cloudSyncProvider(`${home}/Desktop/SOP-Archiv`, on), 'iCloud Drive');
  assert.equal(cloudSyncProvider(`${home}/SOP-Archiv`, on), null, 'the own folder stays on the Mac');
  assert.equal(cloudSyncProvider(`${home}/Documents/SOP-Archiv`, off), null, 'iCloud for Documents switched off');
  assert.equal(localDefault([`${home}/Documents/SOP-Archiv`, `${home}/SOP-Archiv`], on), `${home}/SOP-Archiv`);
});
