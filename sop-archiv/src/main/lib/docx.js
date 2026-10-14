'use strict';
// A controlled document as a Word file (.docx), written directly (WordprocessingML in a ZIP):
// company header with the logo, document code, version and page numbers, a title block with the
// "prepared / reviewed / approved" table, then the numbered sections. Places to complete are
// highlighted ("[DOPLNIŤ: …]"), so they are easy to find in Word.

const JSZip = require('jszip');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

const PLACEHOLDER = /(\[(?:DOPLNIŤ|DOPLNIT|COMPLETE|OVERIŤ|OVERIT|VERIFY)[^\]]*\])/i;

/** Runs of one paragraph: **bold** and placeholders highlighted. */
function runs(text, { bold = false, size = 0, color = '' } = {}) {
  const out = [];
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  for (const p of parts) {
    if (!p) continue;
    const isBold = bold || /^\*\*[^*]+\*\*$/.test(p);
    const t = isBold && /^\*\*/.test(p) ? p.slice(2, -2) : p;
    for (const piece of t.split(PLACEHOLDER)) {
      if (!piece) continue;
      const hl = PLACEHOLDER.test(piece);
      const rpr = `${isBold ? '<w:b/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}${size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : ''}${hl ? '<w:highlight w:val="yellow"/>' : ''}`;
      out.push(`<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(piece)}</w:t></w:r>`);
    }
  }
  return out.join('');
}

function para(text, { style = '', bold = false, size = 0, color = '', align = '', numId = 0, keepNext = false } = {}) {
  const ppr = `${style ? `<w:pStyle w:val="${style}"/>` : ''}${keepNext ? '<w:keepNext/>' : ''}${numId ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>` : ''}${align ? `<w:jc w:val="${align}"/>` : ''}`;
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${runs(text, { bold, size, color })}</w:p>`;
}

/** Section text -> paragraphs: blank lines separate paragraphs, "- " / "• " lines are bullets. */
function bodyParagraphs(text) {
  const out = [];
  for (const block of String(text || '').replace(/\r/g, '').split(/\n/)) {
    const line = block.trimEnd();
    if (!line.trim()) continue;
    const bullet = line.match(/^\s*(?:[-–•*]|\d+\))\s+(.*)$/);
    if (bullet && !/^\s*\d+\.\d/.test(line)) out.push(para(bullet[1], { style: 'ListParagraph', numId: 1 }));
    else if (/^\s*\d+\.\d+\.?\s+\S/.test(line)) out.push(para(line.trim(), { style: 'Heading2', keepNext: true }));
    else out.push(para(line.trim()));
  }
  return out.join('');
}

function cell(content, { width = 0, shade = '', vAlign = 'center' } = {}) {
  return `<w:tc><w:tcPr>${width ? `<w:tcW w:w="${width}" w:type="dxa"/>` : ''}${shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ''}<w:vAlign w:val="${vAlign}"/></w:tcPr>${content || '<w:p/>'}</w:tc>`;
}

function table(rows, widths) {
  const grid = widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  const tblPr = '<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>';
  return `<w:tbl>${tblPr}<w:tblGrid>${grid}</w:tblGrid>${rows.map((r) => `<w:tr>${r.join('')}</w:tr>`).join('')}</w:tbl>`;
}

