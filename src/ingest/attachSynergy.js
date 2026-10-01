// attachSynergy.js - add a Synergy file to a month that is ALREADY stored.
//
// Fronius and Wattpilot publish on the 1st; Synergy's interval download
// lags by a few days. The upload page has always let a month be built with
// the Synergy slot empty (cross-check 'Pending', single-rate export credit),
// but bringing the file in afterwards meant re-uploading all three files -
// and re-typing the manual fields, which a full re-ingest does not carry
// over. This touches ONLY what the Synergy file decides:
//
//   - gridImportSynergyKwh and the cross-check against Fronius
//   - intervalProfile (kept from the stored digest if this file has none,
//     same fallback as buildDigest.js)
//   - the Synergy/cross-val sentences in `flags`
//   - exportCreditAud and what depends on it (Layer 1, combined), because a
//     profile is what lets the export be split into peak/off-peak
//
// Everything else - the Fronius/Wattpilot figures, grid cost, Layer 2, the
// manual fields, the daily rows - is left exactly as stored. It deliberately
// does NOT run recomputeDigestFinancials(): that re-prices the whole month
// against today's import schedule and charging log, which is the separate,
// explicit Recompute Financials action and must stay so (forward-only rule).
//
// Same month, same config -> same digest as a fresh three-file ingest: the
// export credit goes through the one shared exportCreditForMonth(), and the
// cross-check through the one shared crossValFlag().

import { crossValFlag } from '../data/compute.js';
import { exportCreditForMonth } from './exportCredit.js';

const round = (n, dp = 2) =>
  n == null ? null : Math.round((n + Number.EPSILON) * 10 ** dp) / 10 ** dp;

// The sentences buildDigest.js writes from the Synergy side. Stripped before
// the new ones are appended, so attaching twice cannot stack them.
const SYNERGY_FLAG_PATTERNS = [
  /Cross-val breach \([^)]*\)\.\s*/g,
  /Synergy cross-validation pending\.\s*/g,
  /Synergy file had \d+ row\(s\) outside \S+ \(ignored\)\.\s*/g
];

export function attachSynergyToDigest(digest, synergy, config) {
  if (synergy.pending) {
    throw new Error(`This Synergy file has no readings for ${digest.month}. ` +
      'Check it was downloaded after the month ended.');
  }

  const intervalProfile = synergy.intervalProfile ?? digest.intervalProfile ?? null;

  const cv = crossValFlag(digest.gridImportFroniusKwh, synergy.gridImportSynergyKwh);
  const crossValImport = cv && cv.breach ? 'Fail' : 'Pass';

  let kept = digest.flags ?? '';
  for (const re of SYNERGY_FLAG_PATTERNS) kept = kept.replace(re, '');
  const flagsParts = kept.trim() ? [kept.trim()] : [];
  if (cv && cv.breach) flagsParts.push(`Cross-val breach (${cv.pct}% / ${cv.absDiff} kWh).`);
  if (synergy.outOfMonthRows > 0) {
    flagsParts.push(`Synergy file had ${synergy.outOfMonthRows} row(s) outside ${digest.month} (ignored).`);
  }

  const { exportCreditAud, exportCreditBasis, exportPeakSharePct } = exportCreditForMonth({
    month: digest.month,
    gridExportKwh: digest.gridExportKwh,
    intervalProfile,
    config
  });
  const layer1SavingAud = digest.gridCostAvoidedAud != null && exportCreditAud != null
    ? round(digest.gridCostAvoidedAud + exportCreditAud, 2)
    : null;
  const combinedSavingAud = layer1SavingAud != null && digest.layer2SavingAud != null
    ? round(layer1SavingAud + digest.layer2SavingAud, 2)
    : null;

  return {
    ...digest,
    gridImportSynergyKwh: synergy.gridImportSynergyKwh,
    intervalProfile,
    crossValImport,
    flags: flagsParts.length ? flagsParts.join(' ') : null,
    exportCreditAud,
    exportCreditBasis,
    exportPeakSharePct,
    layer1SavingAud,
    combinedSavingAud
  };
}

// The fields that can differ, in the order the preview lists them.
export const SYNERGY_CHANGED_FIELDS = [
  'gridImportSynergyKwh', 'crossValImport', 'intervalProfile', 'exportCreditBasis',
  'exportPeakSharePct', 'exportCreditAud', 'layer1SavingAud', 'combinedSavingAud', 'flags'
];
