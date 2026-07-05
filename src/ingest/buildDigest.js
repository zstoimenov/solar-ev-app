// buildDigest.js - merge parsed inputs (Fronius + Wattpilot + Synergy) plus the
// manual away-charging entry into ONE 33-field monthlyDigests object, computing
// the per-month financial layers from config. Then callers recompute cumulative
// totals from the full array (see data/compute.js).

import { crossValFlag } from '../data/compute.js';
import { resolveScheduleEntry, sumChargingLogForMonth, financialYearLabel } from '../data/tariffSchedule.js';

const round = (n, dp = 2) =>
  n == null ? null : Math.round((n + Number.EPSILON) * 10 ** dp) / 10 ** dp;

function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

// Build one digest. `parsed` = { fronius, wattpilot, synergy }.
// `manual` = { month, daysInPeriod?, partialMonth?, evWorkChargingKwh, notes? }
// `chargingLog` = the household's paid-public-charging log (see
// data/tariffSchedule.js) - replaces the old manual "paid public kWh" entry;
// free/workplace charging is still a manual field since it has no cost.
export function buildDigest(parsed, manual, config, chargingLog = []) {
  const { fronius, wattpilot, synergy } = parsed;
  const month = manual.month;
  const days = manual.daysInPeriod ?? daysInMonth(month);
  const fullDays = daysInMonth(month);

  const tariffs = config.tariffs;
  // config.tariffSchedule.import - a dated history of buy-price changes -
  // takes over from the static config rate once at least one entry is
  // on/before this month (see data/tariffSchedule.js: no mid-month blending,
  // whatever rate was active on the 1st applies to the whole month).
  const importEntry = resolveScheduleEntry(config.tariffSchedule?.import, month);
  const usageRate = (importEntry ? importEntry.priceCentsPerKwh : tariffs.usageRateCPerKwh) / 100; // AUD/kWh
  // Daily supply charge - only tracked via the schedule (the old static
  // config.tariffs never had one), so it's 0 for months resolved from the
  // static fallback above. Applied equally to actual + baseline below, so it
  // does NOT change gridCostAvoidedAud/layer1SavingAud (you'd pay the same
  // connection fee with or without solar) - it only makes the two absolute
  // cost figures match a real bill instead of usage-only.
  const supplyChargeAudPerDay = (importEntry?.supplyChargeCPerDay ?? 0) / 100;
  // Feed-in (export) schedule is stored (config.tariffSchedule.export) but not
  // yet auto-applied here - Fronius only gives a monthly export total, not an
  // hour-by-hour split, so there's no reliable way to apply its two time-of-day
  // rates without an assumed peak-share guess. Keeps using the blended rate.
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
  const supplyChargeAud = round(supplyChargeAudPerDay * days, 2);
  const actualGridCostAud =
    fronius.gridImportFroniusKwh != null
      ? round(fronius.gridImportFroniusKwh * usageRate + supplyChargeAud, 2)
      : null;
  const baselineGridCostAud = cons != null ? round(cons * usageRate + supplyChargeAud, 2) : null;
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
  // Paid public charging - date-stamped log entries for this month, summed
  // (see data/tariffSchedule.js). Free/workplace charging stays a manual
  // field below since it has no cost to subtract here.
  const publicCharging = sumChargingLogForMonth(chargingLog, month);
  const evElectricityCostAud = publicCharging.costAud ?? 0;
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
    financialYear: financialYearLabel(month),
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
    zeroProductionDays: fronius.zeroProductionDays ?? null,

    evTotalChargedKwh: round(wattpilot.evTotalChargedKwh),
    evFromPvKwh: round(wattpilot.evFromPvKwh),
    evFromBatteryKwh: round(wattpilot.evFromBatteryKwh),
    evFromHomeGridKwh: round(wattpilot.evFromHomeGridKwh),
    evWorkChargingKwh: manual.evWorkChargingKwh ?? 0,
    evPublicTripKwh: publicCharging.energyKwh ?? 0,
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
