import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const VERSION_PREFIX = 'v2';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

/** Loads the encryption key from disk, creating a random one (mode 0600) on first run. */
export function loadOrCreateKey(keyPath: string): Buffer {
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });

  if (!fs.existsSync(keyPath)) {
    // Write to a temp file, then hard-link it into place. link() fails if the
    // target already exists, so two processes starting together cannot overwrite each other's key.
    const tmp = `${keyPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, crypto.randomBytes(KEY_LENGTH).toString('hex'), { mode: 0o600 });
    try {
      fs.linkSync(tmp, keyPath);
    } catch (e: any) {
      if (e.code !== 'EEXIST') throw e;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  try { fs.chmodSync(keyPath, 0o600); } catch { /* best effort (e.g. Windows) */ }

  const key = Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'hex');
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Invalid encryption key file: ${keyPath}`);
  }
  return key;
}

export function isEncrypted(value?: string): boolean {
  return typeof value === 'string' && value.startsWith(VERSION_PREFIX + ':');
}

/** AES-256-GCM. `context` (e.g. the field name) is authenticated, so values cannot be swapped between fields. */
export function encrypt(key: Buffer, text: string | undefined, context: string): string | undefined {
  if (!text) return text;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return [VERSION_PREFIX, iv.toString('hex'), cipher.getAuthTag().toString('hex'), data.toString('hex')].join(':');
}

/** Throws if the value is malformed, tampered with, or the key is wrong. Never returns ciphertext. */
export function decrypt(key: Buffer, payload: string | undefined, context: string): string | undefined {
  if (!payload) return payload;
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION_PREFIX) {
    throw new Error('Unsupported or corrupted secret');
  }
  const [, ivHex, tagHex, dataHex] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

// ---- Migration from v1.x (AES-CBC, key derived from hostname + username) ----

const LEGACY_SHAPE = /^[0-9a-f]{32}:[0-9a-f]{32,}$/;

export function looksLikeLegacyCiphertext(value: string): boolean {
  return LEGACY_SHAPE.test(value);
}

export function legacyDecrypt(value: string): string | null {
  try {
    const legacyKey = crypto.scryptSync(os.hostname() + os.userInfo().username, 'tabby-user-manager-salt', 32);
    const [ivHex, dataHex] = value.split(':');
    const decipher = crypto.createDecipheriv('aes-256-cbc', legacyKey, Buffer.from(ivHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Returns the v2 value for a stored secret, or null if it can't be migrated safely.
 *  - already v2            -> unchanged
 *  - legacy ciphertext     -> decrypted with the old key, re-encrypted as v2 (null if the old key no longer matches)
 *  - anything else         -> treated as plaintext from a pre-encryption version and encrypted
 */
export function migrateSecret(key: Buffer, value: string, context: string): string | null {
  if (isEncrypted(value)) return value;
  if (looksLikeLegacyCiphertext(value)) {
    const plain = legacyDecrypt(value);
    return plain === null ? null : (encrypt(key, plain, context) as string);
  }
  return encrypt(key, value, context) as string;
}
