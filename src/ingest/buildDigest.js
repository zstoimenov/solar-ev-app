// buildDigest.js - merge parsed inputs (Fronius + Wattpilot + Synergy) plus the
// manual away-charging entry into ONE 33-field monthlyDigests object, computing
// the per-month financial layers from config. Then callers recompute cumulative
// totals from the full array (see data/compute.js).

import { crossValFlag } from '../data/compute.js';
import { resolveScheduleEntry, sumChargingLogForMonth, financialYearLabel } from '../data/tariffSchedule.js';
import { exportCreditForMonth } from './exportCredit.js';

const round = (n, dp = 2) =>
  n == null ? null : Math.round((n + Number.EPSILON) * 10 ** dp) / 10 ** dp;

// Build the month's dailySeries[] rows by joining the two parsers' per-day
// output on date. Both files are one row per day; either may be missing a
// given date, so this is an outer join and every field stays independently
// nullable (null = no reading, never a confirmed zero).
//
// Purely energy - no financial field is derived here. Rows outside `month`
// are dropped: a stray row cannot quietly write into a neighbouring month.
export function buildDailySeries(parsed, month) {
  const byDate = new Map();
  const take = (rows, assign) => {
    for (const r of rows ?? []) {
      if (!r.date || r.date.slice(0, 7) !== month) continue;
      const row = byDate.get(r.date) ?? { date: r.date };
      assign(row, r);
      byDate.set(r.date, row);
    }
  };
  take(parsed.fronius?.daily, (row, r) => {
    row.solarKwh = r.solarKwh;
    row.consumptionKwh = r.consumptionKwh;
    row.gridImportKwh = r.gridImportKwh;
    row.gridExportKwh = r.gridExportKwh;
  });
  take(parsed.wattpilot?.daily, (row, r) => {
    row.evPvKwh = r.evPvKwh;
    row.evBatteryKwh = r.evBatteryKwh;
    row.evGridKwh = r.evGridKwh;
  });
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

// Build one digest. `parsed` = { fronius, wattpilot, synergy }.
// `manual` = { month, daysInPeriod?, partialMonth?, evWorkChargingKwh, notes? }
// `chargingLog` = the household's paid-public-charging log (see
// data/tariffSchedule.js) - replaces the old manual "paid public kWh" entry;
// free/workplace charging is still a manual field since it has no cost.
// `prevDigest` = the existing digest when overwriting an already-ingested
// month - used only as the public-charging fallback (see below).
export function buildDigest(parsed, manual, config, chargingLog = [], prevDigest = null) {
  const { fronius, wattpilot, synergy } = parsed;
  const month = manual.month;
  const fullDays = daysInMonth(month);
  // Days actually covered: the Fronius file's daily row count, capped at the
  // calendar month - a mid-month export must pro-rate the counterfactual and
  // the supply charge by the days it covers, not the whole month.
  const days = manual.daysInPeriod ?? Math.min(fronius.days || fullDays, fullDays);

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
  // The foregone-export rate used by Layer 2's home-charging cost below.
  // Deliberately still the single DEBS rate even when the export credit is
  // priced on a measured split (see exportCredit.js): what an EV's PV/battery
  // kWh would have earned depends on the time of day it was charged, which
  // the Wattpilot data does not say. Changing it here would move Layer 2 on
  // an assumption, which is the thing this app does not do.
  const debsPeak = tariffs.debsPeakCPerKwh / 100;

  // The month's half-hourly profile, when its Synergy file carried 30-minute
  // rows (or an earlier ingest of this month captured one).
  const intervalProfile = synergy.intervalProfile ?? prevDigest?.intervalProfile ?? null;

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
  // Two-rate feed-in applied on the month's MEASURED peak share when there
  // is one, otherwise the previous single-rate behaviour, unchanged.
  const { exportCreditAud, exportCreditBasis, exportPeakSharePct } = exportCreditForMonth({
    month,
    gridExportKwh: fronius.gridExportKwh,
    intervalProfile,
    config
  });
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
  // field below since it has no cost to subtract here. When OVERWRITING an
  // existing month and the log has nothing for it, keep the digest's stored
  // figures (may be a real manually-entered value predating the log feature)
  // - same fallback rule as recomputeFinancials.js, don't change to ?? 0.
  const publicCharging = sumChargingLogForMonth(chargingLog, month);
  const evPublicTripKwh = publicCharging.energyKwh ?? prevDigest?.evPublicTripKwh ?? 0;
  const evElectricityCostAud = publicCharging.costAud ?? prevDigest?.evElectricityCostAud ?? 0;
  // Home charging is NOT free to the EV: the grid-sourced portion is paid at
  // the import rate, and the PV/battery-sourced portion forgoes the export
  // credit it would otherwise have earned (FiT). Without this, Layer 1
  // (which already credits solar for covering the EV's load) plus Layer 2
  // would overstate the combined saving by the EV's home energy.
  const evHomeChargingCostAud = round(
    (wattpilot.evFromHomeGridKwh ?? 0) * usageRate +
    ((wattpilot.evFromPvKwh ?? 0) + (wattpilot.evFromBatteryKwh ?? 0)) * debsPeak,
    2
  );
  const layer2SavingAud = round(
    ceratoCounterfactualAud - evElectricityCostAud - evHomeChargingCostAud, 2
  );

  const combinedSavingAud =
    layer1SavingAud != null && layer2SavingAud != null
      ? round(layer1SavingAud + layer2SavingAud, 2)
      : null;

  // Cross-validation Fronius vs Synergy grid import. There is no export
  // cross-check source (Synergy's file only covers billed import), so
  // crossValExport is honestly 'n/a' - never a fake 'Pass'.
  const cv = crossValFlag(fronius.gridImportFroniusKwh, synergy.gridImportSynergyKwh);
  const crossValImport = synergy.pending ? 'Pending' : cv && cv.breach ? 'Fail' : 'Pass';
  const crossValExport = 'n/a';

  const flagsParts = [];
  if ((manual.partialMonth ?? days < fullDays)) flagsParts.push(`Partial month (${days}d).`);
  if (cv && cv.breach) flagsParts.push(`Cross-val breach (${cv.pct}% / ${cv.absDiff} kWh).`);
  if (synergy.pending) flagsParts.push('Synergy cross-validation pending.');
  if (synergy.outOfMonthRows > 0) {
    flagsParts.push(`Synergy file had ${synergy.outOfMonthRows} row(s) outside ${month} (ignored).`);
  }

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
    // Optional (not in DIGEST_FIELDS): the month's half-hourly shape, when
    // the Synergy download carried 30-minute rows. Re-ingesting a month from
    // a DAILY-granularity file must not erase a profile captured earlier -
    // same trap as the charging-log fallback below, so the previous digest's
    // profile is kept rather than overwritten with null.
    intervalProfile,
    selfSufficiencyPct,
    selfConsumptionRatePct,
    zeroProductionDays: fronius.zeroProductionDays ?? null,

    evTotalChargedKwh: round(wattpilot.evTotalChargedKwh),
    evFromPvKwh: round(wattpilot.evFromPvKwh),
    evFromBatteryKwh: round(wattpilot.evFromBatteryKwh),
    evFromHomeGridKwh: round(wattpilot.evFromHomeGridKwh),
    evWorkChargingKwh: manual.evWorkChargingKwh ?? 0,
    evPublicTripKwh,
    evGridChargingDays: wattpilot.evGridChargingDays ?? null,
    evElectricityCostAud: round(evElectricityCostAud),
    // Optional (not in DIGEST_FIELDS, so older backups still validate):
    // what the EV's home charging cost this month - see Layer 2 above.
    evHomeChargingCostAud,

    actualGridCostAud,
    baselineGridCostAud,
    gridCostAvoidedAud,
    exportCreditAud,
    // Optional (not in DIGEST_FIELDS): how the credit above was priced, so a
    // reader can tell a measured split from the single-rate fallback rather
    // than having to infer it.
    exportCreditBasis,
    exportPeakSharePct,
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
