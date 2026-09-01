// planPricing.js - pricing a tariff plan against measured usage.
//
// This computes dollars, but NOT stored ones: every figure here is a
// hypothetical ("what would this month have cost on a plan you are not on"),
// which is why it lives outside buildDigest.js - that file remains the only
// place a figure written to monthlyDigests[] is produced. Nothing here is
// ever persisted.
//
// The plan-grouping and band-coverage helpers are shared with
// Dashboard/PlanComparison.jsx (the EV-charging-only comparison), so the two
// comparisons can never disagree about what a plan's bands are.

import { financialYearOf } from './tariffSchedule.js';
import { bucketToTime, profileTotals } from './intervals.js';

// Flattens the (planName, financialYear, bandLabel) rows of
// config.tariffPlans back into one object per plan-year, each carrying its
// full band list. Sorted by FY first so each year reads as its own group -
// plans are only ever compared against others in the SAME year, since
// comparing FY2025-26 prices against FY2026-27 ones would just crown the
// older, cheaper vintage.
export function groupPlans(tariffPlans) {
  const map = new Map();
  for (const p of tariffPlans ?? []) {
    const fy = financialYearOf(p);
    const key = `${p.planName}__${fy}`;
    if (!map.has(key)) {
      map.set(key, {
        planName: p.planName,
        financialYear: fy,
        supplyChargeCPerDay: p.supplyChargeCPerDay,
        bands: []
      });
    }
    map.get(key).bands.push({
      label: p.bandLabel, from: p.from, to: p.to, priceCentsPerKwh: p.priceCentsPerKwh
    });
  }
  return [...map.values()].sort(
    (a, b) => a.financialYear.localeCompare(b.financialYear) || a.planName.localeCompare(b.planName)
  );
}

// Total minutes/day a plan's bands cover. 1440 = exactly the full day; less
// means a gap (energy in it silently prices at $0), more means overlapping
// bands double-price it. Either way the plan's estimate is unreliable and
// the UI says so rather than quietly showing a wrong number.
export function bandCoverageMinutes(bands) {
  const mins = (hhmm) => {
    const [h, m] = (hhmm ?? '00:00').split(':').map(Number);
    return h * 60 + m;
  };
  return bands.reduce((total, b) => {
    const from = mins(b.from);
    const toRaw = mins(b.to);
    const to = toRaw <= from ? toRaw + 1440 : toRaw;
    return total + (to - from);
  }, 0);
}

const inWindow = (time, from, to) =>
  from < to ? time >= from && time < to : time >= from || time < to;

// A flat plan is one band with from/to null - it applies all day.
const bandForTime = (bands, time) =>
  bands.find((b) => (b.from == null && b.to == null) || inWindow(time, b.from, b.to)) ?? null;

// Price one month-shaped import profile against one plan.
//
// Unlike the EV-charging-only comparison, this INCLUDES the daily supply
// charge: it is part of a real bill and it differs between plans (Synergy's
// EV Add On carries a higher one), so leaving it out would flatter whichever
// plan buys its cheap daytime rate with a bigger fixed fee.
//
// It excludes the feed-in credit, which is set by the state's DEBS scheme
// rather than by the retail plan - it is the same either way and so cannot
// change the ranking.
export function priceProfileOnPlan(plan, profile, days) {
  if (!profile?.importKwh || !plan?.bands?.length) return null;
  let usageCents = 0;
  let unpricedKwh = 0;
  for (let i = 0; i < profile.importKwh.length; i++) {
    const kwh = profile.importKwh[i] ?? 0;
    if (!kwh) continue;
    const band = bandForTime(plan.bands, bucketToTime(i));
    if (!band || band.priceCentsPerKwh == null) {
      unpricedKwh += kwh;
      continue;
    }
    usageCents += kwh * band.priceCentsPerKwh;
  }
  const supplyAud = ((plan.supplyChargeCPerDay ?? 0) / 100) * (days ?? 0);
  const usageAud = usageCents / 100;
  return {
    planName: plan.planName,
    financialYear: plan.financialYear,
    usageAud,
    supplyAud,
    totalAud: usageAud + supplyAud,
    unpricedKwh,
    coverageMin: bandCoverageMinutes(plan.bands)
  };
}

// Every plan on file, priced against the same profile and sorted cheapest
// first within each financial year. Returns null when there is nothing to
// compare - no profile, or no plans catalogued.
//
// `financialYears` scopes the comparison to the rate cards that were current
// for the months being priced: showing an August-2026 month costed on last
// year's prices as well answers a question nobody asked. When no card exists
// for those years, every year is priced instead and `fyFallback` says so, so
// the reader knows the prices are not the ones that applied.
export function comparePlansOnProfile(tariffPlans, profile, days, { financialYears } = {}) {
  let plans = groupPlans(tariffPlans);
  if (!plans.length || !profile?.importKwh) return null;
  let fyFallback = false;
  if (financialYears?.length) {
    const wanted = plans.filter((p) => financialYears.includes(p.financialYear));
    if (wanted.length) plans = wanted;
    else fyFallback = true;
  }
  const totals = profileTotals(profile);
  if (!(totals.importKwh > 0)) return null;

  const rows = plans
    .map((plan) => priceProfileOnPlan(plan, profile, days))
    .filter(Boolean)
    .sort(
      (a, b) => a.financialYear.localeCompare(b.financialYear) || a.totalAud - b.totalAud
    );

  // "Cheapest" is only meaningful within one price vintage.
  const cheapestByFy = new Map();
  for (const r of rows) {
    const cur = cheapestByFy.get(r.financialYear);
    if (cur == null || r.totalAud < cur.totalAud) cheapestByFy.set(r.financialYear, r);
  }
  const latestFy = rows.length ? rows[rows.length - 1].financialYear : null;
  const latestRows = rows.filter((r) => r.financialYear === latestFy);

  return {
    rows,
    fyFallback,
    cheapestByFy,
    latestFy,
    cheapest: cheapestByFy.get(latestFy) ?? null,
    dearest: latestRows.length ? latestRows[latestRows.length - 1] : null,
    importKwh: totals.importKwh,
    days
  };
}
