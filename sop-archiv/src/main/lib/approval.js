'use strict';
// Approval of a document version: reviewers ("Preskúmal") and approvers ("Schválil") sign in order,
// each with their own password. A rejection ends the request; the last approval makes the version
// effective. Every step is kept with the document (who, when, decision, comment).

const ROLES = ['review', 'approve'];

/** A new request: steps for the reviewers, then the approvers (each a user of the archive). */
function createRequest({ doc, reviewers = [], approvers = [], note = '', by, users, now = new Date().toISOString() }) {
  const known = new Map(users.map((u) => [u.id, u]));
  const steps = [];
  for (const [role, ids] of [
    ['review', reviewers],
    ['approve', approvers]
  ]) {
    for (const userId of ids) {
      const u = known.get(userId);
      if (!u || u.disabled) throw new Error('UNKNOWN_SIGNER');
      if (steps.some((s) => s.userId === userId && s.role === role)) continue;
      steps.push({ role, userId, name: u.name, decision: null, at: null, comment: '' });
    }
  }
  if (!steps.some((s) => s.role === 'approve')) throw new Error('APPROVER_REQUIRED');
  const cur = (doc.versions || []).find((v) => v.id === doc.currentVersionId);
  return { id: `apr-${now}-${Math.random().toString(36).slice(2, 8)}`, versionId: doc.currentVersionId, versionSeq: cur ? cur.seq : 0, version: doc.version, status: 'pending', requestedBy: by, requestedAt: now, note: String(note || '').slice(0, 2000), steps };
}

/** The step waiting for a signature (reviews first, then approvals; in order). */
function nextStep(req) {
  if (!req || req.status !== 'pending') return null;
  return req.steps.find((s) => !s.decision) || null;
}

/** Sign the next step. decision: 'approved' | 'rejected'. Returns the updated request. */
function sign(req, { userId, decision, comment = '', now = new Date().toISOString() }) {
  const step = nextStep(req);
  if (!step) throw new Error('NOTHING_TO_SIGN');
  if (step.userId !== userId) throw new Error('NOT_YOUR_TURN');
  if (!['approved', 'rejected'].includes(decision)) throw new Error('Unknown decision');
  if (decision === 'rejected' && !String(comment || '').trim()) throw new Error('REASON_REQUIRED');
  step.decision = decision;
  step.at = now;
  step.comment = String(comment || '').slice(0, 2000);
  if (decision === 'rejected') {
    req.status = 'rejected';
    req.closedAt = now;
  } else if (!nextStep(req)) {
    req.status = 'approved';
    req.closedAt = now;
  }
  return req;
}

module.exports = { ROLES, createRequest, nextStep, sign };
