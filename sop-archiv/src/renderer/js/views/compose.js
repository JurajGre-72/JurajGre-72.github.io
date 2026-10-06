// "New document": a new SOP or directive from a template – basic details, how the process works in the
// company, the acts that apply, the outline – then the text, chapter by chapter, written by hand or
// drafted by the AI. Saved into the archive as a draft (Word file).
import { t } from '../i18n.js';
import { html, icon, typeLabel, toast, errorToast, todayIso } from '../ui.js';
import { app, DEFAULT_LOGO } from '../app.js';

const api = window.api;

let st = null; // the document being written (kept while moving around the app)
let init = null; // { code, sections, laws, models, user }
let suggestions = []; // acts suggested for the topic
const running = new Map(); // request id -> section index
let stopAll = false;
let offChunk = null;

function fresh(type) {
  return { doc: { type, code: '', title: '', department: '', owner: '', approver: '', version: '1', effectiveDate: '' }, description: '', lawIds: [], modelDocId: '', outlineFrom: '', sections: [], aiUsed: false, aiModel: '' };
}

/** The company logo as PNG (for the Word header). */
export async function logoPng() {
  try {
    const img = new Image();
    img.src = app.logoUrl || DEFAULT_LOGO;
    await img.decode();
    const w = 900;
    const h = Math.max(1, Math.round((w * (img.naturalHeight || 1)) / (img.naturalWidth || 1)));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, w, h);
    x.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/png');
  } catch (_) {
    return null;
  }
}

const aiOn = () => app.info.settings.ai.provider && app.info.settings.ai.provider !== 'none';

function sectionsHtml() {
  return html`${st.sections.map(
    (s, i) => html`<div class="cmp-sec" data-i="${i}">
      <div class="cmp-sec-head">
        <input class="cmp-sec-title" value="${s.heading}" data-input="secHeading" data-i="${i}" aria-label="${t('nd.chapter')}">
        ${aiOn() ? html`<button type="button" class="btn btn-sm" data-action="draftOne" data-i="${i}" ${running.size ? 'disabled' : ''}>${icon('sparkles')}${t('nd.draftOne')}</button>` : ''}
        <button type="button" class="btn btn-sm btn-ghost" data-action="secUp" data-i="${i}" title="${t('nd.up')}" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="btn btn-sm btn-ghost danger" data-action="secRemove" data-i="${i}" title="${t('delete')}">${icon('x')}</button>
      </div>
      ${s.hint ? html`<div class="muted small">${s.hint}</div>` : ''}
      <textarea class="cmp-sec-text" rows="${Math.min(18, Math.max(4, (s.text || '').split('\n').length + 1))}" data-input="secText" data-i="${i}" placeholder="${t('nd.textPh')}">${s.text || ''}</textarea>
      <div class="cmp-sec-state small muted" id="sec-state-${i}"></div>
    </div>`
  )}`;
}

function lawsHtml() {
  const sug = new Map(suggestions.map((x) => [x.lawId, x]));
  const list = init.laws.slice().sort((a, b) => Number(sug.has(b.id)) - Number(sug.has(a.id)) || Number(b.hasText) - Number(a.hasText));
  return html`<div class="nd-laws">${list.map((l) => {
    const sg = sug.get(l.id);
    return html`<label class="check ${l.hasText ? '' : 'muted'}"><input type="checkbox" data-change="law" value="${l.id}" ${st.lawIds.includes(l.id) ? 'checked' : ''}> <span>${l.short || l.title}${sg ? html` <span class="chip chip-good">${t('nd.suggested')}</span> <span class="muted small">${sg.sections.join(', ')}</span>` : ''}${l.hasText ? '' : html` <span class="muted small">(${t('nd.noText')})</span>`}</span></label>`;
  })}</div>`;
}

