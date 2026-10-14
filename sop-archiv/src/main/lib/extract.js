'use strict';
// Text extraction from the document formats typically found in a QA archive.
// Returns { pages: [{ page, text }], status: 'ok'|'empty'|'unsupported'|'error', error? }

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { cleanText } = require('./text');

const SUPPORTED = ['.pdf', '.docx', '.doc', '.xlsx', '.xlsm', '.odt', '.ods', '.odp', '.rtf', '.txt', '.md', '.csv', '.log', '.html', '.htm', '.xml', '.json'];

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    const p = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjsPromise = import(pathToFileURL(p).href);
  }
  return pdfjsPromise;
}

async function extractPdf(buf) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0
  });
  const doc = await task.promise;
  const pages = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      // Rebuild lines from text positions; a vertical gap larger than ~1.6 line heights starts a new paragraph.
      let out = '';
      let lastY = null;
      let lastH = 0;
      for (const it of tc.items) {
        if (typeof it.str !== 'string') continue;
        const y = it.transform ? it.transform[5] : null;
        const h = Math.abs((it.transform && it.transform[3]) || it.height || 0);
        if (it.str === '' && !it.hasEOL) continue;
        // A small vertical shift (superscript footnote numbers) stays on the same line.
        if (lastY !== null && y !== null && Math.abs(y - lastY) > Math.max(2, Math.max(h, lastH) * 0.5)) {
          if (!out.endsWith('\n')) out += '\n';
          if (Math.abs(lastY - y) > Math.max(h, lastH, 1) * 1.6 && !out.endsWith('\n\n')) out += '\n';
        }
        out += it.str;
        if (it.str) {
          lastY = y;
          lastH = h || lastH;
        }
      }
      pages.push({ page: i, text: cleanText(out) });
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return pages;
}

async function extractDocx(file) {
  const mammoth = require('mammoth');
  const res = await mammoth.extractRawText({ path: file });
  return [{ page: null, text: cleanText(res.value) }];
}

async function extractDoc(file) {
  const WordExtractor = require('word-extractor');
  const ex = new WordExtractor();
  const d = await ex.extract(file);
  const parts = [d.getHeaders && d.getHeaders(), d.getBody(), d.getFootnotes && d.getFootnotes()].filter(Boolean);
  return [{ page: null, text: cleanText(parts.join('\n')) }];
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

async function extractXlsx(buf) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buf);
  const shared = [];
  const ss = zip.file('xl/sharedStrings.xml');
  if (ss) {
    const xml = await ss.async('string');
    for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) || []) {
      shared.push(decodeXml((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
    }
  }
  const sheetNames = Object.keys(zip.files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
  const pages = [];
  for (let i = 0; i < sheetNames.length; i++) {
    const xml = await zip.file(sheetNames[i]).async('string');
    const rows = [];
    for (const row of xml.match(/<row[\s\S]*?<\/row>/g) || []) {
      const cells = [];
      for (const c of row.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
        const t = (c.match(/\bt="([^"]+)"/) || [])[1];
        const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        const is = (c.match(/<is>([\s\S]*?)<\/is>/) || [])[1];
        let val = '';
        if (t === 's' && v != null) val = shared[+v] || '';
        else if (is) val = decodeXml(is.replace(/<[^>]+>/g, ''));
        else if (v != null) val = decodeXml(v);
        if (val !== '') cells.push(val);
      }
      if (cells.length) rows.push(cells.join(' | '));
    }
    pages.push({ page: i + 1, text: cleanText(rows.join('\n')) });
  }
  return pages;
}

async function extractOdf(buf) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buf);
  const f = zip.file('content.xml');
  if (!f) return [];
  const xml = await f.async('string');
  const text = decodeXml(
    xml
      .replace(/<text:tab\/>/g, '\t')
      .replace(/<text:line-break\/>/g, '\n')
      .replace(/<\/(?:text:p|text:h|table:table-row)>/g, '\n')
      .replace(/<\/table:table-cell>/g, ' | ')
      .replace(/<[^>]+>/g, '')
  );
  return [{ page: null, text: cleanText(text) }];
}

