'use strict';
// The archive: everything lives in one folder chosen by the user.
//
//   <dataDir>/archive.json            documents, legislation register, detected changes, settings
//   <dataDir>/files/<docId>/...        original files (every version)
//   <dataDir>/text/<versionId>.json    extracted text (for search)
//   <dataDir>/legislation/<lawId>/...  law snapshots and change diffs
//   <dataDir>/backups/                 daily copies of archive.json
//   <dataDir>/audit.log                append-only audit trail (JSON lines)
//   <dataDir>/branding/logo.*          company logo shown in the app (optional)
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

const STATUSES = ['draft', 'effective', 'review', 'obsolete'];
const LOGO_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const LOGO_MAX_BYTES = 1024 * 1024;
const DOC_FIELDS = ['type', 'code', 'title', 'status', 'department', 'owner', 'approver', 'tags', 'notes', 'effectiveDate', 'reviewDate', 'reviewIntervalMonths', 'version', 'annexOf'];

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
  await fs.promises.rename(tmp, file);
}

class Archive {
  constructor({ dataDir, user, lang = 'sk' }) {
    this.dir = dataDir;
    this.user = user || 'user';
    this.lang = lang;
    this.data = null;
    this.index = new SearchIndex();
    this.analyzed = new Map(); // filePath -> analysis (reused by import)
    this.saving = Promise.resolve();
    this.indexReady = false;
    this.userId = null;
    this.readOnly = false; // another computer has the archive open for changes
  }

  p(...parts) {
    return path.join(this.dir, ...parts);
  }

  async open() {
    for (const d of ['', 'files', 'text', 'legislation', 'backups', 'trash']) await fs.promises.mkdir(this.p(d), { recursive: true });
    const file = this.p('archive.json');
    let created = false;
    if (fs.existsSync(file)) {
      try {
        this.data = JSON.parse(await fs.promises.readFile(file, 'utf8'));
      } catch (e) {
        // Damaged file (e.g. power loss): keep it aside and restore the previous save,
        // or else the newest daily backup.
        const backups = (await fs.promises.readdir(this.p('backups'))).filter((f) => /^archive-.*\.json$/.test(f)).sort().reverse();
        const candidates = [this.p('archive.prev.json'), ...backups.map((b) => this.p('backups', b))];
        let restored = null;
        for (const c of candidates) {
          try {
            this.data = JSON.parse(await fs.promises.readFile(c, 'utf8'));
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
    if (created) {
      await this.save();
      this.audit('archive.created', { dir: this.dir });
    }
    await this._dailyBackup();
    return { created };
  }

  _migrate() {
    const d = this.data;
    d.docs = d.docs || [];
    d.laws = d.laws || [];
    d.changes = d.changes || [];
    d.users = d.users || [];
    const def = defaultArchive(this.lang).settings;
    d.settings = { ...def, ...(d.settings || {}) };
    for (const doc of d.docs) {
      doc.versions = doc.versions || [];
      doc.reviews = doc.reviews || [];
      doc.tags = doc.tags || [];
      doc.citations = doc.citations || [];
      doc.lawRefs = doc.lawRefs || [];
    }
  }

  /** Build the search index from stored text (call after open). */
  async buildIndex(onProgress) {
    this.index.reset();
    const docs = this.data.docs;
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      const pages = await this.loadText(doc.currentVersionId);
      this.index.setDocument(doc, chunkPages(pages));
      if (onProgress && i % 20 === 0) onProgress(i, docs.length);
    }
    this.indexReady = true;
  }

  save() {
    if (this.readOnly) return this.saving; // never write while another computer holds the archive
    const json = JSON.stringify(this.data, null, 1);
    const file = this.p('archive.json');
    this.saving = this.saving
      .then(async () => {
        const tmp = `${file}.${process.pid}.tmp`;
        await fs.promises.writeFile(tmp, json);
        // Keep the previous state one save back, for recovery.
        if (fs.existsSync(file)) await fs.promises.copyFile(file, this.p('archive.prev.json')).catch(() => {});
        await fs.promises.rename(tmp, file);
      })
      .catch((e) => console.error('save failed', e));
    return this.saving;
  }

  async _dailyBackup() {
    if (this.readOnly) return;
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
    const data = JSON.parse(await fs.promises.readFile(this.p('archive.json'), 'utf8'));
    this.data = data;
    this._migrate();
    await this.buildIndex();
  }

  audit(action, details = {}) {
    if (this.readOnly) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), user: this.user, userId: this.userId || undefined, action, ...details }) + '\n';
    fs.promises.appendFile(this.p('audit.log'), line).catch((e) => console.error('audit failed', e));
  }

