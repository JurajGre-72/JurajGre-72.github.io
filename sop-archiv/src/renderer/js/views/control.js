// Approval of a document version (reviewers and approvers sign with their own password), the signature
// sheet (signatures in the app, and rows for people without the app to sign by hand – recorded back with
// the scan) and the register of controlled copies (numbered, for whom; PDFs stamped on every page; copies
// of old versions to withdraw).
import { t } from '../i18n.js';
import { html, icon, openModal, formValues, toast, fmtDateTime, fmtDate, confirmDialog, todayIso, errorToast } from '../ui.js';
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
    ${sheetsPanel(doc)}
    <section class="panel">
      <div class="panel-head"><h3>${icon('file')}${t('cp.title')}</h3>
        <button class="btn" data-action="cpIssue" data-perm="editor">${icon('plus')}${t('cp.issue')}</button></div>
      <p class="muted small">${t('cp.intro')}</p>
      ${old.length ? html`<div class="note note-warn">${icon('alert')}<div>${t('cp.toWithdraw', { n: old.length })}</div></div>` : ''}
      ${copies.length
        ? html`<div class="table-wrap"><table class="table compact"><thead><tr><th>${t('cp.no')}</th><th>${t('f.version')}</th><th>${t('cp.to')}</th><th>${t('cp.format')}</th><th>${t('cp.issued')}</th><th>${t('tr.status')}</th><th></th></tr></thead>
          <tbody>${copies.map((c) => {
            const outdated = c.status === 'issued' && c.versionId !== doc.currentVersionId;
            return html`<tr><td><b>${c.no}</b></td><td>${c.version}</td><td>${c.issuedTo}${c.location ? html` <span class="muted small">· ${c.location}</span>` : ''}</td><td class="small">${t(`cp.f.${c.format}`)}${c.stamped ? '' : html` <span class="muted">(${t('cp.noStamp')})</span>`}${c.withSheet ? html` <span class="muted">+ ${t('sh.short')}</span>` : ''}</td>
              <td class="small nowrap">${fmtDate(c.issuedAt.slice(0, 10))} · ${c.issuedBy}</td>
              <td>${c.status === 'withdrawn' ? html`<span class="chip chip-muted">${t('cp.withdrawn')} ${fmtDate(c.withdrawnAt.slice(0, 10))}</span>` : outdated ? html`<span class="chip chip-warn">${t('cp.withdrawNow')}</span>` : html`<span class="chip chip-good">${t('cp.valid')}</span>`}</td>
              <td>${c.status === 'issued' ? html`<button class="btn btn-sm" data-action="cpWithdraw" data-id="${c.id}" data-perm="editor">${t('cp.withdraw')}</button>` : ''}</td></tr>`;
          })}</tbody></table></div>`
        : html`<p class="muted small">${t('cp.none')}</p>`}
    </section>`;
}

/** Signatures: the sheet to print, and the sheets signed by hand that were recorded (with their scans). */
function sheetsPanel(doc) {
  const sheets = (doc.sheets || []).slice().reverse();
  return html`<section class="panel">
    <div class="panel-head"><h3>${icon('edit')}${t('sh.title')}</h3>
      <div class="btn-row" data-perm="editor">
        <button class="btn" data-action="shPrint">${icon('file')}${t('sh.print')}</button>
        <button class="btn" data-action="shRecord">${icon('check')}${t('sh.record')}</button>
      </div></div>
    <p class="muted small">${t('sh.intro')}</p>
    ${sheets.length
      ? html`<div class="table-wrap"><table class="table compact sh-table"><thead><tr><th>${t('sh.signedOn')}</th><th>${t('sh.kind')}</th><th>${t('sh.who')}</th><th>${t('f.version')}</th><th>${t('sh.recorded')}</th><th></th></tr></thead>
        <tbody>${sheets.map(
          (s) => html`<tr><td class="nowrap">${fmtDate(s.date)}</td><td>${t(`sh.k.${s.kind}`)}</td>
            <td>${s.kind === 'approval' ? s.signers.map((x) => `${x.name} (${t(`sh.role.${x.role}`)})`).join(', ') : s.people.map((p) => p.name).join(', ')}${s.note ? html`<div class="muted small">${s.note}</div>` : ''}</td>
            <td>${s.version}</td><td class="small nowrap">${s.by} · ${fmtDate(s.at.slice(0, 10))}</td>
            <td>${s.file ? html`<button class="btn btn-sm" data-action="shOpenScan" data-id="${s.id}">${icon('external')}${t('sh.scan')}</button>` : html`<span class="muted small">${t('sh.noScan')}</span>`}</td></tr>`
        )}</tbody></table></div>`
      : html`<p class="muted small">${t('sh.none')}</p>`}
  </section>`;
}

/** Print the signature sheet: what goes on it. */
export async function sheetPrintDialog(doc) {
  const tr = await api.training.doc(doc.id);
  const without = tr.rows.filter((r) => !r.record && !r.person.userId).length;
  const signedInApp = (doc.approvals || []).some((a) => a.versionId === doc.currentVersionId && a.status === 'approved');
  let out = null;
  const go = (mode) => async (el) => {
    const v = formValues(el);
    try {
      out = await api.sheets.pdf(doc.id, { handApproval: !!v.handApproval, people: !!v.people, emptyRows: v.emptyRows }, mode);
      if (out && out.file) toast(t('doc.copySaved', { path: out.file }), 'good', 6000);
      return !!out;
    } catch (e) {
      el.querySelector('#sh-err').textContent = errText(e);
      return false;
    }
  };
  await openModal({
    title: `${t('sh.print')} – ${doc.code || doc.title} v${doc.version}`,
    size: 'md',
    body: html`<form class="form-grid sh-form">
      <p class="field full">${t('sh.printIntro')}</p>
      <label class="check field full"><input type="checkbox" name="handApproval" ${signedInApp ? '' : 'checked'}> ${t('sh.optHand')}</label>
      <label class="check field full"><input type="checkbox" name="people" checked> ${t('sh.optPeople', { n: without })}</label>
      <div class="field"><label>${t('sh.optEmpty')}</label><input type="number" name="emptyRows" min="0" max="100" value="8"></div>
      <p class="field full muted small">${doc.current && /\.pdf$/i.test(doc.current.fileName) ? t('sh.copyHint') : t('sh.copyHintNoPdf')}</p>
      <div class="field full err small" id="sh-err"></div>
    </form>`,
    buttons: [
      { label: t('cancel'), value: null },
      { label: t('sh.save'), value: 'save', onClick: go('save') },
      { label: t('sh.open'), kind: 'primary', value: 'open', onClick: go('open') }
    ]
  });
  return out;
}

/** The signed paper sheet recorded back: who signed (employees, or approval by hand), when, the scan. */
export async function sheetRecordDialog(doc) {
  const [tr, all] = await Promise.all([api.training.doc(doc.id), api.people.list()]);
  const missing = new Set(tr.rows.filter((r) => !r.record).map((r) => r.person.id));
  const people = all.filter((p) => p.active !== false).sort((a, b) => (missing.has(b.id) - missing.has(a.id)) || a.name.localeCompare(b.name, 'sk'));
  let scan = null;
  let saved = null;
  const signerRow = (role) => html`<div class="sh-signer"><span>${t(`sh.role.${role}`)}</span><input data-signer="${role}" placeholder="${t('sh.signerName')}"><input data-pos="${role}" placeholder="${t('sh.signerPos')}"></div>`;
  await openModal({
    title: `${t('sh.record')} – ${doc.code || doc.title} v${doc.version}`,
    size: 'lg',
    body: html`<form class="form-grid sh-form" autocomplete="off">
      <div class="field full radio-col">
        <label class="radio"><input type="radio" name="kind" value="reading" checked> ${t('sh.k.reading')}</label>
        <label class="radio"><input type="radio" name="kind" value="approval"> ${t('sh.k.approval')}</label>
      </div>
      <div class="field full" id="sh-people"><label>${t('sh.whoSigned')}</label>
        <div class="tr-people">${people.map((p) => html`<label class="check"><input type="checkbox" data-person="${p.id}"> ${p.name} <span class="muted small">${[p.position, p.department].filter(Boolean).join(', ')}</span>${missing.has(p.id) ? html` <span class="chip chip-warn">${t('tr.missing')}</span>` : ''}${p.userId ? '' : html` <span class="chip chip-muted">${t('sh.noApp')}</span>`}</label>`)}</div>
        ${people.length ? '' : html`<p class="muted small">${t('tr.noPeople')}</p>`}</div>
      <div class="field full" id="sh-signers" hidden><label>${t('sh.signers')}</label>${['prepared', 'review', 'approve'].map(signerRow)}<span class="hint">${t('sh.signersHint')}</span></div>
      <div class="field"><label>${t('sh.signedOn')}</label><input type="date" name="date" value="${todayIso()}"></div>
      <div class="field"><label>${t('sh.scanLabel')}</label><div class="btn-row"><button type="button" class="btn btn-sm" id="sh-pick">${icon('upload')}${t('sh.pick')}</button><span class="small" id="sh-file">${t('sh.noScanYet')}</span></div></div>
      <div class="field full"><label>${t('rv.notes')}</label><textarea name="note" rows="2" placeholder="${t('sh.notePh')}"></textarea></div>
      <p class="field full muted small">${t('sh.recordHint')}</p>
      <div class="field full err small" id="sh-err"></div>
    </form>`,
    onMount: (el) => {
      el.addEventListener('change', (e) => {
        if (e.target.name !== 'kind') return;
        const approval = e.target.value === 'approval';
        el.querySelector('#sh-people').hidden = approval;
        el.querySelector('#sh-signers').hidden = !approval;
      });
      el.querySelector('#sh-pick').addEventListener('click', async () => {
        try {
          const f = await api.sheets.pickScan();
          if (!f) return;
          scan = f;
          el.querySelector('#sh-file').textContent = `${f.name} (${Math.max(1, Math.round(f.size / 1024))} kB)`;
        } catch (e) {
          errorToast(e);
        }
      });
    },
    buttons: [
      { label: t('cancel'), value: null },
      {
        label: t('save'),
        kind: 'primary',
        value: 'ok',
        onClick: async (el) => {
          const v = formValues(el);
          const signers = ['prepared', 'review', 'approve'].map((role) => ({ role, name: el.querySelector(`[data-signer="${role}"]`).value, position: el.querySelector(`[data-pos="${role}"]`).value })).filter((x) => x.name.trim());
          try {
            saved = await api.sheets.record(doc.id, {
              kind: v.kind,
              personIds: Array.from(el.querySelectorAll('[data-person]:checked')).map((x) => x.dataset.person),
              signers,
              date: v.date,
              note: v.note,
              scan: scan ? scan.path : null
            });
            return true;
          } catch (e) {
            el.querySelector('#sh-err').textContent = errText(e);
            return false;
          }
        }
      }
    ]
  });
  if (saved) toast(t('sh.saved'), 'good');
  return saved;
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
      ${pdf
        ? html`<label class="check field full"><input type="checkbox" name="signSheet" checked> ${t('cp.withSheet')}</label>
          <label class="check field full cp-sub"><input type="checkbox" name="handApproval"> ${t('sh.optHand')}</label>`
        : html`<p class="field full muted small">${t('sh.copyHintNoPdf')}</p>`}
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
            const v = formValues(el);
            res = await api.copies.issue(doc.id, { ...v, signSheet: !!v.signSheet, handApproval: !!v.handApproval });
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
  async shPrint() {
    await sheetPrintDialog(getDoc());
  },
  async shRecord() {
    if (await sheetRecordDialog(getDoc())) {
      app.refreshSidebar();
      app.rerender();
    }
  },
  async shOpenScan(el) {
    await api.sheets.openScan(getDoc().id, el.dataset.id);
  },
  async cpWithdraw(el) {
    await api.copies.withdraw(getDoc().id, el.dataset.id);
    toast(t('cp.withdrawnToast'), 'good');
    app.rerender();
  }
});
