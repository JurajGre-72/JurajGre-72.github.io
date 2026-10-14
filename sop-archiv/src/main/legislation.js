'use strict';
// Legislation monitor: fetches each registered law, works out which version is in force and
// whether a newer (possibly future) version exists, keeps text snapshots and records changes
// with a §-level diff and the list of affected documents.

const { cleanText } = require('./lib/text');
const { today, compactToIso } = require('./lib/dates');
const { detectSource, parseVersions, pageVersionKey, detectRepealed, pickVersions, diffLaw, hashText, touchedKeys, slovlexIndexUrl, slovlexIndexVersions, slovlexIndexRepealed, slovlexActName, eurlexLang } = require('./lib/legis-parse');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Generic pages: drop clock times and very short lines before comparing (they change on every visit).
function stableText(text) {
  return cleanText(text)
    .split('\n')
    .map((l) => l.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, '').trim())
    .filter((l) => l.length >= 4)
    .join('\n');
}

class LegislationMonitor {
  /**
   * fetchPage(url) -> { url, title, text, html, links:[{href,text}] }
   */
  constructor(archive, { fetchPage, isOffline = () => false, pauseMs = 1500, transact = (fn) => fn() }) {
    this.archive = archive;
    // Saving a check's result is a short write transaction; the (slow) pages are read outside it, so
    // colleagues on other computers are not kept waiting.
    this.transact = transact;
    this.fetchPage = fetchPage;
    this.isOffline = isOffline;
    this.pauseMs = pauseMs;
    this.running = false;
  }

  /**
   * Fetch a law page. For Slov-Lex, read the version index on static.slov-lex.sk (page.versionIndex);
   * if that fails, the portal page, also in its other URL form (with / without "/ezbierky").
   */
  async _fetchLawPage(url, source) {
    const index = source === 'slovlex' && slovlexIndexUrl(url);
    if (index) {
      try {
        const page = await this.fetchPage(index);
        const versions = slovlexIndexVersions(page.html, page.url || index);
        if (versions.length) return { ...page, versionIndex: versions };
      } catch (_) {
        /* fall back to the portal page */
      }
      await sleep(this.pauseMs);
    }
    try {
      return await this.fetchPage(url);
    } catch (e) {
      if (source !== 'slovlex' || !/HTTP 4\d\d/.test(String(e.message))) throw e;
      const alt = url.includes('/ezbierky/') ? url.replace('/ezbierky/', '/') : url.replace('slov-lex.sk/pravne-predpisy/', 'slov-lex.sk/ezbierky/pravne-predpisy/');
      if (alt === url) throw e;
      await sleep(this.pauseMs);
      return this.fetchPage(alt);
    }
  }

  async _snapshotText(law, version, fetched) {
    if (this.archive.hasSnapshot(law.id, version.key)) return this.archive.loadSnapshot(law.id, version.key);
    let text;
    if (fetched && fetched.key === version.key) text = fetched.text;
    else {
      await sleep(this.pauseMs);
      const page = await this.fetchPage(version.url);
      text = page.text;
      this.lastPageTitle = page.title || '';
    }
    text = cleanText(text).replace(/\n\s*\n/g, '\n');
    if (text.length < 200) throw new Error(`Version ${version.date}: page has almost no text`);
    await this.archive.saveSnapshot(law.id, version.key, text);
    return text;
  }

  /**
   * Text of a version. A consolidated EUR-Lex version may not be published in the act's language yet
   * (HTTP 404): then the newest earlier one that is, or for the first version the act as adopted.
   */
  async _versionText(law, versions, version, fetched, source) {
    for (let i = versions.indexOf(version); i >= 0; i--) {
      const v = versions[i];
      try {
        return { version: v, text: await this._snapshotText(law, v, fetched) };
      } catch (e) {
        if (source !== 'eurlex' || !/HTTP 404/.test(String(e.message))) throw e;
        if (v.fallbackUrl) {
          await sleep(this.pauseMs);
          return { version: v, text: await this._snapshotText(law, { ...v, url: v.fallbackUrl }, null) };
        }
        await sleep(this.pauseMs);
      }
    }
    throw new Error(`EUR-Lex: no version of this act is available in ${eurlexLang(law.url)}`);
  }

