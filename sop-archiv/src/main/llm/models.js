'use strict';
// Models the built-in AI can download. Each file is accepted only with exactly this size and SHA-256
// fingerprint. An entry without a fingerprint cannot be downloaded (a model file can still be chosen from
// this computer, e.g. copied from a USB stick).

const MODELS = [
  {
    id: 'gemma-4-e4b',
    name: 'Gemma 4 E4B',
    vendor: 'Google',
    license: 'Apache 2.0',
    url: '',
    file: '',
    size: 0,
    sha256: '',
    ramGB: 8, // works with
    goodRamGB: 16, // comfortable with
    contextSize: 16384,
    recommended: true,
    sk: 'Odporúčaný pre bežný notebook. Dobrá slovenčina, rýchle odpovede.',
    en: 'Recommended for a regular laptop. Good Slovak, quick answers.'
  },
  {
    id: 'gemma-4-26b-a4b',
    name: 'Gemma 4 26B A4B',
    vendor: 'Google',
    license: 'Apache 2.0',
    url: '',
    file: '',
    size: 0,
    sha256: '',
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
    url: '',
    file: '',
    size: 0,
    sha256: '',
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
