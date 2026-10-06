'use strict';
// The built-in AI: a language model running in its own process on this computer (Electron utility
// process; a plain Node child process in the unit tests). It only turns text into text.
//
// Before anything else is loaded, this process loses the ability to reach the network or to start
// other programs: whatever the model or the engine did, company documents could not leave from here.

const BLOCKED = 'The AI process has no network access and cannot start programs';
const deny = () => {
  throw new Error(BLOCKED);
};

// --- No network ------------------------------------------------------------------
const net = require('net');
const tls = require('tls');
const dns = require('dns');
const http = require('http');
const https = require('https');
net.Socket.prototype.connect = deny;
net.connect = net.createConnection = deny;
tls.connect = deny;
http.request = http.get = https.request = https.get = deny;
dns.lookup = (_h, o, cb) => process.nextTick(() => (typeof o === 'function' ? o : cb)(new Error(BLOCKED)));
for (const k of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny']) if (dns.promises && dns.promises[k]) dns.promises[k] = async () => deny();
globalThis.fetch = async () => deny();
globalThis.WebSocket = class {
  constructor() {
    deny();
  }
};

// --- No other programs ---------------------------------------------------------------
// The engine checks a GPU binary in a separate process before loading it. That check is answered here
// (this process is already separate from the app: an incompatible binary can only stop this process, and
// the app then starts it again without the GPU).
const { EventEmitter } = require('events');
const cp = require('child_process');
function bindingCheck() {
  const p = new EventEmitter();
  p.pid = -1;
  p.exitCode = null;
  p.killed = false;
  p.stdout = null;
  p.stderr = null;
  const exit = (code) => {
    if (p.exitCode !== null) return;
    p.exitCode = code;
    setImmediate(() => p.emit('exit', code));
  };
  p.send = (m) => {
    if (m.type === 'start') setImmediate(() => p.emit('message', { type: 'loaded' }));
    else if (m.type === 'test') setImmediate(() => p.emit('message', { type: 'done' }));
    else if (m.type === 'exit') exit(0);
    return true;
  };
  p.kill = () => {
    p.killed = true;
    exit(0);
    return true;
  };
  setImmediate(() => p.emit('message', { type: 'ready' }));
  return p;
}
cp.fork = (modulePath) => {
  if (/testBindingBinary\.js$/.test(String(modulePath))) return bindingCheck();
  return deny();
};
cp.spawn = cp.spawnSync = cp.exec = cp.execSync = cp.execFile = cp.execFileSync = deny;
require('module').syncBuiltinESMExports(); // the engine imports these as ES modules

// --- Messages with the app ---------------------------------------------------------------------
const port = process.parentPort;
const send = (m) => (port ? port.postMessage(m) : process.send(m));
const onMessage = (fn) => (port ? port.on('message', (e) => fn(e.data)) : process.on('message', fn));

let llamaLib = null;
let llama = null;
let llamaGpu = null;
let model = null;
let context = null;
let chatWrapper = null; // the model's chat format, with "thinking" switched off
let sequence = null; // the context's one working slot, emptied before every request
let queue = Promise.resolve(); // requests run one after another
let loaded = null; // { modelPath, gpu, contextSize }
const running = new Map(); // request id -> AbortController

async function lib() {
  if (!llamaLib) llamaLib = await import('node-llama-cpp');
  return llamaLib;
}

async function unload() {
  for (const c of running.values()) c.abort();
  if (context) await context.dispose().catch(() => {});
  if (model) await model.dispose().catch(() => {});
  context = null;
  model = null;
  chatWrapper = null;
  sequence = null;
  loaded = null;
}

async function load({ modelPath, gpu = 'auto', contextSize = 8192, threads = 0 }) {
  if (loaded && loaded.modelPath === modelPath && loaded.gpu === gpu && loaded.contextSize === contextSize) return info();
  await unload();
  const L = await lib();
  // One engine per process: another GPU setting needs a new process (the app restarts it).
  if (llama && llamaGpu !== gpu) throw new Error('RESTART_NEEDED');
  if (!llama) {
    llama = await L.getLlama({ gpu, build: 'never', usePrebuiltBinaries: true, skipDownload: true, progressLogs: false, logLevel: L.LlamaLogLevel.error, ...(threads ? { maxThreads: threads } : {}) });
    llamaGpu = gpu;
  }
  model = await llama.loadModel({ modelPath });
  // As much context as fits in memory, up to the requested size (never more than the model was made for).
  const max = Math.max(256, Math.min(contextSize, model.trainContextSize || contextSize));
  context = await model.createContext({ contextSize: { min: Math.min(2048, max), max }, sequences: 1 });
  // Kept for the model's lifetime: a slot given back is freed only later, so taking a new one for
  // the next request (e.g. the next chapter of a draft) could fail with "No sequences left".
  sequence = context.getSequence();
  // Answers come straight away: a model that "thinks" first (Gemma 4 does by default) would spend the
  // answer's length – and minutes on an ordinary computer – on reasoning that is never shown.
  const wrapper = L.resolveChatWrapper(model);
  chatWrapper = L.Gemma4ChatWrapper && wrapper instanceof L.Gemma4ChatWrapper ? new L.Gemma4ChatWrapper({ reasoning: false }) : wrapper;
  // How many characters of a typical Slovak text fit in one token of this model (to size requests).
  const sample = SAMPLE.repeat(2);
  charsPerToken = Math.max(0.5, Math.min(6, sample.length / Math.max(1, model.tokenize(sample).length)));
  loaded = { modelPath, gpu, contextSize };
  return info();
}

const SAMPLE =
  'Lieky sa pri príjme kontrolujú podľa dodacieho listu; skontroluje sa neporušenosť obalov, šarža, dátum exspirácie a teplota počas prepravy. ' +
  'Termolabilné lieky sa uložia do chladiaceho zariadenia pri teplote 2 – 8 °C. Záznamy sa uchovávajú päť rokov podľa § 18 ods. 1 písm. l) zákona č. 362/2011 Z. z. ';
let charsPerToken = 3;

function info() {
  return {
    loaded: !!model,
    gpu: llama ? llama.gpu : null,
    contextSize: context ? context.contextSize : 0,
    charsPerToken,
    trainContextSize: model ? model.trainContextSize : 0,
    name: model && model.fileInfo && model.fileInfo.metadata && model.fileInfo.metadata.general ? model.fileInfo.metadata.general.name || '' : ''
  };
}

/** One request = one fresh conversation: nothing from an earlier request (or another user) is kept. */
async function run(id, args) {
  // Requests wait for each other; one cancelled while waiting does not run at all.
  const ctrl = new AbortController();
  ctrl.id = id;
  running.set(id, ctrl);
  const prev = queue;
  let release;
  queue = new Promise((r) => (release = r));
  try {
    await prev;
    if (ctrl.signal.aborted) return { text: '', aborted: true };
    return await runOne(ctrl, args);
  } finally {
    running.delete(id);
    release();
  }
}

async function runOne(ctrl, { system, user, maxTokens = 2048, temperature = 0.2 }) {
  if (!model || !context || !sequence) throw new Error('No model loaded');
  // The request and the answer must fit in the context: a clear message instead of a cut-off answer.
  const used = model.tokenize(system || '').length + model.tokenize(user || '').length + 48;
  if (used > context.contextSize - 64) throw new Error('AI_PROMPT_TOO_LONG');
  maxTokens = Math.max(32, Math.min(maxTokens, context.contextSize - used));
  const L = await lib();
  await sequence.clearHistory(); // the previous request leaves nothing behind
  const session = new L.LlamaChatSession({ contextSequence: sequence, systemPrompt: system || undefined, autoDisposeSequence: false, ...(chatWrapper ? { chatWrapper } : {}) });
  try {
    let buffered = '';
    let last = Date.now();
    const flush = () => {
      if (buffered) send({ t: 'chunk', id: ctrl.id, text: buffered });
      buffered = '';
      last = Date.now();
    };
    const text = await session.prompt(user, {
      maxTokens,
      temperature,
      signal: ctrl.signal,
      stopOnAbortSignal: true,
      budgets: { thoughtTokens: 0 }, // other reasoning models too
      onTextChunk: (chunk) => {
        buffered += chunk;
        if (Date.now() - last > 120) flush();
      }
    });
    flush();
    return { text, aborted: ctrl.signal.aborted };
  } finally {
    session.dispose({ disposeSequence: false });
  }
}

/** Proof that this process cannot reach the network (shown in Settings and checked by the tests). */
async function probe() {
  const tries = {
    fetch: () => fetch('https://example.com/'),
    socket: () => new Promise((resolve, reject) => {
      try {
        net.connect(443, '93.184.215.14').on('error', reject).on('connect', resolve);
      } catch (e) {
        reject(e);
      }
    }),
    dns: () => dns.promises.lookup('example.com'),
    program: () => Promise.resolve().then(() => cp.spawn('curl', ['https://example.com/']))
  };
  const out = {};
  for (const [k, fn] of Object.entries(tries)) {
    try {
      await fn();
      out[k] = 'open';
    } catch (e) {
      out[k] = String(e.message || e).includes(BLOCKED) ? 'blocked' : `error: ${e.message}`;
    }
  }
  return out;
}

onMessage(async (m) => {
  const reply = (data) => send({ t: 'ok', id: m.id, ...data });
  const fail = (e) => send({ t: 'err', id: m.id, message: String((e && e.message) || e) });
  try {
    if (m.t === 'load') reply(await load(m));
    else if (m.t === 'run') reply(await run(m.id, m));
    else if (m.t === 'abort') {
      const c = running.get(m.target);
      if (c) c.abort();
      reply({});
    } else if (m.t === 'unload') {
      await unload();
      reply({});
    } else if (m.t === 'info') reply(info());
    else if (m.t === 'probe') reply({ network: await probe() });
    else fail(new Error(`Unknown request ${m.t}`));
  } catch (e) {
    fail(e);
  }
});

send({ t: 'ready' });
