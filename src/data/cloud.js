// cloud.js - optional encrypted cloud backup, on top of Supabase.
//
// SCOPE, and it is a deliberately narrow one: this is NOT sync. IndexedDB
// (db.js) stays the single source of truth; nothing here ever runs on its
// own, on a timer, or in response to an edit. It adds exactly two user-driven
// actions - push an encrypted snapshot up, pull one back down - so that a
// lost, wiped or replaced phone stops being an unrecoverable event. The
// device-eviction hardening in storage.js reduces how often you need that;
// it cannot replace it, because persistent storage does not survive clearing
// site data, uninstalling, or moving to another phone.
//
// WHAT THE SERVER CAN SEE. The payload column holds only the output of
// crypto.js:encryptJson - AES-GCM ciphertext under a PBKDF2-derived key, with
// the passphrase never leaving the browser. Supabase holds a blob it cannot
// read; a database breach or a subpoena served on the host yields nothing
// without the passphrase. uploadSnapshot() refuses to send anything that is
// not an encrypted envelope, and the table carries a matching CHECK
// constraint, so "just this once, unencrypted" is not reachable by accident.
// The row's plaintext columns are only what the restore picker must display
// before it can decrypt anything: a month count, the month range, the app
// version. No energy or financial figure is among them.
//
// AUTH is a Supabase email magic link. The implicit flow is chosen over the
// default PKCE one on purpose: PKCE requires the link to be opened in the
// same browser context that requested it, which is exactly what an installed
// PWA on Android cannot guarantee (the mail app opens a plain Chrome tab, or
// a custom tab, or another browser entirely). The implicit flow lets
// completeSignInFromLink() finish the sign-in from a link the user pastes
// back into the app, which works from any context.

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, cloudEnabled, authRedirectUrl } from './supabaseConfig.js';
import { authStorage } from './db.js';
import { isEncryptedEnvelope } from './crypto.js';

const SNAPSHOTS_KEPT = 10;
// Mirrors the table's own size constraint, so the client can refuse an
// oversized payload with a readable message instead of a constraint error.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

let _client = null;

// Lazily constructed so a build with no project configured never touches the
// network and never registers an auth listener.
export function cloudClient() {
  if (!cloudEnabled) return null;
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        storage: authStorage,
        storageKey: 'roi-app',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'implicit'
      }
    });
  }
  return _client;
}

// Supabase errors arrive as a returned { error } object with a message that
// is sometimes an internal one. Everything below funnels through here so the
// UI can render `e.message` without leaking raw API wording.
function fail(error, fallback) {
  const raw = error?.message ?? '';
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    throw new Error('Could not reach the cloud backup service - check your connection and try again.');
  }
  throw new Error(raw ? `${fallback}: ${raw}` : fallback);
}

// --- Auth ---

export async function getUser() {
  const c = cloudClient();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  return data?.session?.user ?? null;
}

// Returns an unsubscribe function, or a no-op when cloud is not configured.
export function onAuthChange(cb) {
  const c = cloudClient();
  if (!c) return () => {};
  const { data } = c.auth.onAuthStateChange((_event, session) => cb(session?.user ?? null));
  return () => data?.subscription?.unsubscribe();
}

export async function sendSignInLink(email) {
  const c = cloudClient();
  if (!c) throw new Error('Cloud backup is not configured in this build.');
  const { error } = await c.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: authRedirectUrl() }
  });
  if (error) fail(error, 'Could not send the sign-in email');
}

