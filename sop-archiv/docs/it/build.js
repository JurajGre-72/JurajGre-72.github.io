'use strict';
// Builds the information sheet for IT (docs/it/*.docx) with the app's own Word writer and the company logo.
//   node docs/it/build.js

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { buildDocx } = require(path.join(ROOT, 'src/main/lib/docx'));
const { DOC } = require('./obsah');

async function logoPng() {
  const svg = fs.readFileSync(path.join(ROOT, 'src/renderer/brand/pharmacopola-logo.svg'), 'utf8');
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));
  const exe = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && fs.existsSync(p));
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 300 } });
    await page.setContent(`<html><body style="margin:0;background:#fff"><img id="l" style="width:900px;display:block" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`);
    return await (await page.$('#l')).screenshot({ type: 'png' });
  } finally {
    await browser.close();
  }
}

(async () => {
  const buf = await buildDocx({ lang: 'sk', logoPng: await logoPng(), doc: { ...DOC.doc, org: 'PHARMACOPOLA s.r.o.' }, sections: DOC.sections });
  fs.writeFileSync(path.join(__dirname, DOC.file), buf);
  console.log('written', path.join(__dirname, DOC.file));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
