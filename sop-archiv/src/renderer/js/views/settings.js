// Settings.
import { t, setLang } from '../i18n.js';
import { html, icon, fmtDateTime, toast, errorToast, formValues } from '../ui.js';
import { app } from '../app.js';
import { auditDetails } from './document.js';

const api = window.api;
let netLog = [];
let audit = [];

function section(id, title, iconName, body) {
  return html`<section class="panel settings-sec" id="set-${id}"><h3>${icon(iconName)}${title}</h3>${body}</section>`;
}

function aiSection(s) {
  const p = s.ai.provider || 'none';
  const defaults = { ollama: 'http://127.0.0.1:11434', openai: 'http://127.0.0.1:1234/v1', anthropic: '' };
  const modelDefault = { ollama: 'qwen2.5:7b', openai: '', anthropic: 'claude-opus-5-5' };
  return html`
    <p class="muted">${t('set.aiIntro')}</p>
    <form id="ai-form" class="form-grid">
      <div class="field full radio-col">
        ${['none', 'ollama', 'openai', 'anthropic'].map((x) => html`<label class="radio ${x === 'anthropic' ? 'cloud' : ''}"><input type="radio" name="provider" value="${x}" ${x === p ? 'checked' : ''} data-change="aiProvider"> ${t(`set.ai.${x}`)}</label>`)}
      </div>
      ${p === 'none'
        ? ''
        : html`
        ${p === 'anthropic' ? html`<div class="field full note note-warn">${icon('alert')}${t('set.aiCloudWarn')}</div>` : html`<div class="field full note">${icon('lock')}${t('set.aiOllamaHelp')}</div>`}
        ${p !== 'anthropic' ? html`<div class="field"><label>${t('set.aiBaseUrl')}</label><input name="baseUrl" value="${s.ai.baseUrl || defaults[p]}"></div>` : ''}
        <div class="field"><label>${t('set.aiModel')}</label><input name="model" value="${s.ai.model || modelDefault[p]}" list="ai-models"><datalist id="ai-models"></datalist></div>
        ${p === 'anthropic' || p === 'openai'
          ? html`<div class="field full"><label>${t('set.aiKey')}</label><input type="password" name="apiKey" autocomplete="off" placeholder="${s.ai.hasApiKey ? '••••••••' : p === 'openai' ? '(optional)' : 'sk-ant-…'}">
              ${s.ai.hasApiKey ? html`<span class="hint">${t('set.aiKeySet', { how: s.ai.keyEncrypted ? t('set.aiKeyEnc') : t('set.aiKeyPlain') })} <button type="button" class="link" data-action="clearKey">${t('set.aiKeyClear')}</button></span>` : ''}</div>`
          : ''}
        <div class="field"><label>${t('set.aiBudget')}</label><input type="number" name="budget" min="2000" step="1000" value="${s.ai.budget || (p === 'anthropic' ? 200000 : 14000)}"></div>
        <div class="field full btn-row"><button type="button" class="btn" data-action="aiTest">${icon('refresh')}${t('set.aiTest')}</button> <span id="ai-test" class="small"></span></div>
      `}
      <div class="field full btn-row"><button type="button" class="btn btn-primary" data-action="aiSave">${t('save')}</button></div>
    </form>`;
}

