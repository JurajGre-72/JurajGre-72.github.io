'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const su = require('../../src/main/lib/selfupdate');
const { newestRelease } = require('../../src/main/lib/updates');

const H = 'a'.repeat(64);
const ASSETS = [
  { name: 'SOP-Archiv-1.0.2-Setup.exe', browser_download_url: 'https://github.com/x/y/releases/download/sop-archiv-v1.0.2/SOP-Archiv-1.0.2-Setup.exe', size: 100, digest: `sha256:${H}` },
  { name: 'SOP-Archiv-1.0.2-portable.exe', browser_download_url: 'https://github.com/p', size: 90 },
  { name: 'SOP-Archiv-1.0.2-mac-arm64.dmg', browser_download_url: 'https://github.com/a', size: 200, digest: `sha256:${'B'.repeat(64)}` },
  { name: 'SOP-Archiv-1.0.2-mac-x64.dmg', browser_download_url: 'https://github.com/i', size: 210 },
  { name: 'SOP-Archiv-1.0.2-linux-x86_64.AppImage', browser_download_url: 'https://github.com/l', size: 150 },
  { name: 'SHA256SUMS.txt', browser_download_url: 'https://github.com/s', size: 1 }
];

test('the file for this computer: Mac by processor, Windows installer, Linux AppImage; none where the app cannot replace itself', () => {
  assert.equal(su.assetFor(ASSETS, { platform: 'darwin', arch: 'arm64' }).name, 'SOP-Archiv-1.0.2-mac-arm64.dmg');
  assert.equal(su.assetFor(ASSETS, { platform: 'darwin', arch: 'x64' }).name, 'SOP-Archiv-1.0.2-mac-x64.dmg');
  const win = su.assetFor(ASSETS, { platform: 'win32', arch: 'x64' });
  assert.equal(win.name, 'SOP-Archiv-1.0.2-Setup.exe');
  assert.equal(win.sha256, H, 'the fingerprint GitHub states');
  assert.equal(su.assetFor(ASSETS, { platform: 'darwin', arch: 'arm64' }).sha256, 'b'.repeat(64));
  assert.equal(su.assetFor(ASSETS, { platform: 'win32', arch: 'x64', portable: true }), null, 'a portable copy is replaced by hand');
  assert.equal(su.assetFor(ASSETS, { platform: 'linux', arch: 'x64', appImage: true }).name, 'SOP-Archiv-1.0.2-linux-x86_64.AppImage');
  assert.equal(su.assetFor(ASSETS, { platform: 'linux', arch: 'x64' }), null);
  assert.equal(su.assetFor([], { platform: 'darwin', arch: 'arm64' }), null);
  assert.equal(su.assetFor(ASSETS, { platform: 'darwin', arch: 'x64' }).sha256, null, 'no digest: from SHA256SUMS.txt');
  assert.equal(su.sumsAsset(ASSETS), 'https://github.com/s');
});

test('fingerprints from SHA256SUMS.txt; the release keeps its files', () => {
  const sums = su.parseSums(`${H}  SOP-Archiv-1.0.2-mac-x64.dmg\n${'c'.repeat(64)} *SOP-Archiv-1.0.2-Setup.exe\r\nnonsense\n`);
  assert.equal(sums.get('SOP-Archiv-1.0.2-mac-x64.dmg'), H);
  assert.equal(sums.get('SOP-Archiv-1.0.2-Setup.exe'), 'c'.repeat(64));
  assert.equal(sums.size, 2);
  assert.equal(su.digestOf({ digest: 'md5:abc' }), null);
  const r = newestRelease([{ tag_name: 'sop-archiv-v1.0.2', html_url: 'u', assets: ASSETS }]);
  assert.equal(r.assets.length, ASSETS.length);
});

