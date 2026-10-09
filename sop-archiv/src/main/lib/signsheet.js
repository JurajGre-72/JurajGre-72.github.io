'use strict';
// The signature sheet of a document version – the last page(s) of a printed SOP, ŠPP or OS:
//   1. the electronic signatures made in the app (reviewed / approved with the own password) and who has
//      confirmed "read and understood" (or whose training is recorded),
//   2. rows to approve the document by hand, for people who do not use the app,
//   3. rows for employees without the app to confirm with their own signature that they know the document –
//      the ones who must know it and have not confirmed yet are already listed.
// A4 portrait, full Slovak diacritics (Liberation Sans, shipped with PDF.js). Appended to a controlled
// copy (before it is stamped) or printed on its own.

const fs = require('fs');
const path = require('path');

function fontPath(bold) {
  const dir = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts');
  return path.join(dir, bold ? 'LiberationSans-Bold.ttf' : 'LiberationSans-Regular.ttf');
}

const TEXT = {
  sk: {
    title: 'PODPISOVÝ HÁROK',
    cont: 'Podpisový hárok (pokračovanie)',
    meta: 'Verzia {v} · platná od {eff} · vytlačené {printed}',
    notEffective: 'zatiaľ neschválená',
    e: 'Elektronické podpisy v aplikácii SOP Archív',
    eNote: 'Podpísané osobným heslom používateľa v aplikácii. Meno, úloha, dátum a čas sú uložené v auditnom zázname a nedajú sa zmeniť.',
    eSubmitted: 'Na schválenie predložil(a): {name}, {at}',
    eNone: 'Táto verzia zatiaľ nie je podpísaná v aplikácii.',
    role: { prepared: 'Vypracoval(a)', review: 'Preskúmal(a)', approve: 'Schválil(a)' },
    colRole: 'Úloha',
    colName: 'Meno a priezvisko',
    colAt: 'Dátum a čas',
    colHow: 'Spôsob podpisu',
    colDate: 'Dátum',
    colPos: 'Funkcia / úsek',
    colSign: 'Podpis',
    colNo: 'Č.',
    howE: 'elektronicky (heslom)',
    howWait: 'čaká na podpis v aplikácii',
    read: 'Oboznámenie zaznamenané v aplikácii',
    howRead: { reading: 'potvrdené elektronicky (heslom)', signed: 'vlastnoručný podpis (hárok uložený)', session: 'školenie', onjob: 'zaškolenie na pracovisku', self: 'samoštúdium' },
    hand: 'Schválenie vlastnoručným podpisom',
    handNote: 'Pre osoby, ktoré dokument schvaľujú a nepracujú v aplikácii.',
    ack: 'Oboznámenie zamestnancov s dokumentom',
    ackNote: 'Svojím podpisom potvrdzujem, že som sa oboznámil(a) s dokumentom {doc}, verzia {v}, porozumel(a) som mu a budem postupovať podľa neho.',
    footer: 'Vytvorené v aplikácii SOP Archív {printed}. Elektronické podpisy sú evidované v auditnom zázname aplikácie.',
    page: 'Strana {n} / {total}'
  },
  en: {
    title: 'SIGNATURE SHEET',
    cont: 'Signature sheet (continued)',
    meta: 'Version {v} · effective from {eff} · printed {printed}',
    notEffective: 'not approved yet',
    e: 'Electronic signatures in SOP Archív',
    eNote: 'Signed with the user’s own password in the app. Name, role, date and time are kept in the audit trail and cannot be changed.',
    eSubmitted: 'Submitted for approval by: {name}, {at}',
    eNone: 'This version has not been signed in the app yet.',
    role: { prepared: 'Prepared by', review: 'Reviewed by', approve: 'Approved by' },
    colRole: 'Role',
    colName: 'Name',
    colAt: 'Date and time',
    colHow: 'How signed',
    colDate: 'Date',
    colPos: 'Position / department',
    colSign: 'Signature',
    colNo: 'No.',
    howE: 'electronically (password)',
    howWait: 'waiting for the signature in the app',
    read: 'Acknowledgement recorded in the app',
    howRead: { reading: 'confirmed electronically (password)', signed: 'handwritten signature (sheet kept)', session: 'training session', onjob: 'on-the-job training', self: 'self-study' },
    hand: 'Approval by handwritten signature',
    handNote: 'For people who approve the document and do not use the app.',
    ack: 'Employees’ acknowledgement of the document',
    ackNote: 'With my signature I confirm that I have read the document {doc}, version {v}, understood it and will follow it.',
    footer: 'Created in SOP Archív {printed}. Electronic signatures are recorded in the app’s audit trail.',
    page: 'Page {n} / {total}'
  }
};
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] === undefined || v[k] === null || v[k] === '' ? '–' : String(v[k])));

