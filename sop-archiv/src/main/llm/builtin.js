'use strict';
// The built-in AI as the app uses it: which models are on this computer, downloading or adding one,
// running a request, and a test that shows the speed and that the AI process cannot reach the network.
// Models are kept per computer (in the app's own folder), not in the archive.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { LocalModel } = require('./engine');
const { downloadFile } = require('./download');
const { MODELS, modelHost, recommendedFor } = require('./models');

const GGUF_MAGIC = Buffer.from('GGUF', 'latin1');

function isGguf(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(4);
    fs.readSync(fd, b, 0, 4, 0);
    fs.closeSync(fd);
    return b.equals(GGUF_MAGIC);
  } catch (_) {
    return false;
  }
}

class BuiltinAi {
  /**
   * dir: folder for model files; fetchFn: fetch for downloads; logNet(entry); onProgress({ id, phase, done, total })
   */
  constructor({ dir, fetchFn, logNet = () => {}, log = () => {}, onProgress = () => {}, catalog = MODELS, engine = null }) {
    this.dir = dir;
    this.fetchFn = fetchFn;
    this.logNet = logNet;
    this.onProgress = onProgress;
    this.catalog = catalog;
    this.engine = engine || new LocalModel({ log });
    this.download = null; // { id, ctrl, promise }
  }

  ramGB() {
    return Math.round(os.totalmem() / 1024 ** 3);
  }

  _fileFor(entry) {
    return entry.file ? path.join(this.dir, entry.file) : null;
  }

  /** Catalog + files on this computer. */
  list() {
    const files = fs.existsSync(this.dir) ? fs.readdirSync(this.dir).filter((f) => f.toLowerCase().endsWith('.gguf')) : [];
    const known = new Set();
    const out = this.catalog.map((m) => {
      const f = this._fileFor(m);
      if (m.file) known.add(m.file);
      const here = !!f && fs.existsSync(f);
      const part = f && fs.existsSync(`${f}.part`) ? fs.statSync(`${f}.part`).size : 0;
      return { id: m.id, name: m.name, vendor: m.vendor, license: m.license, size: m.size, ramGB: m.ramGB, goodRamGB: m.goodRamGB, sk: m.sk, en: m.en, downloadable: !!(m.url && m.sha256), here, file: m.file, partial: part, downloading: !!(this.download && this.download.id === m.id), recommended: !!m.recommended };
    });
    for (const f of files) {
      if (known.has(f)) continue;
      out.push({ id: `file:${f}`, name: f.replace(/\.gguf$/i, ''), file: f, here: true, custom: true, size: fs.statSync(path.join(this.dir, f)).size });
    }
    return { models: out, ramGB: this.ramGB(), recommended: recommendedFor(this.ramGB(), this.catalog), dir: this.dir };
  }

  /** Path of the model chosen in the settings ("<catalog id>" or "file:<name>"), if it is on this computer. */
  modelPath(choice) {
    if (!choice) return null;
    const entry = this.catalog.find((m) => m.id === choice);
    const f = entry ? this._fileFor(entry) : choice.startsWith('file:') ? path.join(this.dir, path.basename(choice.slice(5))) : null;
    return f && fs.existsSync(f) ? f : null;
  }

  modelName(choice) {
    const entry = this.catalog.find((m) => m.id === choice);
    return entry ? entry.name : String(choice || '').replace(/^file:/, '').replace(/\.gguf$/i, '');
  }

  async startDownload(id) {
    const m = this.catalog.find((x) => x.id === id);
    if (!m) throw new Error('Unknown model');
    if (!m.url || !m.sha256) throw new Error('MODEL_NO_CHECKSUM');
    if (this.download) throw new Error('MODEL_BUSY');
    fs.mkdirSync(this.dir, { recursive: true });
    const ctrl = new AbortController();
    this.logNet({ purpose: 'model', url: m.url });
    const promise = downloadFile({
      url: m.url,
      dest: this._fileFor(m),
      sha256: m.sha256,
      size: m.size,
      fetchFn: this.fetchFn,
      allowHost: modelHost,
      signal: ctrl.signal,
      onProgress: (p) => this.onProgress({ id, ...p })
    })
      .then((r) => {
        this.onProgress({ id, phase: 'done', done: r.size, total: r.size });
        return r;
      })
      .catch((e) => {
        this.onProgress({ id, phase: e.message === 'MODEL_CANCELLED' ? 'cancelled' : 'error', error: e.message });
        throw e;
      })
      .finally(() => {
        this.download = null;
      });
    this.download = { id, ctrl, promise };
    promise.catch(() => {});
    return { started: true };
  }

