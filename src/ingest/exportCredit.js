// exportCredit.js - what this month's exported energy earned.
//
// ONE implementation, imported by both ingest paths (buildDigest.js on a
// fresh ingest, recomputeFinancials.js on the opt-in recompute of a stored
// month). They must never drift: the same month must produce the same credit
// whichever route computed it.
//
// Two ways to price a month, and which one is used is recorded on the digest
// rather than inferred:
//
//   'measured-split' - the household has a two-rate feed-in schedule
//     (config.tariffSchedule.export) AND the month has a half-hourly profile
//     from its Synergy interval file. The profile says what share of the
//     exported energy actually left inside the peak window, so each share is
//     paid at its own rate. Until interval data existed this was impossible:
//     Fronius reports only a monthly export total, and splitting it would
//     have needed an assumed peak share - the kind of guess-dressed-up-as-a-
//     number this app refuses. The share is now measured, so it is used.
//
//   'single-rate' - no export schedule, or no profile for the month. Falls
//     back to the previous behaviour exactly (the whole export total at
//     config.tariffs.debsPeakCPerKwh), so months without interval data keep
//     the figure they already had.
//
// The SHARE comes from the meter profile; the QUANTITY credited stays
// `gridExportKwh` (Fronius). That is deliberate: the two totals differ
// slightly, and swapping which one is credited would move Layer 1 for a
// reason that has nothing to do with the time-of-day split this change is
// about. Only the rate applied is new.

import { resolveScheduleEntry } from '../data/tariffSchedule.js';
import { exportShareInWindow } from '../data/intervals.js';

const round = (n, dp = 2) =>
  n == null ? null : Math.round((n + Number.EPSILON) * 10 ** dp) / 10 ** dp;

export function exportCreditForMonth({ month, gridExportKwh, intervalProfile, config }) {
  if (gridExportKwh == null) {
    return { exportCreditAud: null, exportCreditBasis: null, exportPeakSharePct: null };
  }

  const entry = resolveScheduleEntry(config?.tariffSchedule?.export, month);
  const share =
    entry?.peakFrom && entry?.peakTo && intervalProfile?.exportKwh
      ? exportShareInWindow(intervalProfile, entry.peakFrom, entry.peakTo)
      : null;

  if (share && entry.peakPriceCentsPerKwh != null && entry.offPeakPriceCentsPerKwh != null) {
    const peakKwh = gridExportKwh * (share.insidePct / 100);
    const offPeakKwh = gridExportKwh - peakKwh;
    return {
      exportCreditAud: round(
        peakKwh * (entry.peakPriceCentsPerKwh / 100) +
        offPeakKwh * (entry.offPeakPriceCentsPerKwh / 100),
        2
      ),
      exportCreditBasis: 'measured-split',
      exportPeakSharePct: round(share.insidePct, 1)
    };
  }

  const debsPeak = (config?.tariffs?.debsPeakCPerKwh ?? 0) / 100;
  return {
    exportCreditAud: round(gridExportKwh * debsPeak, 2),
    exportCreditBasis: 'single-rate',
    exportPeakSharePct: null
  };
}
