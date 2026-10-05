// First-run welcome: language, name, organization, archive folder, reminders.
import { t, setLang } from '../i18n.js';
import { html, icon, openModal, formValues, errorToast } from '../ui.js';
import { app } from '../app.js';

const api = window.api;

export async function maybeOnboard() {
  if (app.info.settings.onboarded) return;
  let folder = app.info.dataDir;
  let vals = null;
  const body = () => html`<form class="form-grid onboard">
    <div class="field full ob-hero">${icon('shield', 'big')}<p>${t('ob.intro')}</p></div>
    <div class="field"><label>${t('ob.lang')}</label><select name="lang" data-ob-lang><option value="sk" ${app.info.settings.lang === 'sk' ? 'selected' : ''}>Slovenčina</option><option value="en" ${app.info.settings.lang === 'en' ? 'selected' : ''}>English</option></select></div>
    <div class="field"><label>${t('ob.name')}</label><input name="userName" value="${app.info.settings.userName || app.info.user}"></div>
    <div class="field full"><label>${t('ob.org')}</label><input name="org" value="${app.info.archiveSettings.org || ''}" placeholder="PHARMACOPOLA s.r.o."></div>
    <div class="field full"><label>${t('ob.folder')}</label><div class="path-box">${icon('folder')}<code data-ob-folder>${folder}</code><button type="button" class="btn btn-sm" data-ob-change>${t('ob.change')}</button></div><span class="hint">${t('set.dataDirHint')}</span></div>
    <div class="field full"><label>${t('ob.reminders')}</label>
      <label class="check"><input type="checkbox" name="launchAtLogin"> ${t('set.launchAtLogin')}</label>
      <label class="check"><input type="checkbox" name="runInBackground"> ${t('set.background')}</label>
      <span class="hint">${t('set.backgroundHint')}</span>
    </div>
  </form>`;
  const r = await openModal({
    title: t('ob.welcome'),
    size: 'md',
    dismissable: false,
    body: body(),
    buttons: [{ label: t('ob.start'), kind: 'primary', value: 'ok', onClick: (el) => ((vals = formValues(el)), true) }],
    onMount: (el) => {
      el.addEventListener('change', (e) => {
        if (e.target.matches('[data-ob-lang]')) {
          setLang(e.target.value);
          app.info.settings.lang = e.target.value;
          const keep = formValues(el);
          el.querySelector('.modal-body').innerHTML = String(body());
          el.querySelector('h2').textContent = t('ob.welcome');
          el.querySelector('[data-modal-btn]').textContent = t('ob.start');
          for (const [k, v] of Object.entries(keep)) {
            const f = el.querySelector(`[name="${k}"]`);
            if (f && f.type === 'checkbox') f.checked = v;
            else if (f) f.value = v;
          }
        }
      });
      el.addEventListener('click', async (e) => {
        if (!e.target.closest('[data-ob-change]')) return;
        const dir = await api.app.chooseFolder();
        if (dir) {
          folder = dir;
          el.querySelector('[data-ob-folder]').textContent = dir;
        }
      });
    }
  });
  if (r !== 'ok' || !vals) return;
  try {
    if (folder !== app.info.dataDir) await api.app.switchDataDir(folder, 'open');
    await api.app.setSettings({ lang: vals.lang, userName: vals.userName.trim(), launchAtLogin: vals.launchAtLogin, runInBackground: vals.runInBackground, onboarded: true });
    if (vals.org) await api.archive.updateSettings({ org: vals.org });
    await app.reloadInfo();
    app.rerender();
  } catch (e) {
    errorToast(e);
  }
}
