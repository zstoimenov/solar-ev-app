// RoiLayers - the three ROI layers, clearly separated (no double-counting).
//  Layer 1: solar + battery (grid cost avoided + export credit) - accrued.
//  Layer 2: EV vs Kia Cerato counterfactual - HEADLINE = accrued cumulative;
//           the annual scope figure is shown only as a labelled sub-metric.
//  Layer 3: novated lease tax saving - FIXED $/yr constant, never recomputed.
// Combined household benefit is shown as a breakdown, not a single blended number.

import React from 'react';

const LAYER3_ANNUAL_AUD = 5378; // fixed, time-based (see brief §5 / seed note)

function money(n) {
  return n == null ? '—' : `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function RoiLayers({ state }) {
  const c = state.cumulativeTotals;
  const cfg = state.config;
  const layer1 = c.financial.layer1SavingAud;
  const layer2Accrued = c.financial.layer2SavingAud; // canonical headline
  const layer2AnnualScope = cfg.counterfactual.layer2ScopeTotalAudPerYr;
  const combined12 = c.financial.combinedLayer12SavingAud;

  return (
    <div className="panel">
      <h2>ROI Layers</h2>
      <div className="grid cols-3">
        <div className="metric">
          <div className="label">Layer 1 — Solar + Battery</div>
          <div className="value green">{money(layer1)}</div>
          <div className="sub">Accrued: grid cost avoided + export credit</div>
        </div>
        <div className="metric">
          <div className="label">Layer 2 — EV vs Cerato</div>
          <div className="value green">{money(layer2Accrued)}</div>
          <div className="sub">
            Accrued (headline). Annual scope: {money(layer2AnnualScope)}/yr — sub-metric only
          </div>
        </div>
        <div className="metric">
          <div className="label">Layer 3 — Lease tax saving</div>
          <div className="value blue">{money(LAYER3_ANNUAL_AUD)}/yr</div>
          <div className="sub">Time-based fixed constant — not derived from energy data</div>
        </div>
      </div>

      <h3 style={{ marginTop: '1rem' }}>Combined household benefit (breakdown, not blended)</h3>
      <table className="digest">
        <tbody>
          <tr><td>Layer 1 (accrued)</td><td>{money(layer1)}</td></tr>
          <tr><td>Layer 2 (accrued)</td><td>{money(layer2Accrued)}</td></tr>
          <tr><td><strong>Layers 1+2 accrued</strong></td><td><strong>{money(combined12)}</strong></td></tr>
          <tr><td>Layer 3 (fixed, per year)</td><td>{money(LAYER3_ANNUAL_AUD)}/yr</td></tr>
        </tbody>
      </table>
      <p className="small">
        Layers are kept separate to avoid double-counting: 1 &amp; 2 are accrued
        from energy data; 3 is a fixed annual tax figure and is not summed into
        the accrued total.
      </p>
    </div>
  );
}
