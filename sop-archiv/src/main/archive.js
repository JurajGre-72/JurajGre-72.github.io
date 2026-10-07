'use strict';
// The archive: everything lives in one folder chosen by the user.
//
//   <dataDir>/archive.json            documents, legislation register, detected changes, settings
//   <dataDir>/files/<docId>/...        original files (every version)
//   <dataDir>/text/<versionId>.json    extracted text (for search)
//   <dataDir>/legislation/<lawId>/...  law snapshots and change diffs
//   <dataDir>/backups/                 daily copies of archive.json
//   <dataDir>/audit/<computer>.log     append-only audit trail, one file per computer (lib/auditlog.js);
//                                      older archives also have audit.log
//   <dataDir>/branding/logo.*          company logo shown in the app (optional)
//   <dataDir>/keyring.json             once encrypted: the data key, wrapped per user password and for the recovery code
//   <dataDir>/archive.rev              a new random value after every save: other computers see that something changed
//
// Several computers can work with one archive (a shared network folder). Every change is a short
// write transaction (main.js withWrite): take the folder's lock, read what others saved since
// (syncFromDisk), change, save, release. Nobody holds the archive for a whole session.
//
// After the first administrator profile is set up, every file above (except keyring.json, the lock and the
// logo) is encrypted with AES-256-GCM (lib/vault.js); it can only be read after signing in to the app.
//
// Plain files on purpose: the folder can be backed up, moved or inspected without this app.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { extractFile } = require('./lib/extract');
const { chunkPages } = require('./lib/text');
const { detectMetadata, detectCitations, detectAllLawRefs, aliasesFromKey } = require('./lib/metadata');
const { SearchIndex } = require('./lib/search');
const { reviewState } = require('./lib/reviews');
const { touchedKeys, diffLaw, hashText } = require('./lib/legis-parse');
const { analyzeLawAgainstDocs, SEVERITY } = require('./lib/compliance');
const { today, addMonths } = require('./lib/dates');
const { DEFAULT_LAWS, DOC_TYPES, defaultArchive } = require('./lib/defaults');
const { ROLES, hashPassword, verifyPassword, validPassword } = require('./lib/auth');
const { pagesWithoutText } = require('./ocr');
const vault = require('./lib/vault');
const { replaceFile, writeFileRetry, retryBusy } = require('./lib/fsretry');
const training = require('./lib/training');
const approval = require('./lib/approval');
const company = require('./lib/company');
const notices = require('./lib/notices');
const { AuditLog } = require('./lib/auditlog');
const os = require('os');

const STATUSES = ['draft', 'effective', 'review', 'obsolete'];
const LOGO_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const LOGO_MAX_BYTES = 1024 * 1024;
const DOC_FIELDS = ['type', 'code', 'title', 'status', 'department', 'owner', 'approver', 'tags', 'notes', 'effectiveDate', 'reviewDate', 'reviewIntervalMonths', 'version', 'annexOf', 'trainingFor'];

function id() {
  return crypto.randomUUID();
}

function safeName(name) {
  const base = String(name || 'dokument')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return base.length > 120 ? base.slice(0, 80) + '…' + base.slice(-30) : base;
}

async function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, data);
  await replaceFile(tmp, file);
}

class Archive {
  constructor({ dataDir, user, lang = 'sk', host }) {
    const opts = { host };
    this.dir = dataDir;
    this.user = user || 'user';
    this.lang = lang;
    this.data = null;
    this.index = new SearchIndex();
    this.analyzed = new Map(); // filePath -> analysis (reused by import)
    this.saving = Promise.resolve();
    this._syncing = Promise.resolve();
    this._saves = 0; // changes saved by this program (a reading from disk started before one is out of date)
    this.saveError = null; // the last save that did not reach the disk (see takeSaveError)
    this.indexReady = false;
    this.userId = null;
    this.readOnly = false; // this computer may not write to the archive folder
    this.key = null; // data key, only in memory, after a user signed in
    this.keyring = null; // keyring.json when the archive is encrypted
    this.pendingAudit = []; // audit entries made while locked, written after unlocking
    // The audit trail of this computer (each computer working with a shared archive writes its own file).
    this.host = opts.host || os.hostname();
    this.auditLog = new AuditLog(this.dir, this.host, {
      encrypt: (json) => (this.key ? vault.encryptLine(this.key, json) : json),
      decrypt: (line) => (line.startsWith('E1:') ? vault.decryptLine(this.key, line) : line)
    });
  }

  /** The archive is encrypted (has a keyring). */
  get encrypted() {
    return !!this.keyring;
  }

  /** Encrypted and nobody has signed in yet: nothing can be read. */
  get locked() {
    return this.encrypted && !this.key;
  }

  // Every file of the archive goes through these: encrypted when the archive is, plain files still readable.
  async _readFile(file) {
    const buf = await fs.promises.readFile(file);
    if (!vault.isEncrypted(buf)) return buf;
    if (!this.key) throw new Error('LOCKED');
    return vault.decrypt(this.key, buf);
  }

  async _readText(file) {
    return (await this._readFile(file)).toString('utf8');
  }

  async _readJson(file) {
    return JSON.parse(await this._readText(file));
  }

  _seal(data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    return this.key ? vault.encrypt(this.key, buf) : buf;
  }

  async _write(file, data) {
    await writeAtomic(file, this._seal(data));
  }

  p(...parts) {
    return path.join(this.dir, ...parts);
  }

  async open() {
    for (const d of ['', 'files', 'text', 'legislation', 'backups', 'trash']) await fs.promises.mkdir(this.p(d), { recursive: true });
    this.keyring = this._loadKeyring();
    if (this.locked) {
      // Encrypted: nothing is read until someone signs in (see login / unlock).
      this.data = defaultArchive(this.lang);
      return { created: false, locked: true };
    }
    return this._load();
  }

  async _load() {
    const file = this.p('archive.json');
    let created = false;
    if (fs.existsSync(file)) {
      try {
        this.data = await this._readJson(file);
      } catch (e) {
        if (e.message === 'LOCKED') throw e;
        // Damaged file (e.g. power loss): keep it aside and restore the previous save,
        // or else the newest daily backup.
        const backups = (await fs.promises.readdir(this.p('backups'))).filter((f) => /^archive-.*\.json$/.test(f)).sort().reverse();
        const candidates = [this.p('archive.prev.json'), ...backups.map((b) => this.p('backups', b))];
        let restored = null;
        for (const c of candidates) {
          try {
            this.data = await this._readJson(c);
            restored = path.basename(c);
            break;
          } catch (_) {
            /* try the next one */
          }
        }
        if (!restored) throw e;
        if (!this.readOnly) await fs.promises.copyFile(file, `${file}.damaged-${Date.now()}`);
        this.restoredFrom = restored;
        await this.save();
        this.audit('archive.restored', { from: this.restoredFrom });
      }
    } else {
      this.data = defaultArchive(this.lang);
      this.data.laws = DEFAULT_LAWS.map((l) => this._newLaw(l));
      created = true;
    }
    this._migrate();
    this._rev = this._readRev();
    if (created) {
      await this.save();
      this.audit('archive.created', { dir: this.dir });
    }
    await this._dailyBackup();
    return { created };
  }

  _readRev() {
    try {
      return fs.readFileSync(this.p('archive.rev'), 'utf8').trim();
    } catch (_) {
      return '';
    }
  }

  /**
   * Another computer saved since this one last read or wrote: read its state – documents, users, keys,
   * search index. Returns true when something was read. (Called at the start of every write transaction
   * and every few seconds in between.)
   */
  syncFromDisk() {
    // One reading at a time: a transaction's reading waits for a background one still in progress.
    const run = () => this._sync();
    const p = this._syncing.then(run, run);
    this._syncing = p.catch(() => {});
    return p;
  }

  async _sync() {
    if (this.locked || !this.data) return false;
    await this.saving;
    const rev = this._readRev();
    if (rev === (this._rev || '')) return false;
    const saves = this._saves;
    // Both files exactly as saved: a file a colleague is just replacing (Windows refuses to open it for a
    // moment) is read again; if it still cannot be read, nothing is taken over (no mix of old and new).
    let keyring = null;
    if (fs.existsSync(this.p('keyring.json'))) {
      keyring = JSON.parse(await retryBusy(() => fs.promises.readFile(this.p('keyring.json'), 'utf8')));
    }
    const data = JSON.parse((await retryBusy(() => this._readFile(this.p('archive.json')))).toString('utf8'));
    // This computer saved a change while the file was being read: what was read is older than what is in
    // memory now, so it is not used (a write transaction reads the colleagues' changes before it changes anything).
    if (saves !== this._saves) return false;
    if (keyring) this.keyring = keyring;
    this.data = data;
    this._migrate();
    this._rev = rev;
    await this._refreshIndex();
    return true;
  }

  _migrate() {
    const d = this.data;
    d.docs = d.docs || [];
    d.laws = d.laws || [];
    d.changes = d.changes || [];
    d.users = d.users || [];
    d.company = d.company ? company.cleanCompany(d.company) : company.defaultCompany();
    d.people = d.people || [];
    d.trainings = d.trainings || [];
    d.decisions = d.decisions || [];
    d.notices = d.notices || { items: [], sources: {} };
    d.notices.items = d.notices.items || [];
    d.notices.sources = d.notices.sources || {};
    const def = defaultArchive(this.lang).settings;
    d.settings = { ...def, ...(d.settings || {}) };
    for (const doc of d.docs) {
      doc.versions = doc.versions || [];
      doc.reviews = doc.reviews || [];
      doc.tags = doc.tags || [];
      doc.citations = doc.citations || [];
      doc.lawRefs = doc.lawRefs || [];
      doc.proposals = doc.proposals || [];
      doc.approvals = doc.approvals || [];
      doc.copies = doc.copies || [];
    }
  }

