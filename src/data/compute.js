// compute.js - pure recompute helpers shared by ingest and any recompute path.
// No IndexedDB, no React. Given the full digest array + config, produce the
// cumulativeTotals block and meta fields. Null-safe throughout: absent values
// stay null and are skipped in sums (never treated as 0).

// Null-preserving: a column with NO values at all sums to null (no data
// yet), not 0 - months with values are summed and nulls skipped.
const sum = (arr, key) =>
  arr.reduce((acc, d) => (d[key] == null ? acc : (acc ?? 0) + d[key]), null);

// The fixed Layer 3 (novated lease tax saving) annual figure. Read from
// config.lease.taxSavingAudPerYr when the backup carries it; the constant
// fallback matches the household's current lease terms for older backups.
const DEFAULT_LAYER3_ANNUAL_AUD = 5378;
export function layer3AnnualAud(config) {
  return config?.lease?.taxSavingAudPerYr ?? DEFAULT_LAYER3_ANNUAL_AUD;
}

const round = (n, dp = 2) =>
  n == null ? null : Math.round((n + Number.EPSILON) * 10 ** dp) / 10 ** dp;

// "YYYY-MM" (or "YYYY-MM-DD", only the first 7 chars are read) -> a single
// monotonic integer, for month-count arithmetic (e.g. "2023-03" -> 24278).
const monthIndex = (yyyymm) => {
  const [y, m] = yyyymm.slice(0, 7).split('-').map(Number);
  return y * 12 + (m - 1);
};
const monthFromIndex = (idx) => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;

// Cross-validation flag rule (brief §5): flag a month only when the Fronius
// vs Synergy grid-import divergence is >5% AND >2 kWh absolute. If Synergy is
// pending (null), the month cannot be cross-validated -> not flagged here.
export function crossValFlag(fronius, synergy) {
  if (fronius == null || synergy == null) return null;
  const absDiff = Math.abs(fronius - synergy);
  const base = Math.max(Math.abs(fronius), 1e-9);
  const pct = (absDiff / base) * 100;
  const breach = pct > 5 && absDiff > 2;
  return { pct: round(pct, 1), absDiff: round(absDiff), breach };
}