/** Decode bytes as UTF-8, falling back to Windows-1250 (older Slovak files). */
function decodeText(buf) {
  let b = buf;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch (_) {
    return new TextDecoder('windows-1250').decode(b);
  }
}

function htmlToText(html) {
  return decodeXml(
    html
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr|section|article|table)>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' | ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
  );
}

function rtfToText(raw) {
  const s = raw.toString('latin1');
  const cpMatch = s.match(/\\ansicpg(\d+)/);
  const cp = cpMatch ? `windows-${cpMatch[1]}` : 'windows-1250';
  let dec;
  try {
    dec = new TextDecoder(cp);
  } catch (_) {
    dec = new TextDecoder('windows-1250');
  }
  let out = '';
  let i = 0;
  let depth = 0;
  const skipDepth = [];
  let uc = 1;
  let skip = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '{') {
      depth++;
      i++;
      if (s.startsWith('\\*', i) || /^\\(fonttbl|colortbl|stylesheet|info|pict|header|footer|listtable|listoverridetable|rsidtbl|themedata|colorschememapping|datastore|latentstyles)\b/.test(s.slice(i, i + 30))) skipDepth.push(depth);
      continue;
    }
    if (ch === '}') {
      if (skipDepth.length && skipDepth[skipDepth.length - 1] === depth) skipDepth.pop();
      depth--;
      i++;
      continue;
    }
    const skipping = skipDepth.length > 0;
    if (ch === '\\') {
      const nx = s[i + 1];
      if (nx === "'") {
        const byte = parseInt(s.substr(i + 2, 2), 16);
        if (!skipping && skip <= 0) out += dec.decode(Uint8Array.of(byte));
        else skip--;
        i += 4;
        continue;
      }
      if (nx === '\\' || nx === '{' || nx === '}') {
        if (!skipping) out += nx;
        i += 2;
        continue;
      }
      const m = s.slice(i).match(/^\\([a-z]+)(-?\d+)? ?/i);
      if (m) {
        const word = m[1];
        const arg = m[2];
        if (!skipping) {
          if (word === 'par' || word === 'line' || word === 'row') out += '\n';
          else if (word === 'tab' || word === 'cell') out += '\t';
          else if (word === 'u' && arg) {
            let code = parseInt(arg, 10);
            if (code < 0) code += 65536;
            out += String.fromCharCode(code);
            skip = uc;
          } else if (word === 'uc' && arg) uc = parseInt(arg, 10);
        }
        i += m[0].length;
        continue;
      }
      i += 2;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      i++;
      continue;
    }
    if (!skipping) {
      if (skip > 0) skip--;
      else out += ch;
    }
    i++;
  }
  return out;
}

/** Extract text from a file on disk. Never throws. */
async function extractFile(file) {
  const ext = path.extname(file).toLowerCase();
  try {
    let pages;
    if (ext === '.pdf') pages = await extractPdf(await fs.promises.readFile(file));
    else if (ext === '.docx') pages = await extractDocx(file);
    else if (ext === '.doc') pages = await extractDoc(file);
    else if (ext === '.xlsx' || ext === '.xlsm') pages = await extractXlsx(await fs.promises.readFile(file));
    else if (ext === '.odt' || ext === '.ods' || ext === '.odp') pages = await extractOdf(await fs.promises.readFile(file));
    else if (ext === '.rtf') pages = [{ page: null, text: cleanText(rtfToText(await fs.promises.readFile(file))) }];
    else if (ext === '.html' || ext === '.htm' || ext === '.xml') pages = [{ page: null, text: cleanText(htmlToText(decodeText(await fs.promises.readFile(file)))) }];
    else if (['.txt', '.md', '.csv', '.log', '.json'].includes(ext)) pages = [{ page: null, text: cleanText(decodeText(await fs.promises.readFile(file))) }];
    else return { pages: [], status: 'unsupported' };
    const chars = pages.reduce((n, p) => n + p.text.length, 0);
    return { pages, status: chars > 20 ? 'ok' : 'empty' };
  } catch (e) {
    return { pages: [], status: 'error', error: String((e && e.message) || e) };
  }
}

module.exports = { extractFile, SUPPORTED, decodeText, htmlToText, rtfToText };