function pngSize(buf) {
  if (!buf || buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function logoDrawing(size) {
  const cx = 1600000; // ~4.4 cm wide
  const cy = Math.round((cx * size.h) / size.w);
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Logo"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="logo.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdLogo" xmlns:r="${R}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

const L = {
  sk: { code: 'Kód', version: 'Verzia', effective: 'Účinnosť od', dept: 'Útvar', page: 'Strana', of: 'z', prepared: 'Vypracoval', reviewed: 'Preskúmal', approved: 'Schválil', name: 'Meno', role: 'Funkcia', date: 'Dátum', sign: 'Podpis', draft: 'NÁVRH – neriadená kópia' },
  en: { code: 'Code', version: 'Version', effective: 'Effective from', dept: 'Department', page: 'Page', of: 'of', prepared: 'Prepared by', reviewed: 'Reviewed by', approved: 'Approved by', name: 'Name', role: 'Position', date: 'Date', sign: 'Signature', draft: 'DRAFT – uncontrolled copy' }
};

function field(instr) {
  return `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
}

/**
 * doc: { org, typeLabel, code, title, version, effectiveDate, department, preparedBy, approvedBy, draft }
 * sections: [{ heading, text }]   logoPng: PNG image (Buffer) or null
 */
/** A section's table: { columns: [label], widths: [twips], rows: [[text]] } (header row shaded and repeated on each page). */
function dataTable(tb, scale = 1) {
  const widths = tb.widths.map((w) => Math.round(w * scale));
  const head = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${tb.columns.map((c, i) => cell(para(c, { style: 'Small', bold: true }), { width: widths[i], shade: 'EAF0F3' })).join('')}</w:tr>`;
  const grid = widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  const tblPr = '<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>';
  const rows = tb.rows.map((r) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((v, i) => cell(String(v ?? '').split('\n').map((l) => para(l, { style: 'Small' })).join(''), { width: widths[i], vAlign: 'top' })).join('')}</w:tr>`).join('');
  return `<w:tbl>${tblPr}<w:tblGrid>${grid}</w:tblGrid>${head}${rows}</w:tbl><w:p/>`;
}

/** landscape: wide tables (the page is turned; table widths given for portrait are scaled). */
async function buildDocx({ doc = {}, sections = [], logoPng = null, lang = 'sk', landscape = false }) {
  const t = L[lang] || L.sk;
  const logo = pngSize(logoPng);
  const k = landscape ? 14570 / 9638 : 1; // tables fill the width of a turned page too
  const W2 = (arr) => arr.map((w) => Math.round(w * k));
  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>'
  );
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  zip.file(
    'docProps/core.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc([doc.code, doc.title].filter(Boolean).join(' – '))}</dc:title><dc:creator>${esc(doc.preparedBy || '')}</dc:creator><cp:lastModifiedBy>${esc(doc.preparedBy || '')}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`
  );
  zip.file('docProps/app.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>SOP Archiv</Application></Properties>');

  zip.file(
    'word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="${lang === 'en' ? 'en-GB' : 'sk-SK'}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:jc w:val="both"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="120" w:after="240"/></w:pPr><w:rPr><w:b/><w:color w:val="003A5B"/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:jc w:val="left"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="003A5B"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:jc w:val="left"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="007A69"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/><w:jc w:val="left"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Small"><w:name w:val="Small"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/><w:jc w:val="left"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="9FB8C7"/><w:left w:val="single" w:sz="4" w:space="0" w:color="9FB8C7"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="9FB8C7"/><w:right w:val="single" w:sz="4" w:space="0" w:color="9FB8C7"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="9FB8C7"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="9FB8C7"/></w:tblBorders><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`
  );
  zip.file(
    'word/numbering.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="–"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`
  );

  // Header: logo (or company name) | title | code, version, page
  const left = logo ? `<w:p>${logoDrawing(logo)}</w:p>` : para(doc.org || '', { bold: true, color: '003A5B' });
  const mid = para(doc.typeLabel || '', { style: 'Small', align: 'center' }) + para(doc.title || '', { bold: true, align: 'center', color: '003A5B' });
  const right = para(`${t.code}: ${doc.code || '—'}`, { style: 'Small' }) + para(`${t.version}: ${doc.version || '1'}`, { style: 'Small' }) + `<w:p><w:pPr><w:pStyle w:val="Small"/></w:pPr><w:r><w:t xml:space="preserve">${t.page} </w:t></w:r>${field('PAGE')}<w:r><w:t xml:space="preserve"> ${t.of} </w:t></w:r>${field('NUMPAGES')}</w:p>`;
  zip.file(
    'word/header1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="${W}" xmlns:r="${R}">${table([[cell(left, { width: Math.round(2700 * k) }), cell(mid, { width: Math.round(4500 * k) }), cell(right, { width: Math.round(2438 * k) })]], W2([2700, 4500, 2438]))}<w:p/></w:hdr>`
  );
  zip.file('word/_rels/header1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${logo ? '<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/>' : ''}</Relationships>`);
  if (logo) zip.file('word/media/logo.png', logoPng);
  zip.file(
    'word/footer1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="${W}">${para([doc.org, [doc.code, doc.title].filter(Boolean).join(' '), `${t.version} ${doc.version || '1'}`].filter(Boolean).join(' · ') + (doc.draft ? ` · ${t.draft}` : ''), { style: 'Small', align: 'center', color: '5B6E7A' })}</w:ftr>`
  );

  // Title block and approval table
  const meta = table(
    [
      [t.code, t.version, t.effective, t.dept].map((h) => cell(para(h, { style: 'Small', bold: true }), { shade: 'EAF0F3' })),
      [doc.code || '', doc.version || '1', doc.effectiveDate || '[DOPLNIŤ]', doc.department || ''].map((v) => cell(para(v, { style: 'Small' })))
    ],
    W2([2400, 2400, 2400, 2438])
  );
  const sign = table(
    [
      ['', t.name, t.role, t.date, t.sign].map((h) => cell(para(h, { style: 'Small', bold: true }), { shade: 'EAF0F3' })),
      ...[
        [t.prepared, doc.preparedBy || ''],
        [t.reviewed, ''],
        [t.approved, doc.approvedBy || '']
      ].map(([role, name]) => [cell(para(role, { style: 'Small', bold: true })), cell(para(name, { style: 'Small' })), cell(para('', { style: 'Small' })), cell(para('', { style: 'Small' })), cell(para('', { style: 'Small' }))])
    ],
    W2([1700, 2600, 2000, 1500, 1838])
  );
  const body = [
    doc.org ? para(doc.org, { align: 'center', bold: true, color: '003A5B' }) : '',
    doc.typeLabel ? para(doc.typeLabel.toUpperCase(), { align: 'center', size: 20, color: '5B6E7A' }) : '',
    para(doc.title || '', { style: 'Title' }),
    meta,
    '<w:p/>',
    sign,
    '<w:p/>',
    ...sections.map((s) => para(s.heading, { style: 'Heading1', keepNext: true }) + bodyParagraphs(s.text) + (s.table ? dataTable(s.table, landscape ? 14570 / 9638 : 1) : ''))
  ].join('');
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr><w:headerReference w:type="default" r:id="rIdH1"/><w:footerReference w:type="default" r:id="rIdF1"/>${landscape ? '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>' : '<w:pgSz w:w="11906" w:h="16838"/>'}<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`
  );
  zip.file(
    'word/_rels/document.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdN" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rIdH1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdF1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>'
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { buildDocx, bodyParagraphs };
