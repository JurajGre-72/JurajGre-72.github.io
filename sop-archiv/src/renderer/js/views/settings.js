// Settings: my profile (everyone), users and archive settings (administrator), privacy logs.
import { t, setLang, lang } from '../i18n.js';
import { html, icon, fmtDateTime, toast, errorToast, formValues, openModal, confirmDialog } from '../ui.js';
import { app } from '../app.js';
import { auditDetails } from './document.js';
import { showRecoveryCode } from './recovery.js';

const api = window.api;
let netLog = [];
let audit = [];
let users = [];
let company = { profile: { activities: {}, notes: '' }, activities: [] };

// What the company does and does not do (see lib/company.js); administrators edit it.
function companySection() {
  const p = company.profile;
  const val = (id) => p.activities[id] || '';
  return html`<p class="muted">${t('co.intro')}</p>
    <form class="form-grid" data-submit="saveCompany">
      <div class="field full"><div class="co-grid">${company.activities.map(
        (a) => html`<div class="co-row"><span>${lang() === 'sk' ? a.sk : a.en}</span>
          <div class="seg" role="radiogroup" aria-label="${lang() === 'sk' ? a.sk : a.en}">
            ${[['yes', t('co.yes')], ['no', t('co.no')], ['', t('co.unset')]].map(
              ([v, label]) => html`<label class="seg-opt ${v === 'no' ? 'seg-no' : v === 'yes' ? 'seg-yes' : ''}"><input type="radio" name="act-${a.id}" value="${v}" ${val(a.id) === v ? 'checked' : ''} ${app.can('admin') ? '' : 'disabled'}><span>${label}</span></label>`
            )}
          </div></div>`
      )}</div></div>
      <div class="field full"><label>${t('co.notes')}</label><textarea name="notes" rows="3" placeholder="${t('co.notesPh')}" ${app.can('admin') ? '' : 'readonly'}>${p.notes || ''}</textarea></div>
      ${p.updatedAt ? html`<p class="field full muted small">${p.updatedBy} · ${fmtDateTime(p.updatedAt)}</p>` : ''}
      <div class="field full btn-row" data-perm="admin"><button class="btn btn-primary">${t('save')}</button></div>
    </form>`;
}

function section(id, title, iconName, body, perm) {
  return html`<section class="panel settings-sec" id="set-${id}" ${perm ? html`data-perm="${perm}"` : ''}><h3>${icon(iconName)}${title}</h3>${body}</section>`;
}

const errText = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function aiSection(s) {
  const p = s.ai.provider || 'none';
  const defaults = { ollama: 'http://127.0.0.1:11434', openai: 'http://127.0.0.1:1234/v1' };
  const modelDefault = { ollama: 'qwen2.5:7b', openai: '' };
  return html`
    <p class="muted">${t('set.aiIntro')}</p>
    <div class="note">${icon('lock')}${t('set.aiLocalOnly')}</div>
    <form id="ai-form" class="form-grid">
      <div class="field full radio-col">
        ${['none', 'ollama', 'openai'].map((x) => html`<label class="radio"><input type="radio" name="provider" value="${x}" ${x === p ? 'checked' : ''} data-change="aiProvider"> ${t(`set.ai.${x}`)}</label>`)}
      </div>
      ${p === 'none'
        ? ''
        : html`
        <div class="field full note">${icon('info')}${t('set.aiOllamaHelp')}</div>
        <div class="field"><label>${t('set.aiBaseUrl')}</label><input name="baseUrl" value="${s.ai.baseUrl || defaults[p]}"><span class="hint">${t('set.aiUrlHint')}</span></div>
        <div class="field"><label>${t('set.aiModel')}</label><input name="model" value="${s.ai.model || modelDefault[p]}" list="ai-models"><datalist id="ai-models"></datalist></div>
        ${p === 'openai'
          ? html`<div class="field full"><label>${t('set.aiKey')}</label><input type="password" name="apiKey" autocomplete="off" placeholder="${s.ai.hasApiKey ? '••••••••' : t('set.aiKeyOptional')}">
              ${s.ai.hasApiKey ? html`<span class="hint">${t('set.aiKeySet', { how: s.ai.keyEncrypted ? t('set.aiKeyEnc') : t('set.aiKeyPlain') })} <button type="button" class="link" data-action="clearKey">${t('set.aiKeyClear')}</button></span>` : ''}</div>`
          : ''}
        <div class="field"><label>${t('set.aiBudget')}</label><input type="number" name="budget" min="2000" step="1000" value="${s.ai.budget || 14000}"></div>
        <div class="field full btn-row"><button type="button" class="btn" data-action="aiTest">${icon('refresh')}${t('set.aiTest')}</button> <span id="ai-test" class="small"></span></div>
      `}
      <div class="field full btn-row"><button type="button" class="btn btn-primary" data-action="aiSave">${t('save')}</button></div>
    </form>`;
}

