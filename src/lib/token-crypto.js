// ── Token encryption — AES-256-GCM for calendar refresh tokens ─────────────
// Google Calendar refresh tokens are long-lived credentials: whoever holds
// one can request new access tokens for that user's calendar until the user
// explicitly revokes at myaccount.google.com. Storing them in cleartext in
// the DB would mean a single DB leak = full calendar-read access to every
// connected user. We encrypt them at rest with AES-256-GCM using a key
// derived from a dedicated env var.
//
// Why GCM:
//   • Authenticated: any tamper with the ciphertext / IV fails decryption
//     rather than silently returning garbage. Defends against DB-level
//     row manipulation, not just exfiltration.
//   • Ubiquitous: Node's crypto module supports it natively, no external
//     dependency.
//
// Key handling:
//   • CALENDAR_TOKEN_ENCRYPTION_KEY env var. Accepts either a base64 string
//     (preferred — `openssl rand -base64 32`) or raw UTF-8 bytes.
//   • Must be ≥32 bytes after decoding. We truncate to exactly 32 bytes to
//     match AES-256's keysize.
//   • Rotating the key invalidates every stored refresh_token — users have
//     to reconnect their calendar once. That's an acceptable cost for
//     rotation; doing transparent re-encryption would require reading-and-
//     rewriting every row inside a transaction, which is out of scope.
//
// IV handling:
//   • 12 bytes (NIST SP 800-38D recommended for GCM). Generated fresh per
//     encryption via crypto.randomBytes — MUST be unique per key+plaintext.
//   • Stored alongside the ciphertext in the calendar_tokens table
//     (refresh_token_iv column). Not secret; just needs to be unpredictable.
//
// Ciphertext layout:
//   [ encrypted_bytes | auth_tag (16 bytes) ]
// We concatenate the tag onto the ciphertext on encrypt, split it on
// decrypt. Keeps the schema simple (one BYTEA column) at a ~16-byte cost.

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;    // GCM standard; 96 bits
const TAG_BYTES = 16;   // GCM auth tag; 128 bits
const KEY_BYTES = 32;   // AES-256

let _cachedKey = null;

function getKey() {
  if (_cachedKey) return _cachedKey;
  const raw = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('CALENDAR_TOKEN_ENCRYPTION_KEY is not set — refusing to handle calendar tokens');
  }

  // Try base64 first (common form from `openssl rand -base64 32`). If that
  // decodes to ≥32 bytes, use those bytes. Otherwise fall back to treating
  // the env value as raw UTF-8 bytes — acceptable for dev convenience, but
  // the deploy docs recommend base64.
  let keyBuf;
  try {
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length >= KEY_BYTES) {
      keyBuf = decoded.subarray(0, KEY_BYTES);
    }
  } catch { /* fall through to UTF-8 path */ }

  if (!keyBuf) {
    const utf8 = Buffer.from(raw, 'utf-8');
    if (utf8.length < KEY_BYTES) {
      throw new Error(
        `CALENDAR_TOKEN_ENCRYPTION_KEY is too short (need ≥${KEY_BYTES} bytes, got ${utf8.length}). ` +
        `Generate one with: openssl rand -base64 32`
      );
    }
    keyBuf = utf8.subarray(0, KEY_BYTES);
  }

  _cachedKey = keyBuf;
  return _cachedKey;
}

/**
 * Encrypt a string. Returns { ciphertext: Buffer, iv: Buffer } — both
 * suitable for storing in BYTEA columns. Ciphertext includes the 16-byte
 * auth tag appended, so decrypt() can split it back out.
 */
export function encryptString(plaintext) {
  if (typeof plaintext !== 'string') {
    throw new TypeError('encryptString: expected string plaintext');
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([enc, tag]),
    iv,
  };
}

/**
 * Decrypt a ciphertext produced by encryptString. Throws on auth-tag mismatch
 * or invalid key — callers should catch and treat as "token is invalid,
 * prompt reconnection".
 */
export function decryptString(ciphertext, iv) {
  if (!Buffer.isBuffer(ciphertext)) ciphertext = Buffer.from(ciphertext);
  if (!Buffer.isBuffer(iv)) iv = Buffer.from(iv);
  if (ciphertext.length < TAG_BYTES) {
    throw new Error('decryptString: ciphertext too short to contain auth tag');
  }
  if (iv.length !== IV_BYTES) {
    throw new Error(`decryptString: IV must be ${IV_BYTES} bytes, got ${iv.length}`);
  }

  const enc = ciphertext.subarray(0, ciphertext.length - TAG_BYTES);
  const tag = ciphertext.subarray(ciphertext.length - TAG_BYTES);

  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf-8');
}

/**
 * Exposed only for tests / dev REPL. Clears the cached key so a fresh env
 * var value takes effect on the next call. Don't use in request handlers.
 */
export function __resetKeyCacheForTests() {
  _cachedKey = null;
}
