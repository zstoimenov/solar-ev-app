// cloud.js - the OPTIONAL encrypted cloud backup, and the only module that
// talks to Supabase. Modelled on forecast.js, the app's other networked
// module, and bound by the same rules:
//
//   - OFF until the household turns it on. Nothing here makes a request
//     unless config.cloud.enabled is true, so the default install is exactly
//     as local-only as it was before.
//   - The payload is CIPHERTEXT, always. encryptJson() runs before the row is
//     built and there is no plaintext upload path to choose by accident. The
//     passphrase is never stored, never sent, and cannot be recovered - the
//     same bargain the encrypted file export already makes.
//   - No raw browser or library error string ever reaches the household. Every
//     failure becomes a CloudError with a sentence a person can act on.
//
// What this is NOT: sync. There is no merging, no per-record write, no
// background push. It takes the whole store, encrypts it, and appends it as
// one row; or it takes one row back and hands it to importState(). Two-way
// sync stays declined - see CLAUDE.md.
//
// What Supabase can see, stated plainly because it is the whole question:
// the ciphertext, and four plaintext columns (month count, first and last
// month, app version) that exist so the snapshot list is readable without
// asking for the passphrase first. No energy figure, no dollar figure, no
// location.

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './cloudKeys.js';
import {
  getState, putState, importState,
  getAuthSession, putAuthSession, delAuthSession,
  getCloudMeta, recordCloudPush
} from './db.js';
import { encryptJson, decryptJson, isEncryptedEnvelope } from './crypto.js';
import { APP_VERSION } from '../version.js';

// Thrown for anything the household needs to read. Module-private like
// forecast.js's ForecastError - callers show err.message, never err.status.
class CloudError extends Error {}

// --- The gate --------------------------------------------------------------
// Returns null unless the feature has been switched on, and every entry point
// below checks it. The feature is disabled by the ABSENCE of the config key
// rather than by a boolean buried in a settings object, exactly as
// forecastConfig()/saveForecastLocation() do it.
export function cloudConfig(config) {
  const c = config?.cloud;
  if (!c || c.enabled !== true) return null;
  return { enabled: true };
}

// Written through getState() rather than through whatever scoped view a
// screen happens to hold, so a date-filtered dashboard state can never be
// written back over the real store. Same rule as saveForecastLocation().
export async function saveCloudEnabled(enabled) {
  const current = await getState();
  const next = { ...current, config: { ...current.config } };
  if (enabled) next.config.cloud = { enabled: true };
  else delete next.config.cloud;
  await putState(next);
  return next;
}

// --- The client ------------------------------------------------------------
// supabase-js is given a storage adapter over IndexedDB rather than its
// default localStorage, so db.js's "no localStorage/sessionStorage" rule
// survives having a third-party client in the tree. The adapter reads and
// writes one record holding a { key: value } map, because the library may
// keep more than one key.
const idbStorage = {
  async getItem(key) {
    const all = await getAuthSession();
    return all?.[key] ?? null;
  },
  async setItem(key, value) {
    const all = (await getAuthSession()) ?? {};
    await putAuthSession({ ...all, [key]: value });
  },
  async removeItem(key) {
    const all = (await getAuthSession()) ?? {};
    if (!(key in all)) return;
    delete all[key];
    if (Object.keys(all).length === 0) await delAuthSession();
    else await putAuthSession(all);
  }
};

let _client = null;
function client() {
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        storage: idbStorage,
        storageKey: 'roi-app-auth',
        persistSession: true,
        autoRefreshToken: true,
        // Nothing arrives by URL any more - sign-in is email + password, so
        // there is no redirect to parse. Left off rather than harmlessly on,
        // so the client never inspects the address bar of a page that also
        // shows household data.
        detectSessionInUrl: false
      }
    });
  }
  return _client;
}