// Completes a sign-in from the link text the user pasted back in, for the
// case where the emailed link opened somewhere that is not this app.
//
// Two shapes are accepted: the raw href from the email
// (.../auth/v1/verify?token=...&type=magiclink), which is exchanged via
// verifyOtp; and the URL the browser landed on after following it
// (...#access_token=...&refresh_token=...), whose tokens are set directly.
// The second is what you get when the link did open a browser but in a
// context that is not the installed app.
export async function completeSignInFromLink(pastedText) {
  const c = cloudClient();
  if (!c) throw new Error('Cloud backup is not configured in this build.');
  const text = pastedText.trim();
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('That does not look like a link. Copy the whole "Log in" link out of the email.');
  }

  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const accessToken = hash.get('access_token');
  const refreshToken = hash.get('refresh_token');
  if (accessToken && refreshToken) {
    const { error } = await c.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error) fail(error, 'Could not use that link');
    return;
  }

  const tokenHash = url.searchParams.get('token') || url.searchParams.get('token_hash');
  if (!tokenHash) {
    throw new Error('That link has no sign-in token in it. Copy the "Log in" link from the email itself.');
  }
  // The link carries its own type, and it is not always 'magiclink': the very
  // first sign-in for an address that has never been seen is a 'signup'
  // confirmation. Verifying that under the wrong type fails, which would make
  // the paste path look broken exactly once - on the first ever use.
  const linkType = url.searchParams.get('type');
  const KNOWN = ['magiclink', 'signup', 'invite', 'recovery', 'email_change', 'email'];
  const type = KNOWN.includes(linkType) ? linkType : 'email';
  const { error } = await c.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) fail(error, 'Could not use that link (it may have expired or already been used)');
}

export async function signOut() {
  const c = cloudClient();
  if (!c) return;
  const { error } = await c.auth.signOut();
  if (error) fail(error, 'Could not sign out');
}

// --- Snapshots ---

// Metadata only - the payload column is deliberately not selected, so
// listing the backups never pulls several megabytes of ciphertext down a
// phone connection.
export async function listSnapshots() {
  const c = cloudClient();
  if (!c) return [];
  const { data, error } = await c
    .from('backups')
    .select('id, created_at, month_count, first_month, last_month, app_version')
    .order('created_at', { ascending: false });
  if (error) fail(error, 'Could not list your cloud backups');
  return data ?? [];
}

// `envelope` must be the object returned by crypto.js:encryptJson. The guard
// here is the one that matters - it is the last point before the data leaves
// the device - and it is intentionally a hard throw rather than a fallback
// to plaintext.
export async function uploadSnapshot(envelope, meta) {
  const c = cloudClient();
  if (!c) throw new Error('Cloud backup is not configured in this build.');
  if (!isEncryptedEnvelope(envelope)) {
    throw new Error('Refusing to upload: the backup is not encrypted.');
  }
  const { data, error } = await c
    .from('backups')
    .insert({
      payload: JSON.stringify(envelope),
      month_count: meta.monthCount ?? null,
      first_month: meta.firstMonth ?? null,
      last_month: meta.lastMonth ?? null,
      app_version: meta.appVersion ?? null
    })
    .select('id, created_at, month_count, first_month, last_month, app_version')
    .single();
  if (error) fail(error, 'Could not upload the backup');
  return data;
}

// Returns the parsed encrypted envelope for one snapshot; decryption is the
// caller's job, since only the UI holds the passphrase.
export async function fetchSnapshot(id) {
  const c = cloudClient();
  if (!c) throw new Error('Cloud backup is not configured in this build.');
  const { data, error } = await c.from('backups').select('payload').eq('id', id).single();
  if (error) fail(error, 'Could not download that backup');
  try {
    return JSON.parse(data.payload);
  } catch {
    throw new Error('That backup is corrupted - its stored contents are not readable.');
  }
}

export async function deleteSnapshot(id) {
  const c = cloudClient();
  if (!c) return;
  const { error } = await c.from('backups').delete().eq('id', id);
  if (error) fail(error, 'Could not delete that backup');
}

// Keeps the most recent SNAPSHOTS_KEPT and removes the rest. Called after a
// successful upload, never before one: pruning first would open a window
// where the oldest copy is gone and the new one has not landed. A failure
// here is swallowed by the caller - an un-pruned extra row is clutter, not a
// reason to tell the user their backup failed when it did not.
export async function pruneSnapshots(keep = SNAPSHOTS_KEPT) {
  const c = cloudClient();
  if (!c) return 0;
  const all = await listSnapshots();
  const surplus = all.slice(keep);
  for (const row of surplus) await deleteSnapshot(row.id);
  return surplus.length;
}

export { SNAPSHOTS_KEPT, MAX_UPLOAD_BYTES };
