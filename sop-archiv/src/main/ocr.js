'use strict';
// Text recognition (OCR) for scanned PDFs, entirely on this computer:
// a hidden window draws each page as an image (PDF.js), Tesseract reads the text (Slovak + English).
// The language data comes with the app; nothing is downloaded and nothing leaves the computer.

const fs = require('fs');
const path = require('path');

const MIN_CHARS = 25; // a page with less text than this is treated as a scan

/** Pages (1-based numbers) of an extracted PDF that have (almost) no text layer. */
function pagesWithoutText(pages) {
  return (pages || []).filter((p) => p.page && (p.text || '').replace(/\s+/g, '').length < MIN_CHARS).map((p) => p.page);
}

const LANGS = ['slk', 'eng'];

/**
 * Typical OCR confusions in Slovak regulatory text: "§" read as "$" ("$ 18 zákona"), "§§" as "$$",
 * and ranges written with a long dash ("2 — 8 °C").
 */
function fixOcrText(text) {
  return String(text || '')
    .replace(/\$\$\s*(?=\d)/g, '§§ ')
    .replace(/(^|[\s(„"'])\$\s*(?=\d)/gm, '$1§ ')
    .replace(/(\d)\s*[—―]\s*(\d)/g, '$1 – $2');
}

/** The language data that comes with the app, copied once into one local folder (Tesseract reads it from there). */
function prepareLanguageData(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const code of LANGS) {
    const src = require.resolve(`@tesseract.js-data/${code}/4.0.0_best_int/${code}.traineddata.gz`);
    const dest = path.join(dir, `${code}.traineddata.gz`);
    if (!fs.existsSync(dest) || fs.statSync(dest).size !== fs.statSync(src).size) fs.copyFileSync(src, dest);
  }
  return dir;
}

function createOcr({ dataDir, log = () => {} } = {}) {
  const { BrowserWindow } = require('electron');
  let worker = null;
  let win = null;

  async function recognizer() {
    if (worker) return worker;
    const { createWorker, OEM } = require('tesseract.js');
    // A local folder as the language path and no cache: Tesseract never downloads anything.
    const langPath = prepareLanguageData(dataDir);
    worker = await createWorker(LANGS.join('+'), OEM.LSTM_ONLY, { langPath, gzip: true, cacheMethod: 'none', logger: () => {}, errorHandler: (e) => log(String(e)) });
    return worker;
  }

  async function renderer() {
    if (win && !win.isDestroyed()) return win;
    win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await win.loadURL('app://app/ocr.html');
    for (let i = 0; i < 100; i++) {
      if (await win.webContents.executeJavaScript('window.ocrReady === true').catch(() => false)) return win;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('OCR page did not start');
  }

  /**
   * Recognise the text of the given pages of a PDF file. onPage({ page, done, total }) after each page.
   * Returns [{ page, text }].
   */
  async function readPdf(filePath, pageNumbers, onPage = () => {}) {
    const w = await renderer();
    const tess = await recognizer();
    const b64 = (await fs.promises.readFile(filePath)).toString('base64');
    const count = await w.webContents.executeJavaScript(`window.ocrOpen(${JSON.stringify(b64)})`);
    const wanted = (pageNumbers && pageNumbers.length ? pageNumbers : Array.from({ length: count }, (_, i) => i + 1)).filter((n) => n >= 1 && n <= count);
    const out = [];
    try {
      for (let i = 0; i < wanted.length; i++) {
        const n = wanted[i];
        const dataUrl = await w.webContents.executeJavaScript(`window.ocrRender(${n})`);
        const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
        const { data } = await tess.recognize(png);
        out.push({ page: n, text: fixOcrText(data.text).trim() });
        onPage({ page: n, done: i + 1, total: wanted.length });
      }
    } finally {
      await w.webContents.executeJavaScript('window.ocrClose()').catch(() => {});
    }
    return out;
  }

  async function close() {
    if (worker) await worker.terminate().catch(() => {});
    worker = null;
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
  }

  return { readPdf, close };
}

module.exports = { createOcr, pagesWithoutText, fixOcrText, MIN_CHARS };
