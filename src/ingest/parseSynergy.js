// parseSynergy.js - Synergy MA_IntervalDataHistory.csv -> billed grid import.
// Rule (match source skill exactly): filter to Billing Status == 'Billed'
// before summing. Keep unbilled rows OUT of the total but report their
// presence so the month can be flagged "pending" rather than a real zero.
// We do NOT ingest 30-min interval detail beyond summing kWh.

import Papa from 'papaparse';

const norm = (s) => (s == null ? '' : String(s).trim().toLowerCase());

// Find a field name in the parsed header by keyword match.
function findField(fields, ...keywords) {
  for (const f of fields) {
    const lf = norm(f);
    if (keywords.every((k) => lf.includes(k))) return f;
  }
  return null;
}

// Returns { gridImportSynergyKwh, billedRows, unbilledRows, pending }
// gridImportSynergyKwh is null when there are zero billed rows (pending),
// preserving the null convention (distinguishable from a real zero).
export function parseSynergy(text) {
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  const fields = parsed.meta.fields ?? [];

  const statusField = findField(fields, 'billing', 'status') || findField(fields, 'status');
  const usageField =
    findField(fields, 'usage') ||
    findField(fields, 'kwh') ||
    findField(fields, 'consumption') ||
    findField(fields, 'quantity');

  let billed = 0;
  let billedRows = 0;
  let unbilledRows = 0;

  for (const row of parsed.data) {
    const status = statusField ? norm(row[statusField]) : 'billed';
    const kwh = usageField ? Number(row[usageField]) || 0 : 0;
    if (status === 'billed') {
      billed += kwh;
      billedRows += 1;
    } else {
      unbilledRows += 1;
    }
  }

  const pending = billedRows === 0;
  return {
    gridImportSynergyKwh: pending ? null : Math.round((billed + Number.EPSILON) * 100) / 100,
    billedRows,
    unbilledRows,
    pending
  };
}