  /** Build the search index from stored text (call after open). */
  async buildIndex(onProgress) {
    this.index.reset();
    this._indexed = new Map();
    const docs = this.data.docs;
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      const pages = await this.loadText(doc.currentVersionId);
      this.index.setDocument(doc, chunkPages(pages));
      this._indexed.set(doc.id, this._indexSig(doc));
      if (onProgress && i % 20 === 0) onProgress(i, docs.length);
    }
    this.indexReady = true;
  }

  _indexSig(doc) {
    return JSON.stringify([doc.currentVersionId, doc.code, doc.title, doc.type, doc.status, doc.department, doc.tags, (doc.versions.find((v) => v.id === doc.currentVersionId) || {}).ocr]);
  }

  /** After reading another computer's changes: index only the documents that changed. */
  async _refreshIndex() {
    if (!this.indexReady || !this._indexed) return;
    const ids = new Set(this.data.docs.map((d) => d.id));
    for (const id of [...this._indexed.keys()]) {
      if (!ids.has(id)) {
        this.index.removeDocument(id);
        this._indexed.delete(id);
      }
    }
    for (const doc of this.data.docs) {
      const sig = this._indexSig(doc);
      if (this._indexed.get(doc.id) === sig) continue;
      this.index.setDocument(doc, chunkPages(await this.loadText(doc.currentVersionId)));
      this._indexed.set(doc.id, sig);
    }
  }

  save() {
    if (this.readOnly || this.locked) return this.saving; // never write to a read-only folder, or before unlocking
    // With a shared folder, a save outside a write transaction could overwrite another computer's work.
    if (this.shared && !this.inTx) {
      const e = new Error('Archive saved outside a write transaction');
      if (process.env.SOP_ARCHIV_STRICT_TX) throw e;
      console.error(e);
      if (this._readRev() !== (this._rev || '')) return this.saving; // someone else saved meanwhile: do not overwrite
    }
    this._saves++;
    const content = this._seal(JSON.stringify(this.data, null, 1));
    const file = this.p('archive.json');
    this.saving = this.saving
      .then(async () => {
        const tmp = `${file}.${process.pid}.tmp`;
        await fs.promises.writeFile(tmp, content);
        // Keep the previous state one save back, for recovery.
        if (fs.existsSync(file)) await retryBusy(() => fs.promises.copyFile(file, this.p('archive.prev.json'))).catch(() => {});
        await replaceFile(tmp, file);
        // Other computers notice the change by this value.
        const rev = crypto.randomBytes(8).toString('hex');
        await writeFileRetry(this.p('archive.rev'), rev);
        this._rev = rev;
      })
      .catch((e) => {
        console.error('save failed', e);
        this.saveError = e;
        this.audit('archive.saveFailed', { error: String(e.code || e.message || e) });
      });
    return this.saving;
  }

  /**
   * A save of this program failed (folder gone, disk full, file kept busy by another program): returns the
   * error once. What is in memory then differs from the disk, so the next reading reloads what is really saved.
   */
  takeSaveError() {
    const e = this.saveError;
    if (e) {
      this.saveError = null;
      this._rev = '(not saved)';
    }
    return e;
  }

  async _dailyBackup() {
    if (this.readOnly || this.locked) return;
    try {
      const target = this.p('backups', `archive-${today()}.json`);
      if (!fs.existsSync(target) && fs.existsSync(this.p('archive.json'))) {
        await fs.promises.copyFile(this.p('archive.json'), target);
        const all = (await fs.promises.readdir(this.p('backups'))).filter((f) => /^archive-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
        for (const old of all.slice(0, Math.max(0, all.length - 30))) await fs.promises.unlink(this.p('backups', old));
      }
    } catch (e) {
      console.error('backup failed', e);
    }
  }

  /** Re-read archive.json written by another computer (read-only mode). */
  async reload() {
    if (this.locked) return;
    const data = await this._readJson(this.p('archive.json'));
    this.data = data;
    this._migrate();
    await this.buildIndex();
  }

  audit(action, details = {}) {
    const rec = { ts: new Date().toISOString(), user: this.user, userId: this.userId || undefined, action, ...details };
    if (this.locked) {
      this.pendingAudit.push(rec); // written once someone signs in
      return;
    }
    this.auditLog.append(rec);
  }

  /** Every record of the audit trail (all computers), oldest first. */
  async allAudit() {
    if (this.locked) return [];
    return (await this.auditLog.readAll()).rows;
  }

  /** Whether the trail is complete: { ok, records, files, problems } (see lib/auditlog.js). */
  async auditIntegrity() {
    if (this.locked) return null;
    return (await this.auditLog.readAll()).integrity;
  }

  async readAudit({ docId, limit = 300 } = {}) {
    let rows = await this.allAudit();
    if (docId) rows = rows.filter((r) => r.docId === docId);
    return rows.slice(-limit).reverse();
  }

  // ---------------------------------------------------------------------------
  // User profiles (stored in the archive, so they travel with a shared archive folder)

  publicUsers() {
    // Encrypted: the sign-in screen only knows the names in the keyring (profiles that can sign in).
    if (this.encrypted) return this.keyring.users.filter((u) => u.wrap).map((u) => ({ id: u.id, name: u.name, role: u.role }));
    return this.data.users.filter((u) => !u.disabled).map((u) => ({ id: u.id, name: u.name, role: u.role }));
  }

  listUsers() {
    return this.data.users.map(({ salt, hash, ...u }) => ({ ...u, needsPassword: this.encrypted && !u.disabled && !this._keyEntry(u.id)?.wrap }));
  }

  _user(userId) {
    const u = this.data.users.find((x) => x.id === userId);
    if (!u) throw new Error('User not found');
    return u;
  }

  _checkName(name, exceptId) {
    const n = String(name || '').trim();
    if (n.length < 2) throw new Error('NAME_REQUIRED');
    if (this.data.users.some((u) => u.id !== exceptId && u.name.toLowerCase() === n.toLowerCase())) throw new Error('NAME_TAKEN');
    return n;
  }

  /** mustChange: a password set by an administrator is changed by its user at the first sign-in. */
  async createUser({ name, role, password, mustChange = true }) {
    const n = this._checkName(name);
    if (!ROLES.includes(role)) throw new Error('Invalid role');
    if (!validPassword(password)) throw new Error('PASSWORD_SHORT');
    const u = { id: id(), name: n, role, createdAt: new Date().toISOString(), createdBy: this.user, disabled: false, prefs: {}, mustChangePassword: !!mustChange };
    if (this.encrypted) this._setKeyEntry(u, password);
    else Object.assign(u, hashPassword(password));
    this.data.users.push(u);
    if (this.encrypted) await this._saveKeyring();
    await this.save();
    this.audit('user.created', { targetUser: n, role });
    return this.listUsers().find((x) => x.id === u.id);
  }

  _activeAdmins(except) {
    return this.data.users.filter((u) => u.role === 'admin' && !u.disabled && u.id !== except).length;
  }

  async updateUser(userId, patch) {
    const u = this._user(userId);
    const changes = {};
    if (patch.name !== undefined) {
      const n = this._checkName(patch.name, userId);
      if (n !== u.name) changes.name = { from: u.name, to: n };
      u.name = n;
    }
    const losesAdmin = (patch.role !== undefined && patch.role !== 'admin') || patch.disabled === true;
    if (u.role === 'admin' && losesAdmin && !this._activeAdmins(userId)) throw new Error('LAST_ADMIN');
    if (patch.role !== undefined) {
      if (!ROLES.includes(patch.role)) throw new Error('Invalid role');
      if (patch.role !== u.role) changes.role = { from: u.role, to: patch.role };
      u.role = patch.role;
    }
    if (patch.disabled !== undefined) {
      if (!!patch.disabled !== !!u.disabled) changes.disabled = { from: !!u.disabled, to: !!patch.disabled };
      u.disabled = !!patch.disabled;
    }
    if (this.encrypted) {
      const e = this._keyEntry(userId);
      if (e) Object.assign(e, { name: u.name, role: u.role });
      // A disabled profile loses its key: even with the old password it cannot open the archive files.
      if (e && u.disabled) e.wrap = null;
      await this._saveKeyring();
    }
    await this.save();
    if (Object.keys(changes).length) this.audit('user.updated', { targetUser: u.name, userChanges: changes });
    return this.listUsers().find((x) => x.id === userId);
  }

  async setPassword(userId, password, { self = false } = {}) {
    const u = this._user(userId);
    if (!validPassword(password)) throw new Error('PASSWORD_SHORT');
    if (this.encrypted) {
      if (u.disabled) throw new Error('USER_DISABLED');
      this._setKeyEntry(u, password);
      await this._saveKeyring();
      u.passwordChangedAt = new Date().toISOString();
    } else Object.assign(u, hashPassword(password), { passwordChangedAt: new Date().toISOString() });
    // Set by an administrator: known to two people, so the user replaces it at the next sign-in.
    u.mustChangePassword = !self;
    await this.save();
    this.audit(self ? 'user.password-changed' : 'user.password-reset', { targetUser: u.name });
  }

  /** Returns the user if the password is right (and the profile is active), else null. Unencrypted archives only. */
  verifyLogin(userId, password) {
    if (this.encrypted) return this.key && this.checkPassword(userId, password) ? this.data.users.find((x) => x.id === userId && !x.disabled) || null : null;
    const u = this.data.users.find((x) => x.id === userId && !x.disabled);
    if (!u || !verifyPassword(password, u.salt, u.hash)) return null;
    return u;
  }

  // ---------------------------------------------------------------------------
  // Encryption: keyring, unlocking, recovery code (see lib/vault.js)

  _loadKeyring() {
    try {
      return JSON.parse(fs.readFileSync(this.p('keyring.json'), 'utf8'));
    } catch (_) {
      return null;
    }
  }

  async _saveKeyring() {
    if (this.readOnly) return;
    await writeAtomic(this.p('keyring.json'), JSON.stringify(this.keyring, null, 1));
  }

  _keyEntry(userId) {
    return this.keyring ? this.keyring.users.find((x) => x.id === userId) : null;
  }

  _setKeyEntry(user, password) {
    let e = this._keyEntry(user.id);
    if (!e) {
      e = { id: user.id };
      this.keyring.users.push(e);
    }
    Object.assign(e, { name: user.name, role: user.role, wrap: vault.wrapKey(this.key, password) });
    delete user.salt;
    delete user.hash;
  }

  /** Is this the user's password? (Encrypted archives: the user's copy of the data key opens with it.) */
  checkPassword(userId, password) {
    if (!this.encrypted) return !!this.verifyLogin(userId, password);
    const dek = vault.unwrapKey(this._keyEntry(userId)?.wrap, password);
    return !!dek && (!this.key || dek.equals(this.key));
  }

  /** Open an encrypted archive with its data key. */
  async unlock(dek) {
    if (this.key) return false;
    this.key = dek;
    try {
      await this._load();
    } catch (e) {
      this.key = null;
      throw e;
    }
    for (const rec of this.pendingAudit.splice(0)) this.auditLog.append(rec);
    await this.auditLog.chain;
    await this._encryptRemaining(); // a conversion that was interrupted continues
    return true;
  }

  /**
   * Sign in. Encrypted archives: the password must open the user's copy of the data key; the first sign-in
   * unlocks the archive. Returns { user, unlocked } or null; throws NEEDS_PASSWORD for a profile without a key.
   */
  async login(userId, password) {
    if (!this.encrypted) {
      const u = this.verifyLogin(userId, password);
      return u ? { user: u, unlocked: false } : null;
    }
    const e = this._keyEntry(userId);
    if (e && !e.wrap) throw new Error('NEEDS_PASSWORD');
    const dek = vault.unwrapKey(e && e.wrap, password);
    if (!dek) return null;
    if (this.key && !dek.equals(this.key)) return null;
    const unlocked = this.key ? false : await this.unlock(dek);
    const u = this.data.users.find((x) => x.id === userId && !x.disabled);
    if (!u) return null;
    if (vault.wrapIsOld(e.wrap) && !this.readOnly) {
      this._setKeyEntry(u, password); // profiles from before encryption get a fresh, stronger wrap
      await this._saveKeyring();
      await this.save();
    }
    return { user: u, unlocked };
  }

  /**
   * Turn on encryption. New archives: when the first administrator is set up. Existing archives: every
   * profile keeps its password (its stored password check wraps the key until the next sign-in), every file
   * is encrypted in place. Returns the recovery code, to be shown once.
   */
  async enableEncryption() {
    if (this.encrypted) throw new Error('Already encrypted');
    if (this.readOnly) throw new Error('READ_ONLY');
    this.key = vault.newDataKey();
    const code = vault.newRecoveryCode();
    this.keyring = {
      format: 1,
      createdAt: new Date().toISOString(),
      users: this.data.users
        .filter((u) => u.salt && u.hash)
        .map((u) => ({ id: u.id, name: u.name, role: u.role, wrap: u.disabled ? null : vault.wrapKeyLegacy(this.key, u) })),
      recovery: { wrap: vault.wrapKey(this.key, vault.normalizeRecoveryCode(code)), createdAt: new Date().toISOString() }
    };
    for (const u of this.data.users) {
      delete u.salt;
      delete u.hash;
    }
    if (this.data.users.length) this.data.pendingRecoveryCode = code; // shown to the first administrator who signs in
    await this._saveKeyring();
    await this.save();
    await this._encryptRemaining();
    this.audit('archive.encrypted', {});
    return code;
  }

  /** Encrypt every file of the archive that is still plain (also moves document files to neutral names). */
  async _encryptRemaining() {
    if (!this.key || this.readOnly) return;
    let renamed = false;
    for (const doc of this.data.docs) {
      for (const v of doc.versions) {
        const file = this.p(v.file);
        const neutral = path.join('files', doc.id, `v${v.seq}.bin`);
        if (!fs.existsSync(file) || v.file === neutral.split(path.sep).join('/')) continue;
        const buf = await fs.promises.readFile(file);
        await writeAtomic(this.p(neutral), vault.isEncrypted(buf) ? buf : vault.encrypt(this.key, buf));
        await fs.promises.unlink(file);
        v.file = neutral.split(path.sep).join('/');
        renamed = true;
      }
    }
    if (renamed) await this.save();
    const skip = new Set([this.p('keyring.json'), this.p('.sop-archiv.lock'), this.p('audit.log')]);
    const walk = async (dir) => {
      for (const ent of await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const f = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (f !== this.p('branding') && f !== this.p('audit')) await walk(f); // audit files: line by line, below
        } else if (!skip.has(f) && !ent.name.endsWith('.tmp')) {
          const buf = await fs.promises.readFile(f);
          if (!vault.isEncrypted(buf)) await writeAtomic(f, vault.encrypt(this.key, buf));
        }
      }
    };
    await walk(this.dir);
    // The audit log: every plain line becomes an encrypted one.
    const log = this.p('audit.log');
    if (fs.existsSync(log)) {
      const lines = (await fs.promises.readFile(log, 'utf8')).split('\n').filter(Boolean);
      if (lines.some((l) => !l.startsWith('E1:'))) await writeAtomic(log, lines.map((l) => (l.startsWith('E1:') ? l : vault.encryptLine(this.key, l))).join('\n') + '\n');
    }
    await this.auditLog.reencrypt();
  }

  /** Forgotten passwords: the recovery code opens the archive and sets a new password for an administrator. */
  async recover(code, userId, newPassword) {
    if (!this.encrypted) throw new Error('Not encrypted');
    if (!validPassword(newPassword)) throw new Error('PASSWORD_SHORT');
    const dek = vault.unwrapKey(this.keyring.recovery && this.keyring.recovery.wrap, vault.normalizeRecoveryCode(code));
    if (!dek || (this.key && !dek.equals(this.key))) return null;
    if (!this.key) await this.unlock(dek);
    const u = this.data.users.find((x) => x.id === userId && x.role === 'admin');
    if (!u) throw new Error('NOT_ADMIN');
    u.disabled = false;
    this._setKeyEntry(u, newPassword);
    await this._saveKeyring();
    u.passwordChangedAt = new Date().toISOString();
    await this.save();
    this.audit('auth.recovered', { targetUser: u.name });
    return u;
  }

  /** A new recovery code (the old one stops working). Shown once. */
  async newRecoveryCode() {
    if (!this.key) throw new Error('LOCKED');
    const code = vault.newRecoveryCode();
    this.keyring.recovery = { wrap: vault.wrapKey(this.key, vault.normalizeRecoveryCode(code)), createdAt: new Date().toISOString() };
    await this._saveKeyring();
    this.audit('archive.recovery-code', {});
    return code;
  }

  /** The recovery code created when an existing archive was encrypted, until an administrator has kept it. */
  takePendingRecoveryCode() {
    return (this.data && this.data.pendingRecoveryCode) || null;
  }

  async confirmRecoveryCodeKept() {
    if (this.data.pendingRecoveryCode) {
      delete this.data.pendingRecoveryCode;
      await this.save();
    }
  }

  async recordLogin(userId) {
    const u = this._user(userId);
    u.lastLoginAt = new Date().toISOString();
    await this.save();
  }

  async setPrefs(userId, prefs) {
    const u = this._user(userId);
    u.prefs = { ...(u.prefs || {}), ...prefs };
    await this.save();
    return u.prefs;
  }

  // ---------------------------------------------------------------------------
  // Documents

  settings() {
    return this.data.settings;
  }

  typeInterval(type) {
    const t = (this.data.settings.docTypes || []).find((x) => x.id === type);
    return (t && t.interval) || 24;
  }

  decorate(doc) {
    const rs = reviewState(doc, this.data.settings.warnDays);
    const pendingChanges = this.data.changes.filter(
      (c) => c.status !== 'resolved' && (c.affected || []).some((a) => a.docId === doc.id && a.status === 'open' && a.severity !== 'info')
    ).length;
    const cur = doc.versions.find((v) => v.id === doc.currentVersionId) || null;
    return { ...doc, review: rs, pendingChanges, current: cur };
  }

  // ---------------------------------------------------------------------------
  // OCR of scanned documents (done by main.js with ocr.js; the archive keeps the result)

  /** Versions waiting for text recognition, current versions first. */
  pendingOcr() {
    const jobs = [];
    for (const d of this.data.docs) {
      for (const v of d.versions) {
        if (v.ocr && v.ocr.status === 'pending') jobs.push({ docId: d.id, versionId: v.id, pages: v.ocr.pages, title: d.code ? `${d.code} ${d.title}` : d.title, current: v.id === d.currentVersionId });
      }
    }
    return jobs.sort((a, b) => b.current - a.current);
  }

  versionFile(docId, versionId) {
    const v = this._doc(docId).versions.find((x) => x.id === versionId);
    if (!v) throw new Error('Version not found');
    return this.p(v.file);
  }

  /** Store recognised text of scanned pages; the document becomes searchable and is checked against the acts it cites. */
  async applyOcr(docId, versionId, ocrPages) {
    const doc = this._doc(docId);
    const v = doc.versions.find((x) => x.id === versionId);
    if (!v) throw new Error('Version not found');
    const byPage = new Map(ocrPages.map((p) => [p.page, p.text]));
    const pages = (await this.loadText(versionId)).map((p) => (byPage.has(p.page) && byPage.get(p.page).length > (p.text || '').length ? { ...p, text: byPage.get(p.page), ocr: true } : p));
    await this._write(this.p('text', `${versionId}.json`), JSON.stringify({ pages }));
    const text = pages.map((p) => p.text).join('\n');
    v.chars = text.length;
    v.textStatus = text.replace(/\s+/g, '').length >= 25 ? 'ok' : 'empty';
    v.ocr = { status: 'done', pages: ocrPages.map((p) => p.page), at: new Date().toISOString() };
    if (versionId === doc.currentVersionId) {
      // Fill in what the scan's text tells and nobody has entered yet.
      const found = detectMetadata(text, v.fileName);
      for (const k of ['effectiveDate', 'reviewDate', 'owner', 'approver']) if (!doc[k] && found[k]) doc[k] = found[k];
      if (!doc.reviewDate && doc.effectiveDate && doc.reviewIntervalMonths) doc.reviewDate = addMonths(doc.effectiveDate, doc.reviewIntervalMonths);
      this._refreshCitations(doc, text);
      if (this._watchCitedLaws()) await this._recomputeAllCitations();
      this.index.setDocument(doc, chunkPages(pages));
      this._attachToOpenChanges(doc);
    }
    await this.save();
    this.audit('doc.ocr', { docId, code: doc.code, title: doc.title, pages: ocrPages.length });
    return this.decorate(doc);
  }

  async ocrFailed(docId, versionId, error) {
    const v = this._doc(docId).versions.find((x) => x.id === versionId);
    if (!v) return;
    v.ocr = { ...(v.ocr || {}), status: 'error', error: String(error).slice(0, 300) };
    await this.save();
  }

  /** The main document an annex belongs to, and the annexes of a document (by code). */
  _related(doc) {
    const same = (a, b) => !!a && !!b && a.toUpperCase() === b.toUpperCase();
    const brief = (d) => ({ id: d.id, code: d.code, title: d.title, version: d.version, status: d.status });
    const parent = doc.annexOf ? this.data.docs.find((d) => same(d.code, doc.annexOf) && d.status !== 'obsolete') : null;
    const annexes = doc.code ? this.data.docs.filter((d) => same(d.annexOf, doc.code) && d.status !== 'obsolete') : [];
    return { parent: parent ? brief(parent) : null, annexes: annexes.map(brief).sort((a, b) => a.code.localeCompare(b.code, 'sk', { numeric: true })) };
  }

  /** Department for an area code in a document code ("SM_Q_01" -> quality, "SM_HR_003" -> HR). */
  _departmentFor(area) {
    const re = { Q: /kvalit|quality|\bQA\b/i, QA: /kvalit|quality|\bQA\b/i, HR: /personal|\bHR\b|human/i, IT: /^IT\b|\bIT\b/ }[area];
    return (re && (this.data.settings.departments || []).find((d) => re.test(d))) || '';
  }

  /** A document type found in a file name but missing from the archive's list is added from the defaults. */
  _ensureType(type) {
    const list = this.data.settings.docTypes || (this.data.settings.docTypes = []);
    if (!type || list.some((t) => t.id === type)) return;
    const def = DOC_TYPES.find((t) => t.id === type);
    if (def) list.push({ ...def });
  }

  listDocs() {
    return this.data.docs.map((d) => this.decorate(d));
  }

  getDoc(docId) {
    const d = this.data.docs.find((x) => x.id === docId);
    return d ? { ...this.decorate(d), ...this._related(d) } : null;
  }

  _doc(docId) {
    const d = this.data.docs.find((x) => x.id === docId);
    if (!d) throw new Error('Document not found');
    return d;
  }

  async loadText(versionId) {
    if (!versionId) return [];
    try {
      const j = await this._readJson(this.p('text', `${versionId}.json`));
      return j.pages || [];
    } catch (_) {
      return [];
    }
  }

  async docText(docId, versionId) {
    const d = this._doc(docId);
    return this.loadText(versionId || d.currentVersionId);
  }

  /** Inspect a file before import: extract text, guess metadata, find duplicates and citations. */
  async analyzeFile(filePath) {
    const a = await this._analysis(filePath);
    const { sha, meta } = a;
    // Compared with the archive as it is now (not cached: the archive changes between calls).
    const duplicateOf = this.data.docs.find((d) => d.versions.some((v) => v.sha256 === sha));
    const sameCode = meta.code ? this.data.docs.find((d) => d.code && d.code.toUpperCase() === meta.code.toUpperCase() && d.status !== 'obsolete') : null;
    return {
      ...a.public,
      duplicateOf: duplicateOf ? { id: duplicateOf.id, code: duplicateOf.code, title: duplicateOf.title } : null,
      sameCode: sameCode && (!duplicateOf || sameCode.id !== duplicateOf.id) ? { id: sameCode.id, code: sameCode.code, title: sameCode.title, version: sameCode.version } : null
    };
  }

  /** Text extraction + metadata guess for a file, cached by path, size and modification time. */
  async _analysis(filePath) {
    const st = await fs.promises.stat(filePath);
    const cacheKey = `${filePath}|${st.size}|${st.mtimeMs}`;
    if (this.analyzed.has(cacheKey)) return this.analyzed.get(cacheKey);
    const sha = await sha256File(filePath);
    const ex = await extractFile(filePath);
    const text = ex.pages.map((p) => p.text).join('\n');
    const meta = detectMetadata(text, path.basename(filePath), { folder: path.dirname(filePath) });
    if (meta.area) meta.department = this._departmentFor(meta.area) || undefined;
    delete meta.area;
    if (meta.lang === 'en') meta.tags = ['EN'];
    delete meta.lang;
    const pub = {
      filePath,
      fileName: path.basename(filePath),
      ext: path.extname(filePath).toLowerCase(),
      size: st.size,
      textStatus: ex.status,
      textError: ex.error || null,
      chars: text.length,
      pages: ex.pages.filter((p) => p.page).length || null,
      ocrPages: path.extname(filePath).toLowerCase() === '.pdf' ? pagesWithoutText(ex.pages).length : 0,
      meta,
      preview: text.slice(0, 600)
    };
    const entry = { public: pub, ex, sha, text, meta };
    if (this.analyzed.size > 200) this.analyzed.clear();
    this.analyzed.set(cacheKey, entry);
    return entry;
  }

  _cleanMeta(meta) {
    const out = {};
    for (const k of DOC_FIELDS) if (meta[k] !== undefined) out[k] = meta[k];
    if (out.tags && !Array.isArray(out.tags)) out.tags = String(out.tags).split(',').map((t) => t.trim()).filter(Boolean);
    if (out.trainingFor !== undefined) out.trainingFor = (Array.isArray(out.trainingFor) ? out.trainingFor : String(out.trainingFor || '').split(',')).map((x) => String(x).trim()).filter(Boolean);
    if (out.status && !STATUSES.includes(out.status)) delete out.status;
    if (out.reviewIntervalMonths !== undefined) out.reviewIntervalMonths = Math.max(0, parseInt(out.reviewIntervalMonths, 10) || 0);
    for (const k of ['code', 'title', 'department', 'owner', 'approver', 'notes', 'version', 'annexOf']) if (typeof out[k] === 'string') out[k] = out[k].trim();
    for (const k of ['effectiveDate', 'reviewDate']) if (out[k] === '') out[k] = null;
    return out;
  }

  async _storeVersion(doc, filePath, analysis, label) {
    const seq = doc.versions.length + 1;
    const vid = id();
    // Encrypted archives do not show document names in file names either.
    const rel = path.join('files', doc.id, this.key ? `v${seq}.bin` : `v${seq}-${safeName(path.basename(filePath))}`);
    await fs.promises.mkdir(this.p('files', doc.id), { recursive: true });
    if (this.key) await this._write(this.p(rel), await fs.promises.readFile(filePath));
    else await fs.promises.copyFile(filePath, this.p(rel));
    await this._write(this.p('text', `${vid}.json`), JSON.stringify({ pages: analysis.ex.pages }));
    const version = {
      id: vid,
      seq,
      label: label || String(seq),
      fileName: path.basename(filePath),
      file: rel.split(path.sep).join('/'),
      size: (await fs.promises.stat(filePath)).size,
      sha256: analysis.sha,
      importedAt: new Date().toISOString(),
      importedBy: this.user,
      textStatus: analysis.ex.status,
      chars: analysis.text.length,
      status: 'current'
    };
    // Scanned pages (no text layer) are read later by OCR, in the background.
    const scanned = path.extname(filePath).toLowerCase() === '.pdf' ? pagesWithoutText(analysis.ex.pages) : [];
    if (scanned.length) version.ocr = { status: 'pending', pages: scanned };
    for (const v of doc.versions) if (v.status === 'current') v.status = 'superseded';
    doc.versions.push(version);
    doc.currentVersionId = vid;
    return version;
  }

  _refreshCitations(doc, text) {
    doc.citations = detectCitations(text, this.data.laws);
    const known = new Set(this.data.laws.map((l) => l.key).filter(Boolean));
    // The title counts too: "Pokyn … podľa Vyhlášky 82-2012 MZSR".
    doc.lawRefs = detectAllLawRefs(`${doc.title || ''}\n${text}`).filter((r) => !known.has(r.key));
  }

  /**
   * Every act cited in a document is watched: acts found in documents but missing from the register
   * are added to it (unless someone removed them from the register before). Returns how many were added.
   */
  _watchCitedLaws() {
    const ignored = new Set(this.data.settings.ignoredLawKeys || []);
    const known = new Set(this.data.laws.map((l) => l.key).filter(Boolean));
    let added = 0;
    for (const doc of this.data.docs) {
      if (doc.status === 'obsolete') continue;
      for (const r of doc.lawRefs || []) {
        if (!r.key || !r.url || known.has(r.key) || ignored.has(r.key)) continue;
        const law = this._newLaw({ key: r.key, title: r.label, short: r.label, jurisdiction: r.jurisdiction, url: r.url, origin: 'documents', autoTitle: true });
        law.aliases = aliasesFromKey(law.key);
        this.data.laws.push(law);
        known.add(r.key);
        added++;
        this.audit('law.added', { lawId: law.id, title: law.title, origin: 'documents', docId: doc.id, code: doc.code });
      }
    }
    return added;
  }

  /** Watch the acts cited in documents; re-link citations when acts were added. */
  async watchCitedLaws() {
    if (!this._watchCitedLaws()) return 0;
    await this._recomputeAllCitations();
    await this.save();
    return 1;
  }

  async importFile(filePath, meta = {}) {
    const a = await this._analysis(filePath);
    const m = this._cleanMeta({ ...a.public.meta, ...meta });
    const now = new Date().toISOString();
    const doc = {
      id: id(),
      type: m.type || 'OTHER',
      code: m.code || '',
      title: m.title || path.basename(filePath),
      status: m.status || 'effective',
      department: m.department || '',
      owner: m.owner || '',
      approver: m.approver || '',
      tags: m.tags || [],
      notes: m.notes || '',
      version: m.version || '1',
      effectiveDate: m.effectiveDate || null,
      annexOf: m.annexOf || '',
      // An annex is reviewed together with its main document.
      reviewIntervalMonths: m.reviewIntervalMonths ?? (m.annexOf ? 0 : this.typeInterval(m.type)),
      reviewDate: m.reviewDate || null,
      versions: [],
      reviews: [],
      citations: [],
      lawRefs: [],
      proposals: [],
      approvals: [],
      copies: [],
      trainingFor: m.trainingFor || [],
      trainingSeq: 1,
      createdAt: now,
      updatedAt: now
    };
    if (!doc.reviewDate && doc.effectiveDate && doc.reviewIntervalMonths) doc.reviewDate = addMonths(doc.effectiveDate, doc.reviewIntervalMonths);
    this._ensureType(doc.type);
    await this._storeVersion(doc, filePath, a, doc.version);
    this._refreshCitations(doc, a.text);
    this.data.docs.push(doc);
    if (this._watchCitedLaws()) await this._recomputeAllCitations();
    this.index.setDocument(doc, chunkPages(a.ex.pages));
    this._attachToOpenChanges(doc);
    await this.save();
    this.audit('doc.imported', { docId: doc.id, code: doc.code, title: doc.title, file: path.basename(filePath) });
    return this.decorate(doc);
  }

  async addVersion(docId, filePath, meta = {}) {
    const doc = this._doc(docId);
    const a = await this._analysis(filePath);
    const m = this._cleanMeta(meta);
    const prevLabel = doc.version;
    Object.assign(doc, m);
    if (!m.version) doc.version = String(doc.versions.length + 1);
    const stored = await this._storeVersion(doc, filePath, a, doc.version);
    // A new version needs training again, unless it is only a correction that does not change what people do.
    if (meta.retrain !== false) doc.trainingSeq = stored.seq;
    // A new effective date moves the next review; otherwise the planned review date stays as it was.
    if (!m.reviewDate && m.effectiveDate && doc.reviewIntervalMonths) doc.reviewDate = addMonths(m.effectiveDate, doc.reviewIntervalMonths);
    if (!m.status && doc.status === 'review') doc.status = 'effective';
    doc.updatedAt = new Date().toISOString();
    doc.updatedBy = this.user;
    this._refreshCitations(doc, a.text);
    if (this._watchCitedLaws()) await this._recomputeAllCitations();
    this.index.setDocument(doc, chunkPages(a.ex.pages));
    await this.save();
    this.audit('doc.version-added', { docId, code: doc.code, from: prevLabel, to: doc.version, file: path.basename(filePath) });
    return this.decorate(doc);
  }

  /** expected: the time of the change the user saw – if someone changed the document since, nothing is overwritten. */
  async updateDoc(docId, patch, { expected } = {}) {
    const doc = this._doc(docId);
    if (expected && doc.updatedAt && expected !== doc.updatedAt) throw new Error(`CONFLICT:${doc.updatedBy || '?'}`);
    const m = this._cleanMeta(patch);
    const changes = {};
    for (const [k, v] of Object.entries(m)) {
      if (JSON.stringify(doc[k]) !== JSON.stringify(v)) changes[k] = { from: doc[k] ?? null, to: v };
    }
    Object.assign(doc, m);
    doc.updatedAt = new Date().toISOString();
    doc.updatedBy = this.user;
    const pages = await this.loadText(doc.currentVersionId);
    this.index.setDocument(doc, chunkPages(pages));
    await this.save();
    if (Object.keys(changes).length) this.audit('doc.updated', { docId, code: doc.code, changes });
    return this.decorate(doc);
  }

  /**
   * Why a document may not be deleted: it has been used as a controlled record (signed, issued as a
   * controlled copy, trained on, reviewed, assessed against legislation, named in a decision). Such a
   * document is withdrawn (status "obsolete") instead and kept. [] = it may be deleted (e.g. a mistaken import).
   */
  deletionBlockers(docId) {
    const doc = this._doc(docId);
    const out = [];
    if ((doc.approvals || []).some((a) => (a.steps || []).some((s) => s.decision))) out.push('approvals');
    if ((doc.copies || []).length) out.push('copies');
    if (this.data.trainings.some((t) => t.docId === docId)) out.push('training');
    if ((doc.reviews || []).length) out.push('reviews');
    if (this.data.changes.some((c) => (c.affected || []).some((a) => a.docId === docId && (a.status === 'done' || a.status === 'na' || a.note)))) out.push('assessed');
    if (this.data.decisions.some((d) => d.docId === docId)) out.push('decisions');
    return out;
  }

  async deleteDoc(docId, reason) {
    const doc = this._doc(docId);
    if (this.deletionBlockers(docId).length) throw new Error('DOC_HAS_RECORDS');
    const why = String(reason || '').trim();
    if (why.length < 5) throw new Error('REASON_REQUIRED');
    const src = this.p('files', docId);
    if (fs.existsSync(src)) {
      const dest = this.p('trash', `${docId}-${Date.now()}`);
      await fs.promises.rename(src, dest).catch(async () => {
        await fs.promises.cp(src, dest, { recursive: true });
        await fs.promises.rm(src, { recursive: true, force: true });
      });
    }
    this.data.docs = this.data.docs.filter((d) => d.id !== docId);
    for (const c of this.data.changes) c.affected = (c.affected || []).filter((a) => a.docId !== docId);
    this.index.removeDocument(docId);
    await this.save();
    this.audit('doc.deleted', { docId, code: doc.code, title: doc.title, version: doc.version, status: doc.status, reason: why });
    return true;
  }

  /** Deleted documents are kept (still encrypted) in the trash folder until it is emptied. */
  async trashInfo() {
    const size = async (p) => {
      const st = await fs.promises.stat(p);
      if (!st.isDirectory()) return st.size;
      let n = 0;
      for (const e of await fs.promises.readdir(p)) n += await size(path.join(p, e));
      return n;
    };
    let entries = [];
    try {
      entries = await fs.promises.readdir(this.p('trash'));
    } catch (_) {
      /* no trash yet */
    }
    let bytes = 0;
    for (const e of entries) bytes += await size(this.p('trash', e)).catch(() => 0);
    return { count: entries.length, bytes };
  }

  /** Removes the deleted documents' files for good. */
  async emptyTrash() {
    const info = await this.trashInfo();
    for (const e of await fs.promises.readdir(this.p('trash')).catch(() => [])) await fs.promises.rm(this.p('trash', e), { recursive: true, force: true });
    this.audit('archive.trash-emptied', { n: info.count });
    return info;
  }

  async markReviewed(docId, r) {
    const doc = this._doc(docId);
    const review = {
      id: id(),
      date: r.date || today(),
      by: (r.by || this.user).trim(),
      outcome: ['no-change', 'update-needed', 'updated'].includes(r.outcome) ? r.outcome : 'no-change',
      notes: (r.notes || '').trim(),
      previousReviewDate: doc.reviewDate || null,
      nextReviewDate: r.nextReviewDate || (doc.reviewIntervalMonths ? addMonths(r.date || today(), doc.reviewIntervalMonths) : null)
    };
    doc.reviews.push(review);
    doc.lastReviewDate = review.date;
    doc.reviewDate = review.nextReviewDate;
    if (review.outcome === 'update-needed') doc.status = 'review';
    else if (doc.status === 'review') doc.status = 'effective';
    doc.updatedAt = new Date().toISOString();
    doc.updatedBy = this.user;
    await this.save();
    this.audit('doc.reviewed', { docId, code: doc.code, outcome: review.outcome, next: review.nextReviewDate, notes: review.notes });
    return this.decorate(doc);
  }

  filePath(docId, versionId) {
    const doc = this._doc(docId);
    const v = doc.versions.find((x) => x.id === (versionId || doc.currentVersionId));
    if (!v) throw new Error('Version not found');
    return this.p(v.file);
  }

  /** The original file of a version, decrypted: { name, data }. */
  async versionContent(docId, versionId) {
    const doc = this._doc(docId);
    const v = doc.versions.find((x) => x.id === (versionId || doc.currentVersionId));
    if (!v) throw new Error('Version not found');
    return { name: v.fileName, data: await this._readFile(this.p(v.file)) };
  }

  // ---------------------------------------------------------------------------
  // Search

  search(q, filters = {}) {
    const docsById = new Map(this.data.docs.map((d) => [d.id, d]));
    const allowDoc = (docId) => {
      const d = docsById.get(docId);
      if (!d) return false;
      if (!filters.includeObsolete && d.status === 'obsolete') return false;
      if (filters.type && d.type !== filters.type) return false;
      if (filters.department && d.department !== filters.department) return false;
      if (filters.status && d.status !== filters.status) return false;
      return true;
    };
    const res = this.index.search(q, { allowDoc, limit: filters.limit || 60 });
    return {
      ...res,
      results: res.results.map((r) => {
        const d = docsById.get(r.docId);
        return { ...r, hits: r.hits.map(({ text, ...h }) => h), doc: { id: d.id, code: d.code, title: d.title, type: d.type, status: d.status, version: d.version, department: d.department } };
      })
    };
  }

  passages(q, limit = 8) {
    const docsById = new Map(this.data.docs.map((d) => [d.id, d]));
    return this.index
      .passages(q, { limit, allowDoc: (id2) => docsById.has(id2) && docsById.get(id2).status !== 'obsolete' })
      .map((p) => ({ ...p, doc: { id: p.docId, code: docsById.get(p.docId).code, title: docsById.get(p.docId).title, version: docsById.get(p.docId).version } }));
  }

  // ---------------------------------------------------------------------------
  // Settings stored in the archive

  async updateSettings(patch) {
    const allowed = ['warnDays', 'reminderDaysIcs', 'docTypes', 'departments', 'legisAutoCheck', 'legisLastAutoCheck', 'autoLockMinutes', 'noticesAuto'];
    for (const k of allowed) if (patch[k] !== undefined) this.data.settings[k] = patch[k];
    if (patch.org !== undefined) this.data.org = String(patch.org).trim();
    await this.save();
    return { ...this.data.settings, org: this.data.org };
  }

  // ---------------------------------------------------------------------------
  // Company logo: one image in <dataDir>/branding, so every computer sharing the archive shows it

  _logoFile() {
    try {
      const f = fs.readdirSync(this.p('branding')).find((n) => /^logo\.[a-z]+$/.test(n) && LOGO_TYPES[path.extname(n)]);
      return f ? this.p('branding', f) : null;
    } catch (_) {
      return null;
    }
  }

  /** { v, type } (v changes whenever the logo changes) or null */
  logoInfo() {
    const f = this._logoFile();
    if (!f) return null;
    return { v: Math.round(fs.statSync(f).mtimeMs), type: LOGO_TYPES[path.extname(f)] };
  }

  logoDataUrl() {
    const f = this._logoFile();
    if (!f) return null;
    return `data:${LOGO_TYPES[path.extname(f)]};base64,${fs.readFileSync(f).toString('base64')}`;
  }

  async setLogo(src) {
    const ext = path.extname(src).toLowerCase();
    if (!LOGO_TYPES[ext]) throw new Error('LOGO_TYPE');
    if (fs.statSync(src).size > LOGO_MAX_BYTES) throw new Error('LOGO_SIZE');
    const dir = this.p('branding');
    await fs.promises.mkdir(dir, { recursive: true });
    const old = this._logoFile();
    const tmp = path.join(dir, `.logo-${id()}${ext}`);
    await fs.promises.copyFile(src, tmp);
    if (old) await fs.promises.rm(old, { force: true });
    await fs.promises.rename(tmp, path.join(dir, `logo${ext}`));
    this.audit('archive.logo', { file: path.basename(src) });
    return this.logoInfo();
  }

  async clearLogo() {
    const f = this._logoFile();
    if (f) await fs.promises.rm(f, { force: true });
    this.audit('archive.logo', { removed: true });
    return null;
  }

  // ---------------------------------------------------------------------------
  // Approval of a version (see lib/approval.js) and controlled copies

  _pendingApproval(doc) {
    return (doc.approvals || []).find((a) => a.status === 'pending') || null;
  }

  async requestApproval(docId, { reviewers = [], approvers = [], note = '' }) {
    const doc = this._doc(docId);
    if (this._pendingApproval(doc)) throw new Error('APPROVAL_PENDING');
    const req = approval.createRequest({ doc, reviewers, approvers, note, by: this.user, users: this.data.users });
    (doc.approvals = doc.approvals || []).push(req);
    await this.save();
    this.audit('approval.requested', { docId, code: doc.code, version: doc.version, reviewers: req.steps.filter((x) => x.role === 'review').map((x) => x.name), approvers: req.steps.filter((x) => x.role === 'approve').map((x) => x.name) });
    return req;
  }

  /** Sign the next step (the password was checked by the caller). The last approval makes the version effective. */
  async signApproval(docId, userId, { decision, comment = '' }) {
    const doc = this._doc(docId);
    const req = this._pendingApproval(doc);
    if (!req) throw new Error('NOTHING_TO_SIGN');
    if (req.versionId !== doc.currentVersionId) throw new Error('VERSION_CHANGED');
    const step = approval.nextStep(req);
    approval.sign(req, { userId, decision, comment });
    this.audit(decision === 'approved' ? 'approval.signed' : 'approval.rejected', { docId, code: doc.code, version: doc.version, role: step.role, signer: step.name, comment: comment || undefined });
    if (req.status === 'approved') {
      const approvers = req.steps.filter((x) => x.role === 'approve').map((x) => x.name);
      doc.approver = approvers.join(', ');
      doc.approvedAt = req.closedAt;
      doc.status = 'effective';
      if (!doc.effectiveDate) doc.effectiveDate = today();
      if (!doc.reviewDate && doc.reviewIntervalMonths) doc.reviewDate = addMonths(doc.effectiveDate, doc.reviewIntervalMonths);
      doc.updatedAt = new Date().toISOString();
      doc.updatedBy = this.user;
    doc.updatedBy = this.user;
      this.audit('approval.approved', { docId, code: doc.code, version: doc.version, approvers });
    }
    await this.save();
    return req;
  }

  async cancelApproval(docId) {
    const doc = this._doc(docId);
    const req = this._pendingApproval(doc);
    if (!req) return null;
    req.status = 'cancelled';
    req.closedAt = new Date().toISOString();
    await this.save();
    this.audit('approval.cancelled', { docId, code: doc.code, version: doc.version });
    return req;
  }

  /** Documents waiting for this user's signature. */
  approvalsFor(userId) {
    const out = [];
    for (const d of this.data.docs) {
      const req = this._pendingApproval(d);
      const step = approval.nextStep(req);
      if (step && step.userId === userId) out.push({ id: d.id, code: d.code, title: d.title, version: d.version, role: step.role, requestedBy: req.requestedBy, requestedAt: req.requestedAt, note: req.note });
    }
    return out;
  }

  /** Register a controlled copy of the current version: { copy, name, data, stamped }. PDFs get the stamp on every page. */
  async issueCopy(docId, { issuedTo, location = '', format = 'print', note = '', labels = {} }) {
    const doc = this._doc(docId);
    const to = String(issuedTo || '').trim();
    if (!to) throw new Error('RECIPIENT_REQUIRED');
    const cur = doc.versions.find((v) => v.id === doc.currentVersionId);
    const no = (doc.copies || []).reduce((n, c) => Math.max(n, c.no), 0) + 1;
    const copy = { id: id(), no, versionId: cur.id, versionSeq: cur.seq, version: doc.version, issuedTo: to.slice(0, 200), location: String(location || '').trim().slice(0, 200), format: format === 'pdf' ? 'pdf' : 'print', note: String(note || '').slice(0, 1000), issuedBy: this.user, issuedAt: new Date().toISOString(), status: 'issued' };
    const content = await this.versionContent(docId);
    let data = content.data;
    let stamped = false;
    if (/\.pdf$/i.test(content.name)) {
      const { stampPdf } = require('./lib/stamp');
      const L = { title: 'RIADENÁ KÓPIA č. {no}', to: 'Vydané pre: {to}', version: 'Verzia {v} · vydané {date}', back: 'Pri novej verzii kópiu vráťte.', ...labels };
      const fill = (s) => s.replace('{no}', no).replace('{to}', [copy.issuedTo, copy.location].filter(Boolean).join(' – ')).replace('{v}', doc.version).replace('{date}', new Date().toLocaleDateString('sk-SK'));
      data = await stampPdf(data, { title: fill(L.title), lines: [`${doc.code || ''} ${doc.title}`.trim().slice(0, 70), fill(L.to), fill(L.version), L.back] });
      stamped = true;
    }
    copy.stamped = stamped;
    (doc.copies = doc.copies || []).push(copy);
    await this.save();
    this.audit('copy.issued', { docId, code: doc.code, version: doc.version, no, to: copy.issuedTo, location: copy.location || undefined, format: copy.format });
    const base = content.name.replace(/(\.[^.]+)$/, '');
    const ext = (content.name.match(/\.[^.]+$/) || [''])[0];
    return { copy, name: `${base}_RK${no}${ext}`, data, stamped };
  }

  async withdrawCopy(docId, copyId) {
    const doc = this._doc(docId);
    const c = (doc.copies || []).find((x) => x.id === copyId);
    if (!c) throw new Error('Copy not found');
    c.status = 'withdrawn';
    c.withdrawnAt = new Date().toISOString();
    c.withdrawnBy = this.user;
    await this.save();
    this.audit('copy.withdrawn', { docId, code: doc.code, version: c.version, no: c.no, to: c.issuedTo });
    return c;
  }

  /** Issued copies of versions that are no longer current (or of documents no longer valid): to be withdrawn. */
  copiesToWithdraw() {
    const out = [];
    for (const d of this.data.docs) {
      for (const c of d.copies || []) {
        if (c.status !== 'issued') continue;
        if (c.versionId !== d.currentVersionId || d.status === 'obsolete') out.push({ docId: d.id, code: d.code, title: d.title, currentVersion: d.version, ...c });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Employees and training records (see lib/training.js)

  listPeople() {
    const users = new Map(this.data.users.map((u) => [u.id, u.name]));
    return this.data.people.map((p) => ({ ...p, userName: p.userId ? users.get(p.userId) || '' : '' })).sort((a, b) => a.name.localeCompare(b.name, 'sk'));
  }

  async savePerson(p) {
    const name = String(p.name || '').trim();
    if (!name) throw new Error('NAME_REQUIRED');
    const userId = p.userId && this.data.users.some((u) => u.id === p.userId) ? p.userId : null;
    if (userId && this.data.people.some((x) => x.userId === userId && x.id !== p.id)) throw new Error('USER_LINKED');
    let person = p.id ? this.data.people.find((x) => x.id === p.id) : null;
    const fields = { name, department: String(p.department || '').trim(), position: String(p.position || '').trim(), userId, active: p.active !== false };
    if (person) Object.assign(person, fields, { updatedAt: new Date().toISOString() });
    else {
      person = { id: id(), ...fields, createdAt: new Date().toISOString() };
      this.data.people.push(person);
    }
    await this.save();
    this.audit(p.id ? 'person.updated' : 'person.added', { personId: person.id, person: person.name, department: person.department, active: person.active });
    return person;
  }

  /** The employee record of an app profile (for "read and understood"). */
  personOfUser(userId) {
    return this.data.people.find((p) => p.userId === userId && p.active !== false) || null;
  }

  _activeDocs() {
    return this.data.docs.filter((d) => d.status !== 'obsolete' && d.status !== 'draft');
  }

  /** Record training of people on the current version of a document. */
  async recordTraining({ docId, personIds, date, method, trainer, notes }, { confirmedByUser = null } = {}) {
    const doc = this._doc(docId);
    const cur = doc.versions.find((v) => v.id === doc.currentVersionId);
    if (!cur) throw new Error('Version not found');
    const people = (personIds || []).map((pid) => this.data.people.find((p) => p.id === pid)).filter(Boolean);
    if (!people.length) throw new Error('PEOPLE_REQUIRED');
    const day = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : today();
    const m = training.METHODS.includes(method) ? method : 'session';
    const at = new Date().toISOString();
    const recs = people.map((p) => ({
      id: id(),
      docId: doc.id,
      code: doc.code,
      title: doc.title,
      versionId: cur.id,
      versionSeq: cur.seq,
      version: doc.version,
      personId: p.id,
      personName: p.name,
      date: day,
      method: m,
      trainer: String(trainer || '').trim().slice(0, 200),
      notes: String(notes || '').trim().slice(0, 2000),
      by: this.user,
      at,
      confirmedByUser: confirmedByUser || undefined
    }));
    this.data.trainings.push(...recs);
    await this.save();
    this.audit(confirmedByUser ? 'training.confirmed' : 'training.recorded', { docId: doc.id, code: doc.code, version: doc.version, people: recs.map((r) => r.personName), date: day, method: m, trainer: recs[0].trainer || undefined });
    return recs;
  }

  async removeTraining(trainingId) {
    const r = this.data.trainings.find((x) => x.id === trainingId);
    if (!r) throw new Error('Record not found');
    this.data.trainings = this.data.trainings.filter((x) => x.id !== trainingId);
    await this.save();
    this.audit('training.removed', { docId: r.docId, code: r.code, person: r.personName, date: r.date, version: r.version });
    return true;
  }

  trainingOverview() {
    const docs = this._activeDocs();
    const ov = training.overview(docs, this.data.people, this.data.trainings);
    const byId = new Map(this.data.docs.map((d) => [d.id, d]));
    return {
      missing: ov.missing,
      people: ov.people.map((x) => ({ ...x.person, required: x.required, trained: x.trained, missing: x.missing.map((d) => ({ id: d, code: byId.get(d).code, title: byId.get(d).title, version: byId.get(d).version })) })),
      docs: ov.docs.map((x) => {
        const d = byId.get(x.docId);
        return { id: d.id, code: d.code, title: d.title, version: d.version, trainingFor: d.trainingFor || [], required: x.required, trained: x.trained, missing: x.missing };
      })
    };
  }

  /** Everything about one employee: records (newest first) and what is missing. */
  personCard(personId) {
    const p = this.data.people.find((x) => x.id === personId);
    if (!p) throw new Error('Person not found');
    const records = this.data.trainings.filter((t) => t.personId === personId).sort((a, b) => `${b.date}${b.at}`.localeCompare(`${a.date}${a.at}`));
    const missing = this._activeDocs().filter((d) => training.isRequired(d, p) && !training.validRecord(d, p, this.data.trainings)).map((d) => ({ id: d.id, code: d.code, title: d.title, version: d.version }));
    return { person: p, records, missing };
  }

  /** Training of one document: who must know it, who is trained on its current version. */
  docTraining(docId) {
    const d = this._doc(docId);
    const people = this.data.people.filter((p) => training.isRequired(d, p));
    const rows = people.map((p) => ({ person: { id: p.id, name: p.name, department: p.department }, record: training.validRecord(d, p, this.data.trainings) }));
    const history = this.data.trainings.filter((t) => t.docId === docId).sort((a, b) => `${b.date}${b.at}`.localeCompare(`${a.date}${a.at}`));
    return { trainingFor: d.trainingFor || [], requiredSeq: training.requiredSeq(d), rows, history };
  }

  /** Documents the signed-in user (through their employee record) still has to read. */
  readingList(userId) {
    const p = this.personOfUser(userId);
    if (!p) return { person: null, docs: [] };
    return { person: { id: p.id, name: p.name }, docs: this.personCard(p.id).missing };
  }

  // ---------------------------------------------------------------------------
  // The company's own rules (see lib/company.js): what the company does, and decisions that a
  // provision does not apply to it or that its document deliberately differs.

  companyProfile() {
    return this.data.company;
  }

  async updateCompany(patch) {
    const next = company.cleanCompany({ ...this.data.company, ...patch, activities: { ...this.data.company.activities, ...((patch && patch.activities) || {}) } });
    for (const k of Object.keys((patch && patch.activities) || {})) if (!patch.activities[k]) delete next.activities[k];
    next.updatedAt = new Date().toISOString();
    next.updatedBy = this.user;
    this.data.company = next;
    await this.save();
    this.audit('company.updated', { activities: next.activities });
    return next;
  }

  listDecisions() {
    const laws = new Map(this.data.laws.map((l) => [l.id, l]));
    const docs = new Map(this.data.docs.map((d) => [d.id, d]));
    return this.data.decisions.map((d) => {
      const law = laws.get(d.lawId);
      const doc = d.docId ? docs.get(d.docId) : null;
      return { ...d, law: law ? { id: law.id, title: law.title, short: law.short } : null, doc: doc ? { id: doc.id, code: doc.code, title: doc.title } : null };
    });
  }

  /** { lawId, section ('§18', 'art5' or '*'), docId (optional), kind ('na' | 'ours'), reason, changeId (optional) } */
  async addDecision({ lawId, section, docId, kind, reason, changeId }) {
    const law = this.data.laws.find((l) => l.id === lawId);
    if (!law) throw new Error('Law not found');
    if (docId) this._doc(docId);
    if (!company.KINDS.includes(kind)) throw new Error('Unknown decision');
    const why = String(reason || '').trim();
    if (why.length < 3) throw new Error('REASON_REQUIRED');
    const sec = section === '*' ? '*' : String(section || '').trim();
    if (!sec) throw new Error('Section missing');
    const ch = changeId ? this.data.changes.find((c) => c.id === changeId) : null;
    const st = law.state || {};
    const d = {
      id: id(),
      lawId,
      lawKey: law.key || '',
      section: sec,
      docId: docId || null,
      kind,
      reason: why.slice(0, 2000),
      // the version of the act the decision was made for: a later change of the provision asks again
      atKey: (ch && (ch.toKey || ch.snapshotKey)) || st.newestKey || st.snapshotKey || null,
      by: this.user,
      at: new Date().toISOString()
    };
    // one decision per provision and scope: a new one replaces the previous
    this.data.decisions = this.data.decisions.filter((x) => !(x.lawId === d.lawId && x.section === d.section && (x.docId || null) === d.docId));
    this.data.decisions.push(d);
    await this._refreshAffected(lawId);
    await this.save();
    this.audit('decision.added', { lawId, title: law.title, section: sec, docId: d.docId || undefined, code: d.docId ? this._doc(d.docId).code : undefined, kind, reason: d.reason });
    return d;
  }

  async removeDecision(decisionId) {
    const d = this.data.decisions.find((x) => x.id === decisionId);
    if (!d) throw new Error('Decision not found');
    this.data.decisions = this.data.decisions.filter((x) => x.id !== decisionId);
    await this._refreshAffected(d.lawId);
    await this.save();
    const law = this.data.laws.find((l) => l.id === d.lawId);
    this.audit('decision.removed', { lawId: d.lawId, title: law ? law.title : '', section: d.section, docId: d.docId || undefined, kind: d.kind, reason: d.reason });
    return true;
  }

  /** Recompute the affected documents of the open changes of an act (after a decision). */
  async _refreshAffected(lawId) {
    for (const c of this.data.changes) if (c.lawId === lawId) c.affected = this._affectedFrom(c, await this.loadAnalysis(c), c.affected || []);
  }

  _decisionCtx(change, docId) {
    return { lawId: change.lawId, docId, changeKey: change.toKey || change.snapshotKey || null };
  }

  // ---------------------------------------------------------------------------
  // Legislation register

  _newLaw(l) {
    return {
      id: id(),
      key: l.key || '',
      title: l.title || '',
      short: l.short || '',
      jurisdiction: l.jurisdiction || 'SK',
      url: l.url || '',
      aliases: Array.isArray(l.aliases) ? l.aliases : String(l.aliases || '').split(',').map((a) => a.trim()).filter(Boolean),
      enabled: l.enabled !== false,
      notes: l.notes || '',
      origin: l.origin || 'user', // 'documents' = added because a document cites it
      autoTitle: !!l.autoTitle, // the name is replaced by the official title on the first check
      state: null,
      snapshots: []
    };
  }

  listLaws() {
    return this.data.laws.map((l) => ({
      ...l,
      docCount: this.data.docs.filter((d) => d.status !== 'obsolete' && d.citations.some((c) => c.lawId === l.id)).length,
      openChanges: this.data.changes.filter((c) => c.lawId === l.id && c.status !== 'resolved').length
    }));
  }

  async _recomputeAllCitations() {
    for (const doc of this.data.docs) {
      const pages = await this.loadText(doc.currentVersionId);
      this._refreshCitations(doc, pages.map((p) => p.text).join('\n'));
    }
  }

  async addLaw(l) {
    const law = this._newLaw(l);
    if (law.key && this.data.settings.ignoredLawKeys) this.data.settings.ignoredLawKeys = this.data.settings.ignoredLawKeys.filter((k) => k !== law.key);
    if (!law.aliases.length) law.aliases = aliasesFromKey(law.key);
    this.data.laws.push(law);
    await this._recomputeAllCitations();
    await this.save();
    this.audit('law.added', { lawId: law.id, title: law.title });
    return law;
  }

  async updateLaw(lawId, patch) {
    const law = this.data.laws.find((l) => l.id === lawId);
    if (!law) throw new Error('Law not found');
    for (const k of ['key', 'title', 'short', 'jurisdiction', 'url', 'enabled', 'notes']) if (patch[k] !== undefined) law[k] = patch[k];
    if (patch.aliases !== undefined) law.aliases = Array.isArray(patch.aliases) ? patch.aliases : String(patch.aliases).split(',').map((a) => a.trim()).filter(Boolean);
    if (patch.url !== undefined || patch.key !== undefined) law.state = null; // new source -> new baseline
    await this._recomputeAllCitations();
    await this.save();
    this.audit('law.updated', { lawId, title: law.title });
    return law;
  }

  async removeLaw(lawId) {
    const law = this.data.laws.find((l) => l.id === lawId);
    if (law && law.key) this.data.settings.ignoredLawKeys = [...new Set([...(this.data.settings.ignoredLawKeys || []), law.key])];
    this.data.laws = this.data.laws.filter((l) => l.id !== lawId);
    this.data.changes = this.data.changes.filter((c) => c.lawId !== lawId);
    for (const d of this.data.docs) d.citations = d.citations.filter((c) => c.lawId !== lawId);
    await fs.promises.rm(this.p('legislation', lawId), { recursive: true, force: true });
    await this._recomputeAllCitations();
    await this.save();
    this.audit('law.removed', { lawId, title: law && law.title });
  }

  // Snapshots of law texts -------------------------------------------------------

  snapshotPath(lawId, key) {
    return this.p('legislation', lawId, `${String(key).replace(/[^\w.-]/g, '_')}.txt`);
  }

  hasSnapshot(lawId, key) {
    return fs.existsSync(this.snapshotPath(lawId, key));
  }

  async saveSnapshot(lawId, key, text) {
    await fs.promises.mkdir(this.p('legislation', lawId), { recursive: true });
    await this._write(this.snapshotPath(lawId, key), text);
  }

  async loadSnapshot(lawId, key) {
    return this._readText(this.snapshotPath(lawId, key));
  }

  async listSnapshotKeys(lawId) {
    try {
      const files = await fs.promises.readdir(this.p('legislation', lawId));
      const out = [];
      for (const f of files) {
        if (!f.endsWith('.txt')) continue;
        const st = await fs.promises.stat(this.p('legislation', lawId, f));
        out.push({ key: f.slice(0, -4), mtime: st.mtimeMs });
      }
      return out;
    } catch (_) {
      return [];
    }
  }

  /** The stored version a new text of the act should be compared with. */
  async previousSnapshotKey(law, key) {
    const keys = (await this.listSnapshotKeys(law.id)).filter((k) => k.key !== key);
    if (!keys.length) return null;
    const dated = keys.filter((k) => /^\d{8}$/.test(k.key)).map((k) => k.key).sort();
    if (/^\d{8}$/.test(key)) {
      const older = dated.filter((k) => k < key);
      if (older.length) return older[older.length - 1];
    }
    const st = law.state || {};
    for (const k of [st.newestKey, st.lastImport && st.lastImport.key, st.snapshotKey]) if (k && k !== key && keys.some((x) => x.key === k)) return k;
    return keys.sort((a, b) => b.mtime - a.mtime)[0].key;
  }

  // Changes and checks -------------------------------------------------------------

  /** Check every document against the text of an act (see lib/compliance.js). */
  async _analysisFor(law, lawText, touched) {
    const active = this.data.docs.filter((d) => d.status !== 'obsolete');
    const docs = [];
    for (const d of active) if (d.citations.some((c) => c.lawId === law.id)) docs.push({ doc: d, pages: await this.loadText(d.currentVersionId) });
    const allow = new Set(active.map((d) => d.id));
    return analyzeLawAgainstDocs({
      law,
      lawText,
      touched,
      docs,
      searchFn: this.indexReady || this.index.size ? (w, m) => this.index.relatedChunks(w, { minTerms: m, allowDoc: (docId) => allow.has(docId) }) : null
    });
  }

  /**
   * Affected documents of a change: those citing the act (from current citations) plus those the
   * analysis found related. Keeps earlier decisions (status, note).
   */
  _affectedFrom(change, analysis, previous = []) {
    const touched = new Set(change.touched || []);
    const prev = new Map(previous.map((a) => [a.docId, a]));
    const byDoc = new Map(((analysis && analysis.docs) || []).map((d) => [d.docId, d]));
    const out = [];
    for (const doc of this.data.docs) {
      if (doc.status === 'obsolete') continue;
      const c = doc.citations.find((x) => x.lawId === change.lawId);
      const an = byDoc.get(doc.id);
      if (!c && !an) continue;
      // Provisions that do not apply to the company, or where its document deliberately differs, are not findings.
      const ap = company.applyDecisions({ findings: (an && an.findings) || [], direct: c ? c.sections.filter((s) => touched.has(s)) : [], cites: !!c }, this.data.decisions, this._decisionCtx(change, doc.id));
      if (!c && an && !ap.active.length) continue; // only related by content, and all of it decided
      const counts = {};
      for (const f of ap.active) counts[f.type] = (counts[f.type] || 0) + 1;
      const decided = ap.findings.length - ap.active.length;
      const p = prev.get(doc.id);
      out.push({ docId: doc.id, direct: ap.direct, cites: c ? c.count : 0, severity: ap.severity, counts, decided, status: p ? p.status : 'open', note: p ? p.note : '' });
    }
    out.sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity] || b.direct.length - a.direct.length || b.cites - a.cites);
    return out;
  }

  _attachToOpenChanges(doc) {
    for (const ch of this.data.changes) {
      if (ch.status === 'resolved') continue;
      const cit = doc.citations.find((c) => c.lawId === ch.lawId);
      if (!cit || (ch.affected || []).some((a) => a.docId === doc.id)) continue;
      const direct = cit.sections.filter((s) => (ch.touched || []).includes(s));
      ch.affected.push({ docId: doc.id, direct, cites: cit.count, severity: direct.length ? 'high' : 'low', counts: {}, status: 'open', note: '' });
    }
  }

  _changeFile(change, suffix) {
    return this.p('legislation', change.lawId, 'changes', `${change.id}${suffix}`);
  }

  /** Record a change (or a check report). lawText = the text of the act to check documents against. */
  async addChange(change, diff, lawText = null) {
    const ch = { id: id(), detectedAt: new Date().toISOString(), status: 'new', ai: {}, ...change };
    ch.touched = touchedKeys(diff);
    const law = this.data.laws.find((l) => l.id === ch.lawId);
    const analysis = lawText && law ? await this._analysisFor(law, lawText, ch.touched) : null;
    ch.affected = this._affectedFrom(ch, analysis, []);
    if (analysis) {
      ch.analyzedAt = new Date().toISOString();
      ch.sectionsInText = analysis.sections;
    }
    await fs.promises.mkdir(this.p('legislation', ch.lawId, 'changes'), { recursive: true });
    await this._write(this._changeFile(ch, '.json'), JSON.stringify(diff || { mode: 'none', changed: [], added: [], removed: [], stats: {} }));
    if (analysis) await this._write(this._changeFile(ch, '.analysis.json'), JSON.stringify(analysis));
    this.data.changes.unshift(ch);
    this.audit(ch.kind === 'check' ? 'legislation.checked-docs' : 'legislation.change-detected', {
      lawId: ch.lawId,
      changeId: ch.id,
      kind: ch.kind,
      from: ch.fromDate,
      to: ch.toDate,
      affected: ch.affected.length,
      source: ch.source ? ch.source.name : undefined
    });
    return ch;
  }

  async loadDiff(change) {
    try {
      return await this._readJson(this._changeFile(change, '.json'));
    } catch (_) {
      return null;
    }
  }

  async loadAnalysis(change) {
    try {
      return await this._readJson(this._changeFile(change, '.analysis.json'));
    } catch (_) {
      return null;
    }
  }

  listChanges() {
    return this.data.changes.map((c) => {
      const law = this.data.laws.find((l) => l.id === c.lawId);
      return { ...c, law: law ? { id: law.id, title: law.title, short: law.short, url: law.url } : null };
    });
  }

  async getChange(changeId) {
    const c = this.data.changes.find((x) => x.id === changeId);
    if (!c) throw new Error('Change not found');
    const [diff, analysis] = await Promise.all([this.loadDiff(c), this.loadAnalysis(c)]);
    c.affected = this._affectedFrom(c, analysis, c.affected || []);
    const law = this.data.laws.find((l) => l.id === c.lawId);
    const docs = new Map(this.data.docs.map((d) => [d.id, d]));
    const an = new Map(((analysis && analysis.docs) || []).map((d) => [d.docId, d]));
    // Text of each provision (from the comparison and the diff), to recognise activities the company does not perform.
    const provision = new Map();
    for (const x of an.values()) for (const r of [...(x.refs || []), ...(x.related || [])]) if (r.lawExcerpt && !provision.has(r.key)) provision.set(r.key, { text: r.lawExcerpt, heading: '' });
    if (diff && diff.mode === 'sections') for (const s of [...diff.changed, ...diff.added, ...diff.removed]) provision.set(String(s.key).replace(/#\d+$/, ''), { text: s.newText || s.oldText || '', heading: s.label || '' });
    const hints = (section) => {
      const p = provision.get(section);
      return p ? company.activityHints(p.text, this.data.company, p.heading) : [];
    };
    return {
      ...c,
      law,
      diff,
      hasText: !!((c.toKey || c.snapshotKey) && this.hasSnapshot(c.lawId, c.toKey || c.snapshotKey)),
      decisions: this.listDecisions().filter((d) => d.lawId === c.lawId),
      affected: c.affected.map((a) => {
        const d = docs.get(a.docId);
        const x = an.get(a.docId);
        const ctx = this._decisionCtx(c, a.docId);
        // Changed cited provisions are findings even without a stored analysis.
        const base = x ? x.findings.slice() : [];
        if (!base.some((f) => f.type === 'changed')) for (const s of (d && d.citations.find((ci) => ci.lawId === c.lawId) || { sections: [] }).sections.filter((s2) => (c.touched || []).includes(s2))) base.unshift({ type: 'changed', severity: 'high', section: s });
        const ap = company.applyDecisions({ findings: base }, this.data.decisions, ctx);
        return {
          ...a,
          doc: d ? { id: d.id, code: d.code, title: d.title, version: d.version, status: d.status } : null,
          findings: ap.findings.map((f) => ({ ...f, hints: hints(f.section) })),
          analysis: x ? { findings: x.findings, refs: x.refs, related: x.related } : null
        };
      })
    };
  }

  /** The newest stored text of an act (null when none was downloaded or imported yet). */
  async lawText(lawId) {
    const law = this.data.laws.find((l) => l.id === lawId);
    if (!law) return null;
    const st = law.state || {};
    for (const key of [st.newestKey, st.snapshotKey, st.lastImport && st.lastImport.key]) if (key && this.hasSnapshot(law.id, key)) return this.loadSnapshot(law.id, key);
    return null;
  }

  // ---------------------------------------------------------------------------
  // Proposals to change a document's text (written with the AI or by hand), kept until the new version.

  async addProposal(docId, p) {
    const doc = this._doc(docId);
    const prop = {
      id: id(),
      at: new Date().toISOString(),
      by: this.user,
      versionId: doc.currentVersionId,
      version: doc.version,
      instruction: String(p.instruction || '').slice(0, 2000),
      original: String(p.original || '').slice(0, 20000),
      text: String(p.text || '').slice(0, 20000),
      reasons: (p.reasons || []).map((r) => String(r).slice(0, 1000)).slice(0, 30),
      lawIds: (p.lawIds || []).filter((x) => this.data.laws.some((l) => l.id === x)),
      ai: p.ai ? { model: String(p.ai.model || ''), provider: String(p.ai.provider || '') } : null,
      changeId: p.changeId || null,
      status: 'open'
    };
    (doc.proposals = doc.proposals || []).push(prop);
    await this.save();
    this.audit('doc.proposal-added', { docId, code: doc.code, proposalId: prop.id, ai: prop.ai ? prop.ai.model : undefined });
    return prop;
  }

  async updateProposal(docId, proposalId, patch) {
    const doc = this._doc(docId);
    const prop = (doc.proposals || []).find((x) => x.id === proposalId);
    if (!prop) throw new Error('Proposal not found');
    if (patch.text !== undefined) prop.text = String(patch.text).slice(0, 20000);
    if (patch.status && ['open', 'done', 'rejected'].includes(patch.status)) prop.status = patch.status;
    prop.updatedAt = new Date().toISOString();
    await this.save();
    this.audit('doc.proposal-updated', { docId, code: doc.code, proposalId, status: prop.status });
    return prop;
  }

  async removeProposal(docId, proposalId) {
    const doc = this._doc(docId);
    doc.proposals = (doc.proposals || []).filter((x) => x.id !== proposalId);
    await this.save();
    this.audit('doc.proposal-removed', { docId, code: doc.code, proposalId });
  }

  /** Check the documents again against the stored text of the act (e.g. after a SOP was updated). */
  async recheckChange(changeId) {
    const c = this.data.changes.find((x) => x.id === changeId);
    if (!c) throw new Error('Change not found');
    const law = this.data.laws.find((l) => l.id === c.lawId);
    const key = c.toKey || c.snapshotKey;
    if (!law || !key || !this.hasSnapshot(law.id, key)) throw new Error('The text of the act is not stored for this change');
    const text = await this.loadSnapshot(law.id, key);
    const analysis = await this._analysisFor(law, text, c.touched);
    await this._write(this._changeFile(c, '.analysis.json'), JSON.stringify(analysis));
    c.affected = this._affectedFrom(c, analysis, c.affected || []);
    c.analyzedAt = new Date().toISOString();
    c.sectionsInText = analysis.sections;
    await this.save();
    this.audit('legislation.rechecked', { changeId, lawId: law.id, affected: c.affected.length });
    return this.getChange(changeId);
  }

  /** Find or create a register entry. */
  async ensureLaw({ lawId, spec }) {
    if (lawId) {
      const law = this.data.laws.find((l) => l.id === lawId);
      if (!law) throw new Error('Law not found');
      return law;
    }
    if (spec && spec.key) {
      const existing = this.data.laws.find((l) => l.key === spec.key);
      if (existing) return existing;
    }
    if (spec && spec.url) {
      const existing = this.data.laws.find((l) => l.url && l.url.replace(/\/+$/, '') === spec.url.replace(/\/+$/, ''));
      if (existing) return existing;
    }
    return this.addLaw({ jurisdiction: 'SK', ...spec, title: (spec && spec.title) || (spec && spec.key) || 'Predpis' });
  }

  /**
   * The user brings a text of an act (downloaded file). It is stored as a version, compared with the
   * previous stored version (if any), and every document is checked against it.
   * opts: { lawId | spec, text, versionDate, source: { type, name } }
   */
  async importLawText({ lawId, spec, text, versionDate, source }) {
    if (!text || text.length < 200) throw new Error('The file contains almost no text');
    const law = await this.ensureLaw({ lawId, spec });
    const key = versionDate && /^\d{4}-\d{2}-\d{2}$/.test(versionDate) ? versionDate.replace(/-/g, '') : `f-${hashText(text).slice(0, 10)}`;
    const prevKey = await this.previousSnapshotKey(law, key);
    const prevText = prevKey ? await this.loadSnapshot(law.id, prevKey) : null;
    await this.saveSnapshot(law.id, key, text);
    let diff = prevText ? diffLaw(prevText, text) : null;
    const n = diff ? (diff.mode === 'sections' ? diff.changed.length + diff.added.length + diff.removed.length : diff.added.length + diff.removed.length) : 0;
    if (!n) diff = null;
    const day = today();
    const kind = diff ? (versionDate && versionDate > day ? 'upcoming' : 'new-version') : 'check';
    const prevDate = prevKey && /^\d{8}$/.test(prevKey) ? `${prevKey.slice(0, 4)}-${prevKey.slice(4, 6)}-${prevKey.slice(6, 8)}` : null;
    const ch = await this.addChange(
      {
        lawId: law.id,
        kind,
        fromKey: diff ? prevKey : null,
        fromDate: diff ? prevDate : null,
        toKey: key,
        toDate: versionDate || null,
        snapshotKey: key,
        source: source || null,
        sourceUrl: law.url || null,
        summary: diff ? { mode: diff.mode, stats: diff.stats, sections: touchedKeys(diff).slice(0, 80) } : null
      },
      diff,
      text
    );
    const st = law.state || {};
    law.state = {
      ...st,
      lastImport: { at: new Date().toISOString(), key, name: source ? source.name : '' },
      newestKey: /^\d{8}$/.test(key) && (!st.newestKey || key > st.newestKey) ? key : st.newestKey || null,
      newestDate: /^\d{8}$/.test(key) && (!st.newestKey || key > st.newestKey) ? versionDate : st.newestDate || null
    };
    await this.save();
    return ch;
  }

  /** A check report for the newest stored text of an act (no new version needed). */
  async checkReport(lawId, source) {
    const law = this.data.laws.find((l) => l.id === lawId);
    if (!law) throw new Error('Law not found');
    const st = law.state || {};
    const key = st.newestKey || st.snapshotKey || (st.lastImport && st.lastImport.key);
    if (!key || !this.hasSnapshot(law.id, key)) throw new Error('The text of the act is not available');
    const text = await this.loadSnapshot(law.id, key);
    const ch = await this.addChange(
      { lawId: law.id, kind: 'check', toKey: key, toDate: /^\d{8}$/.test(key) ? `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}` : null, snapshotKey: key, source: source || null, sourceUrl: law.url || null, summary: null },
      null,
      text
    );
    await this.save();
    return ch;
  }

  async updateChange(changeId, patch) {
    const c = this.data.changes.find((x) => x.id === changeId);
    if (!c) throw new Error('Change not found');
    if (patch.status && ['new', 'reviewing', 'resolved'].includes(patch.status)) {
      c.status = patch.status;
      if (patch.status === 'resolved') c.resolution = { date: new Date().toISOString(), by: this.user, note: patch.note || '' };
      this.audit('legislation.change-status', { changeId, lawId: c.lawId, status: c.status, note: patch.note || '' });
    }
    if (patch.docId) {
      const a = (c.affected || []).find((x) => x.docId === patch.docId);
      if (a) {
        if (patch.docStatus) a.status = patch.docStatus; // open | done | na
        if (patch.docNote !== undefined) a.note = patch.docNote;
        this.audit('legislation.doc-assessed', { changeId, docId: patch.docId, status: a.status, note: a.note });
        if (patch.flagForReview) {
          const doc = this._doc(patch.docId);
          doc.status = 'review';
          this.audit('doc.updated', { docId: doc.id, code: doc.code, changes: { status: { to: 'review' } }, reason: 'legislation' });
        }
      }
      if (c.status === 'new') c.status = 'reviewing';
    }
    if (patch.ai) c.ai = { ...(c.ai || {}), ...patch.ai };
    await this.save();
    return this.getChange(changeId);
  }

  // ---------------------------------------------------------------------------
  // Notices of ŠÚKL and ÚŠKVBL (recalls, safety, availability, legislation)

  /**
   * Add what was read from the authorities' pages. batches: [{ src, items, error }].
   * On the first successful read of a page, older notices (over 30 days, or without a date) are
   * kept as "before monitoring started" so the list does not start with years of notices to assess.
   * Returns the new notices.
   */
  async mergeNotices(batches, now = new Date()) {
    const N = this.data.notices;
    const nowIso = now.toISOString();
    const todayIso = nowIso.slice(0, 10);
    const byId = new Map(N.items.map((i) => [i.id, i]));
    const added = [];
    for (const b of batches) {
      const st = N.sources[b.src.id] || {};
      st.lastCheck = nowIso;
      if (b.error) {
        st.ok = false;
        st.error = String(b.error).slice(0, 300);
        N.sources[b.src.id] = st;
        continue;
      }
      const first = !st.firstCheck;
      for (const it of b.items) {
        const id = notices.noticeId(b.src.authority, it.link, it.title);
        const ex = byId.get(id);
        if (ex) {
          if (ex.category === 'other' && it.category !== 'other') ex.category = it.category;
          if (!ex.dateKnown && it.date) Object.assign(ex, { date: it.date, dateKnown: true });
          continue;
        }
        const age = it.date ? (Date.parse(todayIso) - Date.parse(it.date)) / 86400000 : null;
        const old = first && (age === null || age > 30);
        const n = {
          id,
          authority: b.src.authority,
          source: b.src.id,
          title: String(it.title).slice(0, 500),
          link: it.link,
          summary: String(it.summary || '').slice(0, 600),
          date: it.date || todayIso,
          dateKnown: !!it.date,
          category: it.category,
          firstSeen: nowIso,
          seen: old,
          handled: old ? { outcome: 'baseline', note: '', by: '', at: nowIso } : null
        };
        byId.set(id, n);
        N.items.push(n);
        if (!old) added.push(n);
      }
      Object.assign(st, { ok: true, error: null, count: b.items.length, firstCheck: st.firstCheck || nowIso });
      N.sources[b.src.id] = st;
    }
    // Keep the list from growing without end: the newest 3000 (assessed notices are kept first).
    if (N.items.length > 3000) {
      N.items.sort((a, b) => (b.handled && b.handled.outcome !== 'baseline') - (a.handled && a.handled.outcome !== 'baseline') || String(b.date).localeCompare(String(a.date)));
      N.items.length = 3000;
    }
    N.lastCheck = nowIso;
    await this.save();
    if (added.length) this.audit('notices.new', { n: added.length, titles: added.slice(0, 10).map((x) => x.title) });
    return added;
  }

  _noticeView(n) {
    return { ...n, rel: notices.relevance(n, this.data.company, company.activityHints) };
  }

  /** All notices, newest first, with whether each concerns the company; plus the state of each page read. */
  listNotices() {
    // Undated entries found on the first read (e.g. old acts on a list page) go last, not first.
    const sortDate = (n) => (n.dateKnown || !(n.handled && n.handled.outcome === 'baseline') ? String(n.date) : '');
    const items = this.data.notices.items
      .map((n) => this._noticeView(n))
      .sort((a, b) => sortDate(b).localeCompare(sortDate(a)) || String(b.firstSeen).localeCompare(String(a.firstSeen)));
    const activities = company.ACTIVITIES.map(({ id, sk, en }) => ({ id, sk, en }));
    return { items, sources: this.data.notices.sources, lastCheck: this.data.notices.lastCheck || null, counts: this.noticeCounts(items), activities };
  }

  /** toAssess: recalls (and watched names) that concern the company and wait for an assessment; unseen: new and not yet looked at. */
  noticeCounts(items = null) {
    const list = items || this.data.notices.items.map((n) => this._noticeView(n));
    const needs = (n) => !n.handled && n.rel.forUs && (n.category === 'recall' || n.rel.watch.length > 0);
    return {
      toAssess: list.filter(needs).length,
      unseen: list.filter((n) => !n.seen && n.rel.forUs && n.category !== 'other').length
    };
  }

  async seeNotices(ids) {
    const set = new Set(ids || []);
    let n = 0;
    for (const it of this.data.notices.items) if (set.has(it.id) && !it.seen) (it.seen = true), n++;
    if (n) await this.save();
    return n;
  }

  /** The company's assessment of a notice (e.g. a recall: not our product / measures taken / noted). */
  async handleNotice(id, { outcome, note } = {}) {
    const it = this.data.notices.items.find((x) => x.id === id);
    if (!it) throw new Error('NOT_FOUND');
    if (!notices.OUTCOMES.includes(outcome)) throw new Error('OUTCOME_REQUIRED');
    const text = String(note || '').trim().slice(0, 2000);
    if (outcome === 'done' && !text) throw new Error('NOTE_REQUIRED');
    it.handled = { outcome, note: text, by: this.user, at: new Date().toISOString() };
    it.seen = true;
    await this.save();
    this.audit('notice.handled', { title: it.title, authority: it.authority, outcome, note: text });
    return this._noticeView(it);
  }

  async reopenNotice(id) {
    const it = this.data.notices.items.find((x) => x.id === id);
    if (!it) throw new Error('NOT_FOUND');
    const was = it.handled;
    it.handled = null;
    await this.save();
    this.audit('notice.reopened', { title: it.title, was: was && was.outcome });
    return this._noticeView(it);
  }
}

module.exports = { Archive, STATUSES };