  cancelDownload() {
    if (this.download) this.download.ctrl.abort();
  }

  async remove(choice) {
    const f = this.modelPath(choice);
    const entry = this.catalog.find((m) => m.id === choice);
    if (this.engine.loaded && f && this.engine.loaded.modelPath === f) await this.engine.stop();
    if (f) fs.rmSync(f, { force: true });
    if (entry && entry.file) fs.rmSync(path.join(this.dir, `${entry.file}.part`), { force: true });
  }

  /** A model file from this computer (e.g. copied from a USB stick) is copied into the models folder. */
  async addFile(src) {
    if (!isGguf(src)) throw new Error('MODEL_NOT_GGUF');
    fs.mkdirSync(this.dir, { recursive: true });
    const name = path.basename(src).replace(/[^\w.() -]+/g, '_');
    const dest = path.join(this.dir, name.toLowerCase().endsWith('.gguf') ? name : `${name}.gguf`);
    if (path.resolve(src) !== path.resolve(dest)) await fs.promises.copyFile(src, dest);
    return { id: this.catalog.some((m) => m.file === path.basename(dest)) ? this.catalog.find((m) => m.file === path.basename(dest)).id : `file:${path.basename(dest)}` };
  }

  _settings(cfg) {
    const p = this.modelPath(cfg.model);
    if (!p) throw new Error('MODEL_MISSING');
    const entry = this.catalog.find((m) => m.id === cfg.model);
    return { modelPath: p, gpu: cfg.gpu === false ? false : 'auto', contextSize: Number(cfg.contextSize) || (entry && entry.contextSize) || 8192 };
  }

  /** Load the model now, so that its real context size is known before a request is put together. */
  async prepare(cfg) {
    return this.engine.load(this._settings(cfg));
  }

  /** Context (tokens) and characters per token of the loaded model, or estimates for the chosen one. */
  _ctx(cfg) {
    const p = this.modelPath(cfg.model);
    if (this.engine.loaded && p && this.engine.loaded.modelPath === p && this.engine.loaded.info) return { ctx: this.engine.loaded.info.contextSize, cpt: this.engine.loaded.info.charsPerToken || 3 };
    const entry = this.catalog.find((m) => m.id === cfg.model);
    return { ctx: Number(cfg.contextSize) || (entry && entry.contextSize) || 8192, cpt: 3 };
  }

  /** Text in, text out. onChunk(text) as it is written; signal stops it. */
  async complete(cfg, system, user, { onChunk, signal, maxTokens } = {}) {
    await this.engine.load(this._settings(cfg));
    const room = Math.max(64, Math.floor(this._ctx(cfg).ctx * 0.3));
    try {
      const r = await this.engine.complete({ system, user, onChunk, signal, maxTokens: Math.min(maxTokens || 3072, room), temperature: 0.2 });
      return { text: r.text, model: this.modelName(cfg.model), aborted: r.aborted };
    } catch (e) {
      if (/too long prompt|context size|context shift/i.test(e.message)) throw new Error('AI_PROMPT_TOO_LONG');
      throw e;
    }
  }

  /** Characters of documents and acts a request may carry: 60 % of the context, less the instructions; the rest is for the answer. */
  budget(cfg) {
    const { ctx, cpt } = this._ctx(cfg);
    return Math.max(500, Math.floor(ctx * 0.6 * cpt - 1700));
  }

  /** Load the model, write one sentence, report the speed and that the AI process has no network. */
  async test(cfg, lang = 'sk') {
    const t0 = Date.now();
    const info = await this.engine.load(this._settings(cfg));
    const loadMs = Date.now() - t0;
    const t1 = Date.now();
    const q = lang === 'en' ? 'In one sentence: why is temperature monitored during the storage of medicines?' : 'Jednou vetou: prečo sa pri skladovaní liekov sleduje teplota?';
    const r = await this.engine.complete({ user: q, maxTokens: 80, temperature: 0.2 });
    const genMs = Date.now() - t1;
    const network = await this.engine.probe();
    return { model: this.modelName(cfg.model), gpu: info.gpu, contextSize: info.contextSize, loadMs, genMs, text: r.text.trim(), networkBlocked: Object.values(network).every((v) => v === 'blocked'), network };
  }

  status() {
    return { ...this.engine.status(), downloading: this.download ? this.download.id : null };
  }

  async stop() {
    this.cancelDownload();
    await this.engine.stop();
  }
}

module.exports = { BuiltinAi, isGguf };