  async readAudit({ docId, limit = 300 } = {}) {
    try {
      const raw = await fs.promises.readFile(this.p('audit.log'), 'utf8');
      let rows = raw
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch (_) {
            return null;
          }
        })
        .filter(Boolean);
      if (docId) rows = rows.filter((r) => r.docId === docId);
      return rows.slice(-limit).reverse();
    } catch (_) {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // User profiles (stored in the archive, so they travel with a shared archive folder)

  publicUsers() {
    return this.data.users.filter((u) => !u.disabled).map((u) => ({ id: u.id, name: u.name, role: u.role }));
  }

  listUsers() {
    return this.data.users.map(({ salt, hash, ...u }) => u);
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

  async createUser({ name, role, password }) {
    const n = this._checkName(name);
    if (!ROLES.includes(role)) throw new Error('Invalid role');
    if (!validPassword(password)) throw new Error('PASSWORD_SHORT');
    const u = { id: id(), name: n, role, ...hashPassword(password), createdAt: new Date().toISOString(), createdBy: this.user, disabled: false, prefs: {} };
    this.data.users.push(u);
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
    await this.save();
    if (Object.keys(changes).length) this.audit('user.updated', { targetUser: u.name, userChanges: changes });
    return this.listUsers().find((x) => x.id === userId);
  }

  async setPassword(userId, password, { self = false } = {}) {
    const u = this._user(userId);
    if (!validPassword(password)) throw new Error('PASSWORD_SHORT');
    Object.assign(u, hashPassword(password), { passwordChangedAt: new Date().toISOString() });
    await this.save();
    this.audit(self ? 'user.password-changed' : 'user.password-reset', { targetUser: u.name });
  }

  /** Returns the user if the password is right (and the profile is active), else null. */
  verifyLogin(userId, password) {
    const u = this.data.users.find((x) => x.id === userId && !x.disabled);
    if (!u || !verifyPassword(password, u.salt, u.hash)) return null;
    return u;
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
      const j = JSON.parse(await fs.promises.readFile(this.p('text', `${versionId}.json`), 'utf8'));
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
    if (out.status && !STATUSES.includes(out.status)) delete out.status;
    if (out.reviewIntervalMonths !== undefined) out.reviewIntervalMonths = Math.max(0, parseInt(out.reviewIntervalMonths, 10) || 0);
    for (const k of ['code', 'title', 'department', 'owner', 'approver', 'notes', 'version', 'annexOf']) if (typeof out[k] === 'string') out[k] = out[k].trim();
    for (const k of ['effectiveDate', 'reviewDate']) if (out[k] === '') out[k] = null;
    return out;
  }

  async _storeVersion(doc, filePath, analysis, label) {
    const seq = doc.versions.length + 1;
    const vid = id();
    const rel = path.join('files', doc.id, `v${seq}-${safeName(path.basename(filePath))}`);
    await fs.promises.mkdir(this.p('files', doc.id), { recursive: true });
    await fs.promises.copyFile(filePath, this.p(rel));
    await writeAtomic(this.p('text', `${vid}.json`), JSON.stringify({ pages: analysis.ex.pages }));
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
    for (const v of doc.versions) if (v.status === 'current') v.status = 'superseded';
    doc.versions.push(version);
    doc.currentVersionId = vid;
    return version;
  }

  _refreshCitations(doc, text) {
    doc.citations = detectCitations(text, this.data.laws);
    const known = new Set(this.data.laws.map((l) => l.key).filter(Boolean));
    doc.lawRefs = detectAllLawRefs(text).filter((r) => !known.has(r.key));
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
      createdAt: now,
      updatedAt: now
    };
    if (!doc.reviewDate && doc.effectiveDate && doc.reviewIntervalMonths) doc.reviewDate = addMonths(doc.effectiveDate, doc.reviewIntervalMonths);
    this._ensureType(doc.type);
    await this._storeVersion(doc, filePath, a, doc.version);
    this._refreshCitations(doc, a.text);
    this.data.docs.push(doc);
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
    await this._storeVersion(doc, filePath, a, doc.version);
    // A new effective date moves the next review; otherwise the planned review date stays as it was.
    if (!m.reviewDate && m.effectiveDate && doc.reviewIntervalMonths) doc.reviewDate = addMonths(m.effectiveDate, doc.reviewIntervalMonths);
    if (!m.status && doc.status === 'review') doc.status = 'effective';
    doc.updatedAt = new Date().toISOString();
    this._refreshCitations(doc, a.text);
    this.index.setDocument(doc, chunkPages(a.ex.pages));
    await this.save();
    this.audit('doc.version-added', { docId, code: doc.code, from: prevLabel, to: doc.version, file: path.basename(filePath) });
    return this.decorate(doc);
  }

  async updateDoc(docId, patch) {
    const doc = this._doc(docId);
    const m = this._cleanMeta(patch);
    const changes = {};
    for (const [k, v] of Object.entries(m)) {
      if (JSON.stringify(doc[k]) !== JSON.stringify(v)) changes[k] = { from: doc[k] ?? null, to: v };
    }
    Object.assign(doc, m);
    doc.updatedAt = new Date().toISOString();
    const pages = await this.loadText(doc.currentVersionId);
    this.index.setDocument(doc, chunkPages(pages));
    await this.save();
    if (Object.keys(changes).length) this.audit('doc.updated', { docId, code: doc.code, changes });
    return this.decorate(doc);
  }

  async deleteDoc(docId) {
    const doc = this._doc(docId);
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
    this.audit('doc.deleted', { docId, code: doc.code, title: doc.title });
    return true;
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
    const allowed = ['warnDays', 'reminderDaysIcs', 'docTypes', 'departments', 'legisAutoCheck', 'legisLastAutoCheck', 'autoLockMinutes'];
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
    await writeAtomic(this.snapshotPath(lawId, key), text);
  }

  async loadSnapshot(lawId, key) {
    return fs.promises.readFile(this.snapshotPath(lawId, key), 'utf8');
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
      const direct = c ? c.sections.filter((s) => touched.has(s)) : [];
      let severity = an ? an.severity : c ? 'low' : 'info';
      if (direct.length) severity = 'high';
      const counts = {};
      for (const f of (an && an.findings) || []) counts[f.type] = (counts[f.type] || 0) + 1;
      const p = prev.get(doc.id);
      out.push({ docId: doc.id, direct, cites: c ? c.count : 0, severity, counts, status: p ? p.status : 'open', note: p ? p.note : '' });
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
    await writeAtomic(this._changeFile(ch, '.json'), JSON.stringify(diff || { mode: 'none', changed: [], added: [], removed: [], stats: {} }));
    if (analysis) await writeAtomic(this._changeFile(ch, '.analysis.json'), JSON.stringify(analysis));
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
      return JSON.parse(await fs.promises.readFile(this._changeFile(change, '.json'), 'utf8'));
    } catch (_) {
      return null;
    }
  }

  async loadAnalysis(change) {
    try {
      return JSON.parse(await fs.promises.readFile(this._changeFile(change, '.analysis.json'), 'utf8'));
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
    return {
      ...c,
      law,
      diff,
      hasText: !!((c.toKey || c.snapshotKey) && this.hasSnapshot(c.lawId, c.toKey || c.snapshotKey)),
      affected: c.affected.map((a) => {
        const d = docs.get(a.docId);
        const x = an.get(a.docId);
        return {
          ...a,
          doc: d ? { id: d.id, code: d.code, title: d.title, version: d.version, status: d.status } : null,
          analysis: x ? { findings: x.findings, refs: x.refs, related: x.related } : null
        };
      })
    };
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
    await writeAtomic(this._changeFile(c, '.analysis.json'), JSON.stringify(analysis));
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
}

module.exports = { Archive, STATUSES };
