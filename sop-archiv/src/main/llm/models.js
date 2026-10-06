'use strict';
// Models the built-in AI can download: Google's own quantised (QAT, 4-bit) Gemma 4 files from Hugging Face,
// pinned to a fixed revision. Each file is accepted only with exactly this size and SHA-256
// fingerprint. An entry without a fingerprint cannot be downloaded (a model file can still be chosen from
// this computer, e.g. copied from a USB stick).

const MODELS = [
  {
    id: 'gemma-4-e4b',
    name: 'Gemma 4 E4B',
    vendor: 'Google',
    license: 'Apache 2.0',
    url: 'https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf/resolve/4b4a2c1d584be7264f87aac328a1bc739ce81b6c/gemma-4-E4B_q4_0-it.gguf',
    file: 'gemma-4-E4B_q4_0-it.gguf',
    size: 5154941280,
    sha256: '676c35070db6dbe52f93e9c864ee0fba4eddea94b9c875d9cb10daff453fbaee',
    ramGB: 8, // works with
    goodRamGB: 16, // comfortable with
    contextSize: 16384,
    recommended: true,
    sk: 'Odporúčaný pre bežný notebook. Dobrá slovenčina, rýchle odpovede.',
    en: 'Recommended for a regular laptop. Good Slovak, quick answers.'
  },
  {
    id: 'gemma-4-12b',
    name: 'Gemma 4 12B',
    vendor: 'Google',
    license: 'Apache 2.0',
    url: 'https://huggingface.co/google/gemma-4-12B-it-qat-q4_0-gguf/resolve/29d097773436b69ff9feafd636ab4cf873786537/gemma-4-12b-it-qat-q4_0.gguf',
    file: 'gemma-4-12b-it-qat-q4_0.gguf',
    size: 6975879296,
    sha256: '93567e57a8fe10b23569b9d9ec38cd005deedf71e29477c421a4b83f418a538b',
    ramGB: 16,
    goodRamGB: 24,
    contextSize: 16384,
    sk: 'Lepšie texty ako E4B, ale pomalší – pre počítače s 24 GB pamäte.',
    en: 'Better texts than E4B but slower – for computers with 24 GB of memory.'
  },
  {
    id: 'gemma-4-26b-a4b',
    name: 'Gemma 4 26B A4B',
    vendor: 'Google',
    license: 'Apache 2.0',
    url: 'https://huggingface.co/google/gemma-4-26B-A4B-it-qat-q4_0-gguf/resolve/d1c082be9cf3c8a514acf63b8761f4b41935842e/gemma-4-26B_q4_0-it.gguf',
    file: 'gemma-4-26B_q4_0-it.gguf',
    size: 14439363584,
    sha256: '3eca3b8f6d7baf218a7dd6bba5fb59a56ee25fe2d567b6f5f589b4f697eca51d',
    ramGB: 24,
    goodRamGB: 32,
    contextSize: 16384,
    sk: 'Presnejšie texty, potrebuje výkonnejší počítač (32 GB pamäte).',
    en: 'More accurate texts, needs a more powerful computer (32 GB of memory).'
  },
  {
    id: 'gemma-4-e2b',
    name: 'Gemma 4 E2B',
    vendor: 'Google',
    license: 'Apache 2.0',
    url: 'https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf/resolve/675cff42a74c774d6cb76f76d8eacb49b48c9b93/gemma-4-E2B_q4_0-it.gguf',
    file: 'gemma-4-E2B_q4_0-it.gguf',
    size: 3349516256,
    sha256: 'fa401b55b07ee70a54c6dae3903c783a6e65064312529ea57175cb5f8dec6634',
    ramGB: 6,
    goodRamGB: 8,
    contextSize: 8192,
    sk: 'Najmenší – pre staršie počítače. Kratšie a jednoduchšie texty.',
    en: 'Smallest – for older computers. Shorter and simpler texts.'
  }
];

/** Hosts a model may come from (the download address and the servers it redirects to). */
function modelHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === 'huggingface.co' || h.endsWith('.huggingface.co') || h.endsWith('.hf.co');
}

/** The model that suits a computer with this much memory (GB). */
function recommendedFor(ramGB, list = MODELS) {
  const fits = list.filter((m) => ramGB >= m.goodRamGB).sort((a, b) => b.goodRamGB - a.goodRamGB);
  const rec = list.find((m) => m.recommended);
  if (rec && ramGB >= rec.goodRamGB) return rec.id;
  return (fits[0] || list.slice().sort((a, b) => a.ramGB - b.ramGB)[0]).id;
}

module.exports = { MODELS, modelHost, recommendedFor };
