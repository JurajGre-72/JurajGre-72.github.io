// The recovery code of an encrypted archive: shown once, to be printed or written down and kept safe.
import { t } from '../i18n.js';
import { html, icon, openModal, toast } from '../ui.js';

export async function showRecoveryCode(code, { org = '' } = {}) {
  await openModal({
    title: t('rec.title'),
    size: 'md',
    dismissable: false,
    body: html`<div class="rec">
      <p>${t('rec.intro')}</p>
      <div class="rec-code" id="rec-code">${code}</div>
      <ul class="rec-list">
        <li>${t('rec.keep')}</li>
        <li>${t('rec.lost')}</li>
        <li>${t('rec.once')}</li>
      </ul>
      <div class="btn-row">
        <button type="button" class="btn" id="rec-print">${icon('file')}${t('rec.print')}</button>
        <button type="button" class="btn" id="rec-copy">${icon('layers')}${t('rec.copy')}</button>
      </div>
      <label class="check rec-ok"><input type="checkbox" id="rec-kept"> ${t('rec.kept')}</label>
    </div>`,
    buttons: [
      {
        label: t('rec.done'),
        kind: 'primary',
        value: true,
        onClick: (el) => {
          if (!el.querySelector('#rec-kept').checked) {
            toast(t('rec.confirmFirst'), 'bad');
            return false;
          }
          return true;
        }
      }
    ],
    onMount: (el) => {
      el.querySelector('#rec-copy').addEventListener('click', async () => {
        await navigator.clipboard.writeText(code).catch(() => {});
        toast(t('rec.copied'), 'good');
      });
      el.querySelector('#rec-print').addEventListener('click', () => {
        const area = document.createElement('div');
        area.id = 'print-area';
        area.innerHTML = String(html`<h1>${t('appName')} – ${t('rec.title')}</h1><p>${org}</p><p class="print-code">${code}</p><p>${t('rec.keep')}</p><p>${t('rec.printedOn', { date: new Date().toLocaleDateString() })}</p>`);
        document.body.appendChild(area);
        window.print();
        area.remove();
      });
    }
  });
}
