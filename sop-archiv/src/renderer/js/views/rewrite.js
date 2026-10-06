// "Rewrite with AI": choose a passage of a document and an instruction; the AI proposes new wording with
// the reasons and the provisions it relied on. The company's process is kept (see lib/drafting.js).
// A proposal is saved with the document and can be exported to Word for whoever edits the original.
import { t } from '../i18n.js';
import { html, icon, openModal, toast, errorToast, diffView } from '../ui.js';
import { app } from '../app.js';

const api = window.api;

const PRESETS = ['align', 'complete', 'clarify', 'custom'];

function lawList(laws, chosen) {
  const withText = laws.filter((l) => l.hasText !== false);
  return html`<div class="rw-laws">${laws.map(
    (l) => html`<label class="check ${l.hasText === false ? 'muted' : ''}" title="${l.hasText === false ? t('rw.noText') : ''}"><input type="checkbox" name="law" value="${l.id}" ${chosen.has(l.id) ? 'checked' : ''} ${l.hasText === false ? 'disabled' : ''}> ${l.short || l.title}</label>`
  )}${withText.length ? '' : html`<p class="muted small">${t('rw.noLawText')}</p>`}</div>`;
}

/**
 * doc: the document (from api.docs.get); passage: preselected text; lawIds: acts to use (default: the ones it cites);
 * instruction: preset id or text; changeId: when opened from a change report.
 */