export async function render(route) {
  const types = app.info.archiveSettings.docTypes;
  const s = app.info.archiveSettings;
  const type = (route.query && route.query.type) || (st && st.doc.type) || 'ŠPP';
  if (!st || (route.query && route.query.type && route.query.type !== st.doc.type && !st.doc.title)) st = fresh(type);
  init = await api.compose.init(st.doc.type);
  if (!st.doc.code) st.doc.code = init.code;
  if (!st.doc.owner) st.doc.owner = init.user;
  if (!st.sections.length) st.sections = init.sections.map((x) => ({ ...x, text: '' }));
  const sameType = init.models.filter((m) => m.type === st.doc.type);
  return html`<div class="page compose">
    <a class="back" href="#/documents">← ${t('docs.title')}</a>
    <header class="page-head">
      <div><h1>${t('nd.title')}</h1><p class="muted">${t('nd.intro')}</p></div>
      <div class="head-actions">
        <button class="btn" data-action="saveCopy">${icon('download')}${t('nd.saveCopy')}</button>
        <button class="btn btn-primary" data-action="save" id="nd-save">${icon('check')}${t('nd.save')}</button>
      </div>
    </header>

    <section class="panel"><h3><span class="step">1</span>${t('nd.s1')}</h3>
      <div class="form-grid">
        <div class="field"><label>${t('f.type')}</label><select data-change="type">${types.map((tp) => html`<option value="${tp.id}" ${tp.id === st.doc.type ? 'selected' : ''}>${tp.id} – ${typeLabel(types, tp.id)}</option>`)}</select></div>
        <div class="field"><label>${t('f.code')}</label><input data-input="doc" data-k="code" value="${st.doc.code}"><span class="hint">${t('nd.codeHint')}</span></div>
        <div class="field full"><label>${t('f.title')} *</label><input data-input="doc" data-k="title" value="${st.doc.title}" placeholder="${t('nd.titlePh')}" id="nd-title"></div>
        <div class="field"><label>${t('f.department')}</label><select data-change="doc" data-k="department"><option value="">${t('none')}</option>${s.departments.map((d) => html`<option ${d === st.doc.department ? 'selected' : ''}>${d}</option>`)}</select></div>
        <div class="field"><label>${t('f.version')}</label><input data-input="doc" data-k="version" value="${st.doc.version}"></div>
        <div class="field"><label>${t('f.owner')}</label><input data-input="doc" data-k="owner" value="${st.doc.owner}"></div>
        <div class="field"><label>${t('f.approver')}</label><input data-input="doc" data-k="approver" value="${st.doc.approver}"></div>
        <div class="field"><label>${t('f.effectiveDate')}</label><input type="date" data-input="doc" data-k="effectiveDate" value="${st.doc.effectiveDate}"></div>
      </div>
    </section>

    <section class="panel"><h3><span class="step">2</span>${t('nd.s2')}</h3>
      <p class="muted small">${t('nd.s2hint')}</p>
      <textarea rows="6" data-input="description" placeholder="${t('nd.descPh')}">${st.description}</textarea>
    </section>

    <section class="panel"><h3><span class="step">3</span>${t('nd.s3')}</h3>
      <p class="muted small">${t('nd.s3hint')}</p>
      <div class="btn-row"><button type="button" class="btn btn-sm" data-action="suggest">${icon('search')}${t('nd.suggest')}</button></div>
      <div id="nd-laws">${lawsHtml()}</div>
    </section>

    <section class="panel"><h3><span class="step">4</span>${t('nd.s4')}</h3>
      <div class="form-grid">
        <div class="field"><label>${t('nd.outlineFrom')}</label><select data-change="outlineFrom">
          <option value="">${t('nd.template', { type: st.doc.type })}</option>
          ${init.models.map((m) => html`<option value="${m.id}" ${m.id === st.outlineFrom ? 'selected' : ''}>${m.code || ''} ${m.title}</option>`)}
        </select></div>
        <div class="field"><label>${t('nd.styleFrom')}</label><select data-change="modelDoc">
          <option value="">${t('none')}</option>
          ${(sameType.length ? sameType : init.models).map((m) => html`<option value="${m.id}" ${m.id === st.modelDocId ? 'selected' : ''}>${m.code || ''} ${m.title}</option>`)}
        </select><span class="hint">${t('nd.styleHint')}</span></div>
      </div>
    </section>

    <section class="panel"><h3><span class="step">5</span>${t('nd.s5')}</h3>
      <div class="btn-row">
        <button type="button" class="btn" data-action="skeleton">${icon('file')}${t('nd.skeleton')}</button>
        ${aiOn()
          ? html`<button type="button" class="btn btn-primary" data-action="draftAll" id="nd-all" ${running.size ? 'disabled' : ''}>${icon('sparkles')}${t('nd.draftAll')}</button>
            <button type="button" class="btn" data-action="stop" id="nd-stop" ${running.size ? '' : 'hidden'}>${icon('x')}${t('rw.stop')}</button>`
          : html`<span class="muted small">${icon('info')}${t('nd.aiOff')}</span>`}
      </div>
      ${aiOn() ? html`<p class="muted small">${icon('shield')}${t('nd.aiNote')}</p>` : ''}
      <div id="nd-sections">${sectionsHtml()}</div>
      <button type="button" class="btn btn-sm" data-action="secAdd">${icon('plus')}${t('nd.addChapter')}</button>
    </section>
  </div>`;
}

