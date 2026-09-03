// storage.js - browser storage DURABILITY (not persistence of app data
// itself; that's db.js). IndexedDB defaults to the "best-effort" bucket,
// which Android Chrome is free to evict when the device runs low on space,
// and which some Android OEM storage cleaners wipe outright. That is how a
// previously-populated store comes back empty with no user action and no
// error - exactly the failure this module exists to prevent.
//
// navigator.storage.persist() moves the origin into the "persistent" bucket,
// which is excluded from that eviction path. Chrome decides silently from
// engagement heuristics (the strongest being "the PWA is installed") and
// shows no prompt, so it is safe to fire automatically on load rather than
// hide behind a button. Firefox does prompt. Nothing here reads or writes
// app data - it only changes the browser's retention policy for the origin.

const STALE_BACKUP_DAYS = 30;

export function storageApiAvailable() {
  return typeof navigator !== 'undefined' &&
    !!navigator.storage &&
    typeof navigator.storage.persist === 'function' &&
    typeof navigator.storage.persisted === 'function';
}

async function readMode() {
  if (!storageApiAvailable()) return 'unsupported';
  try {
    return (await navigator.storage.persisted()) ? 'persistent' : 'best-effort';
  } catch {
    return 'unsupported';
  }
}

// Returns 'persistent' | 'best-effort' | 'unsupported'. Checks the existing
// grant first, so calling this on every load is a no-op once granted.
export async function ensurePersisted() {
  if (!storageApiAvailable()) return 'unsupported';
  try {
    if (await navigator.storage.persisted()) return 'persistent';
    return (await navigator.storage.persist()) ? 'persistent' : 'best-effort';
  } catch {
    return 'unsupported';
  }
}

// { mode, usageBytes, quotaBytes }. usage/quota are null where estimate() is
// unimplemented or throws; they are advisory everywhere (Chrome deliberately
// rounds them to blunt cross-site fingerprinting), so they are shown as
// context on the Data screen and never used to gate behaviour.
export async function getStorageStatus() {
  const mode = await readMode();
  let usageBytes = null;
  let quotaBytes = null;
  if (typeof navigator !== 'undefined' && typeof navigator.storage?.estimate === 'function') {
    try {
      const est = await navigator.storage.estimate();
      usageBytes = est.usage ?? null;
      quotaBytes = est.quota ?? null;
    } catch { /* advisory only - absence is not an error */ }
  }
  return { mode, usageBytes, quotaBytes };
}

export function formatBytes(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

export function daysSince(isoString) {
  if (!isoString) return null;
  const then = Date.parse(isoString);
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86400000);
}

// Describes how far the local store has drifted from the last exported
// backup, as { level, text } or null when the backup is current.
//
// Month drift is checked before elapsed time on purpose: N newly ingested
// months that have never been exported is a concrete, quantifiable exposure,
// whereas "30 days since the last export" on an unchanged store is only a
// reminder. Note this is the mirror image of HealthBanner's guard - that one
// catches the store having FEWER months than the last export (data lost);
// this catches it having MORE (data not yet backed up).
export function backupStaleness({ monthCount, lastExportedCount, lastExportedAt }) {
  if (monthCount === 0) return null;
  if (lastExportedCount == null) {
    return { level: 'warn', text: 'No backup has been exported from this browser yet.' };
  }
  const unbacked = monthCount - lastExportedCount;
  if (unbacked > 0) {
    return {
      level: 'warn',
      text: `${unbacked} month${unbacked === 1 ? '' : 's'} ingested since your last backup.`
    };
  }
  const age = daysSince(lastExportedAt);
  if (age != null && age >= STALE_BACKUP_DAYS) {
    return { level: 'warn', text: `Last backup was ${age} days ago.` };
  }
  return null;
}

// The same question asked of the CLOUD copy. A sibling of backupStaleness()
// rather than a change to it: the two are different backups with different
// failure modes and different fixes (find the file / press the button), and
// merging them would repeat the mistake the comment above warns about.
//
// Returns null when cloud backup is switched off - an unused feature is not
// a problem to nag about.
export function cloudStaleness({ enabled, monthCount, lastPushedCount, lastPushedAt }) {
  if (!enabled) return null;
  if (monthCount === 0) return null;
  if (lastPushedCount == null) {
    return { level: 'warn', text: 'Nothing has been backed up to the cloud yet.' };
  }
  const unpushed = monthCount - lastPushedCount;
  if (unpushed > 0) {
    return {
      level: 'warn',
      text: `${unpushed} month${unpushed === 1 ? '' : 's'} ingested since your last cloud backup.`
    };
  }
  const age = daysSince(lastPushedAt);
  if (age != null && age >= STALE_BACKUP_DAYS) {
    return { level: 'warn', text: `Last cloud backup was ${age} days ago.` };
  }
  return null;
}

// The third staleness question, and the one nothing in the app asked before
// v2.15: is the DATA itself current? The other two guard the copies (is the
// file backup behind the store, is the cloud copy behind it); this one guards
// the store against the calendar. A household that skips an upload sees every
// figure on every screen quietly age with nothing saying so - the app looks
// exactly as it does when everything is up to date.
//
// Kept a sibling of the two above rather than folded into them, for the same
// reason they are siblings of each other: different failure, different fix
// (upload this month's files, not export or push what is already here).
//
// A month can only be uploaded once it has ended, so being one month behind
// the current one is the normal, healthy state - that is simply the month in
// progress. Two or more behind means a completed month was never brought in.
//
// Dates are read LOCALLY (getFullYear/getMonth, never toISOString), the same
// discipline as data/forecast.js: in UTC+8 the UTC date names the previous
// day for the whole local morning, and on the 1st of a month that is the
// previous MONTH.
const STALE_MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const monthIndexOf = (yyyymm) => {
  const [y, m] = yyyymm.slice(0, 7).split('-').map(Number);
  return y * 12 + (m - 1);
};

const monthNameOf = (index) =>
  `${STALE_MONTH_NAMES[((index % 12) + 12) % 12]} ${Math.floor(index / 12)}`;

export function ingestStaleness({ lastMonth, today = new Date() }) {
  if (!lastMonth || !/^\d{4}-\d{2}/.test(lastMonth)) return null;
  const lastIdx = monthIndexOf(lastMonth);
  const nowIdx = today.getFullYear() * 12 + today.getMonth();
  const behind = nowIdx - lastIdx;
  if (behind < 2) return null;

  const missingCount = behind - 1;
  const firstMissing = monthNameOf(lastIdx + 1);
  return {
    level: 'warn',
    missingCount,
    firstMissingMonth: firstMissing,
    lastMonthName: monthNameOf(lastIdx),
    text: missingCount === 1
      ? `${firstMissing} has not been uploaded yet — every figure here still ends at ${monthNameOf(lastIdx)}.`
      : `${missingCount} months have not been uploaded yet, starting with ${firstMissing}.`
  };
}
