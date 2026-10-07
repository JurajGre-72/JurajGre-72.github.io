'use strict';
// The audit trail on disk.
//
// Several computers may work with one archive at the same time (a shared network folder), so each
// computer writes its own file: audit/<computer>.log (the name is a fingerprint of the computer's name,
// so the folder does not show it). Lines are only ever appended. Each line carries `prev`, a fingerprint
// of the line before it in the same file: a line removed, changed or moved later breaks the chain and
// the app reports it. Archives from before this keep their single audit.log, which is still read.
//
// Lines are encrypted one by one when the archive is encrypted (lib/vault.js).

const fs = require('fs');
const { replaceFile } = require('./fsretry');
const path = require('path');
const crypto = require('crypto');

const fp = (line) => crypto.createHash('sha256').update(line).digest('hex').slice(0, 32);

function fileFor(dir, host) {
  return path.join(dir, 'audit', `${crypto.createHash('sha256').update(String(host)).digest('hex').slice(0, 16)}.log`);
}

class AuditLog {
  /** crypt: { encrypt(json) -> line, decrypt(line) -> json } (identity when the archive is not encrypted). */
  constructor(dir, host, crypt) {
    this.dir = dir;
    this.host = host;
    this.crypt = crypt;
    this.file = fileFor(dir, host);
    this.last = null; // fingerprint of the last line of this computer's file (read once)
    this.chain = Promise.resolve();
  }

  async _lastLine() {
    let fd;
    try {
      fd = await fs.promises.open(this.file, 'r');
      const { size } = await fd.stat();
      const len = Math.min(size, 256 * 1024);
      const buf = Buffer.alloc(len);
      await fd.read(buf, 0, len, size - len);
      const lines = buf.toString('utf8').split('\n').filter(Boolean);
      return lines.length ? lines[lines.length - 1] : null;
    } catch (_) {
      return null;
    } finally {
      if (fd) await fd.close().catch(() => {});
    }
  }

  /** Append one record (an object). Records are written in the order they were given. */
  append(record) {
    this.chain = this.chain
      .then(async () => {
        if (this.last === null) {
          const l = await this._lastLine();
          this.last = l ? fp(l) : '';
        }
        const line = this.crypt.encrypt(JSON.stringify({ ...record, host: record.host || this.host, prev: this.last }));
        await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
        await fs.promises.appendFile(this.file, line + '\n');
        this.last = fp(line);
      })
      .catch((e) => console.error('audit failed', e));
    return this.chain;
  }

  /**
   * When an archive is encrypted: every plain line of the per-computer files becomes an encrypted one,
   * and the chain is rebuilt over the new lines (a one-time, recorded conversion).
   */
  async reencrypt() {
    await this.chain;
    for (const f of (await this.files()).filter((x) => path.basename(x) !== 'audit.log')) {
      const lines = (await fs.promises.readFile(f, 'utf8')).split('\n').filter(Boolean);
      if (lines.every((l) => l.startsWith('E1:'))) continue;
      let prev = '';
      const out = [];
      for (const l of lines) {
        let rec;
        try {
          rec = JSON.parse(l.startsWith('E1:') ? this.crypt.decrypt(l) : l);
        } catch (_) {
          continue;
        }
        const nl = this.crypt.encrypt(JSON.stringify({ ...rec, prev }));
        out.push(nl);
        prev = fp(nl);
      }
      const tmp = `${f}.${process.pid}.tmp`;
      await fs.promises.writeFile(tmp, out.join('\n') + '\n');
      await replaceFile(tmp, f);
    }
    this.last = null;
  }

  /** The files of the trail: the old single audit.log (if any) and one per computer. */
  async files() {
    const out = [];
    if (fs.existsSync(path.join(this.dir, 'audit.log'))) out.push(path.join(this.dir, 'audit.log'));
    try {
      for (const f of (await fs.promises.readdir(path.join(this.dir, 'audit'))).sort()) if (f.endsWith('.log')) out.push(path.join(this.dir, 'audit', f));
    } catch (_) {
      /* none yet */
    }
    return out;
  }

  /**
   * Every record (oldest first) and the state of each file's chain:
   * integrity: { ok, records, files, problems: [{ file, line, ts, kind: 'unreadable' | 'chain' }] }
   */
  async readAll() {
    await this.chain;
    const rows = [];
    const problems = [];
    const files = await this.files();
    for (const f of files) {
      let raw = '';
      try {
        raw = await fs.promises.readFile(f, 'utf8');
      } catch (_) {
        continue;
      }
      const lines = raw.split('\n').filter(Boolean);
      let prevLine = null;
      lines.forEach((line, i) => {
        let rec = null;
        try {
          rec = JSON.parse(this.crypt.decrypt(line));
        } catch (_) {
          problems.push({ file: path.basename(f), line: i + 1, kind: 'unreadable' });
        }
        if (rec) {
          // Lines written before the chain existed have no `prev`; from the first that has one, it must match.
          if (rec.prev !== undefined && rec.prev !== (prevLine === null ? '' : fp(prevLine))) problems.push({ file: path.basename(f), line: i + 1, ts: rec.ts, kind: 'chain' });
          const { prev, ...r } = rec;
          rows.push(r);
        }
        prevLine = line;
      });
    }
    rows.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    return { rows, integrity: { ok: problems.length === 0, records: rows.length, files: files.length, problems: problems.slice(0, 50) } };
  }
}

module.exports = { AuditLog, fileFor };
