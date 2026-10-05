'use strict';
// Single-writer lock for an archive folder that may be shared (e.g. a company network drive).
// The first computer to open the archive can change it; others open it read-only and refresh
// automatically. A lock not refreshed for STALE_MS (crash, sleeping laptop) can be taken over.

const fs = require('fs');
const path = require('path');

const STALE_MS = 2 * 60 * 1000;

class ArchiveLock {
  constructor(dir, { host, user, pid = process.pid, staleMs = STALE_MS } = {}) {
    this.file = path.join(dir, '.sop-archiv.lock');
    this.host = host;
    this.user = user;
    this.pid = pid;
    this.staleMs = staleMs;
    this.owned = false;
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (_) {
      return null;
    }
  }

  isMine(h) {
    return !!h && h.host === this.host && h.pid === this.pid;
  }

  /** A lock left by a process on this computer that no longer runs (crash) can be taken over at once. */
  isDeadLocal(h) {
    if (!h || h.host !== this.host || h.pid === this.pid) return false;
    try {
      process.kill(h.pid, 0);
      return false;
    } catch (e) {
      return e.code === 'ESRCH';
    }
  }

  _payload(since) {
    return JSON.stringify({ host: this.host, user: this.user, pid: this.pid, ts: Date.now(), since: since || new Date().toISOString() });
  }

  /** { ok: true } or { ok: false, holder: { host, user, since } } */
  tryAcquire() {
    const h = this.read();
    if (h && !this.isMine(h) && !this.isDeadLocal(h) && Date.now() - (h.ts || 0) < this.staleMs) {
      this.owned = false;
      return { ok: false, holder: { host: h.host, user: h.user, since: h.since } };
    }
    try {
      if (!h && !fs.existsSync(this.file)) fs.writeFileSync(this.file, this._payload(), { flag: 'wx' });
      else fs.writeFileSync(this.file, this._payload(h && this.isMine(h) ? h.since : null));
    } catch (e) {
      if (e.code === 'EEXIST') return this.tryAcquire(); // another computer was faster: look again
      throw e;
    }
    // Confirm nobody overwrote it at the same moment.
    const check = this.read();
    this.owned = this.isMine(check);
    return this.owned ? { ok: true } : { ok: false, holder: check ? { host: check.host, user: check.user, since: check.since } : null };
  }

  /** Refresh the timestamp. Returns false if the lock was lost (taken over by another computer). */
  heartbeat() {
    if (!this.owned) return false;
    const h = this.read();
    if (h && !this.isMine(h)) {
      this.owned = false;
      return false;
    }
    try {
      fs.writeFileSync(this.file, this._payload(h && h.since));
    } catch (_) {
      /* network drive briefly unavailable: try again next time */
    }
    return true;
  }

  setUser(user) {
    this.user = user;
    if (this.owned) this.heartbeat();
  }

  release() {
    if (!this.owned) return;
    const h = this.read();
    if (this.isMine(h)) {
      try {
        fs.unlinkSync(this.file);
      } catch (_) {
        /* ignore */
      }
    }
    this.owned = false;
  }
}

module.exports = { ArchiveLock, STALE_MS };
