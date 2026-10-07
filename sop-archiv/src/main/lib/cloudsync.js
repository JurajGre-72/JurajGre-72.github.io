'use strict';
// Is a folder synchronised to a cloud service (OneDrive, Dropbox, Google Drive, iCloud …)?
// The archive should stay on this computer or the company's server: files in such a folder are uploaded
// to the provider (encrypted, but still outside the company). On many company laptops Windows moves
// "Documents" into OneDrive without asking, so the default folder can be affected too.

const fs = require('fs');
const os = require('os');
const path = require('path');

const PATTERNS = [
  ['OneDrive', /(^|[\\/])OneDrive( - [^\\/]+)?([\\/]|$)/i],
  ['OneDrive', /[\\/]Library[\\/]CloudStorage[\\/]OneDrive/i],
  ['Dropbox', /(^|[\\/])Dropbox( \([^\\/]+\))?([\\/]|$)/i],
  ['Google Drive', /(^|[\\/])(Google Drive|GoogleDrive[^\\/]*|My Drive|Môj disk)([\\/]|$)/i],
  ['iCloud Drive', /(^|[\\/])(iCloud Drive|iCloudDrive|Mobile Documents|com~apple~CloudDocs)([\\/]|$)/i],
  ['Box', /(^|[\\/])(Box|Box Sync)([\\/]|$)/],
  ['pCloud', /(^|[\\/])pCloud( Drive)?([\\/]|$)/i],
  ['MEGA', /(^|[\\/])MEGA( Downloads)?([\\/]|$)/],
  ['Nextcloud', /(^|[\\/])(Nextcloud|ownCloud)([\\/]|$)/i],
  ['Cloud storage', /[\\/]Library[\\/]CloudStorage[\\/]/i]
];

function norm(p) {
  return path.resolve(String(p || '')).replace(/[\\/]+$/, '');
}

function inside(dir, root) {
  if (!root) return false;
  const a = norm(dir).toLowerCase();
  const b = norm(root).toLowerCase();
  return a === b || a.startsWith(b + path.sep) || a.startsWith(b + '/') || a.startsWith(b + '\\');
}

/** Folders the sync programs report (Windows environment variables, Dropbox's own settings). */
function knownRoots(env = process.env) {
  const out = [];
  for (const k of ['OneDrive', 'OneDriveCommercial', 'OneDriveConsumer']) if (env[k]) out.push(['OneDrive', env[k]]);
  const dropboxInfo = [path.join(env.APPDATA || '', 'Dropbox', 'info.json'), path.join(env.LOCALAPPDATA || '', 'Dropbox', 'info.json'), path.join(os.homedir(), '.dropbox', 'info.json')];
  for (const f of dropboxInfo) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      for (const v of Object.values(j)) if (v && v.path) out.push(['Dropbox', v.path]);
    } catch (_) {
      /* not installed */
    }
  }
  return out;
}

/** The name of the cloud service that synchronises this folder, or null. */
function cloudSyncProvider(dir, { env = process.env, roots = null } = {}) {
  if (!dir) return null;
  for (const [name, root] of roots || knownRoots(env)) if (inside(dir, root)) return name;
  const p = norm(dir);
  for (const [name, re] of PATTERNS) if (re.test(p)) return name;
  return null;
}

/**
 * The folder offered for a new archive: the first candidate no cloud service synchronises (on many
 * Windows 11 computers OneDrive takes over "Documents" – then the user's own folder is offered instead).
 * If every candidate is synchronised, the first one (the setup screen then warns).
 */
function localDefault(candidates, opts) {
  return candidates.find((c) => !cloudSyncProvider(c, opts)) || candidates[0];
}

module.exports = { cloudSyncProvider, knownRoots, localDefault };
