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
