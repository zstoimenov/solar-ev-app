// db.js - the ONLY persistence layer. One IndexedDB database `roi-app`,
// one object store `state` holding a single record (key STATE_KEY) that is
// the full schema-v1 object. Per the brief, no localStorage/sessionStorage
// is used for app data - including the "last exported count" guard input.

import { openDB } from 'idb';
import { SCHEMA_VERSION, validate, migrate, SchemaError } from './schema.js';

const DB_NAME = 'roi-app';
const DB_VERSION = 1;
const STORE = 'state';
const STATE_KEY = 'current';
const META_KEY = 'appMeta'; // holds { lastExportedCount } - guard input

let _dbp = null;
function db() {
  if (!_dbp) {
    _dbp = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      }
    });
  }
  return _dbp;
}

export async function getState() {
  return (await db()).get(STORE, STATE_KEY) ?? null;
}

export async function putState(obj) {
  validate(obj);
  await (await db()).put(STORE, obj, STATE_KEY);
  return obj;
}

export async function hasState() {
  return (await getState()) != null;
}

// --- Export guard bookkeeping (persisted in IndexedDB, not localStorage) ---
export async function getAppMeta() {
  return (await (await db()).get(STORE, META_KEY)) ?? { lastExportedCount: null };
}

export async function setLastExportedCount(count) {
  const meta = await getAppMeta();
  meta.lastExportedCount = count;
  await (await db()).put(STORE, meta, META_KEY);
  return meta;
}

// Validate + forward-migrate a parsed backup object, then replace the store.
// Throws SchemaError on any problem WITHOUT touching the existing store
// (no partial load).
export async function importState(parsed) {
  validate(parsed);
  let obj = parsed;
  if (parsed.schemaVersion < SCHEMA_VERSION) {
    obj = validate(migrate(parsed, parsed.schemaVersion, SCHEMA_VERSION));
  }
  await putState(obj);
  return obj;
}

// Wipe the store back to the same empty shell the public bundle ships with,
// and clear the export-guard bookkeeping. Used by the Backup tab's "Delete
// all data" button - irreversible except via a separate backup.
export async function resetState() {
  const empty = {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      exportedAt: new Date().toISOString(),
      appVersion: 'reset',
      monthCount: 0,
      dateRange: { first: null, last: null },
      sourceNote: 'Cleared via the Backup tab "Delete all data" button.'
    },
    config: {},
    monthlyDigests: [],
    cumulativeTotals: {},
    chargingLog: []
  };
  await putState(empty);
  await (await db()).delete(STORE, META_KEY);
  return empty;
}

// Parse a JSON string into an object, surfacing a clean SchemaError on
// malformed JSON so callers can show one consistent message.
export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SchemaError('Rejected: the pasted text is not valid JSON.');
  }
  return parsed;
}

export { SchemaError };
