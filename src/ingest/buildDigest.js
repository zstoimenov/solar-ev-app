// buildDigest.js - merge parsed inputs (Fronius + Wattpilot + Synergy) plus the
// manual away-charging entry into ONE 37-field monthlyDigests object, computing
// the per-month financial layers from config. Then callers recompute cumulative
// totals from the full array (see data/compute.js).

import { crossValFlag } from '../data/compute.js';

const round = (n, dp = 2) =>
  n == null ? null : Math.round((n + Number.EPSILON) * 10 ** dp) / 10 ** dp;

// Financial-year label for a YYYY-MM (Australian FY: Jul-Jun).
function financialYear(month) {
  const [y, m] = month.split('-').map(Number);
  const startYear = m >= 7 ? y : y - 1;
  return `FY${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

// Build one digest. `parsed` = { fronius, wattpilot, synergy }.
// `manual` = { month, daysInPeriod?, partialMonth?, evWorkChargingKwh,
//              evPublicTripKwh, peakProductionKwh, peakProductionDay,
//              lowestProductionKwh, productionStdDevKwh, zeroProductionDays,
//              notes? }
export function buildDigest(parsed, manual, config) {
  const { fronius, wattpilot, synergy } = parsed;
  const month = manual.month;
  const days = manual.daysInPeriod ?? daysInMonth(month);
  const fullDays = daysInMonth(month);

  const tariffs = config.tariffs;
  const usageRate = tariffs.usageRateCPerKwh / 100; // AUD/kWh
  const debsPeak = tariffs.debsPeakCPerKwh / 100;

  // Self-sufficiency / self-consumption from energy fields (null-safe).
  const cons = fronius.totalConsumptionKwh;
  const own = fronius.ownConsumptionKwh;
  const solar = fronius.solarProductionKwh;
  const selfSufficiencyPct =
    cons && own != null ? round((own / cons) * 100, 1) : null;
  const selfConsumptionRatePct =
    solar && own != null ? round((own / solar) * 100, 1) : null;

  // Layer 1 (solar + battery): grid cost avoided on self-consumed energy +
  // export credit, less actual grid cost paid. Baseline = what the same
  // consumption would have cost fully imported.
  const actualGridCostAud =
    fronius.gridImportFroniusKwh != null
      ? round(fronius.gridImportFroniusKwh * usageRate, 2)
      : null;
  const baselineGridCostAud = cons != null ? round(cons * usageRate, 2) : null;
  const gridCostAvoidedAud =
    baselineGridCostAud != null && actualGridCostAud != null
      ? round(baselineGridCostAud - actualGridCostAud, 2)
      : null;
  const exportCreditAud =
    fronius.gridExportKwh != null ? round(fronius.gridExportKwh * debsPeak, 2) : null;
  const layer1SavingAud =
    gridCostAvoidedAud != null && exportCreditAud != null
      ? round(gridCostAvoidedAud + exportCreditAud, 2)
      : null;

  // Layer 2 (EV vs Kia Cerato counterfactual): monthly slice of the annual
  // counterfactual scope, less the EV electricity cost this month.
  const cf = config.counterfactual;
  // Annual counterfactual scope (fuel + service) pro-rated by day count.
  const ceratoCounterfactualAud = round((cf.layer2ScopeTotalAudPerYr / 365) * days, 2);
  const evElectricityCostAud = wattpilot.evElectricityCostAud ?? manual.evElectricityCostAud ?? 0;
  const layer2SavingAud = round(ceratoCounterfactualAud - evElectricityCostAud, 2);

  const combinedSavingAud =
    layer1SavingAud != null && layer2SavingAud != null
      ? round(layer1SavingAud + layer2SavingAud, 2)
      : null;

  // Cross-validation Fronius vs Synergy grid import.
  const cv = crossValFlag(fronius.gridImportFroniusKwh, synergy.gridImportSynergyKwh);
  const crossValImport = synergy.pending ? 'Pending' : cv && cv.breach ? 'Fail' : 'Pass';
  const crossValExport = synergy.pending ? 'Pending' : 'Pass';

  const flagsParts = [];
  if ((manual.partialMonth ?? days < fullDays)) flagsParts.push(`Partial month (${days}d).`);
  if (cv && cv.breach) flagsParts.push(`Cross-val breach (${cv.pct}% / ${cv.absDiff} kWh).`);
  if (synergy.pending) flagsParts.push('Synergy cross-validation pending.');

  return {
    month,
    financialYear: financialYear(month),
    daysInPeriod: days,
    partialMonth: manual.partialMonth ?? days < fullDays,

    solarProductionKwh: round(solar),
    totalConsumptionKwh: round(cons),
    ownConsumptionKwh: round(own),
    gridExportKwh: round(fronius.gridExportKwh),
    gridImportFroniusKwh: round(fronius.gridImportFroniusKwh),
    gridImportSynergyKwh: synergy.gridImportSynergyKwh,
    selfSufficiencyPct,
    selfConsumptionRatePct,
    zeroProductionDays: manual.zeroProductionDays ?? null,

    peakProductionKwh: manual.peakProductionKwh ?? round(fronius.peakProductionKwh),
    peakProductionDay: manual.peakProductionDay ?? fronius.peakProductionDay ?? null,
    lowestProductionKwh: manual.lowestProductionKwh ?? round(fronius.lowestProductionKwh),
    productionStdDevKwh: manual.productionStdDevKwh ?? round(fronius.productionStdDevKwh),

    evTotalChargedKwh: round(wattpilot.evTotalChargedKwh),
    evFromPvKwh: round(wattpilot.evFromPvKwh),
    evFromBatteryKwh: round(wattpilot.evFromBatteryKwh),
    evFromHomeGridKwh: round(wattpilot.evFromHomeGridKwh),
    evWorkChargingKwh: manual.evWorkChargingKwh ?? 0,
    evPublicTripKwh: manual.evPublicTripKwh ?? 0,
    evGridChargingDays: wattpilot.evGridChargingDays ?? null,
    evElectricityCostAud: round(evElectricityCostAud),

    actualGridCostAud,
    baselineGridCostAud,
    gridCostAvoidedAud,
    exportCreditAud,
    ceratoCounterfactualAud,
    layer1SavingAud,
    layer2SavingAud,
    combinedSavingAud,

    crossValImport,
    crossValExport,
    flags: flagsParts.length ? flagsParts.join(' ') : null,
    notes: manual.notes ?? null
  };
}
