// parseSynergy.js - Synergy MA_IntervalDataHistory.csv -> billed grid import,
// plus (when the file has them) a compact time-of-day profile.
//
// ONE parser, TWO shapes of the same export. Synergy's download has at times
// been one row per day and at times one row per 30 minutes, and the columns
// are named differently again ("ANYTIME (KWH)", "Solar export (Units)"). The
// parser therefore detects what it was given rather than being told:
//
//   * Always: billed grid import for the month. Rule (match source skill
//     exactly): filter to Billing Status == 'Billed' before summing. Keep
//     unbilled rows OUT of the total but report their presence so the month
//     can be flagged "pending" rather than a real zero.
//   * When a Time column exists: a 48-bucket half-hourly profile of import
//     and (if present) export. If the interval file ever goes away again,
//     this simply comes back null and everything else still works.
//
// THE RAW ROWS ARE NEVER STORED. A month of 30-minute data is 1,440 rows;
// putting that in the store would bloat every backup file, which is the
// failure the file-only backup change just fixed. Instead the rows are
// folded here into 96 numbers (48 buckets x import/export) - about 15x
// smaller than the CSV and enough to price any tariff whose bands fall on a
// half hour, which every Synergy band does. Same principle as the digest
// itself: aggregate at ingest, keep the summary, discard the input.
//
// Buckets are labelled by their START, confirmed against the real file: a
// row stamped 07:30 covers 07:30-08:00. Getting this backwards would shift
// every tariff band by half an hour.

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

// The time column needs its own finder: a plain 'time' keyword also matches
// "ANYTIME (KWH)", which is the USAGE column. That mix-up would silently
// bucket every reading into 00:00, so an exact match wins and anything
// carrying a unit is rejected outright.
function findTimeField(fields) {
  const exact = fields.find((f) => norm(f) === 'time');
  if (exact) return exact;
  return (
    fields.find((f) => {
      const lf = norm(f);
      return lf.includes('time') && !lf.includes('kwh') && !lf.includes('unit') && !lf.includes('anytime');
    }) ?? null
  );
}

export const BUCKETS_PER_DAY = 48; // 30-minute buckets, index 0 = 00:00-00:30

// "07:30" -> 15. Also tolerates "7:30", "07:30:00" and a full timestamp.
// Returns null for anything that is not a recognisable time of day, so a
// daily-granularity file falls through to the no-profile path.
export function bucketIndex(value) {
  const m = /(\d{1,2}):(\d{2})/.exec(String(value ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 2 + (min >= 30 ? 1 : 0);
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
  const timeField = findTimeField(fields);
  const exportField = findField(fields, 'export');

  let billed = 0;
  let billedRows = 0;
  let unbilledRows = 0;
  let outOfMonthRows = 0;

  // The profile is built from EVERY in-month row, billed or not, because it
  // answers a different question from the total: the total feeds
  // cross-validation against Fronius and must match what Synergy has
  // actually billed, while the profile is the shape of the month and is
  // more useful complete. `includesUnbilled` records the difference so
  // nothing downstream mistakes one for the other.
  const importKwh = timeField ? new Array(BUCKETS_PER_DAY).fill(0) : null;
  const exportKwh = timeField && exportField ? new Array(BUCKETS_PER_DAY).fill(0) : null;
  const profileDates = new Set();
  let profileRows = 0;
  let bucketlessRows = 0;

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

    if (importKwh) {
      const b = bucketIndex(row[timeField]);
      if (b == null) {
        bucketlessRows += 1;
      } else {
        importKwh[b] += kwh;
        if (exportKwh) exportKwh[b] += Number(row[exportField]) || 0;
        if (dateField) profileDates.add(String(row[dateField]).trim());
        profileRows += 1;
      }
    }
  }

  const pending = billedRows === 0;
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  // A file whose Time column never parsed is a daily-granularity export, not
  // a broken one - report no profile rather than 48 zeroes.
  const intervalProfile =
    importKwh && profileRows > 0
      ? {
          source: 'synergy',
          intervalMinutes: 24 * 60 / BUCKETS_PER_DAY,
          days: profileDates.size || null,
          intervals: profileRows,
          includesUnbilled: unbilledRows > 0,
          importKwh: importKwh.map(round2),
          exportKwh: exportKwh ? exportKwh.map(round2) : null
        }
      : null;

  return {
    gridImportSynergyKwh: pending ? null : round2(billed),
    billedRows,
    unbilledRows,
    outOfMonthRows,
    pending,
    // Optional, absent for a daily-granularity file.
    intervalProfile,
    bucketlessRows
  };
}