export async function rewriteDialog({ doc, passage = '', lawIds = null, instruction = 'align', changeId = null }) {
  const aiOn = app.info.settings.ai.provider && app.info.settings.ai.provider !== 'none';
  const [{ passages, cites }, allLaws] = await Promise.all([api.rewrite.passages(doc.id), api.laws.list()]);
  const hasText = (l) => !!(l.state && (l.state.newestKey || l.state.snapshotKey || (l.state.lastImport && l.state.lastImport.key)));
  const laws = allLaws.map((l) => ({ id: l.id, title: l.title, short: l.short, hasText: hasText(l), cited: cites.includes(l.id) })).sort((a, b) => Number(b.cited) - Number(a.cited));
  const chosen = new Set(lawIds || cites);
  let reqId = null;
  let result = null;
  let streamed = '';
  let off = null;
  const preset = PRESETS.includes(instruction) ? instruction : 'custom';
  const customText = PRESETS.includes(instruction) ? '' : instruction;

  await openModal({
    title: `${t('rw.title')} – ${doc.code || doc.title}`,
    size: 'xl',
    body: html`<div class="rw">
      ${aiOn ? '' : html`<div class="note note-warn">${icon('alert')}${t('ch.aiOff')}</div>`}
      <div class="rw-grid">
        <div class="rw-left">
          <div class="field"><label>${t('rw.passage')}</label>
            <textarea id="rw-passage" rows="9" placeholder="${t('rw.passagePh')}">${passage}</textarea>
            <details class="rw-pick"><summary>${icon('file')}${t('rw.pick')}</summary>
              <input type="search" id="rw-find" placeholder="${t('rw.find')}">
              <ul class="rw-passages">${passages.map((p, i) => html`<li><button type="button" class="rw-p" data-i="${i}">${p.page ? html`<span class="page-no">${t('doc.page', { n: p.page })}</span> ` : ''}${p.text.slice(0, 260)}${p.text.length > 260 ? '…' : ''}</button></li>`)}</ul>
            </details>
          </div>
          <div class="field"><label>${t('rw.instruction')}</label>
            <div class="radio-col">${PRESETS.map((k) => html`<label class="radio"><input type="radio" name="preset" value="${k}" ${k === preset ? 'checked' : ''}> ${t(`rw.p.${k}`)}</label>`)}</div>
            <textarea id="rw-custom" rows="2" placeholder="${t('rw.customPh')}" ${preset === 'custom' ? '' : 'hidden'}>${customText}</textarea>
          </div>
          <div class="field"><label>${t('rw.laws')}</label>${lawList(laws, chosen)}</div>
        </div>
        <div class="rw-right">
          <div class="btn-row">
            <button type="button" class="btn btn-primary" id="rw-go" ${aiOn ? '' : 'disabled'}>${icon('sparkles')}${t('rw.go')}</button>
            <button type="button" class="btn" id="rw-stop" hidden>${icon('x')}${t('rw.stop')}</button>
          </div>
          <div id="rw-out" class="rw-out"><p class="muted small">${t('rw.hint')}</p></div>
        </div>
      </div>
    </div>`,
    buttons: [{ label: t('close'), value: null }],
    onMount: (m, close) => {
      const $ = (s) => m.querySelector(s);
      const out = $('#rw-out');
      const passageEl = $('#rw-passage');
      m.querySelectorAll('input[name=preset]').forEach((r) => r.addEventListener('change', () => ($('#rw-custom').hidden = r.value !== 'custom' || !r.checked)));
      $('#rw-find').addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        m.querySelectorAll('.rw-p').forEach((b) => (b.parentElement.hidden = !!q && !passages[Number(b.dataset.i)].text.toLowerCase().includes(q)));
      });
      m.querySelector('.rw-passages').addEventListener('click', (e) => {
        const b = e.target.closest('.rw-p');
        if (!b) return;
        passageEl.value = passages[Number(b.dataset.i)].text;
        $('.rw-pick').open = false;
        passageEl.focus();
      });
      off = api.on('ai:chunk', (c) => {
        if (c.reqId !== reqId) return;
        streamed += c.text;
        const pre = out.querySelector('.rw-stream');
        if (pre) {
          pre.textContent = streamed;
          pre.scrollTop = pre.scrollHeight;
        }
      });
      const instructionText = () => {
        const p = (m.querySelector('input[name=preset]:checked') || {}).value || 'align';
        return p === 'custom' ? $('#rw-custom').value.trim() : t(`rw.i.${p}`);
      };
      const show = () => {
        if (!result) return;
        out.innerHTML = String(html`
          <h4>${t('rw.compare')}</h4>
          ${diffView(result.original, result.text)}
          <h4>${t('rw.newText')}</h4>
          <textarea id="rw-new" rows="8">${result.text}</textarea>
          ${result.reasons.length ? html`<h4>${t('rw.reasons')}</h4><ul class="rw-reasons">${result.reasons.map((r) => html`<li>${r}</li>`)}</ul>` : ''}
          ${result.laws && result.laws.length ? html`<p class="muted small">${icon('scale')}${t('rw.used')}: ${result.laws.map((l) => `${l.title.replace(/^(Zákon|Vyhláška|Nariadenie)\s+/, '$1 ')} (${l.sections.slice(0, 5).join(', ')})`).join('; ')}</p>` : ''}
          <p class="muted small">${icon('sparkles')}${result.model} · ${t('rw.note')}</p>
          <div class="btn-row">
            <button type="button" class="btn btn-primary" id="rw-save" data-perm="editor">${icon('check')}${t('rw.save')}</button>
            <button type="button" class="btn" id="rw-copy">${icon('layers')}${t('rw.copy')}</button>
          </div>`);
        $('#rw-copy').addEventListener('click', async () => {
          await navigator.clipboard.writeText($('#rw-new').value).catch(() => {});
          toast(t('rw.copied'), 'good');
        });
        $('#rw-save').addEventListener('click', async () => {
          try {
            await api.rewrite.save(doc.id, { original: result.original, text: $('#rw-new').value, reasons: result.reasons, instruction: result.instruction, lawIds: result.lawIds, ai: { model: result.model, provider: result.provider }, changeId });
            toast(t('rw.saved'), 'good');
            close(true);
            app.rerender();
          } catch (e) {
            errorToast(e);
          }
        });
      };
      $('#rw-go').addEventListener('click', async () => {
        const text = passageEl.value.trim();
        const instr = instructionText();
        if (text.length < 10) return toast(t('rw.needPassage'), 'bad');
        if (!instr) return toast(t('rw.needInstruction'), 'bad');
        const ids = Array.from(m.querySelectorAll('input[name=law]:checked')).map((x) => x.value);
        reqId = `rw-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        streamed = '';
        out.innerHTML = String(html`<div class="ai-box"><div class="spinner sm"></div>${t('rw.running')}</div><pre class="rw-stream"></pre>`);
        $('#rw-go').disabled = true;
        $('#rw-stop').hidden = false;
        try {
          const r = await api.rewrite.propose(reqId, { docId: doc.id, passage: text, instruction: instr, lawIds: ids });
          result = { ...r, original: text, instruction: instr, lawIds: ids };
          show();
          if (r.aborted) toast(t('rw.stopped'), 'info');
        } catch (e) {
          out.innerHTML = String(html`<div class="err small">${String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}</div>`);
        } finally {
          $('#rw-go').disabled = false;
          $('#rw-stop').hidden = true;
          reqId = null;
        }
      });
      $('#rw-stop').addEventListener('click', () => reqId && api.ai.cancel(reqId));
    }
  });
  if (off) off();
  if (reqId) api.ai.cancel(reqId);
}
