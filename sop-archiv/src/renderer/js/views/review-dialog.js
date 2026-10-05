// "Record review" dialog, shared by several views.
import { t } from '../i18n.js';
import { html, openModal, formValues, todayIso, addMonthsIso, fmtDate, toast, errorToast } from '../ui.js';
import { app } from '../app.js';

const api = window.api;

export async function recordReview(doc) {
  if (!doc) return null;
  const interval = Number(doc.reviewIntervalMonths) || 24;
  const day = todayIso();
  let vals = null;
  const r = await openModal({
    title: `${t('rv.title')} – ${doc.code || doc.title}`,
    size: 'md',
    body: html`<form class="form-grid" data-rv>
      <div class="field"><label>${t('rv.date')}</label><input type="date" name="date" value="${day}" required></div>
      <div class="field"><label>${t('rv.by')}</label><input name="by" value="${app.info.user}"></div>
      <div class="field full"><label>${t('rv.outcome')}</label>
        <div class="radio-col">
          ${['no-change', 'update-needed', 'updated'].map((o, i) => html`<label class="radio"><input type="radio" name="outcome" value="${o}" ${i === 0 ? 'checked' : ''}> ${t(`rv.o.${o}`)}</label>`)}
        </div>
      </div>
      <div class="field"><label>${t('rv.next')}</label><input type="date" name="nextReviewDate" value="${addMonthsIso(day, interval)}"></div>
      <div class="field"><label>&nbsp;</label><div class="muted small">${t('doc.reviewEvery', { n: interval })}</div></div>
      <div class="field full"><label>${t('rv.notes')}</label><textarea name="notes" rows="3"></textarea></div>
    </form>`,
    buttons: [
      { label: t('cancel'), value: null },
      {
        label: t('save'),
        kind: 'primary',
        value: 'ok',
        onClick: (el) => {
          vals = formValues(el);
          return !!vals.date;
        }
      }
    ],
    onMount: (el) => {
      const date = el.querySelector('[name=date]');
      const next = el.querySelector('[name=nextReviewDate]');
      date.addEventListener('change', () => {
        if (date.value) next.value = addMonthsIso(date.value, interval);
      });
    }
  });
  if (r !== 'ok' || !vals) return null;
  try {
    const updated = await api.docs.markReviewed(doc.id, vals);
    toast(t('rv.saved', { date: fmtDate(updated.reviewDate) || '—' }), 'good');
    app.refreshSidebar();
    return updated;
  } catch (e) {
    errorToast(e);
    return null;
  }
}
