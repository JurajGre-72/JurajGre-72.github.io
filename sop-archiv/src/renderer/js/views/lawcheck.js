// "Check documents against a legal act": the act comes as a downloaded file, a web address,
// or a name / number. The result is a report (a change record) with findings per document.
import { t } from '../i18n.js';
import { html, icon, openModal, debounce, errorToast } from '../ui.js';
import { app } from '../app.js';

const api = window.api;

function lawOptions(laws, selectedId) {
  const sorted = laws.slice().sort((a, b) => (a.short || a.title).localeCompare(b.short || b.title, 'sk'));
  return [
    html`<option value="" ${!selectedId ? 'selected' : ''}>${t('lc.newLaw')}</option>`,
    ...sorted.map((l) => html`<option value="${l.id}" ${l.id === selectedId ? 'selected' : ''}>${l.short || l.title}</option>`)
  ];
}

function fileCard(info, laws) {
  if (!info) {
    return html`<div class="lc-drop">${icon('upload', 'big')}<p>${t('lc.fileHint')}</p><button type="button" class="btn btn-primary" data-lc="pick">${icon('folder')}${t('lc.pick')}</button></div>`;
  }
  const id = info.identity || {};
  return html`<div class="lc-file">
    <div class="lc-file-head">${icon('file')}<b>${info.fileName}</b><span class="muted small">${Number(info.chars).toLocaleString()} ${t('lc.chars')} · ${t('lc.sections', { n: info.sections })}</span>
      <button type="button" class="btn btn-sm btn-ghost" data-lc="pick">${t('ob.change')}</button></div>
    ${info.sections < 3 ? html`<div class="note note-warn">${icon('alert')}${t('lc.fewSections')}</div>` : ''}
    <div class="form-grid">
      <div class="field full"><label>${t('lc.whichLaw')}</label><select name="lawId" data-lc-law>${lawOptions(laws, id.lawId)}</select>
        ${id.key ? html`<span class="hint">${t('lc.detected', { key: id.key })}</span>` : ''}</div>
      <div class="field full lc-new" ${id.lawId ? 'hidden' : ''}><label>${t('leg.form.title')}</label><input name="title" value="${id.title || ''}"></div>
      <div class="field lc-new" ${id.lawId ? 'hidden' : ''}><label>${t('leg.form.key')}</label><input name="key" value="${id.key || ''}" placeholder="SK:362/2011"></div>
      <div class="field"><label>${t('lc.versionDate')}</label><input type="date" name="versionDate" value="${id.versionDate || ''}"><span class="hint">${t('lc.versionHint')}</span></div>
    </div>
  </div>`;
}

