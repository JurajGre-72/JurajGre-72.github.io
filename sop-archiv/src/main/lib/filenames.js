'use strict';
// The company's naming of document files, e.g. "_OS5_Príloha č.1_Zoznam kontaktov.pdf",
// "ŠPP_05_2026_pre vzorový príjem.pdf", "SM_HR_003_2_Vzorový poriadok_od_01.01.2025.pdf",
// "Smernica Q_05-2017_Vzorové zaobchádzanie_ver.04_21.01.2022.pdf".
// A recognised name is the most reliable source of a document's code, type and title.
// Pure functions – unit-tested in test/unit/filenames.test.js.

const { parseDate } = require('./dates');

// Area codes in document codes ("SM_Q_01", "SM_HR_003") -> department (index into the default list).
const AREA_DEPT = { Q: 1, QA: 1, HR: 10, IT: 9 };

const YEAR = '(?:19|20)\\d{2}';
const SEP = '[_\\s]+';

/** Underscores in titles stand for spaces. */
function cleanTitle(s) {
  return String(s || '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–]+|[\s\-–]+$/g, '')
    .trim();
}

/** A folder of English (or other language) copies, e.g. "Anglické verzie". */
function languageOf(fileName, folder) {
  const parts = String(folder || '').split(/[\\/]+/).filter(Boolean);
  if (parts.some((p) => /^(anglick|english\b|en$|eng$)/i.test(p.trim()))) return 'en';
  if (/[_\s\-(](EN|ENG|english)[)]?$/i.test(String(fileName || '').replace(/\.[^.]+$/, ''))) return 'en';
  return null;
}

/** "ver.04_21.01.2022", "ver.19.03.2025", "_od_01.01.2025" at the end of a name: { rest, version, date } */
function takeVersionTail(s) {
  const out = { rest: s, version: null, date: null };
  let m = out.rest.match(new RegExp(`${SEP}od${SEP}(\\d{1,2}\\.\\d{1,2}\\.${YEAR})$`, 'i'));
  if (m) {
    out.date = parseDate(m[1]);
    out.rest = out.rest.slice(0, m.index);
  }
  m = out.rest.match(new RegExp(`${SEP}ver\\.?\\s*(?:(\\d{1,3})(?![.\\d]))?[_\\s]*(\\d{1,2}\\.\\d{1,2}\\.${YEAR})?$`, 'i'));
  if (m && (m[1] || m[2])) {
    if (m[1]) out.version = m[1];
    if (m[2]) out.date = parseDate(m[2]);
    out.rest = out.rest.slice(0, m.index);
  }
  return out;
}

/** A trailing edition year: "Vzorová smernica_2026" -> { rest: "Vzorová smernica", year: "2026" } */
function takeYearTail(s) {
  const m = s.match(new RegExp(`${SEP}(${YEAR})$`));
  return m ? { rest: s.slice(0, m.index), year: m[1] } : { rest: s, year: null };
}

/**
 * Read a file name. Returns null when it does not follow a known pattern, otherwise
 * { code, type, title, version?, effectiveDate?, annexOf?, annexNo?, area?, departmentIndex?, lang? }.
 */
function parseFileName(fileName, folder = '') {
  const base = String(fileName || '')
    .replace(/\.[^.]{1,5}$/, '')
    .replace(/^[_\s]+/, '')
    .trim();
  if (!base) return null;
  const lang = languageOf(fileName, folder);
  const done = (r) => {
    if (!r) return null;
    const out = Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== undefined && v !== ''));
    if (lang) out.lang = lang;
    return out;
  };
  let m;

  // Annex: "OS5_Príloha č.1_Zoznam kontaktov", "OS7_príloha3_k Vzorovej príručke_..._2025", "ŠPP_05_Príloha č.2_..."
  m = base.match(/^((?:OS\s?\d{1,3})|(?:ŠPP|SPP)[_\s-]?\d{1,3})[_\s]+pr[íi]loha\s*(?:[čc]\.?\s*)?(\d{1,3})(?:[_\s]+(.*))?$/i);
  if (m) {
    const parent = normalizeParent(m[1]);
    const v = takeVersionTail(m[3] || '');
    const y = takeYearTail(v.rest);
    return done({
      code: `${parent} Príloha č. ${+m[2]}`,
      type: parent.startsWith('OS') ? 'OS' : 'ŠPP',
      title: cleanTitle(y.rest) || `Príloha č. ${+m[2]}`,
      annexOf: parent,
      annexNo: +m[2],
      version: v.version || y.year,
      effectiveDate: v.date
    });
  }

  // Organizational directive: "OS1_Vzorová smernica_2026", "OS7_Vzorova_prirucka_vratane_priloh"
  m = base.match(/^OS\s?(\d{1,3})[_\s]+(.+)$/i);
  if (m) {
    const v = takeVersionTail(m[2]);
    const y = takeYearTail(v.rest);
    return done({ code: `OS${+m[1]}`, type: 'OS', title: cleanTitle(y.rest), version: v.version || y.year, effectiveDate: v.date });
  }

  // Standard working procedure: "ŠPP_05_2026_pre vzorový príjem"
  m = base.match(new RegExp(`^(?:ŠPP|SPP)[_\\s-]?(\\d{1,3})(?:${SEP}(${YEAR}))?${SEP}(.+)$`, 'i'));
  if (m) {
    const v = takeVersionTail(m[3]);
    const y = takeYearTail(v.rest);
    return done({ code: `ŠPP ${m[1]}`, type: 'ŠPP', title: cleanTitle(y.rest), version: v.version || m[2] || y.year, effectiveDate: v.date });
  }

  // Directive / method with an area: "SM_HR_003_2_Vzorový poriadok_od_01.01.2025", "ME_Q_01_2022_Vzorová metodika"
  m = base.match(new RegExp(`^(SM|ME)[_\\s-]([A-Z]{1,3})[_\\s-](\\d{1,4})(?:[_\\s-](${YEAR}|\\d{1,2})(?=[_\\s]))?${SEP}(.+)$`));
  if (m) {
    const v = takeVersionTail(m[5]);
    const y = takeYearTail(v.rest);
    const rev = m[4] && m[4].length <= 2 ? m[4] : null;
    const year = m[4] && m[4].length === 4 ? m[4] : y.year;
    return done({
      code: `${m[1]} ${m[2]} ${m[3]}`,
      type: m[1],
      title: cleanTitle(y.rest),
      version: v.version || rev || year,
      effectiveDate: v.date,
      area: m[2],
      departmentIndex: AREA_DEPT[m[2]]
    });
  }

  // "Smernica Q_05-2017_Vzorové zaobchádzanie_ver.04_21.01.2022"
  m = base.match(new RegExp(`^Smernica\\s+([A-Z]{1,3})[_\\s-](\\d{1,3})[-_](${YEAR})${SEP}(.+)$`, 'i'));
  if (m) {
    const v = takeVersionTail(m[4]);
    const area = m[1].toUpperCase();
    return done({
      code: `${area} ${m[2]}-${m[3]}`,
      type: 'SM',
      title: cleanTitle(v.rest),
      version: v.version,
      effectiveDate: v.date,
      area,
      departmentIndex: AREA_DEPT[area]
    });
  }

  // "ID-04  Vzorový interný dokument"
  m = base.match(/^(ID)[\s\-_]?(\d{1,4})[_\s]+(.+)$/);
  if (m) {
    const v = takeVersionTail(m[3]);
    const y = takeYearTail(v.rest);
    return done({ code: `ID-${m[2]}`, type: 'ID', title: cleanTitle(y.rest), version: v.version || y.year, effectiveDate: v.date });
  }

  // Dated instruction without a code: "2024.09_VZOR_Pokyny pre vzor.zásielky"
  m = base.match(new RegExp(`^(${YEAR})\\.(\\d{2})${SEP}(.+)$`));
  if (m && +m[2] >= 1 && +m[2] <= 12) {
    return done({ title: cleanTitle(m[3]), version: `${m[1]}.${m[2]}` });
  }
  return null;
}

function normalizeParent(s) {
  const t = s.replace(/[_\s-]+/g, '');
  const os = t.match(/^OS(\d+)$/i);
  if (os) return `OS${+os[1]}`;
  const spp = t.match(/^(?:ŠPP|SPP)(\d+)$/i);
  return spp ? `ŠPP ${spp[1]}` : t;
}

module.exports = { parseFileName, languageOf, cleanTitle };
