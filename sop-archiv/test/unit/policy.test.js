'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { policyFile, readPolicy, installedForAll } = require('../../src/main/lib/policy');

const win = { platform: 'win32', env: { ProgramData: 'C:\\ProgramData', ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)' } };

test('IT policy: where it is, what it sets, a broken file keeps the defaults', () => {
  assert.equal(policyFile(win), 'C:\\ProgramData\\SOP Archiv\\policy.json');
  assert.equal(policyFile({ platform: 'darwin' }), '/Library/Application Support/SOP Archiv/policy.json');
  const none = readPolicy({ ...win, readFile: () => { throw Object.assign(new Error('no'), { code: 'ENOENT' }); } });
  assert.deepEqual([none.dataDir, none.updates, none.disableGpu, none.error], [null, 'app', false, null]);
  // Saved by Notepad (with a BOM), a UNC path with doubled backslashes as JSON needs
  const p = readPolicy({ ...win, readFile: () => '\uFEFF{ "dataDir": "\\\\\\\\server\\\\QA\\\\SOP-Archiv", "updates": "it", "disableGpu": true }' });
  assert.deepEqual([p.dataDir, p.updates, p.disableGpu, p.error], ['\\\\server\\QA\\SOP-Archiv', 'it', true, null]);
  assert.equal(readPolicy({ ...win, readFile: () => '{"updates":"sometimes","dataDir":"  "}' }).updates, 'app', 'unknown values ignored');
  assert.equal(readPolicy({ ...win, readFile: () => '{"updates":"sometimes","dataDir":"  "}' }).dataDir, null);
  assert.ok(readPolicy({ ...win, readFile: () => '{ dataDir: C:\\x }' }).error, 'not JSON: reported, defaults kept');
});

test('installed for all users (Program Files): updates by IT', () => {
  assert.equal(installedForAll('C:\\Program Files\\SOP Archiv\\SOP Archiv.exe', win), true);
  assert.equal(installedForAll('c:\\program files (x86)\\SOP Archiv\\SOP Archiv.exe', win), true);
  assert.equal(installedForAll('C:\\Users\\eva\\AppData\\Local\\Programs\\SOP Archiv\\SOP Archiv.exe', win), false, 'installed only for one user');
  assert.equal(installedForAll('/Applications/SOP Archiv.app/Contents/MacOS/SOP Archiv', { platform: 'darwin', env: {} }), false);
});
