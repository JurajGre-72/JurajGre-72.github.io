// Sign-in screen and first-time setup (creates the administrator profile).
import { t, setLang } from '../i18n.js';
import { html, icon, formValues, errorToast } from '../ui.js';
import { app } from '../app.js';
import { cloudNote, confirmLocalFolder } from './cloudnote.js';

const api = window.api;

function shell(inner) {
  return html`<div class="auth-wrap"><div class="auth-card">
    ${app.logoUrl ? html`<img class="auth-logo" src="${app.logoUrl}" alt="">` : ''}
    <div class="auth-brand">${icon('shield', 'big')}<div><div class="auth-title">${t('appName')}</div><div class="muted small">${t('tagline')}</div></div></div>
    ${inner}
  </div></div>`;
}

function initials(name) {
  return String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function setupHtml(info) {
  return shell(html`
    <h2>${t('ob.welcome')}</h2>
    <p class="muted">${t('ob.intro')}</p>
    <form class="form-grid" id="setup-form" autocomplete="off">
      <div class="field"><label>${t('ob.lang')}</label><select name="lang" id="setup-lang"><option value="sk" ${info.settings.lang === 'sk' ? 'selected' : ''}>Slovenčina</option><option value="en" ${info.settings.lang === 'en' ? 'selected' : ''}>English</option></select></div>
      <div class="field"><label>${t('ob.org')}</label><input name="org" value="${info.archiveSettings.org || ''}" placeholder="PHARMACOPOLA s.r.o."></div>
      <div class="field full note">${icon('lock')}${t('auth.setupAdmin')}</div>
      <div class="field"><label>${t('auth.name')}</label><input name="name" required></div>
      <div class="field"><label>${t('auth.role')}</label><div class="readonly">${t('role.admin')}</div></div>
      <div class="field"><label>${t('auth.password')}</label><input type="password" name="password" required></div>
      <div class="field"><label>${t('auth.password2')}</label><input type="password" name="password2" required></div>
      <div class="field full"><label>${t('ob.folder')}</label><div class="path-box">${icon('folder')}<code id="setup-folder">${info.dataDir}</code>${info.managed && info.managed.dataDir ? '' : html`<button type="button" class="btn btn-sm" id="setup-change">${t('ob.change')}</button>`}</div><span class="hint">${t('auth.folderHint')}</span>${cloudNote(info.dataDirCloud)}</div>
      <div class="field full"><label>${t('ob.reminders')}</label>
        <label class="check"><input type="checkbox" name="launchAtLogin"> ${t('set.launchAtLogin')}</label>
        <label class="check"><input type="checkbox" name="runInBackground"> ${t('set.background')}</label>
      </div>
      <div class="field full err small" id="setup-err"></div>
      <div class="field full btn-row"><button class="btn btn-primary" type="submit">${t('ob.start')}</button></div>
    </form>`);
}

function loginHtml(state, selected) {
  const users = state.users;
  const sel = users.find((u) => u.id === selected) || users.find((u) => u.id === state.lastUserId) || (users.length === 1 ? users[0] : null);
  return shell(html`
    <h2>${t('auth.signIn')}</h2>
    ${state.readOnly ? html`<div class="note note-warn">${icon('lock')}${t('ro.banner', state.readOnly)}</div>` : ''}
    <div class="profiles">${users.map(
      (u) => html`<button type="button" class="profile ${sel && sel.id === u.id ? 'on' : ''}" data-user="${u.id}">
        <span class="avatar">${initials(u.name)}</span><span class="pname">${u.name}</span><span class="prole">${t(`role.${u.role}`)}</span>
      </button>`
    )}</div>
    ${sel
      ? html`<form id="login-form" class="login-form" autocomplete="off">
          <input type="hidden" name="userId" value="${sel.id}">
          <label>${t('auth.passwordFor', { name: sel.name })}</label>
          <div class="login-row"><input type="password" name="password" id="login-pw" required><button class="btn btn-primary" type="submit">${icon('lock')}${t('auth.signInBtn')}</button></div>
          <div class="err small" id="login-err"></div>
        </form>`
      : html`<p class="muted">${t('auth.pick')}</p>`}
    <p class="muted small auth-foot">${t('auth.forgot')}${state.canRecover ? html` <button type="button" class="link" id="go-recover">${t('rec.forgotLink')}</button>` : ''}</p>`);
}

function recoverHtml(state) {
  const admins = state.users.filter((u) => u.role === 'admin');
  return shell(html`
    <h2>${t('rec.recoverTitle')}</h2>
    <p class="muted">${t('rec.recoverIntro')}</p>
    <form id="recover-form" class="form-grid" autocomplete="off">
      <div class="field full"><label>${t('rec.adminProfile')}</label><select name="userId">${admins.map((u) => html`<option value="${u.id}">${u.name}</option>`)}</select></div>
      <div class="field full"><label>${t('rec.code')}</label><input name="code" id="rec-input" class="mono" placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" required></div>
      <div class="field"><label>${t('usr.newPw')}</label><input type="password" name="pw" required></div>
      <div class="field"><label>${t('auth.password2')}</label><input type="password" name="pw2" required></div>
      <div class="field full err small" id="login-err"></div>
      <div class="field full btn-row"><button type="button" class="btn btn-ghost" id="back-login">← ${t('auth.signIn')}</button><button class="btn btn-primary" type="submit">${icon('key')}${t('rec.recoverBtn')}</button></div>
    </form>`);
}

/**
 * A password set by an administrator: its user sets their own before going on (it is also their signature).
 * Resolves true when changed, false when the user signs out instead.
 */
export function forcePasswordChange(root, session) {
  root.innerHTML = String(
    shell(html`
    <h2>${t('auth.mustChangeTitle')}</h2>
    <p class="muted">${t('auth.mustChangeIntro', { name: session.name })}</p>
    <form id="pwchange-form" class="form-grid" autocomplete="off">
      <div class="field full"><label>${t('auth.adminPassword')}</label><input type="password" name="old" required></div>
      <div class="field"><label>${t('usr.newPw')}</label><input type="password" name="pw" required minlength="8"></div>
      <div class="field"><label>${t('auth.password2')}</label><input type="password" name="pw2" required></div>
      <div class="field full err small" id="pwchange-err"></div>
      <div class="field full btn-row"><button type="button" class="btn btn-ghost" id="pwchange-out">${t('auth.signOut')}</button><button class="btn btn-primary" type="submit">${icon('lock')}${t('auth.mustChangeBtn')}</button></div>
    </form>`)
  );
  const first = root.querySelector('[name=old]');
  if (first) first.focus();
  return new Promise((resolve) => {
    root.querySelector('#pwchange-out').onclick = async () => {
      await api.auth.logout('user').catch(() => {});
      resolve(false);
    };
    root.querySelector('#pwchange-form').onsubmit = async (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      const err = root.querySelector('#pwchange-err');
      if (v.pw !== v.pw2) return (err.textContent = t('auth.mismatch'));
      if (v.pw.length < 8) return (err.textContent = t('auth.short'));
      try {
        await api.auth.changePassword(v.old, v.pw);
        resolve(true);
      } catch (ex) {
        err.textContent = String(ex.message || ex).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      }
    };
  });
}

/**
 * Show sign-in (or first-time setup) and resolve once a user is signed in.
 */
export async function authenticate(root, info) {
  let state = await api.auth.state();
  if (state.session) return state.session;
  setLang(info.settings.lang);
  return new Promise((resolve) => {
    let selected = null;
    let recovering = false;
    const draw = async () => {
      state = await api.auth.state();
      root.innerHTML = String(state.needsSetup ? setupHtml(info) : recovering ? recoverHtml(state) : loginHtml(state, selected));
      const rc = root.querySelector('#rec-input');
      if (rc) rc.focus();
      const pw = root.querySelector('#login-pw');
      if (pw) pw.focus();
      else {
        const first = root.querySelector('#setup-form [name=name]');
        if (first) first.focus();
      }
    };
    root.onclick = async (e) => {
      if (e.target.closest('#go-recover') || e.target.closest('#back-login')) {
        recovering = !!e.target.closest('#go-recover');
        await draw();
        return;
      }
      const p = e.target.closest('[data-user]');
      if (p) {
        selected = p.dataset.user;
        await draw();
        return;
      }
      if (e.target.closest('#setup-change')) {
        const dir = await api.app.chooseFolder();
        if (!dir || !(await confirmLocalFolder(dir))) return;
        try {
          const r = await api.app.switchDataDir(dir, 'open');
          info.dataDir = r.dataDir;
          info.dataDirCloud = await api.app.cloudSync(r.dataDir).catch(() => null);
          if (!r.needsSetup) {
            // The folder already holds an archive with profiles: sign in to it.
            info = await api.app.info();
          }
          await draw();
          const f = root.querySelector('#setup-folder');
          if (f) f.textContent = r.dataDir;
        } catch (err) {
          errorToast(err);
        }
      }
    };
    root.onchange = async (e) => {
      if (e.target.id === 'setup-lang') {
        const keep = formValues(root.querySelector('#setup-form'));
        await api.app.setSettings({ lang: e.target.value });
        info.settings.lang = e.target.value;
        setLang(e.target.value);
        await draw();
        const f = root.querySelector('#setup-form');
        for (const [k, v] of Object.entries(keep)) {
          const el = f.querySelector(`[name="${k}"]`);
          if (!el || k === 'lang') continue;
          if (el.type === 'checkbox') el.checked = v;
          else el.value = v;
        }
      }
    };
    root.onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target;
      const v = formValues(form);
      try {
        if (form.id === 'setup-form') {
          const err = root.querySelector('#setup-err');
          if (v.password !== v.password2) {
            err.textContent = t('auth.mismatch');
            return;
          }
          await api.app.setSettings({ launchAtLogin: v.launchAtLogin, runInBackground: v.runInBackground });
          const s = await api.auth.setup({ name: v.name, password: v.password, org: v.org, lang: v.lang });
          root.innerHTML = '';
          resolve(s);
        } else if (form.id === 'recover-form') {
          if (v.pw !== v.pw2) {
            root.querySelector('#login-err').textContent = t('auth.mismatch');
            return;
          }
          const s = await api.auth.recover(v.code, v.userId, v.pw);
          root.innerHTML = '';
          resolve(s);
        } else {
          const s = await api.auth.login(v.userId, v.password);
          root.innerHTML = '';
          resolve(s);
        }
      } catch (err) {
        const box = root.querySelector('#login-err') || root.querySelector('#setup-err');
        if (box) box.textContent = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
        const pwf = root.querySelector('#login-pw');
        if (pwf) {
          pwf.value = '';
          pwf.focus();
        }
      }
    };
    draw();
  });
}
