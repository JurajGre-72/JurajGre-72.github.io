'use strict';
// Approval of a document version: reviewers ("Preskúmal") and approvers ("Schválil") sign in order.
// Each signer signs either electronically – in the app, with their own password – or by hand on the
// document's signature sheet (people who do not use the app, or who are to sign on paper); a step signed
// by hand is completed when the signed sheet is recorded. A rejection ends the request; the last approval
// makes the version effective. Every step is kept with the document (who, how, when, decision, comment).

const ROLES = ['review', 'approve'];

/**
 * A new request: steps for the reviewers, then the approvers. reviewers / approvers: users of the archive
 * who sign in the app; hand: [{ role, name, position, userId? }] – who signs by hand on the signature sheet.
 */
function createRequest({ doc, reviewers = [], approvers = [], hand = [], note = '', by, users, now = new Date().toISOString() }) {
  const known = new Map(users.map((u) => [u.id, u]));
  const steps = [];
  const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  for (const [role, ids] of [
    ['review', reviewers],
    ['approve', approvers]
  ]) {
    for (const userId of ids) {
      const u = known.get(userId);
      if (!u || u.disabled) throw new Error('UNKNOWN_SIGNER');
      if (steps.some((s) => s.userId === userId && s.role === role)) continue;
      steps.push({ role, mode: 'app', userId, name: u.name, decision: null, at: null, comment: '' });
    }
    for (const h of hand || []) {
      if ((h.role === 'approve' ? 'approve' : 'review') !== role) continue;
      const u = h.userId ? known.get(h.userId) : null;
      const name = String((u && u.name) || h.name || '').trim().slice(0, 200);
      if (!name || steps.some((s) => s.role === role && same(s.name, name))) continue;
      steps.push({ role, mode: 'hand', userId: null, name, position: String(h.position || '').trim().slice(0, 200), decision: null, at: null, comment: '' });
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
  if (step.mode === 'hand') throw new Error('HAND_STEP');
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

/**
 * The signed sheet recorded: the signatures by hand that are next in order are completed (a hand
 * approval cannot overtake a review still to be signed in the app). Returns the completed steps.
 */
function signHand(req, { signedOn, by, sheetId, now = new Date().toISOString() }) {
  const step = nextStep(req);
  if (!step) throw new Error('NOTHING_TO_SIGN');
  if (step.mode !== 'hand') throw new Error('ORDER');
  const done = [];
  for (let s = nextStep(req); s && s.mode === 'hand'; s = nextStep(req)) {
    Object.assign(s, { decision: 'approved', at: now, signedOn, recordedBy: by, sheetId });
    done.push(s);
  }
  if (!nextStep(req)) {
    req.status = 'approved';
    req.closedAt = now;
  }
  return done;
}

module.exports = { ROLES, createRequest, nextStep, sign, signHand };
