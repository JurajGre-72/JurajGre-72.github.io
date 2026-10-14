'use strict';
// Date helpers. Dates are stored as plain "YYYY-MM-DD" strings (local calendar dates).

const { fold } = require('./text');

const MONTHS = {
  // Slovak (nominative + genitive, folded) and English
  januar: 1, januara: 1, january: 1, jan: 1,
  februar: 2, februara: 2, february: 2, feb: 2,
  marec: 3, marca: 3, march: 3, mar: 3,
  april: 4, aprila: 4, apr: 4,
  maj: 5, maja: 5, may: 5,
  jun: 6, juna: 6, june: 6,
  jul: 7, jula: 7, july: 7,
  august: 8, augusta: 8, aug: 8,
  september: 9, septembra: 9, sep: 9, sept: 9,
  oktober: 10, oktobra: 10, october: 10, oct: 10, okt: 10,
  november: 11, novembra: 11, nov: 11,
  december: 12, decembra: 12, dec: 12
};

function pad(n) {
  return String(n).padStart(2, '0');
}

function valid(y, m, d) {
  if (!(y >= 1950 && y <= 2150 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1;
}

function iso(y, m, d) {
  return valid(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
}

// Pattern (as source string) that matches one date in any supported format.
const DATE_PATTERN =
  '(?:\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}\\s*[./]\\s*\\d{1,2}\\s*[./]\\s*\\d{4}|\\d{1,2}\\.?\\s+[A-Za-zÀ-ž]{3,9}\\.?\\s+\\d{4}|[A-Za-z]{3,9}\\.?\\s+\\d{1,2},?\\s+\\d{4})';

/** Parse a single date string in common SK/EN formats. Returns "YYYY-MM-DD" or null. */
function parseDate(input) {
  if (!input) return null;
  const s = String(input).trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return iso(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{4})/))) return iso(+m[3], +m[2], +m[1]);
  const f = fold(s);
  if ((m = f.match(/^(\d{1,2})\.?\s+([a-z]{3,9})\.?\s+(\d{4})/)) && MONTHS[m[2]]) return iso(+m[3], MONTHS[m[2]], +m[1]);
  if ((m = f.match(/^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/)) && MONTHS[m[1]]) return iso(+m[3], MONTHS[m[1]], +m[2]);
  return null;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toUTC(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole days from a to b (b - a). */
function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

/** Add calendar months, clamping to the end of month (31 Jan + 1 month = 28/29 Feb). */
function addMonths(isoDate, months) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const total = y * 12 + (m - 1) + Number(months);
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${pad(nm)}-${pad(Math.min(d, last))}`;
}

function addDays(isoDate, days) {
  const t = new Date(toUTC(isoDate) + days * 86400000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** "20250101" -> "2025-01-01" */
function compactToIso(s) {
  const m = String(s).match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? iso(+m[1], +m[2], +m[3]) : null;
}

module.exports = { parseDate, today, daysBetween, addMonths, addDays, compactToIso, DATE_PATTERN, iso };