function usersSection() {
  const me = app.info.session;
  return html`<p class="muted">${t('usr.intro')}</p>
    <div class="table-wrap"><table class="table users-table">
      <thead><tr><th>${t('auth.name')}</th><th>${t('auth.role')}</th><th>${t('usr.lastLogin')}</th><th>${t('f.status')}</th><th></th></tr></thead>
      <tbody>${users.map(
        (u) => html`<tr class="${u.disabled ? 'disabled' : ''}">
          <td><b>${u.name}</b>${u.id === me.userId ? html` <span class="chip chip-muted">${t('usr.you')}</span>` : ''}</td>
          <td>${t(`role.${u.role}`)}</td>
          <td class="muted small nowrap">${u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : '—'}</td>
          <td>${u.disabled ? html`<span class="chip chip-muted">${t('usr.disabled')}</span>` : u.needsPassword ? html`<span class="chip chip-warn" title="${t('usr.needsPasswordHint')}">${t('usr.needsPassword')}</span>` : html`<span class="chip chip-good">${t('usr.active')}</span>`}</td>
          <td class="nowrap">
            <button class="btn btn-sm" data-action="editUser" data-id="${u.id}">${icon('edit')}${t('edit')}</button>
            <button class="btn btn-sm" data-action="resetPw" data-id="${u.id}">${icon('key')}${t('usr.resetPw')}</button>
            ${u.id !== me.userId ? html`<button class="btn btn-sm btn-ghost" data-action="toggleUser" data-id="${u.id}">${u.disabled ? t('usr.enable') : t('usr.disable')}</button>` : ''}
          </td>
        </tr>`
      )}</tbody></table></div>
    <div class="btn-row"><button class="btn btn-primary" data-action="addUser">${icon('plus')}${t('usr.add')}</button></div>
    <h4>${t('usr.roles')}</h4>
    <ul class="role-help">
      <li><b>${t('role.reader')}</b> – ${t('role.reader.help')}</li>
      <li><b>${t('role.editor')}</b> – ${t('role.editor.help')}</li>
      <li><b>${t('role.admin')}</b> – ${t('role.admin.help')}</li>
    </ul>`;
}

