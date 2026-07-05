// schema.js - the schemaVersion contract + validators.
// See app-schema_v1.md for the full contract. This file is the code-side
// guardrail: nothing enters IndexedDB without passing validate().

export const SCHEMA_VERSION = 1;

// The 33 fields every monthlyDigests entry must carry (schema section
// "monthlyDigests[]"). Order is documentation-only; presence is what matters.
export const DIGEST_FIELDS = [
  // identity / period
  'month', 'financialYear', 'daysInPeriod', 'partialMonth',
  // energy
  'solarProductionKwh', 'totalConsumptionKwh', 'ownConsumptionKwh', 'gridExportKwh',
  'gridImportFroniusKwh', 'gridImportSynergyKwh', 'selfSufficiencyPct',
  'selfConsumptionRatePct', 'zeroProductionDays',
  // EV charging
  'evTotalChargedKwh', 'evFromPvKwh', 'evFromBatteryKwh', 'evFromHomeGridKwh',
  'evWorkChargingKwh', 'evPublicTripKwh', 'evGridChargingDays', 'evElectricityCostAud',
  // financial
  'actualGridCostAud', 'baselineGridCostAud', 'gridCostAvoidedAud', 'exportCreditAud',
  'ceratoCounterfactualAud', 'layer1SavingAud', 'layer2SavingAud', 'combinedSavingAud',
  // validation / text
  'crossValImport', 'crossValExport', 'flags', 'notes'
];

const REQUIRED_TOP_LEVEL = ['schemaVersion', 'meta', 'config', 'monthlyDigests', 'cumulativeTotals'];

export class SchemaError extends Error {}

// Coerce a legacy "US$"-prefixed currency string (a Notion export artifact)
// to a plain AUD number. Plain numbers/nulls pass through untouched.
export function coerceCurrency(value) {
  if (value == null || typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/US\$|\$|,|\s/g, '');
    if (cleaned === '') return null;
    const n = Number(cleaned);
    return Number.isNaN(n) ? value : n;
  }
  return value;
}

// Validate an incoming full-store object. Throws SchemaError with a clear,
// user-facing message. Returns the object on success. Does NOT mutate.
export function validate(obj) {
  if (obj == null || typeof obj !== 'object') {
    throw new SchemaError('Not a valid backup: expected a JSON object.');
  }
  if (typeof obj.schemaVersion !== 'number') {
    throw new SchemaError('Rejected: missing "schemaVersion". This does not look like a valid backup.');
  }
  if (obj.schemaVersion > SCHEMA_VERSION) {
    throw new SchemaError(
      `Rejected: backup is schemaVersion ${obj.schemaVersion}, but this app only supports up to ${SCHEMA_VERSION}. ` +
      `Update the app before importing this file. Nothing was loaded.`
    );
  }
  for (const key of REQUIRED_TOP_LEVEL) {
    if (!(key in obj)) throw new SchemaError(`Rejected: backup is missing required key "${key}".`);
  }
  if (!Array.isArray(obj.monthlyDigests)) {
    throw new SchemaError('Rejected: "monthlyDigests" must be an array.');
  }
  // Shape-check each digest for the full field set so historical months
  // render as richly as future ingested ones.
  obj.monthlyDigests.forEach((d, i) => {
    for (const f of DIGEST_FIELDS) {
      if (!(f in d)) {
        throw new SchemaError(`Rejected: monthlyDigests[${i}] (${d.month ?? '?'}) is missing field "${f}".`);
      }
    }
  });
  return obj;
}

// Forward migration hook. Identity for v1; future versions add cases here.
// Never assume the current shape - always migrate the incoming version forward.
export function migrate(obj, from, to) {
  let current = obj;
  let v = from;
  while (v < to) {
    // switch (v) { case 1: current = v1_to_v2(current); break; }
    v += 1;
  }
  current.schemaVersion = to;
  return current;
}
