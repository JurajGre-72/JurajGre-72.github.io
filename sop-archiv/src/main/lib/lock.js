'use strict';
// Write lock for an archive folder that may be shared (e.g. a company network drive). A computer holds it
// only while it saves a change (a write transaction in main.js); the others wait for it. A lock not
// refreshed for STALE_MS (crash, sleeping laptop, network gone in the middle of a save) can be taken over.

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

  /** The holder, or null when nobody holds the lock. A lock file another computer is still writing (empty or
   *  half written) counts as held, by an unknown holder, until it is as old as a stale lock. */
  read() {
    let text;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch (_) {
      return null;
    }
    try {
      const h = JSON.parse(text);
      if (h && typeof h === 'object') return h;
    } catch (_) {
      /* being written */
    }
    let ts = Date.now();
    try {
      ts = fs.statSync(this.file).mtimeMs;
    } catch (_) {
      return null; // removed meanwhile
    }
    return { host: '', user: '', pid: 0, ts, unreadable: true };
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
    if (h && !this.isMine(h)) {
      // Stale, or left by a program on this computer that crashed: remove it and create a new one, so that
      // of several computers taking it over at the same moment only one succeeds. Removed only if it is
      // still the same old lock (another computer may have just taken it over).
      const again = this.read();
      if (again && again.ts === h.ts && again.host === h.host && again.pid === h.pid) {
        try {
          fs.unlinkSync(this.file);
        } catch (e) {
          if (e.code !== 'ENOENT') throw e;
        }
      }
      return this.tryAcquire();
    }
    try {
      if (!h) fs.writeFileSync(this.file, this._payload(), { flag: 'wx' });
      else fs.writeFileSync(this.file, this._payload(h.since));
    } catch (e) {
      if (e.code === 'EEXIST') return this.tryAcquire(); // another computer was faster: look again
      // Windows: the lock file of a colleague who has just finished is still being removed, or another
      // program has it open for a moment. Not free yet: the caller tries again shortly.
      if (e.code === 'EBUSY' || (process.platform === 'win32' && (e.code === 'EPERM' || e.code === 'EACCES'))) {
        this.owned = false;
        return { ok: false, holder: null };
      }
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