export async function render() {
  await app.reloadInfo();
  [netLog, audit, users, company] = await Promise.all([api.app.networkLog(), api.app.audit({ limit: 150 }), app.info.session.role === 'admin' ? api.users.list() : Promise.resolve([]), api.company.get()]);
  const s = app.info.settings;
  const a = app.info.archiveSettings;
  const me = app.info.session;
  const types = a.docTypes;
  return html`<div class="page settings">
    <header class="page-head"><div><h1>${t('set.title')}</h1></div></header>

    ${section(
      'me',
      t('set.me'),
      'user',
      html`<div class="me-card"><span class="avatar">${me.name.split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join('')}</span><div><b>${me.name}</b><div class="muted small">${t(`role.${me.role}`)}</div></div></div>
      <form class="form-grid" data-submit="savePrefs">
        <div class="field"><label>${t('set.lang')}</label><select name="lang"><option value="sk" ${s.lang === 'sk' ? 'selected' : ''}>Slovenčina</option><option value="en" ${s.lang === 'en' ? 'selected' : ''}>English</option></select></div>
        <div class="field"><label>${t('set.theme')}</label><select name="theme">${['system', 'light', 'dark'].map((x) => html`<option value="${x}" ${s.theme === x ? 'selected' : ''}>${t(`set.theme.${x}`)}</option>`)}</select></div>
        <div class="field full btn-row"><button class="btn btn-primary">${t('save')}</button></div>
      </form>
      <h4>${t('usr.changePw')}</h4>
      <form class="form-grid" data-submit="changePw" autocomplete="off" data-perm="reader">
        <div class="field"><label>${t('usr.oldPw')}</label><input type="password" name="old" required></div>
        <div class="field"></div>
        <div class="field"><label>${t('usr.newPw')}</label><input type="password" name="pw" required></div>
        <div class="field"><label>${t('auth.password2')}</label><input type="password" name="pw2" required></div>
        <div class="field full btn-row"><button class="btn">${icon('key')}${t('usr.changePw')}</button></div>
      </form>`
    )}

    ${section('users', t('usr.title'), 'users', usersSection(), 'admin')}

    ${section(
      'archive',
      t('set.archive'),
      'folder',
      html`<p class="muted">${t('set.dataDirHint')}</p>
      <div class="path-box">${icon('folder')}<code>${app.info.dataDir}</code></div>
      <p class="muted small">${t('set.sharedHint')}</p>
      <div class="btn-row">
        <button class="btn" data-action="openFolder">${icon('external')}${t('set.openFolder')}</button>
        <button class="btn" data-action="backup" data-perm="editor">${icon('download')}${t('set.backup')}</button>
        <button class="btn" data-action="copyArchive" data-perm="admin">${icon('layers')}${t('set.copyFolder')}</button>
        <button class="btn btn-ghost" data-action="switchArchive" data-perm="admin">${icon('folder')}${t('set.switchFolder')}</button>
      </div>
      <div class="logo-setting" data-perm="admin">
        <h4>${t('set.logo')}</h4>
        <div class="logo-row">
          <div class="logo-preview"><img src="${app.logoUrl}" alt=""></div>
          <div class="btn-row">
            <button class="btn" data-action="setLogo">${icon('upload')}${t('set.logoPick')}</button>
            ${app.customLogo ? html`<button class="btn btn-ghost" data-action="clearLogo">${icon('x')}${t('set.logoRemove')}</button>` : ''}
          </div>
        </div>
        <p class="muted small">${t('set.logoHint')}</p>
      </div>
      <form class="form-grid" data-submit="saveOrg" data-perm="admin">
        <div class="field"><label>${t('set.org')}</label><input name="org" value="${a.org || ''}"></div>
        <div class="field"><label>${t('set.autoLock')}</label><input type="number" name="autoLockMinutes" min="0" max="480" value="${a.autoLockMinutes ?? 30}"><span class="hint">${t('set.autoLockHint')}</span></div>
        <div class="field full btn-row"><button class="btn btn-primary">${t('save')}</button></div>
      </form>`
    )}

    ${section('company', t('co.title'), 'shield', companySection())}

    ${section(
      'reviews',
      t('set.reviews'),
      'bell',
      html`<form class="form-grid" data-submit="saveReviews">
        <div class="field"><label>${t('set.warnDays')}</label><input type="number" name="warnDays" min="1" max="365" value="${a.warnDays}"></div>
        <div class="field"><label>${t('set.icsDays')}</label><input type="number" name="reminderDaysIcs" min="0" max="120" value="${a.reminderDaysIcs}"></div>
        <div class="field full"><label class="check"><input type="checkbox" name="notifications" ${s.notifications ? 'checked' : ''}> ${t('set.notifications')}</label></div>
        <div class="field full"><label class="check"><input type="checkbox" name="launchAtLogin" ${s.launchAtLogin ? 'checked' : ''}> ${t('set.launchAtLogin')}</label></div>
        <div class="field full"><label class="check"><input type="checkbox" name="runInBackground" ${s.runInBackground ? 'checked' : ''}> ${t('set.background')}</label><span class="hint">${t('set.backgroundHint')}</span></div>
        <div class="field full btn-row"><button class="btn btn-primary">${t('save')}</button></div>
      </form>`,
      'admin'
    )}

    ${section(
      'types',
      `${t('set.types')} · ${t('set.departments')}`,
      'layers',
      html`<form class="form-grid" data-submit="saveTypes">
        <div class="field full"><div class="table-wrap"><table class="table compact" id="types-table">
          <thead><tr><th>${t('set.typeCode')}</th><th>${t('set.typeName')} (SK)</th><th>${t('set.typeName')} (EN)</th><th>${t('set.typeInterval')}</th><th></th></tr></thead>
          <tbody>${types.map(
            (tp) => html`<tr><td><input data-k="id" value="${tp.id}" size="8"></td><td><input data-k="sk" value="${tp.sk}"></td><td><input data-k="en" value="${tp.en}"></td><td><input data-k="interval" type="number" min="1" max="120" value="${tp.interval}" size="4"></td><td><button type="button" class="btn btn-sm btn-ghost danger" data-action="delType">${icon('x')}</button></td></tr>`
          )}</tbody></table></div>
          <button type="button" class="btn btn-sm" data-action="addType">${icon('plus')}${t('add')}</button></div>
        <div class="field full"><label>${t('set.departments')} <span class="muted">(${t('set.departmentsHint')})</span></label><textarea name="departments" rows="6">${a.departments.join('\n')}</textarea></div>
        <div class="field full btn-row"><button class="btn btn-primary">${t('save')}</button></div>
      </form>`,
      'admin'
    )}

    ${section(
      'legis',
      t('set.legis'),
      'globe',
      html`<form class="form-grid" data-submit="saveLegis">
        <div class="field"><label>${t('leg.auto')}</label><select name="legisAutoCheck">${['off', 'startup', 'daily', 'weekly'].map((m) => html`<option value="${m}" ${m === a.legisAutoCheck ? 'selected' : ''}>${t(`leg.auto.${m}`)}</option>`)}</select></div>
        <div class="field full"><label class="check"><input type="checkbox" name="offline" ${s.offline ? 'checked' : ''}> ${t('set.offline')}</label></div>
        <div class="field full btn-row"><button class="btn btn-primary">${t('save')}</button></div>
      </form>`,
      'admin'
    )}

    ${section('ai', t('set.ai'), 'sparkles', aiSection(s), 'admin')}

    ${section(
      'privacy',
      t('set.privacy'),
      'shield',
      html`<p>${t('set.privacyText')}</p>
      <h4>${t('set.netLog')}</h4>
      ${netLog.length
        ? html`<div class="table-wrap log"><table class="table compact"><tbody>${netLog.map(
            (e) => html`<tr><td class="nowrap">${fmtDateTime(e.ts)}</td><td><span class="chip chip-${e.purpose === 'ai' ? 'warn' : 'muted'}">${e.purpose}</span></td><td class="url">${e.url}</td></tr>`
          )}</tbody></table></div>`
        : html`<p class="muted small">${t('set.netLogEmpty')}</p>`}
      ${app.info.encrypted ? html`<div class="note note-good">${icon('lock')}<div>${t('enc.on')}</div></div>
      <div class="btn-row" data-perm="admin"><button class="btn" data-action="newRecoveryCode">${icon('key')}${t('enc.newCode')}</button></div>
      <p class="muted small" data-perm="admin">${t('enc.newCodeHint')}</p>` : ''}
      <h4>${t('set.audit')}</h4>
      <div class="table-wrap log"><table class="table compact"><tbody>${audit.map(
        (r) => html`<tr><td class="nowrap">${fmtDateTime(r.ts)}</td><td>${r.user}</td><td>${t(`audit.${r.action}`) === `audit.${r.action}` ? r.action : t(`audit.${r.action}`)}</td><td>${r.code || r.targetUser || r.title || ''}</td><td class="small">${auditDetails(r)}</td></tr>`
      )}</tbody></table></div>`
    )}

    ${section(
      'about',
      t('set.about'),
      'info',
      html`<p>${t('appName')} – ${t('set.version', { v: app.info.version })}</p><p class="muted small">${t('tagline')}</p>
      <div class="btn-row"><button class="btn" data-action="checkUpdate">${icon('refresh')}${t('upd.check')}</button></div>
      <div id="upd-result" class="small"></div>
      <p class="muted small">${t('upd.privacy')}</p>`
    )}
  </div>`;
}

