// Training records: my documents to read, coverage per document and per employee, recording a training
// session, employees, and the employee's training card (printable).
import { t } from '../i18n.js';
import { html, icon, openModal, formValues, toast, errorToast, fmtDate, todayIso } from '../ui.js';
import { app } from '../app.js';

const api = window.api;
let ov = null;
let mine = null;
let people = [];
let users = [];

const METHODS = ['session', 'reading', 'onjob', 'self', 'signed'];

function bar(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return html`<div class="tr-bar" title="${done} / ${total}"><div class="progress"><div class="progress-bar ${pct === 100 ? 'full' : ''}" style="width:${pct}%"></div></div><span class="small">${done}/${total}</span></div>`;
}

function forLabel(list) {
  if (!list || !list.length) return html`<span class="muted small">${t('tr.forNone')}</span>`;
  return list.includes('*') ? t('tr.forAll') : list.join(', ');
}

export async function render() {
  [ov, mine, people] = await Promise.all([api.training.overview(), api.training.mine(), api.people.list()]);
  users = app.can('admin') ? await api.users.list().catch(() => []) : [];
  const docsReq = ov.docs.slice().sort((a, b) => b.missing.length - a.missing.length || (a.code || '').localeCompare(b.code || '', 'sk', { numeric: true }));
  return html`<div class="page training">
    <header class="page-head">
      <div><h1>${t('tr.title')}</h1><p class="muted">${t('tr.intro')}</p></div>
      <div class="head-actions">
        <button class="btn" data-action="exportCsv">${icon('download')}${t('tr.export')}</button>
        <button class="btn btn-primary" data-action="record" data-perm="editor">${icon('check')}${t('tr.record')}</button>
      </div>
    </header>

    <section class="panel ${mine.docs.length ? 'panel-warn' : ''}">
      <h3>${icon('file')}${t('tr.mine')} ${mine.person ? html`<span class="count">${mine.docs.length}</span>` : ''}</h3>
      ${mine.person
        ? mine.docs.length
          ? html`<ul class="rows">${mine.docs.map(
              (d) => html`<li class="row"><a class="row-main" href="#/documents/${d.id}"><span class="code">${d.code || '—'}</span><span class="row-title">${d.title}</span></a><span class="muted small">v${d.version}</span>
              <button class="btn btn-sm" data-action="openDoc" data-id="${d.id}">${icon('external')}${t('doc.openFile')}</button>
              <button class="btn btn-sm btn-primary" data-action="confirmRead" data-id="${d.id}">${icon('check')}${t('tr.readOk')}</button></li>`
            )}</ul>`
          : html`<p class="muted">${icon('checkCircle')}${t('tr.mineDone')}</p>`
        : html`<p class="muted small">${t('tr.notLinked')}</p>`}
    </section>

    <section class="panel">
      <h3>${icon('layers')}${t('tr.byDoc')} <span class="count">${docsReq.length}</span> ${ov.missing ? html`<span class="chip chip-warn">${t('tr.missingN', { n: ov.missing })}</span>` : ''}</h3>
      ${docsReq.length
        ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th>${t('f.code')}</th><th>${t('f.title')}</th><th>${t('f.version')}</th><th>${t('tr.for')}</th><th>${t('tr.trained')}</th><th></th></tr></thead>
          <tbody>${docsReq.map(
            (d) => html`<tr><td class="nowrap"><a href="#/documents/${d.id}?tab=training">${d.code || '—'}</a></td><td>${d.title}</td><td>${d.version}</td><td class="small">${forLabel(d.trainingFor)}</td><td>${bar(d.trained, d.required)}</td>
              <td><button class="btn btn-sm" data-action="record" data-doc="${d.id}" data-perm="editor">${icon('check')}${t('tr.recordShort')}</button></td></tr>`
          )}</tbody></table></div>`
        : html`<p class="muted">${t('tr.noDocs')}</p>`}
    </section>

    <section class="panel">
      <div class="section-head"><h3>${icon('users')}${t('tr.people')} <span class="count">${people.filter((p) => p.active !== false).length}</span></h3>
        <button class="btn btn-sm" data-action="addPerson" data-perm="admin">${icon('plus')}${t('tr.addPerson')}</button></div>
      ${people.length
        ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th>${t('tr.name')}</th><th>${t('f.department')}</th><th>${t('tr.position')}</th><th>${t('tr.profile')}</th><th>${t('tr.trained')}</th><th></th></tr></thead>
          <tbody>${people.map((p) => {
            const o = ov.people.find((x) => x.id === p.id) || { required: 0, trained: 0, missing: [] };
            return html`<tr class="${p.active === false ? 'muted' : ''}"><td><b>${p.name}</b>${p.active === false ? html` <span class="chip chip-muted">${t('tr.inactive')}</span>` : ''}</td><td>${p.department}</td><td>${p.position}</td><td class="small">${p.userName || ''}</td>
              <td>${o.required ? bar(o.trained, o.required) : html`<span class="muted small">—</span>`}</td>
              <td class="nowrap"><button class="btn btn-sm" data-action="card" data-id="${p.id}">${icon('file')}${t('tr.card')}</button>
                <button class="btn btn-sm btn-ghost" data-action="editPerson" data-id="${p.id}" data-perm="admin">${icon('edit')}</button></td></tr>`;
          })}</tbody></table></div>`
        : html`<p class="muted">${t('tr.noPeople')}</p>`}
    </section>
  </div>`;
}