function refreshSections() {
  const el = document.getElementById('nd-sections');
  if (el) el.innerHTML = String(sectionsHtml());
}

function setState(i, text, tone = 'muted') {
  const el = document.getElementById(`sec-state-${i}`);
  if (el) {
    el.className = `cmp-sec-state small ${tone}`;
    el.innerHTML = String(text);
  }
}

function busyUi(on) {
  const all = document.getElementById('nd-all');
  const stop = document.getElementById('nd-stop');
  if (all) all.disabled = on;
  if (stop) stop.hidden = !on;
  document.querySelectorAll('[data-action="draftOne"]').forEach((b) => (b.disabled = on));
}

async function draft(i) {
  if (!st.doc.title.trim()) {
    toast(t('nd.needTitle'), 'bad');
    document.getElementById('nd-title').focus();
    return false;
  }
  const reqId = `nd-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`;
  running.set(reqId, i);
  busyUi(true);
  const box = document.querySelector(`.cmp-sec[data-i="${i}"] textarea`);
  const before = st.sections[i].text;
  st.sections[i].text = '';
  if (box) box.value = '';
  setState(i, html`<span class="spinner sm"></span> ${t('nd.writing')}`);
  try {
    const r = await api.compose.draftSection(reqId, {
      doc: st.doc,
      description: st.description,
      sections: st.sections.map(({ heading, title, hint }) => ({ heading, title, hint })),
      index: i,
      written: st.sections.map((s, j) => (j === i ? null : { heading: s.heading, text: s.text })).filter(Boolean),
      lawIds: st.lawIds,
      modelDocId: st.modelDocId
    });
    st.sections[i].text = r.text || before;
    if (box) {
      box.value = st.sections[i].text;
      box.rows = Math.min(18, Math.max(4, box.value.split('\n').length + 1));
    }
    st.aiUsed = true;
    st.aiModel = r.model;
    setState(i, html`${icon('sparkles')}${t('nd.drafted', { model: r.model })}${r.aborted ? ' · ' + t('rw.stopped') : ''}`);
    return !r.aborted;
  } catch (e) {
    st.sections[i].text = st.sections[i].text || before;
    if (box) box.value = st.sections[i].text;
    setState(i, String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'err');
    return false;
  } finally {
    running.delete(reqId);
    if (!running.size) busyUi(false);
  }
}

export function mount() {
  if (offChunk) offChunk();
  offChunk = api.on('ai:chunk', (c) => {
    if (!running.has(c.reqId)) return;
    const i = running.get(c.reqId);
    st.sections[i].text += c.text;
    const box = document.querySelector(`.cmp-sec[data-i="${i}"] textarea`);
    if (box) {
      box.value = st.sections[i].text;
      box.rows = Math.min(18, Math.max(4, box.value.split('\n').length + 1));
    }
  });
}

export function unmount() {
  if (offChunk) offChunk();
  offChunk = null;
}

function payload() {
  return { doc: st.doc, sections: st.sections.map((s) => ({ heading: s.heading, text: s.text })), aiUsed: st.aiUsed, aiModel: st.aiModel };
}