/** Open the dialog. opts.file = a path dropped onto the window. */
export async function lawCheckDialog(opts = {}) {
  const laws = await api.laws.list();
  let mode = opts.file ? 'file' : 'file';
  let fileInfo = null;
  let resolved = null;
  let modalEl = null;

  const body = () => html`
    <p class="muted">${t('lc.intro')}</p>
    <div class="seg lc-seg">
      ${['file', 'url', 'name'].map((m) => html`<button type="button" class="seg-btn ${mode === m ? 'on' : ''}" data-lc-mode="${m}">${icon(m === 'file' ? 'file' : m === 'url' ? 'globe' : 'search')}${t(`lc.mode.${m}`)}</button>`)}
    </div>
    <form class="lc-body" autocomplete="off">
      ${mode === 'file' ? fileCard(fileInfo, laws) : ''}
      ${mode === 'url'
        ? html`<div class="field"><label>${t('lc.url')}</label><input name="url" placeholder="https://www.slov-lex.sk/pravne-predpisy/SK/ZZ/2011/362/"><span class="hint">${t('lc.urlHint')}</span></div>`
        : ''}
      ${mode === 'name'
        ? html`<div class="field"><label>${t('lc.name')}</label><input name="query" placeholder="${t('lc.namePh')}" data-lc-query><span class="hint" id="lc-resolved">${t('lc.nameHint')}</span></div>`
        : ''}
    </form>
    <div class="lc-status small" id="lc-status"></div>`;

  const redraw = () => {
    modalEl.querySelector('.modal-body').innerHTML = String(body());
    const q = modalEl.querySelector('input[name=url], input[name=query]');
    if (q) q.focus();
  };

  const inspect = async (p) => {
    const st = modalEl.querySelector('#lc-status');
    st.innerHTML = String(html`<div class="spinner sm"></div>${t('lc.reading')}`);
    try {
      fileInfo = await api.legis.inspectFile(p);
      redraw();
    } catch (e) {
      st.textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    }
  };

  const showResolved = debounce(async (q) => {
    const el = modalEl && modalEl.querySelector('#lc-resolved');
    if (!el) return;
    if (!q.trim()) {
      el.textContent = t('lc.nameHint');
      return;
    }
    resolved = await api.legis.resolve(q);
    el.className = resolved ? 'hint ok' : 'hint err';
    el.textContent = resolved ? `${resolved.inRegister ? t('lc.inRegister') : t('lc.willAdd')}: ${resolved.short || resolved.title}${resolved.url ? ' – ' + resolved.url : ''}` : t('lc.notFound');
  }, 250);

  const run = async (close) => {
    const st = modalEl.querySelector('#lc-status');
    const v = Object.fromEntries(new FormData(modalEl.querySelector('form.lc-body')).entries());
    let result;
    st.className = 'lc-status small';
    st.innerHTML = String(html`<div class="spinner sm"></div>${t(mode === 'file' ? 'lc.checking' : 'lc.fetching')}`);
    modalEl.querySelectorAll('.modal-foot button').forEach((b) => (b.disabled = true));
    try {
      if (mode === 'file') {
        if (!fileInfo) throw new Error(t('lc.noFile'));
        result = await api.legis.importFile(fileInfo.path, { lawId: v.lawId || null, title: v.title, key: v.key, versionDate: v.versionDate || null });
      } else if (mode === 'url') {
        if (!/^https?:\/\//i.test(v.url || '')) throw new Error(t('lc.badUrl'));
        result = await api.legis.check(v.url.trim());
      } else {
        if (!(v.query || '').trim()) throw new Error(t('lc.nameHint'));
        result = await api.legis.check(v.query.trim());
      }
      close('done');
      app.refreshSidebar();
      app.navigate(`legislation/change/${result.changeId}`);
    } catch (e) {
      st.className = 'lc-status small err';
      st.textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      modalEl.querySelectorAll('.modal-foot button').forEach((b) => (b.disabled = false));
    }
  };

  await openModal({
    title: t('lc.title'),
    size: 'lg',
    body: body(),
    buttons: [
      { label: t('cancel'), value: null },
      {
        label: t('lc.run'),
        kind: 'primary',
        onClick: async (_el, close) => {
          await run(close);
          return false;
        }
      }
    ],
    onMount: (el) => {
      modalEl = el;
      el.addEventListener('click', async (e) => {
        const m = e.target.closest('[data-lc-mode]');
        if (m) {
          mode = m.dataset.lcMode;
          redraw();
          return;
        }
        if (e.target.closest('[data-lc="pick"]')) {
          const p = await api.legis.pickFile();
          if (p) await inspect(p);
        }
      });
      el.addEventListener('change', (e) => {
        if (e.target.matches('[data-lc-law]')) el.querySelectorAll('.lc-new').forEach((x) => (x.hidden = !!e.target.value));
      });
      el.addEventListener('input', (e) => {
        if (e.target.matches('[data-lc-query]')) showResolved(e.target.value);
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.matches('input')) {
          e.preventDefault();
          el.querySelector('.modal-foot .btn-primary').click();
        }
      });
      if (opts.file) inspect(opts.file).catch(errorToast);
    }
  });
}
