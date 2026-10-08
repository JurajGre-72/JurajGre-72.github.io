'use strict';
// Reads the notices of the authorities (public pages only) and adds new ones to the archive; and the pages
// of the products the company watches in the EU veterinary medicines database. Only these sites are
// contacted; nothing about the archive is sent.

const N = require('./lib/notices');
const U = require('./lib/upd');

/** The EU database: the products' pages change rarely – read once a day, or when asked to. */
const UPD_SOURCE = { id: 'upd-watch', authority: 'upd', kind: 'upd', page: 'https://medicines.health.europa.eu/veterinary/sk' };
const UPD_EVERY_MS = 20 * 60 * 60 * 1000;

class NoticesMonitor {
  /**
   * fetchText(url) → { text, url } (the final address after redirects)
   * base: in tests, a local server instead of the authorities' sites
   */
  constructor(archive, { fetchText, isOffline = () => false, base = null, pauseMs = 800, transact = (fn) => fn() }) {
    this.archive = archive;
    this.transact = transact; // saving the result is a write transaction (the pages are read outside it)
    this.fetchText = fetchText;
    this.isOffline = isOffline;
    this.base = base;
    this.pauseMs = pauseMs;
    this.running = false;
  }

  pause() {
    return new Promise((res) => setTimeout(res, this.pauseMs));
  }

  get sources() {
    return N.sources(this.base);
  }

  /** Read every page; returns { added: [notices], errors: [{ source, error }] }. force: the EU database too. */
  async checkAll({ force = false } = {}) {
    if (this.isOffline()) throw new Error('OFFLINE');
    if (this.running) throw new Error('BUSY');
    this.running = true;
    try {
      const batches = [];
      const list = this.sources;
      for (let i = 0; i < list.length; i++) {
        const src = list[i];
        try {
          const r = await this.fetchText(src.url);
          const items = N.parseSource(src, r.text, r.url);
          // A page that no longer lists anything has most likely changed its layout.
          if (!items.length) throw new Error('FORMAT');
          batches.push({ src, items });
        } catch (e) {
          batches.push({ src, error: (e && e.message) || String(e) });
        }
        if (i < list.length - 1 && this.pauseMs) await this.pause();
      }
      const ids = U.updIds(this.archive.companyProfile().updWatch);
      const last = Date.parse(this.archive.data.notices.updLastCheck || '') || 0;
      if (ids.length && (force || Date.now() - last > UPD_EVERY_MS)) {
        const readings = [];
        for (const id of ids) {
          if (this.pauseMs) await this.pause();
          try {
            const r = await this.fetchText(U.updUrl(id, this.base));
            const product = U.parseProduct(r.text);
            readings.push(product ? { id, product } : { id, error: 'FORMAT' });
          } catch (e) {
            const msg = (e && e.message) || String(e);
            readings.push(/^HTTP 404\b/.test(msg) ? { id, gone: true } : { id, error: msg });
          }
        }
        batches.push({ src: UPD_SOURCE, upd: readings, base: this.base, items: [] });
      }
      const added = await this.transact(() => this.archive.mergeNotices(batches));
      const errors = batches.filter((b) => b.error).map((b) => ({ source: b.src.id, error: b.error }));
      const upd = batches.find((b) => b.upd);
      const failed = upd ? upd.upd.filter((x) => x.error) : [];
      if (failed.length) errors.push({ source: UPD_SOURCE.id, error: failed.length === upd.upd.length ? failed[0].error : `${failed.length}/${upd.upd.length}` });
      return { added, errors };
    } finally {
      this.running = false;
    }
  }
}

/** Is this address one of the authorities' sites (or the local test server)? */
function allowedUrl(url, base = null) {
  try {
    const u = new URL(url);
    if (base && url.startsWith(base)) return true;
    return u.protocol === 'https:' && N.HOSTS.includes(u.hostname.toLowerCase());
  } catch (_) {
    return false;
  }
}

/** Downloads a page as text in its own session (no cookies shared with anything else). */
function createTextFetcher({ log = () => {}, base = null, timeoutMs = 45000 } = {}) {
  const { session } = require('electron');
  let ses = null;
  const getSession = () => {
    if (ses) return ses;
    ses = session.fromPartition('persist:notices');
    ses.setUserAgent(ses.getUserAgent().replace(/\s(?:Electron|sop-archiv|SOP Archiv)\/\S+/gi, ''));
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    return ses;
  };
  return async function fetchText(url) {
    if (!allowedUrl(url, base)) throw new Error('HOST');
    log({ purpose: 'notices', url });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await getSession().fetch(url, { cache: 'no-store', redirect: 'follow', signal: ctrl.signal, headers: { 'accept-language': 'sk,en;q=0.5' } });
      if (!allowedUrl(res.url || url, base)) throw new Error('HOST');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 8 * 1024 * 1024) throw new Error('TOO_BIG');
      return { text: new TextDecoder('utf-8').decode(buf), url: res.url || url };
    } finally {
      clearTimeout(timer);
    }
  };
}

module.exports = { NoticesMonitor, createTextFetcher, allowedUrl };
