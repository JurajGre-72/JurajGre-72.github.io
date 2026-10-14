'use strict';
// Local user profiles: passwords are stored only as salted scrypt hashes.

const crypto = require('crypto');

const ROLES = ['reader', 'editor', 'admin'];
const RANK = { reader: 1, editor: 2, admin: 3 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(hash, 'hex');
  return expected.length === h.length && crypto.timingSafeEqual(h, expected);
}

// Passwords protect the archive's encryption key, so they need some length.
const MIN_PASSWORD = 8;

function validPassword(pw) {
  return typeof pw === 'string' && pw.length >= MIN_PASSWORD;
}

function hasRole(role, needed) {
  return (RANK[role] || 0) >= (RANK[needed] || 99);
}

module.exports = { ROLES, RANK, MIN_PASSWORD, hashPassword, verifyPassword, validPassword, hasRole };
