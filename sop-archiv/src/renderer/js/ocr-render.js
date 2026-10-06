// Draws pages of a PDF as PNG images for text recognition. Runs in a hidden window of the app;
// the main process calls these functions with executeJavaScript. Everything stays on this computer.
import * as pdfjs from '../vendor/pdfjs/pdf.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;
let doc = null;

window.ocrOpen = async (base64) => {
  if (doc) await doc.destroy();
  const bin = atob(base64);
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  doc = await pdfjs.getDocument({ data, isEvalSupported: false, wasmUrl: new URL('../vendor/pdfjs-wasm/', import.meta.url).href, verbosity: 0 }).promise;
  return doc.numPages;
};

// About 220 dpi for an A4 page, capped so very large pages stay manageable.
window.ocrRender = async (n) => {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, 4200 / Math.max(base.width, base.height));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  return canvas.toDataURL('image/png');
};

window.ocrClose = async () => {
  if (doc) await doc.destroy();
  doc = null;
};
window.ocrReady = true;