  async _change(law, kind, from, to, fromText, toText, extra = {}) {
    const diff = fromText != null ? diffLaw(fromText, toText) : null;
    if (diff) {
      const n = diff.mode === 'sections' ? diff.changed.length + diff.added.length + diff.removed.length : diff.added.length + diff.removed.length;
      if (!n) return null; // only formatting / footnote numbering differed
    }
    // Recorded when the result is saved (see checkLaw).
    return {
      change: {
        lawId: law.id,
        kind,
        fromKey: from ? from.key : null,
        toKey: to ? to.key : null,
        fromDate: from ? from.date : null,
        toDate: to ? to.date : null,
        sourceUrl: to ? to.url : law.url,
        summary: diff ? { mode: diff.mode, stats: diff.stats, sections: touchedKeys(diff).slice(0, 80) } : null,
        ...extra
      },
      diff: diff || { mode: 'none', changed: [], added: [], removed: [], stats: {} },
      toText: toText || null
    };
  }

  /** Check one law. Returns { lawId, status, changes:[...], state }. Never throws. */
  async checkLaw(lawId) {
    const found = this.archive.data.laws.find((l) => l.id === lawId);
    if (!found) throw new Error('Law not found');
    const law = { ...found }; // nothing in the archive changes until the result is saved
    const startedAt = new Date().toISOString();
    let named = null;
    const prev = law.state || {};
    const state = { ...prev, lastCheck: new Date().toISOString(), status: 'ok', error: null };
    const created = [];
    try {
      if (this.isOffline()) throw new Error('offline');
      if (!/^https?:\/\//i.test(law.url || '')) throw new Error('missing URL');
      const source = detectSource(law.url);
      const page = await this._fetchLawPage(law.url, source);
      const day = today();
      state.source = source;
      state.pageTitle = page.title || '';
      const versions = page.versionIndex || parseVersions(source, page, law);

      if (versions.length) {
        let { effective, newest, upcoming } = pickVersions(versions, day);
        // The Slov-Lex page itself shows one version (the one in force unless its URL says otherwise).
        const shownKey = source === 'slovlex' && !page.versionIndex ? pageVersionKey(page) || effective.key : null;
        const fetched = shownKey ? { key: shownKey, text: page.text } : null;
        this.lastPageTitle = '';
        const eff = await this._versionText(law, versions, effective, fetched, source);
        const effText = eff.text;
        effective = eff.version;
        // An act added from a document citation gets its official name.
        named = (law.autoTitle && source === 'slovlex' && slovlexActName(this.lastPageTitle)) || null;
        const nw = newest.key <= effective.key ? eff : await this._versionText(law, versions, newest, fetched, source);
        const newText = nw.text;
        newest = nw.version;
        if (!prev.newestKey) {
          // First check = baseline. If a future version is already published, report it right away.
          if (newest.key !== effective.key) {
            const c = await this._change(law, 'upcoming', effective, newest, effText, newText, amendments(versions, effective.key, newest.key));
            if (c) created.push(c);
          }
        } else if (newest.key > prev.newestKey) {
          let from = { key: prev.newestKey, date: compactToIso(prev.newestKey) };
          let fromText = this.archive.hasSnapshot(law.id, from.key) ? await this.archive.loadSnapshot(law.id, from.key) : null;
          const listed = fromText == null && versions.find((v) => v.key === prev.newestKey);
          if (listed) {
            // The previous text was not kept (e.g. an archive copied without its legislation folder): fetch it again.
            try {
              fromText = await this._snapshotText(law, listed, null);
              from = listed;
            } catch (_) {
              /* compare with the version in force instead */
            }
          }
          if (fromText == null && newest.key !== effective.key) {
            from = effective;
            fromText = effText;
          }
          const c = await this._change(law, newest.date > day ? 'upcoming' : 'new-version', from, newest, fromText, newText, amendments(versions, from.key, newest.key));
          if (c) created.push(c);
        }
        Object.assign(state, {
          mode: 'versions',
          effectiveKey: effective.key,
          effectiveDate: effective.date,
          newestKey: newest.key,
          newestDate: newest.date,
          upcoming: upcoming.map((v) => ({ key: v.key, date: v.date, url: v.url })),
          versionCount: versions.length,
          recentVersions: versions.slice(-8).map((v) => ({ key: v.key, date: v.date, url: v.url }))
        });
      } else {
        // Any other page (e.g. a non-consolidated act or a regulator's news page): watch its text.
        // For EUR-Lex, read the act itself (TXT page) rather than its information page (ALL).
        let textPage = page;
        if (source === 'eurlex' && /\/(ALL|TXT)\//i.test(law.url) && !/\/TXT\/HTML\//i.test(law.url)) {
          await sleep(this.pauseMs);
          textPage = await this.fetchPage(law.url.replace(/\/(ALL|TXT)\//i, '/TXT/HTML/')).catch((e) => {
            throw /HTTP 404/.test(String(e.message)) ? new Error(`EUR-Lex: the act is not available in ${eurlexLang(law.url)} (HTTP 404)`) : e;
          });
        }
        const text = stableText(textPage.text);
        if (text.length < 100) throw new Error('page has almost no text (blocked or requires login?)');
        const hash = hashText(text);
        const key = `p-${hash}`;
        if (!this.archive.hasSnapshot(law.id, key)) await this.archive.saveSnapshot(law.id, key, text);
        if (prev.hash && prev.hash !== hash) {
          const oldText = prev.snapshotKey && this.archive.hasSnapshot(law.id, prev.snapshotKey) ? await this.archive.loadSnapshot(law.id, prev.snapshotKey) : '';
          const c = await this._change(law, 'page-changed', { key: prev.snapshotKey, date: (prev.lastCheck || '').slice(0, 10) }, { key, date: day, url: law.url }, oldText, text);
          if (c) created.push(c);
        }
        Object.assign(state, { mode: 'page', hash, snapshotKey: key, effectiveKey: null, newestKey: null, upcoming: [] });
      }

      const repealed = page.versionIndex ? slovlexIndexRepealed(page.versionIndex, today()) : detectRepealed(source, page.bodyText || page.text);
      if (repealed && !prev.repealed) {
        const c = await this._change(law, 'repealed', null, null, null, null, { notice: repealed });
        if (c) created.push(c);
      }
      state.repealed = repealed;
    } catch (e) {
      state.status = 'error';
      state.error = String((e && e.message) || e);
    }
    return this.transact(async () => {
      const fresh = this.archive.data.laws.find((l) => l.id === lawId);
      if (!fresh) return { lawId, status: 'removed', error: null, changes: [], state };
      // Checked meanwhile on another computer: its result stands (no duplicate changes).
      if (fresh.state && fresh.state.lastCheck && fresh.state.lastCheck > startedAt) return { lawId, status: fresh.state.status, error: fresh.state.error, changes: [], state: fresh.state };
      const ids = [];
      for (const p of created) {
        const c = await this.archive.addChange(p.change, p.diff, p.toText);
        if (c) ids.push(c.id);
      }
      if (named) Object.assign(fresh, named, { autoTitle: false });
      fresh.state = state;
      await this.archive.save();
      this.archive.audit('legislation.checked', { lawId, title: fresh.short || fresh.title, status: state.status, error: state.error, newChanges: ids.length });
      return { lawId, status: state.status, error: state.error, changes: ids, state };
    });
  }

  /**
   * Check one act now and always produce a report: the new change(s) if a new version was
   * found, otherwise a check of all documents against the current text.
   */
  async checkAndReport(lawId, source) {
    if (this.running) throw new Error('BUSY');
    this.running = true;
    try {
      const r = await this.checkLaw(lawId);
      if (r.status === 'error') throw new Error(r.error);
      if (r.changes.length) return { changeId: r.changes[0], newChanges: r.changes.length };
      const ch = await this.transact(() => this.archive.checkReport(lawId, source));
      return { changeId: ch.id, newChanges: 0 };
    } finally {
      this.running = false;
    }
  }

  /** Check every enabled law, one at a time. onProgress({ done, total, law, result }) */
  async checkAll(onProgress, onlyIds) {
    if (this.running) throw new Error('BUSY');
    this.running = true;
    const results = [];
    try {
      const laws = this.archive.data.laws.filter((l) => l.enabled && (!onlyIds || onlyIds.includes(l.id)));
      for (let i = 0; i < laws.length; i++) {
        if (onProgress) onProgress({ done: i, total: laws.length, law: { id: laws[i].id, title: laws[i].short || laws[i].title } });
        const r = await this.checkLaw(laws[i].id);
        results.push(r);
        if (i < laws.length - 1) await sleep(this.pauseMs);
      }
      if (onProgress) onProgress({ done: laws.length, total: laws.length, finished: true });
    } finally {
      this.running = false;
    }
    return {
      checked: results.length,
      errors: results.filter((r) => r.status === 'error').length,
      changes: results.reduce((n, r) => n + r.changes.length, 0),
      results
    };
  }
}

// ---------------------------------------------------------------------------
// Electron page fetcher: a hidden, sandboxed window in its own session, so pages that are
// rendered by JavaScript (Slov-Lex) or protected by bot checks (EUR-Lex) still work.

const EXTRACT_JS = `(() => {
  const b = document.body;
  const bodyText = b ? b.innerText : '';
  // Prefer the main content area (leaves out menus and footers that change on their own).
  let text = bodyText;
  const cands = Array.from(document.querySelectorAll('main, article, [role=main], #content, .content, #main, .main-content'));
  let best = null;
  for (const c of cands) { const len = (c.innerText || '').length; if (!best || len > best.len) best = { el: c, len }; }
  if (best && best.len >= Math.max(200, bodyText.length * 0.4)) text = best.el.innerText;
  // Slov-Lex: only the act and its annexes, not the page's contents list and info box (they differ in every version).
  const act = document.querySelector('#predpis');
  if (act && (act.innerText || '').length >= 200) text = [act, document.querySelector('#prilohy')].filter(Boolean).map((e) => e.innerText).join('\\n');
  // EUR-Lex: only the act (HTML-only page or the "Text" tab), not the contents list, menus and footer.
  const eu = !act && (document.querySelector('#docHtml') || document.querySelector('#document1') || document.querySelector('#textTabContent'));
  if (eu && (eu.innerText || '').length >= 200) text = eu.innerText;
  return {
    text,
    bodyText,
    html: document.documentElement ? document.documentElement.outerHTML.slice(0, 4000000) : '',
    links: Array.from(document.querySelectorAll('a[href]')).slice(0, 8000).map(a => ({ href: a.href, text: (a.textContent || '').trim().slice(0, 160) }))
  };
})()`;

/** Acts that amended the law after version `fromKey` up to `toKey` (Slov-Lex index only). */
function amendments(versions, fromKey, toKey) {
  const acts = versions.filter((v) => v.key > fromKey && v.key <= toKey).flatMap((v) => v.amendedBy || []);
  return acts.length ? { amendedBy: [...new Set(acts)] } : {};
}

function createElectronFetcher({ log = () => {} } = {}) {
  const { BrowserWindow, session } = require('electron');
  let ses = null;
  function getSession() {
    if (ses) return ses;
    ses = session.fromPartition('persist:legislation');
    ses.setUserAgent(ses.getUserAgent().replace(/\s(?:Electron|sop-archiv|SOP Archiv)\/\S+/gi, ''));
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    ses.webRequest.onBeforeRequest((details, cb) => {
      if (['image', 'media', 'font'].includes(details.resourceType)) return cb({ cancel: true });
      if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') log({ purpose: 'legislation', url: details.url });
      cb({});
    });
    ses.on('will-download', (_e, item) => item.cancel());
    return ses;
  }

  return async function fetchPage(url, { timeoutMs = 60000 } = {}) {
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: { session: getSession(), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, images: false, backgroundThrottling: false, devTools: !require('electron').app.isPackaged }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.setAudioMuted(true);
    let failure = null;
    let httpStatus = null;
    win.webContents.on('did-fail-load', (_e, code, desc, _u, isMain) => {
      if (isMain && code !== -3) failure = `${desc} (${code})`;
    });
    win.webContents.on('did-navigate', (_e, _u, status) => {
      httpStatus = status;
    });
    const started = Date.now();
    try {
      await Promise.race([win.loadURL(url).catch(() => {}), sleep(timeoutMs)]);
      if (failure) throw new Error(failure);
      if (httpStatus >= 400) throw new Error(`HTTP ${httpStatus}`);
      // Wait until the rendered text stops growing (pages that build their content with JavaScript).
      let last = -1;
      let stable = 0;
      while (Date.now() - started < timeoutMs) {
        const len = await win.webContents.executeJavaScript('document.body ? document.body.innerText.length : 0', true).catch(() => 0);
        // A short page may still be loading its content, so it must stay unchanged for longer.
        if (len > 0 && len === last) {
          if (++stable >= (len > 200 ? 3 : 7)) break;
        } else stable = 0;
        last = len;
        await sleep(700);
      }
      let text = '';
      let bodyText = '';
      let html = '';
      const links = [];
      for (const frame of win.webContents.mainFrame.framesInSubtree) {
        try {
          const r = await frame.executeJavaScript(EXTRACT_JS);
          text += (text ? '\n' : '') + (r.text || '');
          bodyText += (bodyText ? '\n' : '') + (r.bodyText || '');
          html += r.html || '';
          links.push(...(r.links || []));
        } catch (_) {
          /* cross-origin or detached frame */
        }
      }
      return { url: win.webContents.getURL(), title: win.webContents.getTitle(), text, bodyText, html, links, status: httpStatus };
    } finally {
      win.destroy();
    }
  };
}

module.exports = { LegislationMonitor, createElectronFetcher, stableText };
