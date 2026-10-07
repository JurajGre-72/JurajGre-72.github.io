'use strict';
// Filters for the audit trail (what an inspector asks: who, when, what, about which document).

const AREAS = {
  documents: /^(doc|copy|version)\./,
  approval: /^approval\./,
  training: /^training\./,
  legislation: /^(law|legislation|decision|company)\./,
  notices: /^notices?\./,
  users: /^(auth|user)\./,
  archive: /^(archive|report|audit|backup)\./,
  ai: /^ai\./
};

// Reading, signing in and out: left out by "changes only".
const NOT_CHANGES = new Set(['doc.opened', 'doc.copy-saved', 'auth.login', 'auth.logout', 'ai.question', 'report.exported', 'audit.exported', 'training.exported', 'doc.proposals-exported']);

function fold(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function areaOf(action) {
  for (const [k, re] of Object.entries(AREAS)) if (re.test(String(action || ''))) return k;
  return 'archive';
}

/**
 * rows: audit records (any order). f: { from, to (yyyy-mm-dd), user, area, docId, q, changesOnly, limit (0 = all) }.
 * Returns { rows (newest first, up to limit), total, users (everyone in the trail) }.
 */
function queryAudit(rows, f = {}) {
  const users = [...new Set(rows.map((r) => r.user).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sk'));
  const q = fold(f.q).trim();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(f.from || '') ? f.from : '';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(f.to || '') ? f.to : '';
  const day = (ts) => {
    // The local calendar day (what the user means by "from 1. 10."), not the UTC one.
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const out = rows.filter((r) => {
    const d = day(r.ts);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (f.user && r.user !== f.user) return false;
    if (f.area && areaOf(r.action) !== f.area) return false;
    if (f.docId && r.docId !== f.docId) return false;
    if (f.changesOnly && NOT_CHANGES.has(r.action)) return false;
    if (q && !fold(JSON.stringify(r)).includes(q)) return false;
    return true;
  });
  out.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  const limit = Number(f.limit) || 0;
  return { rows: limit ? out.slice(0, limit) : out, total: out.length, users };
}

module.exports = { queryAudit, areaOf, AREAS: Object.keys(AREAS) };
