// crypto.js - optional passphrase encryption for exported backups. AES-GCM
// with a PBKDF2-derived key, entirely client-side via the browser's Web
// Crypto API (no dependencies, no network). If the passphrase is lost, the
// encrypted backup is unrecoverable - there is no bypass.
//
// The iteration count was raised from 150k to 600k in v1.16, when cloud
// backup (data/cloud.js) started putting these envelopes on someone else's
// disk. While an encrypted export only ever sat in the user's own Downloads
// folder, the KDF cost mattered mainly against a stolen laptop; once a copy
// is hosted, the passphrase is the *only* thing standing between a database
// breach and the household's data, and the attacker can grind it offline at
// their leisure. 600k is the current OWASP figure for PBKDF2-HMAC-SHA256.
//
// Old envelopes must keep opening, so the count is recorded in the envelope
// and read back from it: v1 envelopes have no `iterations` field and are
// assumed to be the 150k they were written with.

const PBKDF2_ITERATIONS = 600000;
const LEGACY_PBKDF2_ITERATIONS = 150000; // v1 envelopes, written before v1.16
// A ceiling on what will be honoured from an envelope. Without it, a hostile
// backup file could name a billion iterations and hang the tab on the user's
// own device the moment they try to open it.
const MAX_PBKDF2_ITERATIONS = 5000000;
const ENC_VERSION = 2;

function toBase64(bytes) {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function fromBase64(str) {
  const bin = atob(str);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function deriveKey(passphrase, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Encrypts a JSON-serializable object into a JSON-serializable envelope:
// { encrypted: true, v, iterations, salt, iv, data } (all base64 strings
// except v/iterations/encrypted).
export async function encryptJson(obj, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))
  );
  return {
    encrypted: true,
    v: ENC_VERSION,
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(ciphertext))
  };
}

export function isEncryptedEnvelope(obj) {
  return !!obj && obj.encrypted === true &&
    typeof obj.data === 'string' && typeof obj.salt === 'string' && typeof obj.iv === 'string';
}

// Throws a plain Error (wrong passphrase / corrupted data - AES-GCM auth
// tag mismatch) rather than letting the raw DOMException leak through.
export async function decryptJson(envelope, passphrase) {
  const stated = envelope.iterations;
  const iterations = Number.isInteger(stated) && stated > 0
    ? Math.min(stated, MAX_PBKDF2_ITERATIONS)
    : LEGACY_PBKDF2_ITERATIONS;
  const key = await deriveKey(passphrase, fromBase64(envelope.salt), iterations);
  let plainBuf;
  try {
    plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(envelope.iv) }, key, fromBase64(envelope.data)
    );
  } catch {
    throw new Error('Wrong passphrase (or corrupted backup) - could not decrypt.');
  }
  return JSON.parse(new TextDecoder().decode(plainBuf));
}
