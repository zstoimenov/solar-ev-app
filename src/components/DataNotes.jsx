// DataNotes - surfaces the known data caveats so they read as context, not errors:
//  (a) blended FiT provisional (blendedFiTConfirmed:false)
//  (b) Layer 2 scope labels (config annual vs ROI headline vs accrued)
//  (c) Synergy-pending months
//  (d) Jul-2026 service step-change ($330 -> ~$500/yr)

import React from 'react';

export default function DataNotes({ state }) {
  const { config, monthlyDigests } = state;
  const fitProvisional = config?.tariffs?.blendedFiTConfirmed === false;
  const pendingMonths = monthlyDigests
    .filter((d) => d.gridImportSynergyKwh == null || d.crossValImport === 'Pending')
    .map((d) => d.month);

  const cf = config?.counterfactual;

  return (
    <>
      <ul className="notes-list">
        {fitProvisional && (
          <li>
            <strong>Blended FiT is estimated</strong>
            <span className="provisional">provisional</span> — currently{' '}
            {config.tariffs.blendedFiTPostBatteryCPerKwh}c/kWh post-battery.
            Validate against the next quarterly Synergy bill (open item&nbsp;#4).
          </li>
        )}
        <li>
          <strong>Layer 2 figures differ by scope, not error.</strong> Config
          annual scope {money(cf?.layer2ScopeTotalAudPerYr)}/yr · dashboard
          headline uses <em>accrued cumulative</em> · the annual figure is shown
          only as a labelled sub-metric.
        </li>
        {pendingMonths.length > 0 && (
          <li>
            <strong>Synergy import pending</strong> for{' '}
            {pendingMonths.join(', ')} — cross-validation deferred until the
            billed interval data arrives. Rendered as gaps, not zeros.
          </li>
        )}
        {cf && (
          <li>
            <strong>Servicing step-change from Jul&nbsp;2026:</strong>{' '}
            {money(cf.serviceToJun2026AudPerYr)}/yr →{' '}
            {money(cf.serviceFromJul2026AudPerYr)}/yr (Kia 7-yr capped plan
            expired Jun&nbsp;2026). Applied on future ingests.
          </li>
        )}
      </ul>
    </>
  );
}

function money(n) {
  return n == null ? '—' : `$${Number(n).toLocaleString('en-AU')}`;
}
