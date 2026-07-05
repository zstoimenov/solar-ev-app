// tariffSchedule.js - resolves the applicable rate for a given month from a
// date-ordered schedule of dated entries (see app-schema_v1.md
// "config.tariffSchedule"). A rate change takes effect from the start of the
// month it falls in - this does not blend two rates within one month.
// Also sums the paid-public-charging log for a month (see "chargingLog").

const round = (n, dp = 2) =>
  n == null ? null : Math.round((n + Number.EPSILON) * 10 ** dp) / 10 ** dp;

// Australian financial-year label for a YYYY-MM month (FY runs Jul-Jun), e.g.
// "2026-07" -> "FY2026-27", "2026-06" -> "FY2025-26". Synergy (and most WA
// retailers) reprice on 1 July each year, so tariff plan-years are always FY,
// never calendar years - see Ingest/TariffPlanEditor.jsx.
export function financialYearLabel(month) {
  const [y, m] = month.split('-').map(Number);
  const startYear = m >= 7 ? y : y - 1;
  return `FY${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

// A config.tariffPlans[] row's financial year, with a fallback for entries
// saved before the FY fix (a bare `year` number, whose meaning was
// ambiguous) - read as the FY start year, matching how it was always meant
// to be taken from a rate card like Synergy's ("2025 price" = FY2025-26).
export function financialYearOf(planEntry) {
  if (planEntry.financialYear) return planEntry.financialYear;
  if (planEntry.year != null) return financialYearLabel(`${planEntry.year}-07`);
  return '—';
}

// `schedule` = array of entries each carrying at least `effectiveFrom`
// (YYYY-MM-DD). Returns the entry with the latest effectiveFrom on/before
// the 1st of `month` (YYYY-MM), or null if the schedule is empty/not yet
// in effect - callers should fall back to the old static config rate then.
export function resolveScheduleEntry(schedule, month) {
  if (!schedule || schedule.length === 0) return null;
  const monthStart = `${month}-01`;
  const applicable = schedule
    .filter((e) => e.effectiveFrom <= monthStart)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return applicable.length ? applicable[applicable.length - 1] : null;
}

// Sums this month's paid-public-charging log entries. Returns nulls (not
// zero) when there are no entries this month, preserving the app's null
// convention (no data yet vs. a confirmed zero).
export function sumChargingLogForMonth(log, month) {
  const entries = (log ?? []).filter((e) => e.date && e.date.startsWith(month));
  if (!entries.length) return { energyKwh: null, costAud: null };
  return {
    energyKwh: round(entries.reduce((a, e) => a + (Number(e.energyKwh) || 0), 0)),
    costAud: round(entries.reduce((a, e) => a + (Number(e.totalCostAud) || 0), 0))
  };
}
