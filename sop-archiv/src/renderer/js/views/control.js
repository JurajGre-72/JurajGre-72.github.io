// Approval of a document version (reviewers and approvers sign with their own password) and the register
// of controlled copies (numbered, for whom; PDFs stamped on every page; copies of old versions to withdraw).
import { t } from '../i18n.js';
import { html, icon, openModal, formValues, toast, fmtDateTime, fmtDate, confirmDialog } from '../ui.js';
import { app } from '../app.js';

const api = window.api;

const errText = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function pending(doc) {
  return (doc.approvals || []).find((a) => a.status === 'pending') || null;
}

function nextStep(req) {
  return req ? req.steps.find((s) => !s.decision) : null;
}

/** Banner on the document page while a version waits for signatures. */
export function approvalBanner(doc) {
  const req = pending(doc);
  if (!req) return '';
  const step = nextStep(req);
  const mine = step && app.info.session && step.userId === app.info.session.userId;
  return html`<div class="note ${mine ? 'note-warn' : 'note-info'} apr-banner">${icon('shield')}
    <div><b>${t('apr.waiting', { v: req.version })}</b> ${step ? t(`apr.next.${step.role}`, { name: step.name }) : ''}
      <div class="small muted">${t('apr.requested', { by: req.requestedBy, at: fmtDateTime(req.requestedAt) })}${req.note ? ` · ${req.note}` : ''}</div></div>
    <div class="btn-row">${mine ? html`<button class="btn btn-primary" data-action="aprSign">${icon('check')}${t('apr.sign')}</button>` : ''}
      <button class="btn btn-ghost" data-action="aprCancel" data-perm="editor">${icon('x')}${t('apr.cancel')}</button></div>
  </div>`;
}

function stepsHtml(req) {
  return html`<ol class="apr-steps">${req.steps.map(
    (s) => html`<li class="${s.decision || 'open'}"><span class="apr-role">${t(`apr.role.${s.role}`)}</span> <b>${s.name}</b>
      ${s.decision ? html`<span class="chip chip-${s.decision === 'approved' ? 'good' : 'bad'}">${t(`apr.d.${s.decision}`)}</span> <span class="muted small">${fmtDateTime(s.at)}</span>${s.comment ? html`<div class="small">${s.comment}</div>` : ''}` : html`<span class="muted small">${t('apr.waitingSign')}</span>`}</li>`
  )}</ol>`;
}

