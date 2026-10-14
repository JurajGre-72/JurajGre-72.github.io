'use strict';
// Encryption of the archive folder ("vault").
//
// One random data key (AES-256) encrypts every file of the archive with AES-256-GCM (which also detects
// any change to a file). The data key is never stored in the open: each user profile keeps a copy of it
// encrypted with a key derived from that user's password (scrypt), and one more copy is encrypted with
// the recovery code that is printed once when the archive is set up.

const crypto = require('crypto');

const MAGIC = Buffer.from('SOPARC1\0', 'latin1'); // 8 bytes at the start of every encrypted file
const IV = 12;
const TAG = 16;
const LINE_PREFIX = 'E1:';

// scrypt cost for new password wraps: ~0.3 s and 128 MB per attempt makes guessing passwords expensive.
const KDF = { alg: 'scrypt', N: 131072, r: 8, p: 1 };
const MAXMEM = 512 * 1024 * 1024;

function isEncrypted(buf) {
  return Buffer.isBuffer(buf) && buf.length >= MAGIC.length + IV + TAG && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

function encrypt(key, plain) {
  const iv = crypto.randomBytes(IV);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(Buffer.isBuffer(plain) ? plain : Buffer.from(String(plain), 'utf8')), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
}

/** Throws when the key is wrong or the file was changed. */
function decrypt(key, buf) {
  if (!isEncrypted(buf)) throw new Error('Not an encrypted file');
  const iv = buf.subarray(MAGIC.length, MAGIC.length + IV);
  const tag = buf.subarray(MAGIC.length + IV, MAGIC.length + IV + TAG);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(buf.subarray(MAGIC.length + IV + TAG)), d.final()]);
}

/** One line of an append-only log (audit.log), encrypted on its own. */
function encryptLine(key, text) {
  return LINE_PREFIX + encrypt(key, text).subarray(MAGIC.length).toString('base64');
}

function decryptLine(key, line) {
  if (!line.startsWith(LINE_PREFIX)) return line;
  return decrypt(key, Buffer.concat([MAGIC, Buffer.from(line.slice(LINE_PREFIX.length), 'base64')])).toString('utf8');
}

/** Key-encryption key from a password or recovery code. */
function kek(secret, kdf) {
  if (kdf.alg === 'scrypt') return crypto.scryptSync(String(secret).normalize('NFC'), Buffer.from(kdf.salt, 'base64'), 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: MAXMEM });
  if (kdf.alg === 'scrypt-hkdf') {
    // Profiles from before encryption: their stored password check (scrypt, see auth.js) protects the key
    // until the next sign-in, when it is wrapped again with the current settings.
    const h = crypto.scryptSync(String(secret), kdf.salt, 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: MAXMEM });
    return Buffer.from(crypto.hkdfSync('sha256', h, Buffer.alloc(0), Buffer.from('sop-archiv-kek'), 32));
  }
  throw new Error(`Unknown key derivation ${kdf.alg}`);
}

function sealWith(k, dek, kdf) {
  const iv = crypto.randomBytes(IV);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(dek), c.final()]);
  return { kdf, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), key: ct.toString('base64') };
}

/** The data key, encrypted with a key derived from `secret`. */
function wrapKey(dek, secret) {
  const kdf = { ...KDF, salt: crypto.randomBytes(16).toString('base64') };
  return sealWith(kek(secret, kdf), dek, kdf);
}

/** Wrap with a password check from before encryption (hex hash of scrypt(password, salt), see auth.js). */
function wrapKeyLegacy(dek, { salt, hash }) {
  const kdf = { alg: 'scrypt-hkdf', salt, N: 16384, r: 8, p: 1 };
  const k = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(hash, 'hex'), Buffer.alloc(0), Buffer.from('sop-archiv-kek'), 32));
  return sealWith(k, dek, kdf);
}

/** The data key, or null when the secret is wrong. */
function unwrapKey(wrap, secret) {
  if (!wrap) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', kek(secret, wrap.kdf), Buffer.from(wrap.iv, 'base64'));
    d.setAuthTag(Buffer.from(wrap.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(wrap.key, 'base64')), d.final()]);
  } catch (_) {
    return null;
  }
}

/** Should this wrap be renewed with the current settings (old profile or weaker cost)? */
function wrapIsOld(wrap) {
  return !!wrap && (wrap.kdf.alg !== KDF.alg || wrap.kdf.N < KDF.N);
}

// Recovery code: 30 characters (150 bits) in groups of five, without letters that are easy to confuse.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function newRecoveryCode() {
  const bytes = crypto.randomBytes(30);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % 32];
  return s.match(/.{5}/g).join('-');
}

function normalizeRecoveryCode(input) {
  return String(input || '')
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
}

function newDataKey() {
  return crypto.randomBytes(32);
}

module.exports = {
  MAGIC,
  isEncrypted,
  encrypt,
  decrypt,
  encryptLine,
  decryptLine,
  wrapKey,
  wrapKeyLegacy,
  unwrapKey,
  wrapIsOld,
  newRecoveryCode,
  normalizeRecoveryCode,
  newDataKey
};
