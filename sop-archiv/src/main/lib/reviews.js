'use strict';
// Review scheduling: status of each document, calendar (.ics) and CSV export.

const { today, daysBetween, addDays } = require('./dates');

/**
 * Review state of a document.
 *   overdue – review date has passed
 *   due     – review date within `warnDays`
 *   ok      – later
 *   none    – no review date set (or document obsolete)
 */
function reviewState(doc, warnDays = 60, day = today()) {
  if (!doc || doc.status === 'obsolete') return { state: 'none', daysLeft: null };
  if (!doc.reviewDate) return { state: 'none', daysLeft: null };
  const daysLeft = daysBetween(day, doc.reviewDate);
  if (daysLeft < 0) return { state: 'overdue', daysLeft };
  if (daysLeft <= warnDays) return { state: 'due', daysLeft };
  return { state: 'ok', daysLeft };
}

function summarize(docs, warnDays, day = today()) {
  const out = { overdue: [], due: [], ok: 0, none: 0 };
  for (const d of docs) {
    const r = reviewState(d, warnDays, day);
    if (r.state === 'overdue') out.overdue.push(d);
    else if (r.state === 'due') out.due.push(d);
    else if (r.state === 'ok') out.ok++;
    else out.none++;
  }
  return out;
}

// --- iCalendar ---------------------------------------------------------------

function icsEscape(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/([,;])/g, '\\$1');
}

// Lines longer than 75 octets must be folded (RFC 5545 §3.1).
function foldLine(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out = [];
  let cur = '';
  let curLen = 0;
  for (const ch of line) {
    const l = Buffer.byteLength(ch, 'utf8');
    if (curLen + l > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      curLen = 0;
    }
    cur += ch;
    curLen += l;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function stamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Build an .ics calendar with one all-day event per document review.
 * opts: { reminderDays, labels: { prefix, desc } , org }
 */
function buildIcs(docs, opts = {}) {
  const reminder = Number(opts.reminderDays ?? 14);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SOP Archiv//Reviews//SK', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  const now = stamp();
  for (const d of docs) {
    if (!d.reviewDate || d.status === 'obsolete') continue;
    const day = d.reviewDate.replace(/-/g, '');
    const next = addDays(d.reviewDate, 1).replace(/-/g, '');
    const summary = `${opts.prefix || 'Revízia'}: ${d.code ? d.code + ' – ' : ''}${d.title}`;
    const desc = [
      d.code && `${d.code}`,
      d.title,
      d.version && `${opts.versionLabel || 'Verzia'}: ${d.version}`,
      d.owner && `${opts.ownerLabel || 'Zodpovedný'}: ${d.owner}`,
      opts.org
    ]
      .filter(Boolean)
      .join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${d.id}-${day}@sop-archiv.local`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${day}`,
      `DTEND;VALUE=DATE:${next}`,
      `SUMMARY:${icsEscape(summary)}`,
      `DESCRIPTION:${icsEscape(desc)}`,
      'TRANSP:TRANSPARENT'
    );
    if (reminder > 0) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(summary)}`, `TRIGGER:-P${reminder}D`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// --- CSV (opens in Excel; semicolon separated, UTF-8 BOM) -----------------------

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(rows, columns) {
  const head = columns.map((c) => csvCell(c.label)).join(';');
  const body = rows.map((r) => columns.map((c) => csvCell(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(';'));
  return '﻿' + [head, ...body].join('\r\n') + '\r\n';
}

module.exports = { reviewState, summarize, buildIcs, buildCsv };
