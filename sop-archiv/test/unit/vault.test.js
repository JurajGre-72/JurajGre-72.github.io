'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../../src/main/lib/vault');
const { hashPassword } = require('../../src/main/lib/auth');

test('files: encrypted, decrypted, and any change is detected', () => {
  const key = V.newDataKey();
  const enc = V.encrypt(key, 'ŠPP 05 – Príjem a skladovanie tovaru');
  assert.ok(V.isEncrypted(enc));
  assert.ok(!enc.toString('latin1').includes('Príjem'), 'no readable text');
  assert.equal(V.decrypt(key, enc).toString('utf8'), 'ŠPP 05 – Príjem a skladovanie tovaru');
  const tampered = Buffer.from(enc);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => V.decrypt(key, tampered));
  assert.throws(() => V.decrypt(V.newDataKey(), enc), 'a different key cannot read it');
  assert.equal(V.isEncrypted(Buffer.from('{"docs":[]}')), false);
});

test('log lines are encrypted one by one', () => {
  const key = V.newDataKey();
  const line = V.encryptLine(key, '{"action":"doc.imported","title":"Reklamačný poriadok"}');
  assert.ok(line.startsWith('E1:') && !line.includes('Reklama'));
  assert.equal(V.decryptLine(key, line), '{"action":"doc.imported","title":"Reklamačný poriadok"}');
  assert.equal(V.decryptLine(key, '{"plain":true}'), '{"plain":true}', 'older plain lines are still read');
});

test('the data key opens only with the right password or recovery code', () => {
  const dek = V.newDataKey();
  const w = V.wrapKey(dek, 'Tajne-heslo-1');
  assert.ok(!JSON.stringify(w).includes('Tajne'));
  assert.ok(V.unwrapKey(w, 'Tajne-heslo-1').equals(dek));
  assert.equal(V.unwrapKey(w, 'tajne-heslo-1'), null);
  const code = V.newRecoveryCode();
  assert.match(code, /^[0-9A-Z]{5}(-[0-9A-Z]{5}){5}$/);
  const rw = V.wrapKey(dek, V.normalizeRecoveryCode(code));
  // typed in lower case, with spaces and O instead of 0: still accepted
  const typed = code.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o');
  assert.ok(V.unwrapKey(rw, V.normalizeRecoveryCode(typed)).equals(dek));
  assert.equal(V.wrapIsOld(w), false);
});

test('profiles from before encryption keep their password', () => {
  const dek = V.newDataKey();
  const legacy = hashPassword('citam123'); // { salt, hash } as stored before
  const w = V.wrapKeyLegacy(dek, legacy);
  assert.ok(!JSON.stringify(w).includes(legacy.hash), 'the old password check itself is not kept');
  assert.ok(V.unwrapKey(w, 'citam123').equals(dek));
  assert.equal(V.unwrapKey(w, 'zle-heslo'), null);
  assert.equal(V.wrapIsOld(w), true, 'renewed at the next sign-in');
});
