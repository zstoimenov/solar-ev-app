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
const META_KEY = 'appMeta'; // holds { lastExportedCount, lastExportedAt } - guard input
// Weather forecast + historical-radiation cache. Deliberately a SEPARATE
// record from the app state: it is disposable third-party data that can be
// re-fetched at any time, so it must never enter the schema, the backup
// file, or validate(). Losing it costs one HTTP request.
const WEATHER_KEY = 'weatherCache';
// Forecast accuracy log: what the panel projected, so it can later be scored
// against what the roof actually produced. Like the weather cache, it lives
// OUTSIDE `state` - it is the app checking its own homework, not household
// data, and it must never enter validate() or the backup file. Losing it
// costs the measured error bars until a few weeks of days rebuild them.
const FORECAST_LOG_KEY = 'forecastLog';

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
// Spread over the defaults rather than returning the stored record directly,
// so a record written before `lastExportedAt` existed reads back as null
// (per the app's null convention) instead of undefined.
export async function getAppMeta() {
  const stored = await (await db()).get(STORE, META_KEY);
  return { lastExportedCount: null, lastExportedAt: null, ...(stored ?? {}) };
}

// Stamps both the month count (input to the anti-truncation guard) and the
// time of the export (input to the stale-backup warning). Called only on a
// completed export - never on a restore, which would falsely mark the store
// as backed up.
export async function recordExport(count) {
  const meta = await getAppMeta();
  meta.lastExportedCount = count;
  meta.lastExportedAt = new Date().toISOString();
  await (await db()).put(STORE, meta, META_KEY);
  return meta;
}

// --- Weather cache (never part of the backup) ------------------------------
// Read/written by data/forecast.js. Kept out of `state` on purpose: the
// backup file is the household's own record, and nothing in it should be a
// copy of someone else's API response.
export async function getWeatherCache() {
  return (await (await db()).get(STORE, WEATHER_KEY)) ?? null;
}

export async function putWeatherCache(cache) {
  await (await db()).put(STORE, cache, WEATHER_KEY);
  return cache;
}

// --- Forecast accuracy log (never part of the backup) ----------------------
// Read/written by data/forecast.js via data/forecastAccuracy.js.
export async function getForecastLog() {
  return (await (await db()).get(STORE, FORECAST_LOG_KEY)) ?? null;
}

export async function putForecastLog(log) {
  await (await db()).put(STORE, log, FORECAST_LOG_KEY);
  return log;
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
// and clear the export-guard bookkeeping. Used by the Data screen's "Delete
// all data" button - irreversible except via a separate backup.
export async function resetState() {
  const empty = {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      exportedAt: new Date().toISOString(),
      appVersion: 'reset',
      monthCount: 0,
      dateRange: { first: null, last: null },
      sourceNote: 'Cleared via the Data screen "Delete all data" button.'
    },
    config: {},
    monthlyDigests: [],
    cumulativeTotals: {},
    chargingLog: [],
    evChargingSessions: [],
    dailySeries: []
  };
  await putState(empty);
  await (await db()).delete(STORE, META_KEY);
  // The accuracy log is scored against dailySeries; with the store wiped it
  // would score against nothing and report a phantom history.
  await (await db()).delete(STORE, FORECAST_LOG_KEY);
  return empty;
}

// Parse a JSON string into an object, surfacing a clean SchemaError on
// malformed JSON so callers can show one consistent message.
export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SchemaError('Rejected: that file is not valid JSON.');
  }
  return parsed;
}

export { SchemaError };
