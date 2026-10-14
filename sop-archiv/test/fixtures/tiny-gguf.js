'use strict';
// A tiny language model file (GGUF, llama architecture, random weights) for testing the built-in AI
// engine without downloading a real model. It writes nonsense, but it loads, tokenizes, streams text,
// stops and can be aborted exactly like a real model.

const fs = require('fs');

const T = { UINT32: 4, INT32: 5, FLOAT32: 6, STRING: 8, ARRAY: 9, UINT64: 10 };
const ALIGN = 32;

class Writer {
  constructor() {
    this.parts = [];
    this.size = 0;
  }
  push(buf) {
    this.parts.push(buf);
    this.size += buf.length;
  }
  u32(v) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v);
    this.push(b);
  }
  i32(v) {
    const b = Buffer.alloc(4);
    b.writeInt32LE(v);
    this.push(b);
  }
  u64(v) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(v));
    this.push(b);
  }
  f32(v) {
    const b = Buffer.alloc(4);
    b.writeFloatLE(v);
    this.push(b);
  }
  str(s) {
    const b = Buffer.from(s, 'utf8');
    this.u64(b.length);
    this.push(b);
  }
  kv(key, type, value) {
    this.str(key);
    this.u32(type);
    this.value(type, value);
  }
  value(type, v) {
    if (type === T.UINT32) this.u32(v);
    else if (type === T.INT32) this.i32(v);
    else if (type === T.FLOAT32) this.f32(v);
    else if (type === T.STRING) this.str(v);
    else if (type === T.UINT64) this.u64(v);
    else if (type === T.ARRAY) {
      this.u32(v.type);
      this.u64(v.items.length);
      for (const x of v.items) this.value(v.type, x);
    } else throw new Error(`type ${type}`);
  }
  pad() {
    const n = (ALIGN - (this.size % ALIGN)) % ALIGN;
    if (n) this.push(Buffer.alloc(n));
  }
}

function makeTinyModel(file, { embd = 64, ff = 128, heads = 4, ctx = 16384, seed = 7 } = {}) {
  // Vocabulary: unknown/begin/end, the 256 bytes (fallback for any text), and the printable ASCII characters.
  const tokens = ['<unk>', '<s>', '</s>'];
  const types = [2, 3, 3];
  for (let i = 0; i < 256; i++) {
    tokens.push(`<0x${i.toString(16).toUpperCase().padStart(2, '0')}>`);
    types.push(6);
  }
  tokens.push('▁');
  types.push(1);
  for (let c = 33; c < 127; c++) {
    tokens.push(String.fromCharCode(c));
    types.push(1);
  }
  const vocab = tokens.length;
  const scores = tokens.map((_, i) => -i);

  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 4294967296 - 0.5) * 0.2;
  };
  const tensors = [];
  const add = (name, dims, fill) => {
    const n = dims.reduce((a, b) => a * b, 1);
    const data = Buffer.alloc(n * 4);
    for (let i = 0; i < n; i++) data.writeFloatLE(fill === 1 ? 1 : rand(), i * 4);
    tensors.push({ name, dims, data });
  };
  add('token_embd.weight', [embd, vocab]);
  add('output_norm.weight', [embd], 1);
  add('output.weight', [embd, vocab]);
  add('blk.0.attn_norm.weight', [embd], 1);
  add('blk.0.attn_q.weight', [embd, embd]);
  add('blk.0.attn_k.weight', [embd, embd]);
  add('blk.0.attn_v.weight', [embd, embd]);
  add('blk.0.attn_output.weight', [embd, embd]);
  add('blk.0.ffn_norm.weight', [embd], 1);
  add('blk.0.ffn_gate.weight', [embd, ff]);
  add('blk.0.ffn_up.weight', [embd, ff]);
  add('blk.0.ffn_down.weight', [ff, embd]);

  const meta = [
    ['general.architecture', T.STRING, 'llama'],
    ['general.name', T.STRING, 'tiny-test-model'],
    ['general.file_type', T.UINT32, 0],
    ['llama.context_length', T.UINT32, ctx],
    ['llama.embedding_length', T.UINT32, embd],
    ['llama.block_count', T.UINT32, 1],
    ['llama.feed_forward_length', T.UINT32, ff],
    ['llama.attention.head_count', T.UINT32, heads],
    ['llama.attention.head_count_kv', T.UINT32, heads],
    ['llama.attention.layer_norm_rms_epsilon', T.FLOAT32, 1e-5],
    ['llama.rope.dimension_count', T.UINT32, embd / heads],
    ['tokenizer.ggml.model', T.STRING, 'llama'],
    ['tokenizer.ggml.tokens', T.ARRAY, { type: T.STRING, items: tokens }],
    ['tokenizer.ggml.scores', T.ARRAY, { type: T.FLOAT32, items: scores }],
    ['tokenizer.ggml.token_type', T.ARRAY, { type: T.INT32, items: types }],
    ['tokenizer.ggml.unknown_token_id', T.UINT32, 0],
    ['tokenizer.ggml.bos_token_id', T.UINT32, 1],
    ['tokenizer.ggml.eos_token_id', T.UINT32, 2]
  ];

  const w = new Writer();
  w.push(Buffer.from('GGUF', 'latin1'));
  w.u32(3);
  w.u64(tensors.length);
  w.u64(meta.length);
  for (const [k, type, v] of meta) w.kv(k, type, v);
  let offset = 0;
  for (const t of tensors) {
    w.str(t.name);
    w.u32(t.dims.length);
    for (const d of t.dims) w.u64(d);
    w.u32(0); // F32
    w.u64(offset);
    offset += Math.ceil(t.data.length / ALIGN) * ALIGN;
  }
  w.pad();
  for (const t of tensors) {
    w.push(t.data);
    w.pad();
  }
  fs.writeFileSync(file, Buffer.concat(w.parts));
  return file;
}

module.exports = { makeTinyModel };
