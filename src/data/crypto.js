// crypto.js - optional passphrase encryption for exported backups. AES-GCM
// with a PBKDF2-derived key, entirely client-side via the browser's Web
// Crypto API (no dependencies, no network). If the passphrase is lost, the
// encrypted backup is unrecoverable - there is no bypass.

const PBKDF2_ITERATIONS = 150000;
const ENC_VERSION = 1;

function toBase64(bytes) {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function fromBase64(str) {
  const bin = atob(str);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function deriveKey(passphrase, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Encrypts a JSON-serializable object into a JSON-serializable envelope:
// { encrypted: true, v, salt, iv, data } (all base64 strings except v/encrypted).
export async function encryptJson(obj, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))
  );
  return {
    encrypted: true,
    v: ENC_VERSION,
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
  const key = await deriveKey(passphrase, fromBase64(envelope.salt));
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