async function personDialog(person) {
  const deps = app.info.archiveSettings.departments;
  const r = await openModal({
    title: person ? `${t('edit')} – ${person.name}` : t('tr.addPerson'),
    size: 'md',
    body: html`<form class="form-grid">
      <div class="field full"><label>${t('tr.name')}</label><input name="name" value="${person ? person.name : ''}" required></div>
      <div class="field"><label>${t('f.department')}</label><select name="department"><option value="">${t('none')}</option>${Array.from(new Set([...deps, person && person.department].filter(Boolean))).map((d) => html`<option ${person && d === person.department ? 'selected' : ''}>${d}</option>`)}</select></div>
      <div class="field"><label>${t('tr.position')}</label><input name="position" value="${person ? person.position : ''}"></div>
      <div class="field full"><label>${t('tr.profile')}</label><select name="userId"><option value="">${t('tr.noProfile')}</option>${users.map((u) => html`<option value="${u.id}" ${person && person.userId === u.id ? 'selected' : ''}>${u.name}</option>`)}</select><span class="hint">${t('tr.profileHint')}</span></div>
      <div class="field full"><label class="check"><input type="checkbox" name="active" ${!person || person.active !== false ? 'checked' : ''}> ${t('tr.active')}</label></div>
      <div class="field full err small" id="pd-err"></div>
    </form>`,
    buttons: [
      { label: t('cancel'), value: null },
      {
        label: t('save'),
        kind: 'primary',
        value: 'ok',
        onClick: async (el) => {
          try {
            await api.people.save({ ...(person ? { id: person.id } : {}), ...formValues(el) });
            return true;
          } catch (e) {
            el.querySelector('#pd-err').textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
            return false;
          }
        }
      }
    ]
  });
  if (r === 'ok') app.rerender();
}

