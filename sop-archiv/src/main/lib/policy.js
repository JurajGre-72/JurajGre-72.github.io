'use strict';
// Settings IT sets for every user of a computer or a terminal server (e.g. Citrix), in a file only an
// administrator can change:
//   Windows  %ProgramData%\SOP Archiv\policy.json
//   macOS    /Library/Application Support/SOP Archiv/policy.json
//   Linux    /etc/sop-archiv/policy.json
// {
//   "dataDir": "\\\\server\\share\\SOP-Archiv",   – the archive folder for everyone (users cannot switch it)
//   "updates": "it",                              – "app" (default), "it" (IT installs new versions; the app
//                                                    only says that one exists) or "off" (no checking at all)
//   "disableGpu": true                            – software drawing, for servers without a graphics card
// }
// An app installed for all users (Program Files) cannot replace itself without an administrator, so its
// updates are left to IT as well.

const fs = require('fs');
const path = require('path');

function policyFile({ platform = process.platform, env = process.env } = {}) {
  if (platform === 'win32') return path.win32.join(env.ProgramData || env.ALLUSERSPROFILE || 'C:\\ProgramData', 'SOP Archiv', 'policy.json');
  if (platform === 'darwin') return '/Library/Application Support/SOP Archiv/policy.json';
  return '/etc/sop-archiv/policy.json';
}

/** The policy, cleaned; { file, error } when it exists but cannot be read (the app then keeps its defaults). */
function readPolicy({ platform = process.platform, env = process.env, readFile = (f) => fs.readFileSync(f, 'utf8') } = {}) {
  const file = policyFile({ platform, env });
  const out = { file, dataDir: null, updates: 'app', disableGpu: false, error: null };
  let raw;
  try {
    raw = readFile(file);
  } catch (_) {
    return out; // no policy: the usual settings
  }
  try {
    const p = JSON.parse(String(raw).replace(/^\uFEFF/, '')); // Notepad may save a BOM
    if (typeof p.dataDir === 'string' && p.dataDir.trim()) out.dataDir = p.dataDir.trim();
    if (['app', 'it', 'off'].includes(p.updates)) out.updates = p.updates;
    out.disableGpu = p.disableGpu === true;
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

/** Installed for all users (Program Files): only an administrator can replace it. */
function installedForAll(execPath, { platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') return false;
  const exe = String(execPath || '').toLowerCase();
  return [env.ProgramFiles, env.ProgramW6432, env['ProgramFiles(x86)']].filter(Boolean).some((d) => exe.startsWith(`${String(d).toLowerCase().replace(/\\+$/, '')}\\`));
}

module.exports = { policyFile, readPolicy, installedForAll };
