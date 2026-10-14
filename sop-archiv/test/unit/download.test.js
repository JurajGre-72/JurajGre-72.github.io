'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const { downloadFile } = require('../../src/main/llm/download');

const data = crypto.randomBytes(3 * 1024 * 1024 + 123);
const sha = crypto.createHash('sha256').update(data).digest('hex');

function server() {
  const s = http.createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: `http://127.0.0.1:${s.address().port}/model.gguf` });
      return res.end();
    }
    if (req.url === '/elsewhere') {
      res.writeHead(302, { location: `http://localhost:${s.address().port}/model.gguf` });
      return res.end();
    }
    if (req.url !== '/model.gguf') {
      res.writeHead(404);
      return res.end();
    }
    const m = /bytes=(\d+)-/.exec(req.headers.range || '');
    s.ranges.push(req.headers.range || '');
    const from = m ? Number(m[1]) : 0;
    if (from >= data.length) {
      res.writeHead(416);
      return res.end();
    }
    res.writeHead(m ? 206 : 200, { 'content-length': data.length - from });
    // slowly, in pieces, so a download can be interrupted half-way
    let pos = from;
    const step = () => {
      if (pos >= data.length) return res.end();
      const next = Math.min(data.length, pos + 256 * 1024);
      const ok = res.write(data.subarray(pos, next));
      pos = next;
      if (ok) setTimeout(step, 25);
      else res.once('drain', () => setTimeout(step, 25));
    };
    step();
  });
  s.ranges = [];
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r(s)));
}

const only127 = (h) => h === '127.0.0.1';

test('model download: resumes after an interruption, verifies the fingerprint, only from the allowed host', async () => {
  const s = await server();
  const base = `http://127.0.0.1:${s.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-dl-'));
  const dest = path.join(dir, 'model.gguf');
  try {
    // cancelled before the server answered
    const early = new AbortController();
    early.abort();
    await assert.rejects(downloadFile({ url: `${base}/redirect`, dest, sha256: sha, size: data.length, fetchFn: fetch, allowHost: only127, signal: early.signal }), /MODEL_CANCELLED/);
    // interrupted half-way (after the first data arrived)
    const ctrl = new AbortController();
    await assert.rejects(
      downloadFile({ url: `${base}/redirect`, dest, sha256: sha, size: data.length, fetchFn: fetch, allowHost: only127, signal: ctrl.signal, onProgress: (p) => p.done > 0 && setTimeout(() => ctrl.abort(), 150) }),
      /MODEL_CANCELLED/
    );
    // resumed from a part on disk: only the rest is requested
    // (what was received but not yet written when it was cancelled is simply fetched again)
    const partial = 1024 * 1024 + 7;
    fs.writeFileSync(`${dest}.part`, data.subarray(0, partial));
    s.ranges.length = 0;
    // resumed from where it stopped
    const phases = new Set();
    const r = await downloadFile({ url: `${base}/redirect`, dest, sha256: sha, size: data.length, fetchFn: fetch, allowHost: only127, onProgress: (p) => phases.add(p.phase) });
    assert.equal(r.sha256, sha);
    assert.deepEqual(s.ranges.filter(Boolean), [`bytes=${partial}-`], 'only the missing part is requested');
    assert.ok(fs.readFileSync(dest).equals(data));
    assert.ok(!fs.existsSync(`${dest}.part`));
    assert.deepEqual([...phases].sort(), ['download', 'verify']);

    // a wrong fingerprint is refused and nothing is kept
    const bad = path.join(dir, 'bad.gguf');
    await assert.rejects(downloadFile({ url: `${base}/model.gguf`, dest: bad, sha256: 'a'.repeat(64), size: data.length, fetchFn: fetch, allowHost: only127 }), /MODEL_CHECKSUM/);
    assert.ok(!fs.existsSync(bad) && !fs.existsSync(`${bad}.part`));

    // redirected to a host that is not allowed
    await assert.rejects(downloadFile({ url: `${base}/elsewhere`, dest: path.join(dir, 'x.gguf'), sha256: sha, fetchFn: fetch, allowHost: only127 }), /MODEL_HOST/);
    // no fingerprint, no download
    await assert.rejects(downloadFile({ url: `${base}/model.gguf`, dest: path.join(dir, 'y.gguf'), sha256: '', fetchFn: fetch, allowHost: only127 }), /MODEL_NO_CHECKSUM/);
  } finally {
    s.close();
  }
});
