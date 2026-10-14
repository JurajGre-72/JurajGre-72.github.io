'use strict';
// Download of a model file for the built-in AI: only from the model's known address, resumable, and
// accepted only when its SHA-256 fingerprint is exactly the expected one. Nothing is sent but the request
// for the file itself.

const fs = require('fs');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

async function sha256File(file, onProgress) {
  const h = crypto.createHash('sha256');
  const size = fs.statSync(file).size;
  let done = 0;
  await pipeline(fs.createReadStream(file, { highWaterMark: 4 * 1024 * 1024 }), async function* (src) {
    for await (const chunk of src) {
      h.update(chunk);
      done += chunk.length;
      if (onProgress) onProgress(done, size);
      yield* [];
    }
  });
  return h.digest('hex');
}

/**
 * fetchFn: (url, init) => Response (Electron's session.fetch in the app, global fetch in the tests)
 * allowHost: (hostname) => boolean – the address the file finally comes from must be allowed
 * onProgress({ phase: 'download' | 'verify', done, total })
 */
async function downloadFile(opts) {
  try {
    return await download(opts);
  } catch (e) {
    // Cancelled at any moment (waiting for the server, receiving, verifying): one clear message.
    if (opts.signal && opts.signal.aborted) throw new Error('MODEL_CANCELLED');
    throw e;
  }
}

async function download({ url, dest, sha256, size = 0, fetchFn, allowHost, onProgress = () => {}, signal }) {
  if (!sha256 || !/^[0-9a-f]{64}$/.test(sha256)) throw new Error('MODEL_NO_CHECKSUM');
  const part = `${dest}.part`;
  let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  if (size && have > size) {
    fs.rmSync(part, { force: true });
    have = 0;
  }
  if (!size || have < size) {
    const res = await fetchFn(url, { headers: have ? { range: `bytes=${have}-` } : {}, signal, redirect: 'follow' });
    let host = '';
    try {
      host = new URL(res.url || url).hostname;
    } catch (_) {
      /* checked below */
    }
    if (!allowHost(host)) {
      if (res.body) await res.body.cancel().catch(() => {});
      throw new Error('MODEL_HOST');
    }
    if (res.status === 416 && have) {
      // already complete on disk
    } else if (!(res.status === 200 || res.status === 206)) {
      if (res.body) await res.body.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status}`);
    } else {
      if (res.status === 200 && have) have = 0; // the server sends the whole file again
      const len = Number(res.headers.get('content-length') || 0);
      const total = size || (len ? have + len : 0);
      const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
      let done = have;
      let last = 0;
      await pipeline(
        Readable.fromWeb(res.body),
        async function* (src) {
          for await (const chunk of src) {
            done += chunk.length;
            const now = Date.now();
            if (now - last > 250) {
              last = now;
              onProgress({ phase: 'download', done, total });
            }
            yield chunk;
          }
        },
        out,
        { signal }
      );
      onProgress({ phase: 'download', done, total });
    }
  }
  if (size && fs.statSync(part).size !== size) throw new Error('MODEL_INCOMPLETE');
  const digest = await sha256File(part, (done, total) => onProgress({ phase: 'verify', done, total }));
  if (digest !== sha256) {
    fs.rmSync(part, { force: true });
    throw new Error('MODEL_CHECKSUM');
  }
  fs.renameSync(part, dest);
  return { file: dest, size: fs.statSync(dest).size, sha256: digest };
}

module.exports = { downloadFile, sha256File };