// --- Error normalisation ---------------------------------------------------
// A paused free-tier project answers 540, which is the single most likely
// failure here given the household ingests once a month. Saying "540" would
// be useless; saying what to do about it is not.
function toCloudError(error, fallback) {
  if (!error) return new CloudError(fallback);
  const status = error.status ?? error.code;
  if (status === 540 || status === '540') {
    return new CloudError(
      'The backup service is asleep. Free Supabase projects pause after a ' +
      'week of no use - open the Supabase dashboard and press "Resume ' +
      'project", then try again.'
    );
  }
  if (status === 401 || status === 403) {
    return new CloudError('That sign-in has expired. Sign in again, then retry.');
  }
  if (typeof error.message === 'string' &&
      /fetch|network|Load failed/i.test(error.message)) {
    return new CloudError('Could not reach the backup service - check your connection.');
  }
  return new CloudError(error.message || fallback);
}

// --- Sign in ---------------------------------------------------------------
// Email + PASSWORD, not the emailed one-time code this started as. The switch
// was forced by what the free tier actually does, and each reason is a hard
// blocker rather than an inconvenience:
//
//   - Supabase's built-in mail server only delivers to addresses on the
//     project ORGANISATION's team. Any other address fails with "Email
//     address not authorized" and no message is ever sent.
//   - Customising the Magic Link template (needed to put {{ .Token }} in the
//     email, because signInWithOtp sends a LINK by default) was not available
//     on this project, so there was no six-digit code to type.
//   - A PKCE magic link only completes in the browser that requested it. On a
//     phone, a link opened from a mail app frequently lands somewhere else.
//
// A password removes all three: no message is sent, so nothing can fail to
// arrive. The account is still created by hand in the dashboard and signups
// stay off, so this is not a way to register - only to prove who you are.
//
// The earlier objection ("no password field on a page anyone can open") does
// not survive contact with how this works: the password is verified by
// Supabase, never by the bundle; the bundle holds no secret either way; RLS
// still scopes every row to the signed-in user; and the backup itself is
// encrypted with a SEPARATE passphrase, so a stolen password yields
// ciphertext and nothing else.
export async function signInWithPassword(email, password) {
  const trimmed = (email ?? '').trim();
  const pass = password ?? '';
  if (!trimmed) throw new CloudError('Enter the email address of your Supabase account.');
  if (!pass) throw new CloudError('Enter the password for your Supabase account.');

  const { data, error } = await client().auth.signInWithPassword({ email: trimmed, password: pass });
  if (error) {
    const m = error.message ?? '';
    // Three different failures that used to collapse into one misleading
    // message. Each names its own remedy, because the fix for each is in a
    // different place and guessing wrong costs an afternoon.
    if (/logins? are disabled|email logins/i.test(m)) {
      throw new CloudError(
        'Email sign-in is switched off for this Supabase project. Turn the ' +
        'Email provider on under Authentication -> Sign In / Providers.'
      );
    }
    if (/email not confirmed|not confirmed/i.test(m)) {
      throw new CloudError(
        'That account exists but its email was never confirmed. In the Supabase ' +
        'dashboard, open Authentication -> Users, and confirm the address.'
      );
    }
    if (/invalid login credentials|invalid.*password/i.test(m)) {
      throw new CloudError(
        'That email and password were not accepted. If the account has not been ' +
        'created yet, make it once in the Supabase dashboard under ' +
        'Authentication -> Users -> Add user (tick "Auto Confirm User"). The app ' +
        'deliberately cannot create accounts.'
      );
    }
    throw toCloudError(error, 'Could not sign in.');
  }
  return data?.user ?? null;
}

export async function currentUser() {
  try {
    const { data } = await client().auth.getSession();
    return data?.session?.user ?? null;
  } catch {
    // A missing or corrupt stored session is a signed-out state, not a crash.
    return null;
  }
}

export async function signOut() {
  await client().auth.signOut();
  await delAuthSession();
}

