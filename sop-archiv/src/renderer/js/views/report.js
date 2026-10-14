// Inspection report: the register of controlled documents, reviews, legislation and the company's
// decisions, training, approvals, controlled copies and recall assessments – as PDF or Excel.
import { t } from '../i18n.js';
import { html, icon, openModal, formValues, toast, errorToast, todayIso } from '../ui.js';

const api = window.api;

export async function inspectionReportDialog() {
  const today = todayIso();
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  let saved = null;
  await openModal({
    title: t('rep.title'),
    size: 'md',
    body: html`<form class="form-grid rep-form">
      <p class="field full muted">${t('rep.intro')}</p>
      <div class="field"><label>${t('rep.from')}</label><input type="date" name="from" value="${yearAgo}"></div>
      <div class="field"><label>${t('rep.to')}</label><input type="date" name="to" value="${today}"></div>
      <p class="field full hint">${t('rep.periodHint')}</p>
      <fieldset class="field full"><legend>${t('rep.format')}</legend>
        <label class="radio-row"><input type="radio" name="format" value="pdf" checked> <span><b>PDF</b> – ${t('rep.pdf')}</span></label>
        <label class="radio-row"><input type="radio" name="format" value="xlsx"> <span><b>Excel</b> – ${t('rep.xlsx')}</span></label>
      </fieldset>
    </form>`,
    buttons: [
      { label: t('cancel'), value: null },
      {
        label: t('rep.create'),
        kind: 'primary',
        onClick: async (el, close) => {
          const v = formValues(el);
          if (v.from && v.to && v.from > v.to) {
            toast(t('rep.badPeriod'), 'warn');
            return false;
          }
          const btn = el.querySelector('.modal-foot .btn-primary');
          if (btn) btn.disabled = true;
          try {
            saved = await api.report.inspection({ format: v.format, from: v.from, to: v.to });
            close('ok');
          } catch (e) {
            errorToast(e);
            if (btn) btn.disabled = false;
          }
          return false;
        }
      }
    ]
  });
  if (saved) toast(t('rep.saved', { file: saved }), 'good', 6000);
  return saved;
}

export const reportButton = () => html`<button class="btn" data-action="inspectionReport" data-perm="editor">${icon('file')}${t('rep.button')}</button>`;