/** Record a training session (or reading) of the current version of a document. */
export async function recordTrainingDialog(docId = '') {
  const [overview, all, docs] = await Promise.all([api.training.overview(), api.people.list(), api.docs.list()]);
  const active = all.filter((p) => p.active !== false);
  const candidates = docs.filter((d) => d.status === 'effective' || d.status === 'review').sort((a, b) => (a.code || '').localeCompare(b.code || '', 'sk', { numeric: true }));
  const missingOf = (id) => new Set(((overview.docs.find((d) => d.id === id) || {}).missing) || []);
  const requiredOf = (id) => {
    const d = overview.docs.find((x) => x.id === id);
    return d ? d.required : 0;
  };
  const peopleList = (id) => {
    const miss = missingOf(id);
    const req = new Set([...miss]);
    for (const p of overview.people) if (p.missing.some((m) => m.id === id)) req.add(p.id);
    return html`${active.map((p) => html`<label class="check"><input type="checkbox" data-person="${p.id}" ${miss.has(p.id) ? 'checked' : ''}> ${p.name} <span class="muted small">${p.department}</span>${miss.has(p.id) ? html` <span class="chip chip-warn">${t('tr.missing')}</span>` : ''}</label>`)}
      ${active.length ? '' : html`<p class="muted small">${t('tr.noPeople')}</p>`}`;
  };
  let saved = false;
  await openModal({
    title: t('tr.record'),
    size: 'lg',
    body: html`<form class="form-grid tr-form">
      <div class="field full"><label>${t('tr.doc')}</label><select name="docId" id="tr-doc">${candidates.map((d) => html`<option value="${d.id}" ${d.id === docId ? 'selected' : ''}>${d.code || ''} ${d.title} (v${d.version})</option>`)}</select><span class="hint" id="tr-req"></span></div>
      <div class="field"><label>${t('rv.date')}</label><input type="date" name="date" value="${todayIso()}"></div>
      <div class="field"><label>${t('tr.method')}</label><select name="method">${METHODS.filter((m) => m !== 'self' && m !== 'signed').map((m) => html`<option value="${m}">${t(`tr.m.${m}`)}</option>`)}</select></div>
      <div class="field full"><label>${t('tr.trainer')}</label><input name="trainer" placeholder="${t('tr.trainerPh')}"></div>
      <div class="field full"><label>${t('tr.participants')}</label><div class="tr-people" id="tr-people"></div>
        <div class="btn-row"><button type="button" class="btn btn-sm btn-ghost" id="tr-all">${t('tr.selectAll')}</button><button type="button" class="btn btn-sm btn-ghost" id="tr-none">${t('tr.selectNone')}</button></div></div>
      <div class="field full"><label>${t('rv.notes')}</label><textarea name="notes" rows="2"></textarea></div>
      <div class="field full err small" id="tr-err"></div>
    </form>`,
    buttons: [
      { label: t('cancel'), value: null },
      {
        label: t('save'),
        kind: 'primary',
        value: 'ok',
        onClick: async (el) => {
          const v = formValues(el);
          const personIds = Array.from(el.querySelectorAll('[data-person]:checked')).map((x) => x.dataset.person);
          try {
            const recs = await api.training.record({ docId: v.docId, personIds, date: v.date, method: v.method, trainer: v.trainer, notes: v.notes });
            toast(t('tr.saved', { n: recs.length }), 'good');
            saved = true;
            return true;
          } catch (e) {
            el.querySelector('#tr-err').textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
            return false;
          }
        }
      }
    ],
    onMount: (m) => {
      const sel = m.querySelector('#tr-doc');
      const draw = () => {
        m.querySelector('#tr-people').innerHTML = String(peopleList(sel.value));
        const n = requiredOf(sel.value);
        m.querySelector('#tr-req').textContent = n ? t('tr.reqHint', { n, missing: missingOf(sel.value).size }) : t('tr.reqNone');
      };
      sel.addEventListener('change', draw);
      m.querySelector('#tr-all').addEventListener('click', () => m.querySelectorAll('[data-person]').forEach((c) => (c.checked = true)));
      m.querySelector('#tr-none').addEventListener('click', () => m.querySelectorAll('[data-person]').forEach((c) => (c.checked = false)));
      draw();
    }
  });
  return saved;
}

