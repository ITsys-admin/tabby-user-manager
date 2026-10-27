const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const c = require('../.test-build/crypto.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tum-'));
const key = crypto.randomBytes(32);

test('round trip', () => {
  const enc = c.encrypt(key, 'p@ss:word', 'password');
  assert.ok(c.isEncrypted(enc));
  assert.notStrictEqual(enc, 'p@ss:word');
  assert.strictEqual(c.decrypt(key, enc, 'password'), 'p@ss:word');
});

test('empty values pass through', () => {
  assert.strictEqual(c.encrypt(key, '', 'password'), '');
  assert.strictEqual(c.encrypt(key, undefined, 'password'), undefined);
  assert.strictEqual(c.decrypt(key, undefined, 'password'), undefined);
});

test('random IV: same input encrypts differently', () => {
  assert.notStrictEqual(c.encrypt(key, 'x', 'password'), c.encrypt(key, 'x', 'password'));
});

test('tampering is detected', () => {
  const parts = c.encrypt(key, 'secret', 'password').split(':');
  parts[3] = (parts[3][0] === 'a' ? 'b' : 'a') + parts[3].slice(1);
  assert.throws(() => c.decrypt(key, parts.join(':'), 'password'));
});

test('wrong key and wrong field context are rejected', () => {
  const enc = c.encrypt(key, 'secret', 'password');
  assert.throws(() => c.decrypt(crypto.randomBytes(32), enc, 'password'));
  assert.throws(() => c.decrypt(key, enc, 'passphrase'));
});

test('garbage never comes back as plaintext', () => {
  for (const bad of ['plain', 'aa:bb', 'v2:zz', 'v2:a:b:c']) {
    assert.throws(() => c.decrypt(key, bad, 'password'));
  }
});

test('key file: created once, 0600, stable, rejects corruption', () => {
  const p = path.join(tmp(), 'sub', 'users_db.key');
  const k1 = c.loadOrCreateKey(p);
  const k2 = c.loadOrCreateKey(p);
  assert.strictEqual(k1.length, 32);
  assert.ok(k1.equals(k2));
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(p).mode & 0o777, 0o600);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(p)), ['users_db.key']); // no temp leftovers
  fs.writeFileSync(p, 'abcd');
  assert.throws(() => c.loadOrCreateKey(p));
});

test('key file: concurrent first start converges on one key', async () => {
  const p = path.join(tmp(), 'users_db.key');
  const keys = await Promise.all(Array.from({ length: 20 }, () => Promise.resolve().then(() => c.loadOrCreateKey(p))));
  assert.ok(keys.every(k => k.equals(keys[0])));
});

function legacyEncrypt(text) {
  const legacyKey = crypto.scryptSync(os.hostname() + os.userInfo().username, 'tabby-user-manager-salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', legacyKey, iv);
  return iv.toString('hex') + ':' + Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('hex');
}

test('migration: v1 ciphertext -> v2', () => {
  const m = c.migrateSecret(key, legacyEncrypt('old-pass'), 'password');
  assert.ok(c.isEncrypted(m));
  assert.strictEqual(c.decrypt(key, m, 'password'), 'old-pass');
});

test('migration: pre-encryption plaintext (even with ":") -> v2', () => {
  for (const plain of ['hunter2', 'a:b:c', 'abc:def']) {
    const m = c.migrateSecret(key, plain, 'password');
    assert.strictEqual(c.decrypt(key, m, 'password'), plain);
  }
});

test('migration: v2 unchanged; unrecoverable v1 ciphertext returns null (not re-encrypted garbage)', () => {
  const v2 = c.encrypt(key, 'x', 'password');
  assert.strictEqual(c.migrateSecret(key, v2, 'password'), v2);
  const foreign = crypto.randomBytes(16).toString('hex') + ':' + crypto.randomBytes(32).toString('hex');
  assert.strictEqual(c.migrateSecret(key, foreign, 'password'), null);
});
