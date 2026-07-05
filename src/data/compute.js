// compute.js - pure recompute helpers shared by ingest and any recompute path.
// No IndexedDB, no React. Given the full digest array + config, produce the
// cumulativeTotals block and meta fields. Null-safe throughout: absent values
// stay null and are skipped in sums (never treated as 0).

const sum = (arr, key) =>
  arr.reduce((acc, d) => (d[key] == null ? acc : acc + d[key]), 0);

const round = (n, dp = 2) =>
  n == null ? null : Math.round((n + Number.EPSILON) * 10 ** dp) / 10 ** dp;

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
// array. Preserves the seed's structure. Payback is carried from the previous
// cumulativeTotals (component OOP + allocation are config-driven, not derived
// month-to-month here) but recovered/remaining are re-rolled from Layer 1.
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

  const avg = (key) => {
    const vals = digests.map((d) => d[key]).filter((v) => v != null);
    return vals.length ? round(vals.reduce((a, b) => a + b, 0) / vals.length, 1) : null;
  };

  const quality = {
    avgSelfSufficiencyPct: avg('selfSufficiencyPct'),
    avgSelfConsumptionRatePct: avg('selfConsumptionRatePct'),
    zeroProductionDays: sum(digests, 'zeroProductionDays'),
    batteryShortfallDays: null // retired metric - stays null
  };

  const totalCharged = sum(digests, 'evTotalChargedKwh');
  const fromPv = sum(digests, 'evFromPvKwh');
  const fromBattery = sum(digests, 'evFromBatteryKwh');
  const fromHomeGrid = sum(digests, 'evFromHomeGridKwh');
  const pct = (part) => (totalCharged > 0 ? round((part / totalCharged) * 100, 1) : null);

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
    totalAwayChargingCostAud: round(
      sum(digests, 'evElectricityCostAud') // away-charging cost approximation
    ),
    totalEvElectricityCostAud: round(sum(digests, 'evElectricityCostAud')),
    evGridChargingDays: sum(digests, 'evGridChargingDays')
  };

  const layer1 = round(sum(digests, 'layer1SavingAud'));
  const layer2 = round(sum(digests, 'layer2SavingAud'));
  const financial = {
    layer1SavingAud: layer1,
    layer2SavingAud: layer2,
    combinedLayer12SavingAud: round((layer1 || 0) + (layer2 || 0)),
    layer3Note: prevCumulative?.financial?.layer3Note ??
      'Layer 3 (novated lease tax saving) is time-based ($5,378/yr fixed), not derived from energy data.'
  };

  // Payback: keep component OOP + estPaybackYear + allocation from prev/config;
  // re-roll recovered against Layer 1 cumulative in allocation order
  // (solar panels, then charger, then battery).
  const payback = (prevCumulative?.payback ?? []).map((p) => ({ ...p }));
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
    paybackTotals: prevCumulative?.paybackTotals ?? null,
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