/** The "Approval and copies" tab. */
export function controlTab(doc, toWithdraw) {
  const reqs = (doc.approvals || []).slice().reverse();
  const copies = (doc.copies || []).slice().reverse();
  const old = toWithdraw.filter((c) => c.docId === doc.id);
  return html`
    <section class="panel">
      <div class="panel-head"><h3>${icon('shield')}${t('apr.title')}</h3>
        ${pending(doc) ? '' : html`<button class="btn" data-action="aprRequest" data-perm="editor">${icon('check')}${t('apr.request')}</button>`}</div>
      ${reqs.length
        ? reqs.map(
            (r) => html`<article class="apr-req st-${r.status}"><div class="apr-head"><span class="chip chip-${r.status === 'approved' ? 'good' : r.status === 'rejected' ? 'bad' : r.status === 'pending' ? 'warn' : 'muted'}">${t(`apr.st.${r.status}`)}</span>
              <span>${t('f.version')} ${r.version}</span><span class="muted small">${t('apr.requested', { by: r.requestedBy, at: fmtDateTime(r.requestedAt) })}</span></div>
              ${r.note ? html`<p class="small">${r.note}</p>` : ''}${stepsHtml(r)}</article>`
          )
        : html`<p class="muted">${t('apr.none')}</p>`}
    </section>
    <section class="panel">
      <div class="panel-head"><h3>${icon('file')}${t('cp.title')}</h3>
        <button class="btn" data-action="cpIssue" data-perm="editor">${icon('plus')}${t('cp.issue')}</button></div>
      <p class="muted small">${t('cp.intro')}</p>
      ${old.length ? html`<div class="note note-warn">${icon('alert')}<div>${t('cp.toWithdraw', { n: old.length })}</div></div>` : ''}
      ${copies.length
        ? html`<div class="table-wrap"><table class="table compact"><thead><tr><th>${t('cp.no')}</th><th>${t('f.version')}</th><th>${t('cp.to')}</th><th>${t('cp.format')}</th><th>${t('cp.issued')}</th><th>${t('tr.status')}</th><th></th></tr></thead>
          <tbody>${copies.map((c) => {
            const outdated = c.status === 'issued' && c.versionId !== doc.currentVersionId;
            return html`<tr><td><b>${c.no}</b></td><td>${c.version}</td><td>${c.issuedTo}${c.location ? html` <span class="muted small">· ${c.location}</span>` : ''}</td><td class="small">${t(`cp.f.${c.format}`)}${c.stamped ? '' : html` <span class="muted">(${t('cp.noStamp')})</span>`}</td>
              <td class="small nowrap">${fmtDate(c.issuedAt.slice(0, 10))} · ${c.issuedBy}</td>
              <td>${c.status === 'withdrawn' ? html`<span class="chip chip-muted">${t('cp.withdrawn')} ${fmtDate(c.withdrawnAt.slice(0, 10))}</span>` : outdated ? html`<span class="chip chip-warn">${t('cp.withdrawNow')}</span>` : html`<span class="chip chip-good">${t('cp.valid')}</span>`}</td>
              <td>${c.status === 'issued' ? html`<button class="btn btn-sm" data-action="cpWithdraw" data-id="${c.id}" data-perm="editor">${t('cp.withdraw')}</button>` : ''}</td></tr>`;
          })}</tbody></table></div>`
        : html`<p class="muted small">${t('cp.none')}</p>`}
    </section>`;
}

export async function requestDialog(doc) {
  const active = ((await api.auth.state()).users || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'sk'));
  const opts = (role) => html`${active.map((u) => html`<label class="check"><input type="checkbox" data-${role}="${u.id}"> ${u.name} <span class="muted small">${t(`role.${u.role}`)}</span></label>`)}`;
  let ok = false;
  await openModal({
    title: `${t('apr.request')} – ${doc.code || doc.title} v${doc.version}`,
    size: 'md',
    body: html`<form class="form-grid">
      <div class="field full"><label>${t('apr.reviewers')}</label><div class="apr-pick">${opts('rev')}</div><span class="hint">${t('apr.reviewersHint')}</span></div>
      <div class="field full"><label>${t('apr.approvers')}</label><div class="apr-pick">${opts('apr')}</div></div>
      <div class="field full"><label>${t('rv.notes')}</label><textarea name="note" rows="2" placeholder="${t('apr.notePh')}"></textarea></div>
      <div class="field full err small" id="apr-err"></div>
    </form>`,
    buttons: [
      { label: t('cancel'), value: null },
      {
        label: t('apr.send'),
        kind: 'primary',
        value: 'ok',
        onClick: async (el) => {
          try {
            await api.approval.request(doc.id, {
              reviewers: Array.from(el.querySelectorAll('[data-rev]:checked')).map((x) => x.dataset.rev),
              approvers: Array.from(el.querySelectorAll('[data-apr]:checked')).map((x) => x.dataset.apr),
              note: formValues(el).note
            });
            ok = true;
            return true;
          } catch (e) {
            el.querySelector('#apr-err').textContent = errText(e);
            return false;
          }
        }
      }
    ]
  });
  if (ok) toast(t('apr.sent'), 'good');
  return ok;
}

