'use strict';
// "Check for updates": reads the list of published SOP Archív versions (GitHub releases of this project)
// and compares version numbers. Nothing about the archive is sent. Pure helpers – unit-tested.

const TAG_PREFIX = 'sop-archiv-v';

function parseVersion(v) {
  const m = String(v || '').match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : null;
}

function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** The newest published (not draft, not pre-release) version among GitHub releases, or null. */
function newestRelease(releases) {
  const list = (Array.isArray(releases) ? releases : [])
    .filter((r) => r && !r.draft && !r.prerelease && String(r.tag_name || '').startsWith(TAG_PREFIX) && parseVersion(r.tag_name))
    .map((r) => ({ version: parseVersion(r.tag_name).join('.'), url: r.html_url, publishedAt: r.published_at || null, notes: String(r.body || '').slice(0, 1500), assets: Array.isArray(r.assets) ? r.assets : [] }));
  list.sort((a, b) => compareVersions(b.version, a.version));
  return list[0] || null;
}

/**
 * NOVINKY.md (bundled with the app): what changed in each version, newest first.
 * "## 1.0.2" starts a version, "- …" lines are its changes. Returns [{ version, items: [text] }].
 */
function parseChangelog(md) {
  const out = [];
  let cur = null;
  for (const raw of String(md || '').split(/\r?\n/)) {
    const line = raw.trim();
    const h = line.match(/^##\s+(\d+\.\d+\.\d+)\s*$/);
    if (h) {
      cur = { version: h[1], items: [] };
      out.push(cur);
    } else if (cur && /^[-*]\s+/.test(line)) cur.items.push(line.replace(/^[-*]\s+/, ''));
    else if (cur && line && cur.items.length) cur.items[cur.items.length - 1] += ` ${line}`; // a wrapped line
  }
  return out.sort((a, b) => compareVersions(b.version, a.version));
}

/** The installations recorded in the audit trail (newest first): [{ ts, user, host, from, to }]. */
function installHistory(auditRows) {
  return (Array.isArray(auditRows) ? auditRows : [])
    .filter((r) => r && r.action === 'app.updated' && r.to)
    .map((r) => ({ ts: r.ts, user: r.user || '', host: r.host || '', from: r.from || '', to: r.to }))
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
}

module.exports = { TAG_PREFIX, parseVersion, compareVersions, newestRelease, parseChangelog, installHistory };
