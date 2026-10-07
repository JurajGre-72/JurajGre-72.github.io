'use strict';
// Builds the Word files of the validation package and the SOP for using the app (docs/validacia/*.docx)
// with the app's own Word writer and the company logo.
//   node docs/validacia/build.js
// The logo (SVG) is turned into a PNG with the browser that comes with the tests (Playwright).

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { buildDocx } = require(path.join(ROOT, 'src/main/lib/docx'));
const appSop = require(path.join(ROOT, 'src/main/lib/appsop'));
const { DOCS } = require('./obsah');

async function logoPng() {
  const svg = fs.readFileSync(path.join(ROOT, 'src/renderer/brand/pharmacopola-logo.svg'), 'utf8');
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));
  const exe = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && fs.existsSync(p));
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 300 } });
    await page.setContent(`<html><body style="margin:0;background:#fff"><img id="l" style="width:900px;display:block" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`);
    const img = await page.$('#l');
    return await img.screenshot({ type: 'png' });
  } finally {
    await browser.close();
  }
}

(async () => {
  const logo = await logoPng();
  const out = __dirname;
  const org = 'PHARMACOPOLA s.r.o.';
  const sop = await buildDocx({ lang: 'sk', logoPng: logo, doc: { ...appSop.DOC, org, draft: true }, sections: appSop.SECTIONS });
  fs.writeFileSync(path.join(out, 'SOP-SA-01 Používanie aplikácie SOP Archív.docx'), sop);
  for (const d of DOCS) {
    const landscape = d.sections.some((s) => s.table && s.table.columns.length > 5);
    const buf = await buildDocx({ lang: 'sk', logoPng: logo, landscape, doc: { ...d.doc, org, draft: true }, sections: d.sections });
    fs.writeFileSync(path.join(out, d.file), buf);
  }
  console.log('written to', out);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
