'use strict';
// "Controlled copy" stamp on every page of a PDF: copy number, for whom, date – in a box at the top of
// the page, with full Slovak diacritics (Liberation Sans, shipped with PDF.js). The archived original is
// never changed; only the issued copy carries the stamp.

const fs = require('fs');
const path = require('path');

function fontPath(bold) {
  const dir = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts');
  return path.join(dir, bold ? 'LiberationSans-Bold.ttf' : 'LiberationSans-Regular.ttf');
}

/**
 * pdf: Buffer of the original; title: first line (e.g. "RIADENÁ KÓPIA č. 3"), lines: further lines;
 * tone: 'controlled' (green box) or 'uncontrolled' (grey). Returns the stamped PDF (Buffer).
 */
async function stampPdf(pdf, { title, lines = [], tone = 'controlled' }) {
  const { PDFDocument, rgb } = require('pdf-lib');
  const fontkit = require('@pdf-lib/fontkit');
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: false, updateMetadata: false });
  doc.registerFontkit(fontkit);
  const bold = await doc.embedFont(fs.readFileSync(fontPath(true)), { subset: true });
  const regular = await doc.embedFont(fs.readFileSync(fontPath(false)), { subset: true });
  const color = tone === 'controlled' ? rgb(0, 0.42, 0.36) : rgb(0.42, 0.42, 0.42);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.max(7, Math.min(9, width / 70));
    const textW = Math.max(bold.widthOfTextAtSize(title, size + 1), ...lines.map((l) => regular.widthOfTextAtSize(l, size)));
    const boxW = textW + 12;
    const boxH = (size + 1) * 1.35 + lines.length * size * 1.35 + 8;
    const x = width - boxW - 18;
    const y = height - boxH - 12;
    page.drawRectangle({ x, y, width: boxW, height: boxH, color: rgb(1, 1, 1), opacity: 0.88, borderColor: color, borderWidth: 1.2 });
    let ty = y + boxH - (size + 1) - 4;
    page.drawText(title, { x: x + 6, y: ty, size: size + 1, font: bold, color });
    for (const l of lines) {
      ty -= size * 1.35;
      page.drawText(l, { x: x + 6, y: ty, size, font: regular, color: rgb(0.1, 0.1, 0.1) });
    }
  }
  return Buffer.from(await doc.save());
}

module.exports = { stampPdf };