export async function render() {
  await app.reloadInfo();
  [netLog, audit] = await Promise.all([api.app.networkLog(), api.app.audit({ limit: 150 })]);
  const s = app.info.settings;
  const a = app.info.archiveSettings;
  const types = a.docTypes;
  return html`<div class="page settings">
    <header class="page-head"><div><h1>${t('set.title')}</h1></div></header>

    ${section(
      'general',
      t('set.general'),
      'settings',
      html`<form class="form-grid" data-submit="saveGeneral">
        <div class="field"><label>${t('set.lang')}</label><select name="lang"><option value="sk" ${s.lang === 'sk' ? 'selected' : ''}>Slovenčina</option><option value="en" ${s.lang === 'en' ? 'selected' : ''}>English</option></select></div>
        <div class="field"><label>${t('set.theme')}</label><select name="theme">${['system', 'light', 'dark'].map((x) => html`<option value="${x}" ${s.theme === x ? 'selected' : ''}>${t(`set.theme.${x}`)}</option>`)}</select></div>
        <div class="field"><label>${t('set.userName')}</label><input name="userName" value="${s.userName}" placeholder="${app.info.user}"></div>
        <div class="field"><label>${t('set.org')}</label><input name="org" value="${a.org || ''}"></div>
        <div class="field full btn-row"><button class="btn btn-primary">${t('save')}</button></div>
      </form>`
    )}

    ${section(
      'archive',
      t('set.archive'),
      'folder',
      html`<p class="muted">${t('set.dataDirHint')}</p>
      <div class="path-box">${icon('folder')}<code>${app.info.dataDir}</code></div>
      <div class="btn-row">
        <button class="btn" data-action="openFolder">${icon('external')}${t('set.openFolder')}</button>
        <button class="btn" data-action="backup">${icon('download')}${t('set.backup')}</button>
        <button class="btn" data-action="copyArchive">${icon('layers')}${t('set.copyFolder')}</button>
        <button class="btn btn-ghost" data-action="switchArchive">${icon('folder')}${t('set.switchFolder')}</button>
      </div>`
    )}

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
      </form>`
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
      </form>`
    )}

    ${section(
      'legis',
      t('set.legis'),
      'globe',
      html`<form class="form-grid" data-submit="saveLegis">
        <div class="field"><label>${t('leg.auto')}</label><select name="legisAutoCheck">${['off', 'startup', 'daily', 'weekly'].map((m) => html`<option value="${m}" ${m === a.legisAutoCheck ? 'selected' : ''}>${t(`leg.auto.${m}`)}</option>`)}</select></div>
        <div class="field full"><label class="check"><input type="checkbox" name="offline" ${s.offline ? 'checked' : ''}> ${t('set.offline')}</label></div>
        <div class="field full btn-row"><button class="btn btn-primary">${t('save')}</button></div>
      </form>`
    )}

    ${section('ai', t('set.ai'), 'sparkles', aiSection(s))}

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
      <h4>${t('set.audit')}</h4>
      <div class="table-wrap log"><table class="table compact"><tbody>${audit.map(
        (r) => html`<tr><td class="nowrap">${fmtDateTime(r.ts)}</td><td>${r.user}</td><td>${t(`audit.${r.action}`) === `audit.${r.action}` ? r.action : t(`audit.${r.action}`)}</td><td>${r.code || r.title || ''}</td><td class="small">${auditDetails(r)}</td></tr>`
      )}</tbody></table></div>`
    )}

    ${section('about', t('set.about'), 'info', html`<p>${t('appName')} – ${t('set.version', { v: app.info.version })}</p><p class="muted small">${t('tagline')}</p>`)}
  </div>`;
}

async function saveAndReload(p) {
  await p;
  await app.reloadInfo();
  toast(t('set.saved'), 'good');
  app.rerender();
  app.refreshSidebar();
}

export const actions = {
  async saveGeneral(form) {
    const v = formValues(form);
    await api.app.setSettings({ lang: v.lang, theme: v.theme, userName: v.userName.trim() });
    await api.archive.updateSettings({ org: v.org });
    setLang(v.lang);
    await saveAndReload(Promise.resolve());
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
    await saveAndReload(api.app.setSettings({ ai: patch }));
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
      out.textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      out.className = 'small err';
    }
  },
  openFolder: () => api.app.openDataDir(),
  async backup() {
    const p = await api.app.backup();
    if (p) toast(t('set.backupDone', { path: p }), 'good', 8000);
  },
  async switchArchive() {
    const dir = await api.app.chooseFolder();
    if (!dir) return;
    try {
      await api.app.switchDataDir(dir, 'open');
      toast(t('set.switched', { path: dir }), 'good');
      await app.reloadInfo();
      app.navigate('dashboard');
    } catch (e) {
      errorToast(e);
    }
  },
  async copyArchive() {
    const dir = await api.app.chooseFolder();
    if (!dir) return;
    try {
      await api.app.switchDataDir(dir, 'copy');
      toast(t('set.switched', { path: dir }), 'good');
      await app.reloadInfo();
      app.rerender();
    } catch (e) {
      errorToast(e);
    }
  }
};
