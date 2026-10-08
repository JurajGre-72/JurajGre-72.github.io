'use strict';
// Readable export of the whole archive: for an inspection or an audit, or simply so that the company's
// documents are never locked inside this app. Everything is written as ordinary files that open without
// the app – and therefore NOT encrypted (the user is warned before exporting).
//
//   <folder>/ČÍTAJ MA.txt                       what is where, who exported it and when
//   <folder>/Register dokumentov.xlsx           every document and version, with the path to its file
//   <folder>/Dokumenty/<druh>/<kód – názov>/    the original files (all versions or only the valid ones)
//   <folder>/Správa o dokumentácii.pdf / .xlsx  reviews, legislation, decisions, training, approvals, copies, recalls
//   <folder>/Auditný záznam.xlsx                the complete audit trail

const fs = require('fs');
const path = require('path');
const report = require('./lib/report');
const { buildXlsx } = require('./lib/xlsx');

const TEXT = {
  sk: {
    register: 'Register dokumentov',
    docsDir: 'Dokumenty',
    report: 'Správa o dokumentácii',
    audit: 'Auditný záznam',
    readme: 'ČÍTAJ MA.txt',
    cols: ['Kód', 'Názov', 'Druh', 'Stav dokumentu', 'Verzia', 'Stav verzie', 'Účinnosť od', 'Revízia do', 'Útvar', 'Vlastník', 'Schválil', 'Nahrané', 'Nahral', 'Súbor', 'SHA-256 (kontrola, že súbor je nezmenený)'],
    vCurrent: 'platná (aktuálna)',
    vOld: 'staršia, nahradená',
    status: { draft: 'návrh', effective: 'platný', review: 'na revízii', obsolete: 'neplatný' },
    readmeText: (x) =>
      [
        `Export archívu riadenej dokumentácie – ${x.org}`,
        `Vytvorené: ${x.when}, ${x.user} (aplikácia SOP Archív ${x.version})`,
        '',
        `Dokumentov: ${x.docs}, súborov: ${x.files}${x.includeOld ? ' (všetky verzie)' : ' (len platné verzie)'}${x.includeObsolete ? '' : ', bez neplatných dokumentov'}.`,
        '',
        'Obsah:',
        `- ${x.registerName}.xlsx – zoznam všetkých dokumentov a verzií so stavom, dátumami a cestou k súboru.`,
        `- ${x.docsDir}\\ – pôvodné súbory dokumentov (tak, ako boli nahrané do archívu), podľa druhu dokumentu.`,
        `- ${x.reportName}.pdf a .xlsx – revízie, sledované predpisy a ich zmeny, rozhodnutia spoločnosti, školenia, schvaľovanie, riadené kópie, posúdenie oznamov úradov.`,
        `- ${x.auditName}.xlsx – úplný auditný záznam: každá akcia v aplikácii s menom používateľa a časom.`,
        '',
        'DÔLEŽITÉ: súbory v tomto priečinku NIE SÚ zašifrované. Uložte ich len na bezpečné miesto, neposielajte ich e-mailom mimo spoločnosti a po použití priečinok zmažte.',
        'Riadený (platný) stav dokumentov je vždy ten v aplikácii; vytlačené kópie z tohto exportu sú neriadené.'
      ].join('\r\n')
  },
  en: {
    register: 'Document register',
    docsDir: 'Documents',
    report: 'Documentation report',
    audit: 'Audit trail',
    readme: 'README.txt',
    cols: ['Code', 'Title', 'Type', 'Document status', 'Version', 'Version status', 'Effective from', 'Review by', 'Department', 'Owner', 'Approved by', 'Uploaded', 'Uploaded by', 'File', 'SHA-256 (proof the file is unchanged)'],
    vCurrent: 'valid (current)',
    vOld: 'older, superseded',
    status: { draft: 'draft', effective: 'effective', review: 'under review', obsolete: 'obsolete' },
    readmeText: (x) =>
      [
        `Export of the controlled documentation archive – ${x.org}`,
        `Created: ${x.when}, ${x.user} (SOP Archív ${x.version})`,
        '',
        `Documents: ${x.docs}, files: ${x.files}${x.includeOld ? ' (all versions)' : ' (valid versions only)'}${x.includeObsolete ? '' : ', without obsolete documents'}.`,
        '',
        'Contents:',
        `- ${x.registerName}.xlsx – every document and version with status, dates and the path to its file.`,
        `- ${x.docsDir}\\ – the original files (as uploaded to the archive), by document type.`,
        `- ${x.reportName}.pdf and .xlsx – reviews, acts monitored and their changes, the company's decisions, training, approvals, controlled copies, assessment of authority notices.`,
        `- ${x.auditName}.xlsx – the complete audit trail: every action in the app with the user and the time.`,
        '',
        'IMPORTANT: the files in this folder are NOT encrypted. Keep them in a safe place only, do not e-mail them outside the company and delete the folder after use.',
        'The controlled (valid) state of the documents is always the one in the app; printouts from this export are uncontrolled.'
      ].join('\r\n')
  }
};

