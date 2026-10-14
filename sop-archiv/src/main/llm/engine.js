'use strict';
// Runs the built-in AI (llm/worker.js) in a separate process and talks to it.
//
// The model stays loaded while it is used and is unloaded after a while without requests, so the memory
// it takes is given back. If the process stops (e.g. the graphics card's driver cannot run the engine),
// the next start uses the processor only.

const path = require('path');

const WORKER = path.join(__dirname, 'worker.js');
const IDLE_MS = 10 * 60 * 1000;

class LocalModel {
  constructor({ workerPath = WORKER, log = () => {}, idleMs = IDLE_MS } = {}) {
    this.workerPath = workerPath;
    this.log = log;
    this.idleMs = idleMs;
    this.proc = null;
    this.ready = null;
    this.pending = new Map();
    this.seq = 0;
    this.loaded = null; // { modelPath, gpu, contextSize, info }
    this.gpuFailed = false; // the GPU engine stopped the process once: use the processor from now on
    this.idleTimer = null;
    this.busy = 0;
  }

  _spawn() {
    let child;
    const electron = process.versions.electron ? require('electron') : null;
    if (electron && electron.utilityProcess) {
      child = electron.utilityProcess.fork(this.workerPath, [], { serviceName: 'SOP Archiv AI', stdio: 'ignore' });
      child.send = (m) => child.postMessage(m);
    } else {
      child = require('child_process').fork(this.workerPath, [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      if (child.stderr) child.stderr.on('data', (d) => this.log(String(d).trim()));
    }
    this.proc = child;
    this.ready = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('AI_START_TIMEOUT')), 30000);
      child.once('message', (m) => {
        clearTimeout(t);
        if (m && m.t === 'ready') resolve();
        else reject(new Error('AI_START_FAILED'));
      });
    });
    child.on('message', (m) => this._onMessage(m));
    child.on('exit', (code) => {
      if (this.proc !== child) return;
      this.proc = null;
      this.ready = null;
      const wasLoaded = this.loaded;
      this.loaded = null;
      const err = new Error(code ? 'AI_CRASHED' : 'AI_STOPPED');
      err.exitCode = code;
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      if (code && wasLoaded && wasLoaded.gpu !== false) this.gpuFailed = true;
      if (code) this.log(`AI process stopped (exit code ${code})`);
    });
    return this.ready;
  }

  async _ensure() {
    if (!this.proc) await this._spawn();
    else await this.ready;
  }

  _onMessage(m) {
    if (!m || !m.id) return;
    const p = this.pending.get(m.id);
    if (!p) return;
    if (m.t === 'chunk') {
      if (p.onChunk) p.onChunk(m.text);
      return;
    }
    this.pending.delete(m.id);
    if (m.t === 'ok') p.resolve(m);
    else {
      const e = new Error(m.message);
      p.reject(e);
    }
  }

  _call(t, payload = {}, { onChunk } = {}) {
    const id = `r${++this.seq}`;
    return {
      id,
      promise: new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject, onChunk });
        try {
          this.proc.send({ ...payload, t, id });
        } catch (e) {
          this.pending.delete(id);
          reject(e);
        }
      })
    };
  }

  _touch() {
    clearTimeout(this.idleTimer);
    if (this.idleMs > 0) {
      this.idleTimer = setTimeout(() => {
        if (!this.busy) this.stop().catch(() => {});
      }, this.idleMs);
      if (this.idleTimer.unref) this.idleTimer.unref();
    }
  }

  /** Load a model (GGUF file). gpu: 'auto' or false. Falls back to the processor when the GPU engine fails. */
  async load({ modelPath, gpu = 'auto', contextSize = 8192 }) {
    const want = this.gpuFailed ? false : gpu;
    if (this.loaded && this.loaded.modelPath === modelPath && this.loaded.gpu === want && this.loaded.contextSize === contextSize && this.proc) return this.loaded.info;
    try {
      await this._ensure();
      const r = await this._call('load', { modelPath, gpu: want, contextSize }).promise;
      this.loaded = { modelPath, gpu: want, contextSize, info: r };
      this._touch();
      return r;
    } catch (e) {
      if (e.message === 'RESTART_NEEDED' || (e.message === 'AI_CRASHED' && want !== false)) {
        await this.stop();
        if (e.message === 'AI_CRASHED') this.gpuFailed = true;
        return this.load({ modelPath, gpu: e.message === 'AI_CRASHED' ? false : gpu, contextSize });
      }
      throw e;
    }
  }

  /**
   * Write an answer. onChunk(text) receives the text as it is written; signal (AbortSignal) stops it.
   * Returns { text, aborted }.
   */
  async complete({ system, user, maxTokens = 2048, temperature = 0.2, onChunk, signal } = {}) {
    if (!this.loaded) throw new Error('AI_NOT_LOADED');
    this.busy++;
    clearTimeout(this.idleTimer);
    try {
      const call = this._call('run', { system, user, maxTokens, temperature }, { onChunk });
      const onAbort = () => this.proc && this.proc.send({ t: 'abort', id: `a${++this.seq}`, target: call.id });
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
      try {
        const r = await call.promise;
        return { text: r.text, aborted: !!r.aborted };
      } finally {
        if (signal) signal.removeEventListener('abort', onAbort);
      }
    } finally {
      this.busy--;
      this._touch();
    }
  }

  /** What the AI process can reach: { fetch, socket, dns, program } -> 'blocked' | 'open' | 'error: …'. */
  async probe() {
    await this._ensure();
    const r = await this._call('probe').promise;
    this._touch();
    return r.network;
  }

  status() {
    return { running: !!this.proc, loaded: this.loaded ? { modelPath: this.loaded.modelPath, gpu: this.loaded.info.gpu, contextSize: this.loaded.info.contextSize } : null, gpuFailed: this.gpuFailed, busy: this.busy };
  }

  async stop() {
    clearTimeout(this.idleTimer);
    const p = this.proc;
    if (!p) return;
    this.proc = null;
    this.ready = null;
    this.loaded = null;
    const err = new Error('AI_STOPPED');
    for (const x of this.pending.values()) x.reject(err);
    this.pending.clear();
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 3000);
      p.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
      p.kill();
    });
  }
}

module.exports = { LocalModel };