test('Mac: where the app runs from, and where it cannot replace itself', () => {
  assert.equal(su.macAppPath('/Applications/SOP Archiv.app/Contents/MacOS/SOP Archiv'), '/Applications/SOP Archiv.app');
  assert.equal(su.macAppPath('/usr/bin/node'), null);
  assert.equal(su.macCannotReplace('/Applications/SOP Archiv.app'), false);
  assert.equal(su.macCannotReplace('/private/var/folders/x/AppTranslocation/ABC/d/SOP Archiv.app'), true, 'started from the download without moving it');
  assert.equal(su.macCannotReplace('/Volumes/SOP Archiv 1.0.2/SOP Archiv.app'), true, 'started straight from the disk image');
  assert.equal(su.macCannotReplace(null), true);
});

test('Mac swap script: waits for the app to quit, puts the new app in place (spaces in names), keeps nothing old', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-swap-'));
  const app = path.join(dir, 'Apps folder', 'SOP Archiv.app');
  const staged = path.join(dir, 'Apps folder', '.SOP Archiv.app.update');
  fs.mkdirSync(path.join(app, 'Contents'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents', 'version'), 'old');
  fs.mkdirSync(path.join(staged, 'Contents'), { recursive: true });
  fs.writeFileSync(path.join(staged, 'Contents', 'version'), 'new');
  const script = path.join(dir, 'swap.sh');
  fs.writeFileSync(script, su.MAC_SWAP_SCRIPT, { mode: 0o700 });
  const running = spawn('sleep', ['1']); // the "app" that has to quit first
  const started = Date.now();
  const code = await new Promise((resolve) => spawn('/bin/bash', [script, String(running.pid), app, staged, 'no'], { stdio: 'ignore' }).on('exit', resolve));
  assert.equal(code, 0);
  assert.ok(Date.now() - started >= 700, 'waited for the app to quit');
  assert.equal(fs.readFileSync(path.join(app, 'Contents', 'version'), 'utf8'), 'new');
  assert.ok(!fs.existsSync(staged));
  assert.deepEqual(fs.readdirSync(path.dirname(app)), ['SOP Archiv.app'], 'no leftovers');
});

test('Mac swap script: if the new app is missing, the old one stays', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-swap-'));
  const app = path.join(dir, 'SOP Archiv.app');
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, 'v'), 'old');
  const script = path.join(dir, 'swap.sh');
  fs.writeFileSync(script, su.MAC_SWAP_SCRIPT, { mode: 0o700 });
  await new Promise((resolve) => spawn('/bin/bash', [script, '999999', app, path.join(dir, 'missing.app'), 'no'], { stdio: 'ignore' }).on('exit', resolve));
  assert.equal(fs.readFileSync(path.join(app, 'v'), 'utf8'), 'old');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['SOP Archiv.app', 'swap.sh']);
});

test('version history: what changed in each version (NOVINKY.md) and the installations in the audit trail', () => {
  const { parseChangelog, installHistory } = require('../../src/main/lib/updates');
  const md = fs.readFileSync(path.join(__dirname, '..', '..', 'NOVINKY.md'), 'utf8');
  const v = parseChangelog(md);
  assert.equal(v[0].version, require('../../package.json').version, 'the current version is described (a release needs it)');
  assert.ok(v.every((x) => x.items.length > 0), 'every version lists its changes');
  assert.deepEqual(v.map((x) => x.version), [...v.map((x) => x.version)].sort((a, b) => (a < b ? 1 : -1)), 'newest first');
  const wrapped = parseChangelog('## 1.0.0\n- one\n  continued\n- two\n## 1.1.0\n- new');
  assert.deepEqual(wrapped, [{ version: '1.1.0', items: ['new'] }, { version: '1.0.0', items: ['one continued', 'two'] }]);
  const h = installHistory([
    { ts: '2026-10-09T10:00:00Z', action: 'app.updated', user: 'Juraj', host: 'MacBook', from: '1.0.1', to: '1.0.2' },
    { ts: '2026-10-10T10:00:00Z', action: 'app.updated', user: 'Eva', host: 'PC', from: '1.0.2', to: '1.0.3' },
    { ts: '2026-10-09T09:59:00Z', action: 'app.update', from: '1.0.1', to: '1.0.2' },
    { ts: '2026-10-09T09:00:00Z', action: 'doc.opened' }
  ]);
  assert.deepEqual(h.map((x) => x.to), ['1.0.3', '1.0.2']);
  assert.equal(h[1].host, 'MacBook');
});