export const actions = {
  doc(el) {
    st.doc[el.dataset.k] = el.value;
  },
  description(el) {
    st.description = el.value;
  },
  async type(el) {
    const keep = st;
    st = { ...fresh(el.value), description: keep.description, lawIds: keep.lawIds, doc: { ...fresh(el.value).doc, title: keep.doc.title, department: keep.doc.department, owner: keep.doc.owner, approver: keep.doc.approver } };
    app.rerender();
  },
  law(el) {
    st.lawIds = el.checked ? [...new Set([...st.lawIds, el.value])] : st.lawIds.filter((x) => x !== el.value);
  },
  async suggest() {
    const topic = `${st.doc.title}\n${st.description}`.trim();
    if (topic.length < 5) return toast(t('nd.needTopic'), 'bad');
    suggestions = await api.compose.suggestLaws(topic);
    for (const sg of suggestions.slice(0, 4)) if (!st.lawIds.includes(sg.lawId)) st.lawIds.push(sg.lawId);
    document.getElementById('nd-laws').innerHTML = String(lawsHtml());
    toast(suggestions.length ? t('nd.suggestedN', { n: suggestions.length }) : t('nd.suggestedNone'), suggestions.length ? 'good' : 'info');
  },
  async outlineFrom(el) {
    st.outlineFrom = el.value;
    const secs = el.value ? await api.compose.outlineOf(el.value) : init.sections;
    if (el.value && !secs.length) return toast(t('nd.noOutline'), 'info');
    const old = new Map(st.sections.map((s) => [s.title || s.heading, s.text]));
    st.sections = secs.map((x) => ({ ...x, text: old.get(x.title || x.heading) || '' }));
    if (el.value && !st.modelDocId) st.modelDocId = el.value;
    app.rerender();
  },
  modelDoc(el) {
    st.modelDocId = el.value;
  },
  secHeading(el) {
    const s = st.sections[Number(el.dataset.i)];
    s.heading = el.value;
    s.title = el.value.replace(/^\d+\.\s*/, '');
  },
  secText(el) {
    st.sections[Number(el.dataset.i)].text = el.value;
  },
  secAdd() {
    st.sections.push({ heading: `${st.sections.length + 1}. `, title: '', hint: '', text: '' });
    refreshSections();
  },
  secRemove(el) {
    st.sections.splice(Number(el.dataset.i), 1);
    refreshSections();
  },
  secUp(el) {
    const i = Number(el.dataset.i);
    if (i > 0) [st.sections[i - 1], st.sections[i]] = [st.sections[i], st.sections[i - 1]];
    refreshSections();
  },
  /** The outline with what to write in each chapter, without the AI. */
  skeleton() {
    const laws = init.laws.filter((l) => st.lawIds.includes(l.id)).map((l) => `- ${l.title}`);
    for (const s of st.sections) {
      if (s.text && s.text.trim()) continue;
      if (/legislat|legislation/i.test(s.heading)) s.text = laws.length ? laws.join('\n') : `[${t('nd.fill')}: ${s.hint || s.title}]`;
      else if (/zmien|change history/i.test(s.heading)) s.text = `${t('f.version')} ${st.doc.version || '1'} – ${t('nd.firstIssue')} (${todayIso()})`;
      else s.text = `[${t('nd.fill')}: ${s.hint || s.title}]`;
    }
    refreshSections();
  },
  async draftOne(el) {
    stopAll = false;
    await draft(Number(el.dataset.i));
  },
  async draftAll() {
    stopAll = false;
    for (let i = 0; i < st.sections.length && !stopAll; i++) {
      const s = st.sections[i];
      if (s.text && s.text.trim() && !/^\[(DOPLNIŤ|COMPLETE)/.test(s.text.trim())) continue; // already written
      const ok = await draft(i);
      if (!ok) break;
    }
    toast(stopAll ? t('rw.stopped') : t('nd.allDone'), stopAll ? 'info' : 'good');
  },
  stop() {
    stopAll = true;
    for (const id of running.keys()) api.ai.cancel(id);
  },
  async saveCopy() {
    try {
      const p = await api.compose.saveCopy({ ...payload(), logoPng: await logoPng() });
      if (p) toast(t('doc.copySaved', { path: p }), 'good', 6000);
    } catch (e) {
      errorToast(e);
    }
  },
  async save() {
    if (!st.doc.title.trim()) {
      toast(t('nd.needTitle'), 'bad');
      document.getElementById('nd-title').focus();
      return;
    }
    if (running.size) return toast(t('nd.waitAi'), 'info');
    try {
      const d = await api.compose.save({ ...payload(), logoPng: await logoPng() });
      st = null;
      suggestions = [];
      toast(t('nd.saved', { code: d.code || d.title }), 'good', 6000);
      app.refreshSidebar();
      app.navigate(`documents/${d.id}`);
    } catch (e) {
      errorToast(e);
    }
  }
};
