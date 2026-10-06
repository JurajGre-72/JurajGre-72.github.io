'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, newestRelease } = require('../../src/main/lib/updates');

test('version numbers compare numerically', () => {
  assert.ok(compareVersions('1.10.0', '1.9.3') > 0);
  assert.ok(compareVersions('sop-archiv-v1.0.1', '1.0.0') > 0);
  assert.equal(compareVersions('1.2.0', '1.2.0'), 0);
});

test('the newest published SOP Archív release is found; drafts, pre-releases and other tags are ignored', () => {
  const r = newestRelease([
    { tag_name: 'sop-archiv-v1.2.0', html_url: 'https://github.com/x/y/releases/tag/sop-archiv-v1.2.0', published_at: '2027-01-10T10:00:00Z' },
    { tag_name: 'sop-archiv-v1.10.0', html_url: 'u2', draft: true },
    { tag_name: 'sop-archiv-v1.3.0-beta', html_url: 'u3', prerelease: true },
    { tag_name: 'website-v9.0.0', html_url: 'u4' },
    { tag_name: 'sop-archiv-v1.1.5', html_url: 'u5' }
  ]);
  assert.equal(r.version, '1.2.0');
  assert.equal(r.url, 'https://github.com/x/y/releases/tag/sop-archiv-v1.2.0');
  assert.equal(newestRelease([]), null);
  assert.equal(newestRelease({ message: 'Not Found' }), null);
});