async function cardDialog(personId) {
  const c = await api.training.person(personId);
  const org = app.info.archiveSettings.org || '';
  const body = html`<div class="tr-card">
    <div class="tr-card-head"><div><b>${c.person.name}</b><div class="muted small">${[c.person.department, c.person.position].filter(Boolean).join(' · ')}</div></div></div>
    ${c.missing.length ? html`<div class="note note-warn">${icon('alert')}<div>${t('tr.cardMissing')}: ${c.missing.map((d) => `${d.code || d.title} (v${d.version})`).join(', ')}</div></div>` : html`<div class="note note-good">${icon('checkCircle')}<div>${t('tr.cardComplete')}</div></div>`}
    <div class="table-wrap"><table class="table compact">
      <thead><tr><th>${t('rv.date')}</th><th>${t('f.code')}</th><th>${t('f.title')}</th><th>${t('f.version')}</th><th>${t('tr.method')}</th><th>${t('tr.trainer')}</th></tr></thead>
      <tbody>${c.records.length ? c.records.map((r) => html`<tr><td class="nowrap">${fmtDate(r.date)}</td><td class="nowrap">${r.code || ''}</td><td>${r.title}</td><td>${r.version}</td><td>${t(`tr.m.${r.method}`)}${r.confirmedByUser ? html` <span class="chip chip-good">${t('tr.signed')}</span>` : ''}</td><td>${r.trainer || ''}</td></tr>`) : html`<tr><td colspan="6" class="muted">${t('tr.noRecords')}</td></tr>`}</tbody>
    </table></div>
  </div>`;
  await openModal({
    title: `${t('tr.card')} – ${c.person.name}`,
    size: 'lg',
    body,
    buttons: [
      {
        label: t('tr.print'),
        value: null,
        onClick: (m) => {
          const area = document.createElement('div');
          area.id = 'print-area';
          area.innerHTML = String(html`<h1>${t('tr.cardTitle')}</h1><p>${org}</p>${body}<p class="small">${t('tr.printedOn', { date: fmtDate(todayIso()) })}</p>`);
          document.body.appendChild(area);
          window.print();
          area.remove();
          return false;
        }
      },
      { label: t('close'), kind: 'primary', value: null }
    ]
  });
}

/** "Read and understood": the employee confirms with their own password. */
export async function confirmReadDialog(doc) {
  let ok = false;
  await openModal({
    title: t('tr.readOk'),
    size: 'sm',
    body: html`<form class="form-grid" autocomplete="off">
      <p class="field full">${t('tr.readText', { doc: `${doc.code || ''} ${doc.title}`.trim(), v: doc.version })}</p>
      <div class="field full"><label>${t('auth.password')}</label><input type="password" name="pw" id="tr-pw" required></div>
      <p class="field full muted small">${t('tr.readNote')}</p>
      <div class="field full err small" id="tr-pw-err"></div>
    </form>`,
    buttons: [
      { label: t('cancel'), value: null },
      {
        label: t('tr.confirm'),
        kind: 'primary',
        value: 'ok',
        onClick: async (el) => {
          try {
            await api.training.confirm(doc.id, el.querySelector('#tr-pw').value);
            ok = true;
            return true;
          } catch (e) {
            el.querySelector('#tr-pw-err').textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
            return false;
          }
        }
      }
    ]
  });
  if (ok) toast(t('tr.readSaved'), 'good');
  return ok;
}

export const actions = {
  async record(el) {
    if (await recordTrainingDialog(el.dataset.doc || '')) {
      app.refreshSidebar();
      app.rerender();
    }
  },
  addPerson: () => personDialog(null),
  editPerson: (el) => personDialog(people.find((p) => p.id === el.dataset.id)),
  card: (el) => cardDialog(el.dataset.id),
  openDoc: (el) => api.docs.open(el.dataset.id),
  async confirmRead(el) {
    const d = mine.docs.find((x) => x.id === el.dataset.id);
    if (await confirmReadDialog(d)) {
      app.refreshSidebar();
      app.rerender();
    }
  },
  async exportCsv() {
    try {
      const p = await api.training.exportCsv({
        person: t('tr.name'),
        department: t('f.department'),
        code: t('f.code'),
        title: t('f.title'),
        version: t('f.version'),
        date: t('rv.date'),
        method: t('tr.method'),
        trainer: t('tr.trainer'),
        by: t('tr.recordedBy'),
        confirmed: t('tr.signedLong'),
        methods: Object.fromEntries(METHODS.map((m) => [m, t(`tr.m.${m}`)]))
      });
      if (p) toast(t('rev.saved', { path: p }), 'good');
    } catch (e) {
      errorToast(e);
    }
  }
};

export function onDataChanged() {
  app.rerender();
}
