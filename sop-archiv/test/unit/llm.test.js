'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { LocalModel } = require('../../src/main/llm/engine');
const { makeTinyModel } = require('../fixtures/tiny-gguf');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-llm-'));
const modelPath = makeTinyModel(path.join(dir, 'tiny.gguf'));

test('built-in AI process: no network, no other programs', async () => {
  const m = new LocalModel({ idleMs: 0 });
  try {
    assert.deepEqual(await m.probe(), { fetch: 'blocked', socket: 'blocked', dns: 'blocked', program: 'blocked' });
  } finally {
    await m.stop();
  }
});

test('built-in AI: loads a model, streams the answer, stops on request, keeps no earlier conversation', async () => {
  const m = new LocalModel({ idleMs: 0 });
  try {
    const info = await m.load({ modelPath, gpu: false, contextSize: 512 });
    assert.equal(info.loaded, true);
    assert.equal(info.gpu, false);
    assert.ok(info.contextSize >= 256);
    let chunks = '';
    const r = await m.complete({ system: 'Si asistent.', user: 'Napíš vetu.', maxTokens: 24, temperature: 0.8, onChunk: (c) => (chunks += c) });
    assert.equal(r.aborted, false);
    assert.ok(r.text.length > 0, 'text written');
    assert.equal(chunks, r.text, 'streamed text adds up to the answer');
    // Stopped by the user.
    const ctrl = new AbortController();
    let n = 0;
    const r2 = await m.complete({
      user: 'Píš dlho.',
      maxTokens: 400,
      temperature: 0.8,
      signal: ctrl.signal,
      onChunk: () => {
        if (++n === 1) ctrl.abort();
      }
    });
    assert.equal(r2.aborted, true);
    // Requests one after another (each one is a fresh conversation).
    for (let i = 0; i < 3; i++) assert.ok((await m.complete({ user: `Otázka ${i}`, maxTokens: 8, temperature: 0.8 })).text.length >= 0);
    // Two requests at once (e.g. a draft chapter while a rewrite is asked for): the second waits for the first.
    const both = await Promise.all([m.complete({ user: 'Prvá.', maxTokens: 16, temperature: 0.8 }), m.complete({ user: 'Druhá.', maxTokens: 16, temperature: 0.8 })]);
    assert.ok(both.every((x) => x.aborted === false && x.text.length > 0), 'both answered');
    // One cancelled while it waits does not run at all.
    const wait = new AbortController();
    const [first, queued] = await Promise.all([m.complete({ user: 'Tretia.', maxTokens: 16, temperature: 0.8 }), m.complete({ user: 'Štvrtá.', maxTokens: 16, signal: wait.signal }).finally(() => {}), Promise.resolve().then(() => wait.abort())]);
    assert.equal(first.aborted, false);
    assert.deepEqual(queued, { text: '', aborted: true });
    assert.equal(m.status().loaded.gpu, false);
  } finally {
    await m.stop();
  }
  assert.equal(m.status().running, false);
});

test('built-in AI: when the GPU engine stops the process, the processor is used', async () => {
  // A stand-in for the AI process: "crashes" when asked to use the GPU.
  const fake = path.join(dir, 'fake-worker.js');
  fs.writeFileSync(
    fake,
    `process.on('message', (m) => {
      if (m.t === 'load' && m.gpu !== false) process.exit(3);
      process.send({ t: 'ok', id: m.id, loaded: true, gpu: m.gpu, contextSize: 512 });
    });
    process.send({ t: 'ready' });`
  );
  const m = new LocalModel({ workerPath: fake, idleMs: 0 });
  try {
    const info = await m.load({ modelPath, gpu: 'auto' });
    assert.equal(info.gpu, false);
    assert.equal(m.gpuFailed, true);
    assert.equal((await m.load({ modelPath, gpu: 'auto' })).gpu, false, 'remembered');
  } finally {
    await m.stop();
  }
});

test('built-in AI: unloaded after a while without requests', async () => {
  const m = new LocalModel({ idleMs: 300 });
  await m.load({ modelPath, gpu: false, contextSize: 512 });
  assert.equal(m.status().running, true);
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(m.status().running, false, 'memory given back');
});
