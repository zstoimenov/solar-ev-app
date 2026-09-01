// compare.js - one month against the two months a household actually
// compares it to: the month before it, and the same month a year earlier.
//
// The second one is the point. Month-on-month movement in a Perth household
// is mostly the seasons - August beating July says nothing about the system
// - so a bare "up 22% on last month" invites the wrong conclusion. The same
// month a year earlier removes the season from the comparison and leaves
// the part that is actually about the hardware and the household.
//
// This module DERIVES NOTHING. It looks up two values already stored on
// monthlyDigests[] and reports the difference between them, so it cannot
// move a financial figure and works for any digest field - energy or money.

// "2026-01" shifted by -1 is "2025-12". Plain month arithmetic, no Date
// object, so nothing can drift by a timezone.
export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

// Returns null when the month itself has no value for that field - "no
// reading" is not "zero", and there is nothing honest to compare.
export function monthComparison(digests, month, key) {
  if (!month || !Array.isArray(digests)) return null;
  const find = (m) => digests.find((d) => d.month === m) ?? null;
  const self = find(month);
  if (!self || self[key] == null) return null;
  const value = self[key];

  const against = (m) => {
    const row = find(m);
    if (!row || row[key] == null) return null;
    const ref = row[key];
    return {
      month: m,
      value: ref,
      deltaAbs: value - ref,
      // A percentage change from zero is not infinite, it is meaningless -
      // callers fall back to the absolute difference when this is null.
      deltaPct: ref === 0 ? null : ((value - ref) / Math.abs(ref)) * 100,
      partial: row.partialMonth === true
    };
  };

  return {
    month,
    value,
    partial: self.partialMonth === true,
    daysInPeriod: self.daysInPeriod ?? null,
    prev: against(shiftMonth(month, -1)),
    lastYear: against(shiftMonth(month, -12))
  };
}