/** A name that is safe as a file or folder name on Windows, macOS and Linux. */
function safe(s, max = 90) {
  const out = String(s || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, max)
    .trim();
  return out || '_';
}

function unique(dir, name, used) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let n = name;
  for (let i = 2; used.has(path.join(dir, n).toLowerCase()); i++) n = `${base} (${i})${ext}`;
  used.add(path.join(dir, n).toLowerCase());
  return n;
}

/**
 * archive: the open (signed-in) Archive. dest: a new folder. opts: { includeOld, includeObsolete, lang, user,
 * version, typeLabel(id), audit: { columns, rows } (formatted as in the app), notices, printPdf(html) }.
 * Returns { dir, docs, files }.
 */
async function exportArchive(archive, dest, opts) {
  const T = TEXT[opts.lang] || TEXT.sk;
  if (fs.existsSync(dest) && fs.readdirSync(dest).length) throw new Error('EXPORT_NOT_EMPTY');
  await fs.promises.mkdir(dest, { recursive: true });
  const used = new Set();
  const docs = archive.data.docs
    .filter((d) => opts.includeObsolete || d.status !== 'obsolete')
    .slice()
    .sort((a, b) => String(a.code || a.title).localeCompare(String(b.code || b.title), 'sk', { numeric: true }));
  const rows = [];
  let files = 0;
  for (const d of docs) {
    const folder = path.join(T.docsDir, safe(opts.typeLabel ? opts.typeLabel(d.type) : d.type, 40), safe(`${d.code ? `${d.code} – ` : ''}${d.title}`));
    const versions = (d.versions || []).filter((v) => opts.includeOld || v.id === d.currentVersionId);
    for (const v of versions) {
      const content = await archive.versionContent(d.id, v.id);
      const current = v.id === d.currentVersionId;
      const name = unique(folder, safe(`${current ? '' : '(stará) '}v${v.label} – ${v.fileName || content.name}`, 120), used);
      await fs.promises.mkdir(path.join(dest, folder), { recursive: true });
      await fs.promises.writeFile(path.join(dest, folder, name), content.data);
      files++;
      rows.push([d.code || '', d.title, opts.typeLabel ? opts.typeLabel(d.type) : d.type, T.status[d.status] || d.status, v.label, current ? T.vCurrent : T.vOld, current ? d.effectiveDate || '' : '', current ? d.reviewDate || '' : '', d.department || '', d.owner || '', (current && d.approver) || '', String(v.importedAt || '').slice(0, 10), v.importedBy || '', path.join(folder, name), v.sha256 || '']);
    }
  }
  const widths = [14, 44, 14, 14, 8, 18, 12, 12, 18, 18, 20, 12, 18, 70, 66];
  await fs.promises.writeFile(path.join(dest, `${T.register}.xlsx`), await buildXlsx([{ name: T.register, columns: T.cols.map((c, i) => ({ label: c, width: widths[i] })), rows }], { title: T.register }));

  // The documentation report for the whole period.
  const L = opts.labels;
  const r = report.reportData(archive.data, { today: new Date().toISOString().slice(0, 10), warnDays: archive.data.settings.warnDays || 60, notices: opts.notices || [] });
  await fs.promises.writeFile(path.join(dest, `${T.report}.xlsx`), await buildXlsx(report.reportSheets(r, L), { title: L.title }));
  if (opts.printPdf) await fs.promises.writeFile(path.join(dest, `${T.report}.pdf`), await opts.printPdf(report.reportHtml(r, L)));

  // The complete audit trail, as shown in the app.
  if (opts.audit && Array.isArray(opts.audit.rows)) {
    const widthsA = [18, 22, 30, 22, 80];
    await fs.promises.writeFile(
      path.join(dest, `${T.audit}.xlsx`),
      await buildXlsx([{ name: T.audit, columns: opts.audit.columns.map((c, i) => ({ label: String(c), width: widthsA[i] || 20 })), rows: opts.audit.rows.map((row) => row.map((v) => String(v ?? '').slice(0, 4000))) }], { title: T.audit })
    );
  }

  const when = new Date().toLocaleString(opts.lang === 'en' ? 'en-GB' : 'sk-SK');
  await fs.promises.writeFile(
    path.join(dest, T.readme),
    '﻿' + T.readmeText({ org: archive.data.org || '', when, user: opts.user, version: opts.version, docs: docs.length, files, includeOld: opts.includeOld, includeObsolete: opts.includeObsolete, registerName: T.register, docsDir: T.docsDir, reportName: T.report, auditName: T.audit })
  );
  return { dir: dest, docs: docs.length, files };
}

module.exports = { exportArchive, safe };