const day = (iso, lang) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return lang === 'en' ? `${m[1]}-${m[2]}-${m[3]}` : `${+m[3]}. ${+m[2]}. ${m[1]}`;
};
const dayTime = (iso, lang) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return day(iso, lang);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${day(local, lang)} ${hm}`;
};

/**
 * data: {
 *   org, lang ('sk' | 'en'), printedAt (Date),
 *   doc: { code, title, version, effectiveDate },
 *   submitted: { name, at } | null,                     – who sent the version for approval
 *   electronic: [{ role: 'review' | 'approve', name, at | null }],   – at null: waiting for the signature
 *   read: [{ name, date, method }],                     – acknowledgement already recorded for this version
 *   handApproval: true | false,                         – rows to approve by hand
 *   people: [{ name, position }],                       – employees without the app who still have to sign
 *   emptyRows: n                                        – more empty rows to sign
 * }
 * → PDF (Buffer), A4 portrait.
 */
async function buildSignSheet(data) {
  const { PDFDocument, rgb } = require('pdf-lib');
  const fontkit = require('@pdf-lib/fontkit');
  const lang = data.lang === 'en' ? 'en' : 'sk';
  const T = TEXT[lang];
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const bold = await pdf.embedFont(fs.readFileSync(fontPath(true)), { subset: true });
  const regular = await pdf.embedFont(fs.readFileSync(fontPath(false)), { subset: true });
  const navy = rgb(0, 0.227, 0.357);
  const teal = rgb(0, 0.42, 0.36);
  const ink = rgb(0.1, 0.1, 0.1);
  const muted = rgb(0.36, 0.43, 0.48);
  const line = rgb(0.6, 0.66, 0.7);
  const shade = rgb(0.918, 0.941, 0.953);
  const W = 595.28;
  const H = 841.89;
  const left = 50;
  const right = W - 50;
  const width = right - left;
  const bottom = 70;
  const doc = data.doc || {};
  const printed = day((data.printedAt || new Date()).toISOString(), lang);
  const docName = [doc.code, doc.title].filter(Boolean).join(' ');

  let page;
  let y;
  const newPage = (first) => {
    page = pdf.addPage([W, H]);
    y = H - 50;
    if (first) {
      if (data.org) {
        page.drawText(data.org, { x: left, y, size: 10, font: bold, color: navy });
        y -= 22;
      }
      page.drawText(T.title, { x: left, y, size: 16, font: bold, color: teal });
      y -= 20;
      for (const l of wrap(docName, bold, 11, width)) {
        page.drawText(l, { x: left, y, size: 11, font: bold, color: ink });
        y -= 14;
      }
      page.drawText(fill(T.meta, { v: doc.version, eff: doc.effectiveDate ? day(doc.effectiveDate, lang) : T.notEffective, printed }), { x: left, y, size: 9, font: regular, color: muted });
      y -= 22;
    } else {
      page.drawText(cut(`${T.cont} – ${docName} · v${doc.version || ''}`, bold, 9, width), { x: left, y, size: 9, font: bold, color: muted });
      y -= 22;
    }
  };
  const room = (h) => {
    if (y - h < bottom) newPage(false);
  };
  const heading = (text) => {
    room(40);
    y -= 4;
    page.drawText(text, { x: left, y, size: 11.5, font: bold, color: navy });
    y -= 16;
  };
  const paragraph = (text, { size = 9, color = ink, font = regular } = {}) => {
    for (const l of wrap(text, font, size, width)) {
      room(size + 4);
      page.drawText(l, { x: left, y, size, font, color });
      y -= size + 3.5;
    }
    y -= 4;
  };
  // A table: header row repeated on every page it continues on; cells on one line, cut to the column.
  const table = (cols, rows, rowH) => {
    const size = 9;
    const head = () => {
      room(18 + rowH);
      let x = left;
      page.drawRectangle({ x: left, y: y - 16, width, height: 16, color: shade, borderColor: line, borderWidth: 0.6 });
      for (const c of cols) {
        page.drawText(cut(c.label, bold, 8.5, c.w - 8), { x: x + 4, y: y - 11.5, size: 8.5, font: bold, color: ink });
        x += c.w;
      }
      y -= 16;
    };
    head();
    for (const r of rows) {
      if (y - rowH < bottom) {
        newPage(false);
        head();
      }
      let x = left;
      page.drawRectangle({ x: left, y: y - rowH, width, height: rowH, borderColor: line, borderWidth: 0.6 });
      cols.forEach((c, i) => {
        if (i) page.drawLine({ start: { x, y }, end: { x, y: y - rowH }, thickness: 0.6, color: line });
        const v = r[i] === undefined || r[i] === null ? '' : String(r[i]);
        if (v) page.drawText(cut(v, regular, size, c.w - 8), { x: x + 4, y: y - rowH / 2 - 3, size, font: regular, color: ink });
        x += c.w;
      });
      y -= rowH;
    }
    y -= 12;
  };

  newPage(true);
  let n = 0;

  // 1. Signed in the app
  heading(`${++n}. ${T.e}`);
  paragraph(T.eNote, { color: muted, size: 8.5 });
  if (data.submitted && data.submitted.name) paragraph(fill(T.eSubmitted, { name: data.submitted.name, at: dayTime(data.submitted.at, lang) }));
  const el = data.electronic || [];
  if (el.length) {
    table(
      [
        { label: T.colRole, w: 90 },
        { label: T.colName, w: 165 },
        { label: T.colAt, w: 100 },
        { label: T.colHow, w: width - 355 }
      ],
      el.map((s) => [T.role[s.role] || s.role, s.name, s.at ? dayTime(s.at, lang) : '', s.at ? T.howE : T.howWait]),
      18
    );
  } else paragraph(T.eNone, { color: muted });
  const read = data.read || [];
  if (read.length) {
    room(40);
    page.drawText(T.read, { x: left, y, size: 10, font: bold, color: ink });
    y -= 14;
    table(
      [
        { label: T.colNo, w: 28 },
        { label: T.colName, w: 190 },
        { label: T.colDate, w: 80 },
        { label: T.colHow, w: width - 298 }
      ],
      read.map((r, i) => [`${i + 1}.`, r.name, day(r.date, lang), T.howRead[r.method] || r.method || '']),
      16
    );
  }

  // 2. Approval by hand
  if (data.handApproval) {
    heading(`${++n}. ${T.hand}`);
    paragraph(T.handNote, { color: muted, size: 8.5 });
    table(
      [
        { label: T.colRole, w: 90 },
        { label: T.colName, w: 140 },
        { label: T.colPos, w: 100 },
        { label: T.colDate, w: 70 },
        { label: T.colSign, w: width - 400 }
      ],
      ['prepared', 'review', 'approve'].map((r) => [T.role[r]]),
      28
    );
  }

  // 3. Employees' acknowledgement
  const people = data.people || [];
  const empty = Math.max(0, Math.min(200, Number(data.emptyRows) || 0));
  if (people.length || empty) {
    heading(`${++n}. ${T.ack}`);
    paragraph(fill(T.ackNote, { doc: docName, v: doc.version }));
    table(
      [
        { label: T.colNo, w: 28 },
        { label: T.colName, w: 160 },
        { label: T.colPos, w: 120 },
        { label: T.colDate, w: 70 },
        { label: T.colSign, w: width - 378 }
      ],
      [...people.map((p, i) => [`${i + 1}.`, p.name, p.position || '']), ...Array.from({ length: empty }, (_, i) => [`${people.length + i + 1}.`])],
      26
    );
  }

  // Footer on every page: what this is, page numbers.
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: left, y: 52 }, end: { x: right, y: 52 }, thickness: 0.5, color: line });
    const leftText = cut([data.org, `${doc.code || ''} v${doc.version || ''}`.trim(), T.title.toLowerCase()].filter(Boolean).join(' · '), regular, 7.5, width - 80);
    p.drawText(leftText, { x: left, y: 40, size: 7.5, font: regular, color: muted });
    const pg = fill(T.page, { n: i + 1, total: pages.length });
    p.drawText(pg, { x: right - regular.widthOfTextAtSize(pg, 7.5), y: 40, size: 7.5, font: regular, color: muted });
    p.drawText(cut(fill(T.footer, { printed }), regular, 7, width), { x: left, y: 29, size: 7, font: regular, color: muted });
  });
  return Buffer.from(await pdf.save());
}

/** Lines of text that fit the width (words kept whole where possible). */
function wrap(text, font, size, width) {
  const out = [];
  for (const para of String(text || '').split('\n')) {
    let cur = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const next = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) <= width) cur = next;
      else {
        if (cur) out.push(cur);
        cur = font.widthOfTextAtSize(w, size) <= width ? w : cut(w, font, size, width);
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

/** The text cut to the width, with "…" when it does not fit. */
function cut(text, font, size, width) {
  const s = String(text || '');
  if (font.widthOfTextAtSize(s, size) <= width) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (font.widthOfTextAtSize(`${s.slice(0, mid)}…`, size) <= width) lo = mid;
    else hi = mid - 1;
  }
  return `${s.slice(0, lo)}…`;
}

/** The sheet's pages added at the end of a PDF document. */
async function appendSheet(pdf, sheet) {
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: false, updateMetadata: false });
  const add = await PDFDocument.load(sheet);
  for (const p of await doc.copyPages(add, add.getPageIndices())) doc.addPage(p);
  return Buffer.from(await doc.save());
}

module.exports = { buildSignSheet, appendSheet };
