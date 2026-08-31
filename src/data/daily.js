// daily.js - helpers over the optional top-level `dailySeries[]` (one row per
// day, see app-schema_v1.md and redesign_v2.md).
//
// Two rules govern everything here:
//   1. `dailySeries` is OPTIONAL. Pre-v2 backups have none, and a month
//      ingested before v2 has no rows. Every function must return null (or an
//      empty result) rather than throw, so the UI degrades to the monthly
//      figures instead of breaking.
//   2. `monthlyDigests` remains the single source of truth for MONEY. Nothing
//      in this file computes a dollar figure - it is energy only.
//
// Null convention throughout: a missing reading is null and is skipped, never
// summed as 0.

const round = (n, dp = 2) =>
  n == null ? null : Math.round((n + Number.EPSILON) * 10 ** dp) / 10 ** dp;

// Null-preserving sum over a key: all-null in -> null out.
const sumKey = (rows, key) =>
  rows.reduce((acc, r) => (r[key] == null ? acc : (acc ?? 0) + r[key]), null);

export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export function dailyForMonth(dailySeries, month) {
  if (!Array.isArray(dailySeries) || !month) return [];
  return dailySeries.filter((r) => r.date && r.date.slice(0, 7) === month);
}

// Replace every row for `month` with `incoming`, leaving other months alone,
// and return a fresh chronologically-sorted array. Used on ingest: re-running
// a month must not leave half of the old month's rows behind.
export function mergeDailySeries(existing, incoming, month) {
  const kept = (Array.isArray(existing) ? existing : []).filter(
    (r) => r.date && r.date.slice(0, 7) !== month
  );
  return [...kept, ...(incoming ?? [])].sort((a, b) => a.date.localeCompare(b.date));
}

// A day's total EV charging across the three home sources.
export function evDayTotal(row) {
  const parts = [row.evPvKwh, row.evBatteryKwh, row.evGridKwh].filter((v) => v != null);
  return parts.length ? round(parts.reduce((a, b) => a + b, 0), 3) : null;
}

// Month-to-date, from the daily rows alone. `daysCovered` is the count of
// rows we actually have - NOT the calendar day - so a file that stops on the
// 24th reports 24, and a mid-month gap does not silently inflate the pace.
export function monthToDate(dailySeries, month) {
  const rows = dailyForMonth(dailySeries, month);
  if (!rows.length) return null;
  const evRows = rows.map(evDayTotal).filter((v) => v != null);
  return {
    month,
    daysCovered: rows.length,
    daysInMonth: daysInMonth(month),
    lastDate: rows[rows.length - 1].date,
    solarKwh: round(sumKey(rows, 'solarKwh')),
    consumptionKwh: round(sumKey(rows, 'consumptionKwh')),
    gridImportKwh: round(sumKey(rows, 'gridImportKwh')),
    gridExportKwh: round(sumKey(rows, 'gridExportKwh')),
    evKwh: evRows.length ? round(evRows.reduce((a, b) => a + b, 0)) : null
  };
}

// Straight-line projection to month end from the days actually covered.
// Deliberately simple and labelled as a pace in the UI, not a forecast.
export function paceToMonthEnd(mtd) {
  if (!mtd || mtd.solarKwh == null || !mtd.daysCovered) return null;
  return round((mtd.solarKwh / mtd.daysCovered) * mtd.daysInMonth);
}

// What this calendar month has typically produced, from the MONTHLY digests
// (not the daily rows) - so it works from the first month of daily data.
// Only whole months of a DIFFERENT year count: comparing August against
// itself is not a comparison, and a partial month would drag the mean down.
export function typicalForMonth(digests, month) {
  if (!Array.isArray(digests) || !month) return null;
  const mm = month.slice(5, 7);
  const vals = digests
    .filter(
      (d) =>
        d.month.slice(5, 7) === mm &&
        d.month !== month &&
        !d.partialMonth &&
        d.solarProductionKwh != null
    )
    .map((d) => d.solarProductionKwh);
  if (!vals.length) return null;
  return { kwh: round(vals.reduce((a, b) => a + b, 0) / vals.length), years: vals.length };
}

export function bestDay(rows) {
  const withSolar = rows.filter((r) => r.solarKwh != null);
  if (!withSolar.length) return null;
  return withSolar.reduce((a, b) => (b.solarKwh > a.solarKwh ? b : a));
}

// Days in the range where production was effectively zero. Mirrors
// parseFronius.js:countZeroProductionDays' 0.01 kWh threshold.
export function zeroDays(rows) {
  return rows.filter((r) => r.solarKwh != null && r.solarKwh < 0.01).length;
}

const HISTORY_DAYS_REQUIRED = 365;
const WINDOW_DAYS = 6;
const NEARBY_DAYS = 7; // +/- window when matching the same time of year
const MIN_SAMPLES = 6;
const BELOW_PCT = 15;

function dayOfYear(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000);
}

// Is recent production running below what this time of year normally gives?
//
// Returns null - meaning "don't show an alert" - unless there is at least a
// full year of daily history AND enough same-time-of-year samples to compare
// against. This gate is the point: a "seasonal band" computed from six months
// of data is not a band, and inventing one would be exactly the kind of guess
// dressed up as a number this app avoids elsewhere (see PlanComparison's
// scope note). Better to show the raw numbers with no verdict.
export function seasonalCheck(dailySeries) {
  if (!Array.isArray(dailySeries) || dailySeries.length < HISTORY_DAYS_REQUIRED) return null;
  const rows = dailySeries.filter((r) => r.solarKwh != null);
  if (rows.length < HISTORY_DAYS_REQUIRED) return null;

  const spanDays =
    (Date.parse(rows[rows.length - 1].date) - Date.parse(rows[0].date)) / 86400000;
  if (spanDays < HISTORY_DAYS_REQUIRED) return null;

  const recent = rows.slice(-WINDOW_DAYS);
  if (recent.length < WINDOW_DAYS) return null;
  const recentDates = new Set(recent.map((r) => r.date));
  const recentYear = recent[0].date.slice(0, 4);

  // Comparable history: same time of year, any EARLIER year.
  const samples = [];
  for (const r of recent) {
    const doy = dayOfYear(r.date);
    for (const h of rows) {
      if (recentDates.has(h.date) || h.date.slice(0, 4) >= recentYear) continue;
      let delta = Math.abs(dayOfYear(h.date) - doy);
      if (delta > 182) delta = 365 - delta; // wrap around the new year
      if (delta <= NEARBY_DAYS) samples.push(h.solarKwh);
    }
  }
  if (samples.length < MIN_SAMPLES) return null;

  const actual = recent.reduce((a, r) => a + r.solarKwh, 0) / recent.length;
  const expected = samples.reduce((a, b) => a + b, 0) / samples.length;
  if (!(expected > 0)) return null;
  const pct = round(((actual - expected) / expected) * 100, 0);

  return {
    days: recent.length,
    actualPerDay: round(actual, 1),
    expectedPerDay: round(expected, 1),
    pct,
    samples: samples.length,
    below: pct <= -BELOW_PCT
  };
}
