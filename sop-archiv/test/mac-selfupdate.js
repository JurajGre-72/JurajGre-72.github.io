'use strict';
// Run on a Mac after the build (CI): the real one-click update steps on the built app.
// An "installed" copy stands in /…/Apps folder/SOP Archiv.app; the new version is staged from the built .dmg
// exactly as the app does it, swapped in after the "running" app quits, and the result must start.
//   node test/mac-selfupdate.js
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const su = require('../src/main/lib/selfupdate');

const ROOT = path.join(__dirname, '..');
const version = require('../package.json').version;
const run = (cmd, args) => new Promise((resolve, reject) => execFile(cmd, args, (e, out, err) => (e ? reject(new Error(`${cmd}: ${String(err || e.message).trim()}`)) : resolve(String(out).trim()))));
const exitOf = (p) => new Promise((resolve) => p.on('exit', (code) => resolve(code)));

(async () => {
  const dist = path.join(ROOT, 'dist');
  const dmg = path.join(dist, fs.readdirSync(dist).find((f) => f.endsWith('-mac-arm64.dmg')));
  const built = path.join(dist, 'mac-arm64', 'SOP Archiv.app');
  const apps = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sop-upd-')), 'Apps folder');
  fs.mkdirSync(apps);
  const installed = path.join(apps, 'SOP Archiv.app');
  await run('ditto', [built, installed]);
  fs.writeFileSync(path.join(installed, 'Contents', 'OLD-VERSION-MARKER'), 'old');

  // A disk image of another version is refused, nothing is left behind.
  await assert.rejects(su.macStage({ run, fs, path, dmg, appPath: installed, version: '0.0.1', mount: fs.mkdtempSync(path.join(os.tmpdir(), 'sop-mnt-')) }), /UPDATE_VERSION/);
  assert.deepEqual(fs.readdirSync(apps), ['SOP Archiv.app']);

  const staged = await su.macStage({ run, fs, path, dmg, appPath: installed, version, mount: fs.mkdtempSync(path.join(os.tmpdir(), 'sop-mnt-')) });
  const script = path.join(os.tmpdir(), `sop-swap-${process.pid}.sh`);
  fs.writeFileSync(script, su.MAC_SWAP_SCRIPT, { mode: 0o700 });
  const running = spawn('sleep', ['2']); // the app that has to quit first
  assert.equal(await exitOf(spawn('/bin/bash', [script, String(running.pid), installed, staged, 'no'], { stdio: 'inherit' })), 0);

  assert.ok(!fs.existsSync(path.join(installed, 'Contents', 'OLD-VERSION-MARKER')), 'the new app is in place');
  assert.deepEqual(fs.readdirSync(apps), ['SOP Archiv.app'], 'nothing left over');
  assert.equal(await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(installed, 'Contents', 'Info.plist')]), version);
  await run('codesign', ['--verify', '--deep', '--strict', installed]);
  // It starts (the real build refuses a debugging mode and quits with 1 – it ran its own code).
  const app = spawn(path.join(installed, 'Contents', 'MacOS', 'SOP Archiv'), ['--inspect=0'], { stdio: 'pipe' });
  let out = '';
  app.stderr.on('data', (d) => (out += d));
  assert.equal(await exitOf(app), 1, out);
  assert.match(out, /debugging mode/);
  console.log(`✓ Mac one-click update: ${version} staged from the .dmg, checked, swapped in after the app quit, signature intact, starts`);
})().catch((e) => {
  console.error('MAC SELF-UPDATE TEST FAILED:', e);
  process.exit(1);
});