export async function signDialog(doc) {
  const req = pending(doc);
  const step = nextStep(req);
  if (!step) return false;
  let ok = false;
  await openModal({
    title: `${t(`apr.role.${step.role}`)} – ${doc.code || doc.title} v${doc.version}`,
    size: 'md',
    body: html`<form class="form-grid apr-sign" autocomplete="off">
      <p class="field full">${t(`apr.signText.${step.role}`, { doc: `${doc.code || ''} ${doc.title}`.trim(), v: doc.version })}</p>
      <div class="field full radio-col">
        <label class="radio"><input type="radio" name="decision" value="approved" checked> ${t(`apr.yes.${step.role}`)}</label>
        <label class="radio"><input type="radio" name="decision" value="rejected"> ${t('apr.no')}</label>
      </div>
      <div class="field full"><label>${t('apr.comment')}</label><textarea name="comment" rows="2" placeholder="${t('apr.commentPh')}"></textarea></div>
      <div class="field full"><label>${t('auth.password')}</label><input type="password" name="pw" id="apr-pw" required></div>
      <p class="field full muted small">${t('apr.signNote')}</p>
      <div class="field full err small" id="apr-sign-err"></div>
    </form>`,
    buttons: [
      { label: t('cancel'), value: null },
      {
        label: t('apr.signBtn'),
        kind: 'primary',
        value: 'ok',
        onClick: async (el) => {
          const v = formValues(el);
          try {
            await api.approval.sign(doc.id, v.decision, v.comment, el.querySelector('#apr-pw').value);
            ok = true;
            return true;
          } catch (e) {
            el.querySelector('#apr-sign-err').textContent = errText(e);
            return false;
          }
        }
      }
    ]
  });
  if (ok) toast(t('apr.signed'), 'good');
  return ok;
}

export async function issueCopyDialog(doc) {
  const pdf = doc.current && /\.pdf$/i.test(doc.current.fileName);
  let res = null;
  await openModal({
    title: `${t('cp.issue')} – ${doc.code || doc.title} v${doc.version}`,
    size: 'md',
    body: html`<form class="form-grid">
      <div class="field full"><label>${t('cp.to')}</label><input name="issuedTo" placeholder="${t('cp.toPh')}" required></div>
      <div class="field full"><label>${t('cp.location')}</label><input name="location" placeholder="${t('cp.locationPh')}"></div>
      <div class="field full radio-col"><label class="radio"><input type="radio" name="format" value="print" checked> ${t('cp.f.print')}</label><label class="radio"><input type="radio" name="format" value="pdf"> ${t('cp.f.pdf')}</label></div>
      <p class="field full muted small">${pdf ? t('cp.stampNote') : t('cp.noStampNote')}</p>
      <div class="field full err small" id="cp-err"></div>
    </form>`,
    buttons: [
      { label: t('cancel'), value: null },
      {
        label: t('cp.issueBtn'),
        kind: 'primary',
        value: 'ok',
        onClick: async (el) => {
          try {
            res = await api.copies.issue(doc.id, formValues(el));
            return true;
          } catch (e) {
            el.querySelector('#cp-err').textContent = errText(e);
            return false;
          }
        }
      }
    ]
  });
  if (res) toast(t('cp.issued', { no: res.copy.no }), 'good');
  return res;
}

/** Actions merged into the document page's actions. */
export const controlActions = (getDoc) => ({
  async aprRequest() {
    if (await requestDialog(getDoc())) app.rerender();
  },
  async aprSign() {
    if (await signDialog(getDoc())) {
      app.refreshSidebar();
      app.rerender();
    }
  },
  async aprCancel() {
    if (!(await confirmDialog(t('apr.cancelConfirm'), { okLabel: t('apr.cancel'), danger: true }))) return;
    await api.approval.cancel(getDoc().id);
    app.rerender();
  },
  async cpIssue() {
    if (await issueCopyDialog(getDoc())) app.rerender();
  },
  async cpWithdraw(el) {
    await api.copies.withdraw(getDoc().id, el.dataset.id);
    toast(t('cp.withdrawnToast'), 'good');
    app.rerender();
  }
});
