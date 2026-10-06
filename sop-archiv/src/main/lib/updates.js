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
    .map((r) => ({ version: parseVersion(r.tag_name).join('.'), url: r.html_url, publishedAt: r.published_at || null, notes: String(r.body || '').slice(0, 1500) }));
  list.sort((a, b) => compareVersions(b.version, a.version));
  return list[0] || null;
}

module.exports = { TAG_PREFIX, parseVersion, compareVersions, newestRelease };