// --- Push ------------------------------------------------------------------
// Preflight is separate from the push so this module stays DOM-free: the
// component asks for the numbers, decides whether to put a confirm dialog in
// front of the household, and then calls pushSnapshot({ force }). The guard
// itself is the same one the file export has had since v1.14 - a backup with
// fewer months than the last one is the single path to real data loss.
export async function pushPreflight() {
  const current = await getState();
  const count = current?.monthlyDigests?.length ?? 0;
  const { lastPushedCount } = await getCloudMeta();
  return {
    count,
    lastPushedCount,
    wouldTruncate: lastPushedCount != null && count < lastPushedCount
  };
}

export async function pushSnapshot({ passphrase, force = false }) {
  const pass = (passphrase ?? '').trim();
  if (!pass) throw new CloudError('Enter a passphrase. The backup is encrypted before it leaves this device.');

  const current = await getState();
  if (!current) throw new CloudError('There is nothing to back up yet.');
  const count = current.monthlyDigests.length;

  const { wouldTruncate } = await pushPreflight();
  if (wouldTruncate && !force) {
    throw new CloudError('This backup has fewer months than the last one. Confirm before uploading it.');
  }

  const stamped = {
    ...current,
    meta: { ...current.meta, exportedAt: new Date().toISOString(), monthCount: count }
  };

  // Compact, not JSON.stringify(x, null, 2): pretty-printing puts each of an
  // intervalProfile's 96 numbers on its own line and inflates the payload by
  // roughly two thirds for no benefit over the wire.
  const envelope = await encryptJson(stamped, pass);
  const payload = JSON.stringify(envelope);

  const { data, error } = await client()
    .from('backups')
    .insert({
      payload,
      month_count: count,
      first_month: current.meta?.dateRange?.first ?? null,
      last_month: current.meta?.dateRange?.last ?? null,
      app_version: APP_VERSION
    })
    .select('id, created_at')
    .single();

  if (error) throw toCloudError(error, 'The backup could not be uploaded.');

  await recordCloudPush({ count, id: data.id });
  return { id: data.id, createdAt: data.created_at, count, bytes: payload.length };
}

// --- List / pull / delete --------------------------------------------------
// The payload column is deliberately NOT selected here: a list of twenty
// snapshots would drag megabytes of ciphertext across for four numbers each.
export async function listSnapshots({ limit = 25 } = {}) {
  const { data, error } = await client()
    .from('backups')
    .select('id, created_at, month_count, first_month, last_month, app_version')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw toCloudError(error, 'Could not read the list of backups.');
  return data ?? [];
}

// Goes through importState() so a cloud restore hits exactly the same
// validation and forward-migration choke point as a file restore. Nothing is
// written unless the whole object validates.
export async function pullSnapshot(id, passphrase) {
  const pass = (passphrase ?? '').trim();
  if (!pass) throw new CloudError('Enter the passphrase this backup was encrypted with.');

  const { data, error } = await client()
    .from('backups').select('payload').eq('id', id).single();
  if (error) throw toCloudError(error, 'Could not download that backup.');

  let envelope;
  try {
    envelope = JSON.parse(data.payload);
  } catch {
    throw new CloudError('That backup is corrupted - it is not readable JSON.');
  }
  // Refuse anything that is not ciphertext rather than importing it. Plaintext
  // in this table would mean the encryption path was bypassed, which is a bug
  // worth failing loudly on, not working around.
  if (!isEncryptedEnvelope(envelope)) {
    throw new CloudError('That backup is not encrypted, so it was not written by this app. Refusing to restore it.');
  }

  const parsed = await decryptJson(envelope, pass); // throws the shared wrong-passphrase message
  return importState(parsed);
}

export async function deleteSnapshot(id) {
  const { error } = await client().from('backups').delete().eq('id', id);
  if (error) throw toCloudError(error, 'Could not delete that backup.');
  return true;
}
