// The archive folder should not be in a cloud-synchronised folder (OneDrive, Dropbox, Google Drive, iCloud …).
import { t } from '../i18n.js';
import { html, icon, confirmDialog } from '../ui.js';

const api = window.api;

export function cloudNote(provider) {
  return provider ? html`<div class="note note-warn">${icon('alert')}<div>${t('cloud.warn', { name: provider })}</div></div>` : '';
}

/** Before using a folder: if a cloud service synchronises it, the user must confirm. */
export async function confirmLocalFolder(dir) {
  const provider = await api.app.cloudSync(dir).catch(() => null);
  if (!provider) return true;
  return confirmDialog(t('cloud.confirm', { name: provider, path: dir }), { okLabel: t('cloud.useAnyway'), danger: true });
}