async function saveAndReload(p) {
  await p;
  await app.reloadInfo();
  toast(t('set.saved'), 'good');
  app.rerender();
  app.refreshSidebar();
}

async function userDialog(user) {
  let vals = null;
  const r = await openModal({
    title: user ? `${t('edit')} – ${user.name}` : t('usr.add'),
    size: 'md',
    body: html`<form class="form-grid" autocomplete="off">
      <div class="field full"><label>${t('auth.name')}</label><input name="name" value="${user ? user.name : ''}" required></div>
      <div class="field full"><label>${t('auth.role')}</label><select name="role">${['reader', 'editor', 'admin'].map((x) => html`<option value="${x}" ${(user ? user.role : 'editor') === x ? 'selected' : ''}>${t(`role.${x}`)} – ${t(`role.${x}.help`)}</option>`)}</select></div>
      ${user
        ? ''
        : html`<div class="field"><label>${t('auth.password')}</label><input type="password" name="password" required></div>
          <div class="field"><label>${t('auth.password2')}</label><input type="password" name="password2" required></div>
          <div class="field full hint">${t('usr.pwHint')}</div>`}
      <div class="field full err small" id="ud-err"></div>
    </form>`,
    buttons: [
      { label: t('cancel'), value: null },
      {
        label: t('save'),
        kind: 'primary',
        value: 'ok',
        onClick: async (el) => {
          vals = formValues(el);
          const err = el.querySelector('#ud-err');
          if (!user && vals.password !== vals.password2) {
            err.textContent = t('auth.mismatch');
            return false;
          }
          try {
            if (user) await api.users.update(user.id, { name: vals.name, role: vals.role });
            else await api.users.create({ name: vals.name, role: vals.role, password: vals.password });
            return true;
          } catch (e) {
            err.textContent = errText(e);
            return false;
          }
        }
      }
    ]
  });
  if (r === 'ok') await saveAndReload(Promise.resolve());
}

