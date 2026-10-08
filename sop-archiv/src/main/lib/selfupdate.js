'use strict';
// One-click update: which file of a published release belongs to this computer, its fingerprint, and the
// small script that swaps the app on a Mac once it has quit. Pure helpers – unit-tested in
// test/unit/selfupdate.test.js; the downloading and installing is in main.js.

/** Hosts a release file may come from (GitHub sends the download on to its file servers). */
const UPDATE_HOSTS = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];

/**
 * The file for this computer: Mac .dmg for its processor, the Windows installer, a Linux AppImage.
 * null when there is none or the app cannot replace itself here (Windows portable copy, Linux not as AppImage).
 */
function assetFor(assets, { platform, arch, portable = false, appImage = false } = {}) {
  const list = Array.isArray(assets) ? assets : [];
  let re = null;
  if (platform === 'darwin') re = arch === 'arm64' ? /-mac-arm64\.dmg$/i : /-mac-x64\.dmg$/i;
  else if (platform === 'win32' && !portable) re = /-Setup\.exe$/i;
  else if (platform === 'linux' && appImage) re = /\.AppImage$/i;
  if (!re) return null;
  const a = list.find((x) => x && re.test(String(x.name || '')) && x.browser_download_url);
  return a ? { name: a.name, url: a.browser_download_url, size: Number(a.size) || 0, sha256: digestOf(a) } : null;
}

/** GitHub states the fingerprint of every release file ("sha256:…"). */
function digestOf(asset) {
  const m = String((asset && asset.digest) || '').match(/^sha256:([0-9a-f]{64})$/i);
  return m ? m[1].toLowerCase() : null;
}

/** SHA256SUMS.txt published with the release: "<hex>  <file name>" per line. */
function parseSums(text) {
  const out = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^([0-9a-f]{64})\s+\*?(.+?)\s*$/i);
    if (m) out.set(m[2], m[1].toLowerCase());
  }
  return out;
}

/** The SHA256SUMS.txt file of a release, if published. */
function sumsAsset(assets) {
  const a = (Array.isArray(assets) ? assets : []).find((x) => x && /^SHA256SUMS(\.txt)?$/i.test(String(x.name || '')));
  return a ? a.browser_download_url : null;
}

/** "/Applications/SOP Archiv.app" from the program file inside it; null when not run from an app bundle. */
function macAppPath(execPath) {
  const m = String(execPath || '').match(/^(.*?\.app)\/Contents\/MacOS\/[^/]+$/);
  return m ? m[1] : null;
}

/**
 * An app macOS started from a temporary read-only place (opened straight from the downloaded .dmg, or
 * "App Translocation" of a downloaded app that was never moved): it cannot replace itself there.
 */
function macCannotReplace(appPath) {
  return !appPath || /\/AppTranslocation\//.test(appPath) || /^\/Volumes\//.test(appPath);
}

/**
 * Script run once the app has quit: the new app takes the place of the old one, which is kept until the
 * new one is in place (and put back if anything fails), then the app is started again.
 * Paths are arguments, never part of the script text: $1 pid, $2 old app, $3 new app (staged next to it),
 * $4 "open" to start the app again afterwards.
 */
const MAC_SWAP_SCRIPT = `#!/bin/bash
PID="$1"; APP="$2"; NEW="$3"; REOPEN="$4"
for i in $(seq 1 120); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
if kill -0 "$PID" 2>/dev/null; then exit 1; fi
OLD="$APP.old-$$"
if mv "$APP" "$OLD" && mv "$NEW" "$APP"; then
  rm -rf "$OLD"
else
  [ -e "$APP" ] || mv "$OLD" "$APP"
  rm -rf "$NEW"
fi
[ "$REOPEN" = "open" ] && open "$APP"
exit 0
`;

/**
 * Mac: the new app is copied out of the downloaded .dmg next to the installed one (same disk, so the swap
 * is a rename) and checked – its version must be the expected one and its signature intact.
 * run(cmd, args) runs a program and resolves with its output. Returns the path of the staged app.
 */
async function macStage({ run, fs, path, dmg, appPath, version, mount }) {
  const staged = path.join(path.dirname(appPath), `.${path.basename(appPath)}.update`);
  fs.rmSync(staged, { recursive: true, force: true });
  await run('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, dmg]);
  try {
    const name = fs.readdirSync(mount).find((n) => n.endsWith('.app'));
    if (!name) throw new Error('UPDATE_NO_APP');
    await run('ditto', [path.join(mount, name), staged]);
  } finally {
    await run('hdiutil', ['detach', mount, '-quiet']).catch(() => run('hdiutil', ['detach', mount, '-force']).catch(() => {}));
  }
  const got = await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(staged, 'Contents', 'Info.plist')]);
  if (String(got).trim() !== version) {
    fs.rmSync(staged, { recursive: true, force: true });
    throw new Error('UPDATE_VERSION');
  }
  await run('codesign', ['--verify', '--deep', '--strict', staged]);
  return staged;
}

module.exports = { UPDATE_HOSTS, assetFor, digestOf, parseSums, sumsAsset, macAppPath, macCannotReplace, MAC_SWAP_SCRIPT, macStage };
