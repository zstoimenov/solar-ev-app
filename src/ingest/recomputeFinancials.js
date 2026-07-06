// recomputeFinancials.js - re-derives the tariff/charging-log-DEPENDENT
// fields of an ALREADY-STORED digest using the CURRENT tariff schedule and
// charging log, without needing the original raw Fronius/Wattpilot files -
// everything needed (gridImportFroniusKwh, totalConsumptionKwh,
// gridExportKwh, daysInPeriod, evFromPvKwh/evFromBatteryKwh/
// evFromHomeGridKwh) is already sitting on the stored digest.
//
// Ingest itself stays forward-only (see CLAUDE.md "Tariff schedule + public
// charging log") - this is the explicit, opt-in way to bring EXISTING months
// in line after editing the import tariff schedule or the charging log,
// triggered by RecomputeFinancialsButton.jsx. Never called automatically.

import { resolveScheduleEntry, sumChargingLogForMonth } from '../data/tariffSchedule.js';

const round = (n, dp = 2) =>
  n == null ? null : Math.round((n + Number.EPSILON) * 10 ** dp) / 10 ** dp;

export function recomputeDigestFinancials(digest, config, chargingLog) {
  const tariffs = config.tariffs;
  const importEntry = resolveScheduleEntry(config.tariffSchedule?.import, digest.month);
  const usageRate = (importEntry ? importEntry.priceCentsPerKwh : tariffs.usageRateCPerKwh) / 100;
  const supplyChargeAudPerDay = (importEntry?.supplyChargeCPerDay ?? 0) / 100;
  const debsPeak = tariffs.debsPeakCPerKwh / 100;
  const days = digest.daysInPeriod;

  const supplyChargeAud = round(supplyChargeAudPerDay * days, 2);
  const actualGridCostAud = digest.gridImportFroniusKwh != null
    ? round(digest.gridImportFroniusKwh * usageRate + supplyChargeAud, 2)
    : null;
  const baselineGridCostAud = digest.totalConsumptionKwh != null
    ? round(digest.totalConsumptionKwh * usageRate + supplyChargeAud, 2)
    : null;
  const gridCostAvoidedAud = actualGridCostAud != null && baselineGridCostAud != null
    ? round(baselineGridCostAud - actualGridCostAud, 2)
    : null;
  const exportCreditAud = digest.gridExportKwh != null ? round(digest.gridExportKwh * debsPeak, 2) : null;
  const layer1SavingAud = gridCostAvoidedAud != null && exportCreditAud != null
    ? round(gridCostAvoidedAud + exportCreditAud, 2)
    : null;

  const cf = config.counterfactual;
  const ceratoCounterfactualAud = round((cf.layer2ScopeTotalAudPerYr / 365) * days, 2);
  // A month with no charging-log entries isn't "zero paid public charging" -
  // it's a month the log doesn't cover yet (e.g. it predates the log, or
  // simply had none logged). Fall back to whatever the digest already had
  // instead of zeroing it out, or a real ingest predating the log feature
  // gets its manually-entered figure silently erased on recompute.
  const publicCharging = sumChargingLogForMonth(chargingLog, digest.month);
  const evPublicTripKwh = publicCharging.energyKwh ?? digest.evPublicTripKwh ?? 0;
  const evElectricityCostAud = publicCharging.costAud ?? digest.evElectricityCostAud ?? 0;
  // Home charging cost (grid portion at the import rate, PV/battery portion
  // at the foregone feed-in rate) - mirrors buildDigest.js exactly; the
  // per-source kWh are already stored on the digest.
  const evHomeChargingCostAud = round(
    (digest.evFromHomeGridKwh ?? 0) * usageRate +
    ((digest.evFromPvKwh ?? 0) + (digest.evFromBatteryKwh ?? 0)) * debsPeak,
    2
  );
  const layer2SavingAud = round(
    ceratoCounterfactualAud - evElectricityCostAud - evHomeChargingCostAud, 2
  );

  const combinedSavingAud = layer1SavingAud != null && layer2SavingAud != null
    ? round(layer1SavingAud + layer2SavingAud, 2)
    : null;

  return {
    ...digest,
    evPublicTripKwh,
    evElectricityCostAud: round(evElectricityCostAud),
    evHomeChargingCostAud,
    actualGridCostAud,
    baselineGridCostAud,
    gridCostAvoidedAud,
    exportCreditAud,
    ceratoCounterfactualAud,
    layer1SavingAud,
    layer2SavingAud,
    combinedSavingAud
  };
}