// Recompute the cumulativeTotals object from the full chronological digest
// array. Preserves the seed's structure. Payback component OOP + allocation
// order are carried from the previous cumulativeTotals (config-driven), and
// recovered/remaining/estPaybackYear are re-rolled from cumulative Layer 1.
// NOTE: callers building a date-FILTERED view (App.jsx) must take payback
// from a full-history recompute, not this filtered one - payback progress
// is an all-time concept.
export function recomputeCumulative(digests, prevCumulative, config) {
  const months = digests.length;
  const first = months ? digests[0].month : null;
  const last = months ? digests[months - 1].month : null;

  const gridImportSynergyMonths = digests.filter((d) => d.gridImportSynergyKwh != null).length;

  const energy = {
    solarProductionKwh: round(sum(digests, 'solarProductionKwh')),
    totalConsumptionKwh: round(sum(digests, 'totalConsumptionKwh')),
    ownConsumptionKwh: round(sum(digests, 'ownConsumptionKwh')),
    gridExportKwh: round(sum(digests, 'gridExportKwh')),
    gridImportFroniusKwh: round(sum(digests, 'gridImportFroniusKwh')),
    gridImportSynergyKwh: round(sum(digests, 'gridImportSynergyKwh')),
    gridImportSynergyNote: `${gridImportSynergyMonths} of ${months} months`
  };

  // Energy-weighted, not a mean of the monthly percentages - a mean would
  // count a 5-day partial month the same as a full 31-day one. Only months
  // where both sides are known contribute (null convention).
  const weightedPct = (numKey, denKey) => {
    let num = 0;
    let den = 0;
    for (const d of digests) {
      if (d[numKey] == null || d[denKey] == null) continue;
      num += d[numKey];
      den += d[denKey];
    }
    return den > 0 ? round((num / den) * 100, 1) : null;
  };

  const quality = {
    avgSelfSufficiencyPct: weightedPct('ownConsumptionKwh', 'totalConsumptionKwh'),
    avgSelfConsumptionRatePct: weightedPct('ownConsumptionKwh', 'solarProductionKwh'),
    zeroProductionDays: sum(digests, 'zeroProductionDays'),
    batteryShortfallDays: null // retired metric - stays null
  };

  const totalCharged = sum(digests, 'evTotalChargedKwh');
  const fromPv = sum(digests, 'evFromPvKwh');
  const fromBattery = sum(digests, 'evFromBatteryKwh');
  const fromHomeGrid = sum(digests, 'evFromHomeGridKwh');
  const pct = (part) =>
    totalCharged > 0 && part != null ? round((part / totalCharged) * 100, 1) : null;

  // Paid public/trip charging vs home charging are different costs: "away"
  // is real money handed to a charging network; "home" is the grid portion
  // paid on the bill + the export credit forgone on the PV/battery portion
  // (evHomeChargingCostAud - optional, absent on pre-v1.10 digests).
  const awayCost = sum(digests, 'evElectricityCostAud');
  const homeCost = sum(digests, 'evHomeChargingCostAud');
  const ev = {
    totalChargedKwh: round(totalCharged),
    fromPvKwh: round(fromPv),
    fromPvPct: pct(fromPv),
    fromBatteryKwh: round(fromBattery),
    fromBatteryPct: pct(fromBattery),
    fromHomeGridKwh: round(fromHomeGrid),
    fromHomeGridPct: pct(fromHomeGrid),
    workChargingKwh: round(sum(digests, 'evWorkChargingKwh')),
    publicTripKwh: round(sum(digests, 'evPublicTripKwh')),
    totalAwayChargingCostAud: round(awayCost),
    totalEvElectricityCostAud:
      awayCost == null && homeCost == null ? null : round((awayCost ?? 0) + (homeCost ?? 0)),
    evGridChargingDays: sum(digests, 'evGridChargingDays')
  };

  const layer1 = round(sum(digests, 'layer1SavingAud'));
  const layer2 = round(sum(digests, 'layer2SavingAud'));
  const financial = {
    layer1SavingAud: layer1,
    layer2SavingAud: layer2,
    combinedLayer12SavingAud:
      layer1 == null && layer2 == null ? null : round((layer1 ?? 0) + (layer2 ?? 0)),
    layer3Note: prevCumulative?.financial?.layer3Note ??
      `Layer 3 (novated lease tax saving) is time-based ($${layer3AnnualAud(config).toLocaleString('en-AU')}/yr fixed), not derived from energy data.`
  };

  // Payback: component OOP + allocation order come from the stored/seed
  // payback block (config-driven, in allocation order: solar panels, then
  // charger, then battery). Recovered/remaining are re-rolled from the
  // cumulative Layer 1 saving, filling each component in order and clamping
  // at its OOP. estPaybackYear is re-projected from the average Layer 1
  // run-rate over the months that have data.
  const monthsWithLayer1 = digests.filter((d) => d.layer1SavingAud != null).length;
  const layer1Total = Math.max(0, layer1 ?? 0);
  const avgLayer1PerMonth = monthsWithLayer1 > 0 ? layer1Total / monthsWithLayer1 : null;
  const projectYear = (thresholdAud) => {
    if (!avgLayer1PerMonth || avgLayer1PerMonth <= 0 || !last) return null;
    const monthsToGo = Math.ceil((thresholdAud - layer1Total) / avgLayer1PerMonth);
    const [ly, lm] = last.split('-').map(Number);
    return Math.floor((ly * 12 + (lm - 1) + monthsToGo) / 12);
  };

  // Pre-tracking estimate: config.paybackPreTracking.installDate lets a
  // household backdate payback to a hardware install date that predates ALL
  // smart-meter data (no Fronius/Wattpilot history exists for that gap - it
  // isn't a matter of ingesting more months, the data was never captured).
  // Per explicit product decision this gap is filled with an EXTRAPOLATED
  // estimate (a tracked-period average monthly saving x gap months), not
  // left at zero. Only applied to Payback Progress, never blended into Layer
  // 1 / ROI Layers (those stay real-data-only), and self-corrects to null
  // once ingested data covers the gap.
  //
  // basis (config.paybackPreTracking.basis, default 'solar-only'):
  //  - 'solar-only': strip the battery time-shift + EV load out of Layer 1,
  //    so backdating a SOLAR-only install period isn't inflated by hardware
  //    that didn't exist yet. Each solar kWh currently earning the import
  //    rate because it was battery-shifted or fed the EV would, in a
  //    solar-only world, have been EXPORTED instead - so we remove
  //    (evFromPv + batteryDischarge) x (importRate - FiT) from Layer 1. The
  //    legitimate part (solar directly powering daytime base load) is kept
  //    from real data, not estimated. batteryDischarge isn't measured
  //    directly (no whole-house throughput field exists), so it's derived
  //    from the energy balance on CUMULATIVE totals (noise averages out):
  //    (Sigma solar - Sigma export - Sigma ownConsumption) is the battery
  //    round-trip loss, so discharge ~= that x eff/(1-eff). Assumptions:
  //    round-trip efficiency (default 0.9) + representative tariff rates.
  //  - 'layer1': use the raw tracked-period average Layer 1 (solar+battery,
  //    EV load in the baseline) - overstates a solar-only gap.
  const preTrackingCfg = config?.paybackPreTracking;
  const basis = preTrackingCfg?.basis ?? 'solar-only';
  const tariffs = config?.tariffs;
  const importRate = tariffs?.usageRateCPerKwh != null ? tariffs.usageRateCPerKwh / 100 : null;
  const fitRate = tariffs?.debsPeakCPerKwh != null ? tariffs.debsPeakCPerKwh / 100 : null;
  const eff = preTrackingCfg?.batteryRoundTripEfficiency ?? 0.9;

  // Solar-only breakdown (only meaningful when we have tariff rates to value
  // kWh with). batteryDischargeKwh + the two stripped $ amounts are surfaced
  // for transparency in the UI.
  let batteryDischargeKwhEst = null;
  let evAdjustmentAud = null;
  let batteryAdjustmentAud = null;
  let solarOnlyAvgMonthly = null;
  if (importRate != null && fitRate != null && importRate > fitRate && monthsWithLayer1 > 0) {
    const roundTripLossKwh = Math.max(0, (energy.solarProductionKwh ?? 0) - (energy.gridExportKwh ?? 0) - (energy.ownConsumptionKwh ?? 0));
    batteryDischargeKwhEst = eff < 1 ? round(roundTripLossKwh * (eff / (1 - eff))) : 0;
    const strippedKwh = (fromPv ?? 0) + batteryDischargeKwhEst; // EV-direct solar + battery-shifted energy
    evAdjustmentAud = round((fromPv ?? 0) * (importRate - fitRate));
    batteryAdjustmentAud = round(batteryDischargeKwhEst * (importRate - fitRate));
    const solarOnlyTotal = Math.max(0, layer1Total - strippedKwh * (importRate - fitRate));
    solarOnlyAvgMonthly = solarOnlyTotal / monthsWithLayer1;
  }

  // The monthly rate the estimate extrapolates from: solar-only when asked
  // for and computable, else the raw Layer 1 average (with a note recording
  // which was used and why, if a solar-only request had to fall back).
  const canSolarOnly = solarOnlyAvgMonthly != null;
  const useSolarOnly = basis === 'solar-only' && canSolarOnly;
  const rateUsed = useSolarOnly ? solarOnlyAvgMonthly : avgLayer1PerMonth;

  let preTrackingEstimateAud = 0;
  let paybackPreTracking = null;
  if (preTrackingCfg?.installDate && first && rateUsed != null) {
    const installIdx = monthIndex(preTrackingCfg.installDate);
    const gapMonths = monthIndex(first) - installIdx;
    if (gapMonths > 0) {
      preTrackingEstimateAud = round(rateUsed * gapMonths, 2);
      paybackPreTracking = {
        installDate: preTrackingCfg.installDate,
        fromMonth: monthFromIndex(installIdx),
        toMonth: monthFromIndex(monthIndex(first) - 1),
        gapMonths,
        basis: useSolarOnly ? 'solar-only' : 'layer1',
        avgMonthlyRateUsedAud: round(rateUsed, 2),
        avgMonthlyLayer1Aud: round(avgLayer1PerMonth ?? 0, 2),
        batteryDischargeKwhEst,
        batteryRoundTripEfficiency: useSolarOnly ? eff : null,
        evAdjustmentAud: useSolarOnly ? evAdjustmentAud : null,
        batteryAdjustmentAud: useSolarOnly ? batteryAdjustmentAud : null,
        estimatedAud: preTrackingEstimateAud,
        method: useSolarOnly
          ? 'solar-only (battery time-shift + EV load stripped from tracked Layer 1)'
          : (basis === 'solar-only'
              ? 'tracked Layer 1 average (solar-only requested but tariff rates unavailable to strip)'
              : 'tracked Layer 1 average (solar + battery)')
      };
    }
  }

  // Pre-tracking dollars are chronologically the earliest, so they're
  // consumed from each component's OOP before tracked-period dollars -
  // same cascade order (solar -> charger -> battery) as the tracked pool.
  // recoveredPreTrackingAud is tracked separately per component so the UI
  // can show the estimate as its own line rather than blending it silently
  // into "recovered".
  let preTrackingPool = preTrackingEstimateAud;
  let trackedPool = layer1Total;
  let cumOopAud = 0;
  const payback = (prevCumulative?.payback ?? []).map((p) => {
    const oop = p.oopAud ?? 0;
    const fromPreTracking = round(Math.min(oop, Math.max(0, preTrackingPool)), 2);
    preTrackingPool -= fromPreTracking;
    const fromTracked = round(Math.min(oop - fromPreTracking, Math.max(0, trackedPool)), 2);
    trackedPool -= fromTracked;
    const recovered = round(fromPreTracking + fromTracked, 2);
    cumOopAud += oop;
    const remaining = round(oop - recovered, 2);
    const estPaybackYear =
      remaining <= 0 ? 'Paid off' : projectYear(cumOopAud) ?? p.estPaybackYear ?? null;
    return {
      ...p,
      recoveredAud: recovered,
      recoveredPreTrackingAud: fromPreTracking || null,
      remainingAud: remaining,
      estPaybackYear
    };
  });
  const paybackTotals = payback.length
    ? {
        oopAud: round(payback.reduce((a, p) => a + (p.oopAud ?? 0), 0)),
        recoveredAud: round(payback.reduce((a, p) => a + (p.recoveredAud ?? 0), 0)),
        recoveredPreTrackingAud: round(payback.reduce((a, p) => a + (p.recoveredPreTrackingAud ?? 0), 0)) || null,
        remainingAud: round(payback.reduce((a, p) => a + (p.remainingAud ?? 0), 0)),
        allocationOrder: prevCumulative?.paybackTotals?.allocationOrder ??
          payback.map((p) => p.component).join(' → ')
      }
    : prevCumulative?.paybackTotals ?? null;
  const crossValFlags = digests
    .filter((d) => {
      const cv = crossValFlag(d.gridImportFroniusKwh, d.gridImportSynergyKwh);
      return cv && cv.breach;
    })
    .map((d) => d.month);

  return {
    lastUpdated: last,
    coverage: {
      firstMonth: first,
      lastMonth: last,
      totalMonths: months,
      note: prevCumulative?.coverage?.note ?? null
    },
    energy,
    quality,
    ev,
    financial,
    payback,
    paybackTotals,
    paybackPreTracking,
    crossValFlags,
    crossValNote:
      prevCumulative?.crossValNote ??
      'Flag only when divergence >5% AND absolute diff >2 kWh.'
  };
}

// Rebuild meta.monthCount / dateRange from digests (guard inputs).
export function recomputeMeta(prevMeta, digests, appVersion) {
  return {
    ...prevMeta,
    exportedAt: prevMeta.exportedAt, // set fresh only at export time
    appVersion: appVersion ?? prevMeta.appVersion,
    monthCount: digests.length,
    dateRange: {
      first: digests.length ? digests[0].month : null,
      last: digests.length ? digests[digests.length - 1].month : null
    }
  };
}