async function resetDialog(user) {
  const r = await openModal({
    title: `${t('usr.resetPw')} – ${user.name}`,
    size: 'sm',
    body: html`<form class="form-grid" autocomplete="off">
      <div class="field full"><label>${t('usr.newPw')}</label><input type="password" name="pw" required></div>
      <div class="field full"><label>${t('auth.password2')}</label><input type="password" name="pw2" required></div>
      <div class="field full err small" id="rp-err"></div>
    </form>`,
    buttons: [
      { label: t('cancel'), value: null },
      {
        label: t('save'),
        kind: 'primary',
        value: 'ok',
        onClick: async (el) => {
          const v = formValues(el);
          const err = el.querySelector('#rp-err');
          if (v.pw !== v.pw2) {
            err.textContent = t('auth.mismatch');
            return false;
          }
          try {
            await api.users.resetPassword(user.id, v.pw);
            return true;
          } catch (e) {
            err.textContent = errText(e);
            return false;
          }
        }
      }
    ]
  });
  if (r === 'ok') toast(t('usr.pwDone', { name: user.name }), 'good');
}

export const actions = {
  async savePrefs(form) {
    const v = formValues(form);
    await api.auth.setPrefs({ lang: v.lang, theme: v.theme });
    setLang(v.lang);
    await saveAndReload(Promise.resolve());
  },
  async changePw(form) {
    const v = formValues(form);
    if (v.pw !== v.pw2) return toast(t('auth.mismatch'), 'bad');
    try {
      await api.auth.changePassword(v.old, v.pw);
      form.reset();
      toast(t('usr.pwChanged'), 'good');
    } catch (e) {
      errorToast(e);
    }
  },
  addUser: () => userDialog(null),
  editUser: (el) => userDialog(users.find((u) => u.id === el.dataset.id)),
  resetPw: (el) => resetDialog(users.find((u) => u.id === el.dataset.id)),
  async toggleUser(el) {
    const u = users.find((x) => x.id === el.dataset.id);
    if (!u.disabled && !(await confirmDialog(t('usr.disableConfirm', { name: u.name }), { okLabel: t('usr.disable'), danger: true }))) return;
    await saveAndReload(api.users.update(u.id, { disabled: !u.disabled }));
  },
  async saveCompany(form) {
    const v = formValues(form);
    const activities = {};
    for (const a of company.activities) activities[a.id] = v[`act-${a.id}`] || '';
    await api.company.update({ activities, notes: v.notes });
    toast(t('co.saved'), 'good');
    app.rerender();
  },
  async saveOrg(form) {
    const v = formValues(form);
    await saveAndReload(api.archive.updateSettings({ org: v.org, autoLockMinutes: Math.max(0, parseInt(v.autoLockMinutes, 10) || 0) }));
  },
  async saveReviews(form) {
    const v = formValues(form);
    await api.archive.updateSettings({ warnDays: Math.max(1, parseInt(v.warnDays, 10) || 60), reminderDaysIcs: Math.max(0, parseInt(v.reminderDaysIcs, 10) || 0) });
    await saveAndReload(api.app.setSettings({ notifications: v.notifications, launchAtLogin: v.launchAtLogin, runInBackground: v.runInBackground }));
  },
  async saveTypes(form) {
    const rows = Array.from(form.querySelectorAll('#types-table tbody tr')).map((tr) => {
      const o = {};
      tr.querySelectorAll('[data-k]').forEach((i) => {
        o[i.dataset.k] = i.dataset.k === 'interval' ? Math.max(1, parseInt(i.value, 10) || 24) : i.value.trim();
      });
      return o;
    });
    const docTypes = rows.filter((r) => r.id).map((r) => ({ ...r, id: r.id.toUpperCase(), sk: r.sk || r.id, en: r.en || r.sk || r.id }));
    const departments = form.querySelector('[name=departments]').value.split('\n').map((x) => x.trim()).filter(Boolean);
    await saveAndReload(api.archive.updateSettings({ docTypes, departments }));
  },
  addType() {
    const tb = document.querySelector('#types-table tbody');
    const tr = document.createElement('tr');
    tr.innerHTML = String(html`<td><input data-k="id" size="8"></td><td><input data-k="sk"></td><td><input data-k="en"></td><td><input data-k="interval" type="number" min="1" max="120" value="24" size="4"></td><td><button type="button" class="btn btn-sm btn-ghost danger" data-action="delType">${icon('x')}</button></td>`);
    tb.appendChild(tr);
    tr.querySelector('input').focus();
  },
  delType(el) {
    el.closest('tr').remove();
  },
  async saveLegis(form) {
    const v = formValues(form);
    await api.archive.updateSettings({ legisAutoCheck: v.legisAutoCheck });
    await saveAndReload(api.app.setSettings({ offline: v.offline }));
  },
  async aiProvider(el) {
    await api.app.setSettings({ ai: { provider: el.value, baseUrl: '', model: '', budget: 0 } });
    await app.reloadInfo();
    app.rerender();
  },
  async aiSave() {
    const v = formValues(document.getElementById('ai-form'));
    const patch = { provider: v.provider, baseUrl: v.baseUrl || '', model: v.model || '', budget: Number(v.budget) || 0 };
    if (v.apiKey) patch.apiKey = v.apiKey;
    try {
      await saveAndReload(api.app.setSettings({ ai: patch }));
    } catch (e) {
      errorToast(e);
    }
  },
  async clearKey() {
    await saveAndReload(api.app.setSettings({ ai: { clearKey: true } }));
  },
  async aiTest() {
    const v = formValues(document.getElementById('ai-form'));
    const out = document.getElementById('ai-test');
    out.textContent = t('loading');
    out.className = 'small muted';
    try {
      const cfg = { provider: v.provider, baseUrl: v.baseUrl, model: v.model, budget: Number(v.budget) || 0 };
      if (v.apiKey) cfg.apiKey = v.apiKey;
      const r = await api.ai.test(cfg);
      out.textContent = t('set.aiOk', { models: (r.models || []).slice(0, 12).join(', ') || '—' });
      out.className = 'small ok';
      const dl = document.getElementById('ai-models');
      if (dl) dl.innerHTML = String(html`${(r.models || []).map((m) => html`<option value="${m}">`)}`);
    } catch (e) {
      const msg = errText(e);
      out.textContent = msg === 'NOT_LOCAL' ? t('set.aiNotLocal') : msg;
      out.className = 'small err';
    }
  },
  async setLogo() {
    try {
      if (await api.archive.setLogo()) await saveAndReload(Promise.resolve());
    } catch (e) {
      errorToast(e);
    }
  },
  clearLogo: () => saveAndReload(api.archive.clearLogo()),
  async newRecoveryCode() {
    if (!(await confirmDialog(t('enc.newCodeConfirm'), { okLabel: t('enc.newCode') }))) return;
    try {
      const code = await api.archive.newRecoveryCode();
      await showRecoveryCode(code, { org: app.info.archiveSettings.org });
    } catch (e) {
      errorToast(e);
    }
  },
  async checkUpdate() {
    const out = document.getElementById('upd-result');
    out.className = 'small muted';
    out.textContent = t('loading');
    try {
      const r = await api.app.checkUpdate();
      if (r.newer) {
        out.className = 'small';
        out.innerHTML = String(html`<div class="note note-good">${icon('download')}<div>${t('upd.available', { v: r.latest.version, date: r.latest.publishedAt ? fmtDateTime(r.latest.publishedAt) : '' })}<div class="btn-row"><button class="btn btn-primary btn-sm" data-action="openUpdate" data-url="${r.latest.url}">${t('upd.download')}</button></div><div class="muted">${t('upd.keepData')}</div></div></div>`);
      } else {
        out.className = 'small ok';
        out.textContent = r.latest ? t('upd.upToDate', { v: r.current }) : t('upd.noneYet', { v: r.current });
      }
    } catch (e) {
      out.className = 'small err';
      out.textContent = errText(e);
    }
  },
  openUpdate: (el) => api.app.openExternal(el.dataset.url),
  openFolder: () => api.app.openDataDir(),
  async backup() {
    const p = await api.app.backup();
    if (p) toast(t('set.backupDone', { path: p }), 'good', 8000);
  },
  async switchArchive() {
    const dir = await api.app.chooseFolder();
    if (!dir) return;
    try {
      const r = await api.app.switchDataDir(dir, 'open');
      toast(t('set.switched', { path: r.dataDir }), 'good');
      await app.reloadInfo();
      if (!r.session) app.signOut('switch');
      else app.navigate('dashboard');
    } catch (e) {
      errorToast(e);
    }
  },
  async copyArchive() {
    const dir = await api.app.chooseFolder();
    if (!dir) return;
    try {
      const r = await api.app.switchDataDir(dir, 'copy');
      toast(t('set.switched', { path: r.dataDir }), 'good');
      await app.reloadInfo();
      app.rerender();
    } catch (e) {
      errorToast(e);
    }
  }
};
