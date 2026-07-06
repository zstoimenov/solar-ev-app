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

// "12/06/2026", "12.06.2026 00:30" or "2026-06-12..." -> "2026-06", or null
// if the value doesn't look like a date. AU exports are day-first.
function monthOfDateValue(v) {
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}`;
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}`;
  return null;
}

// Returns { gridImportSynergyKwh, billedRows, unbilledRows, outOfMonthRows, pending }
// gridImportSynergyKwh is null when there are zero billed rows (pending),
// preserving the null convention (distinguishable from a real zero).
// `month` (YYYY-MM, optional) scopes the sum to rows dated in the ingest
// month - a Synergy download often spans several months, and summing them
// all would falsely fail cross-validation against one month of Fronius
// import. Rows outside the month are counted (outOfMonthRows) so the ingest
// preview can surface that they were ignored. Rows with no parseable date
// (or a file with no date column) are kept - fail-open to the old behavior.
export function parseSynergy(text, month = null) {
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  const fields = parsed.meta.fields ?? [];

  const statusField = findField(fields, 'billing', 'status') || findField(fields, 'status');
  const usageField =
    findField(fields, 'usage') ||
    findField(fields, 'kwh') ||
    findField(fields, 'consumption') ||
    findField(fields, 'quantity');
  const dateField = findField(fields, 'date');

  let billed = 0;
  let billedRows = 0;
  let unbilledRows = 0;
  let outOfMonthRows = 0;

  for (const row of parsed.data) {
    if (month && dateField) {
      const rowMonth = monthOfDateValue(row[dateField]);
      if (rowMonth && rowMonth !== month) {
        outOfMonthRows += 1;
        continue;
      }
    }
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
    outOfMonthRows,
    pending
  };
}
