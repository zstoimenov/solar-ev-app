// RoiLayers - the three ROI layers, clearly separated (no double-counting).
//  Layer 1: solar + battery (grid cost avoided + export credit) - accrued.
//  Layer 2: EV vs Kia Cerato counterfactual - HEADLINE = accrued cumulative;
//           the annual scope figure is shown only as a labelled sub-metric.
//  Layer 3: novated lease vs private loan advantage (Jul-2026 re-audit) -
//           FIXED $/yr constant, never recomputed from energy data.
// Combined household benefit is shown as a breakdown, not a single blended number.

import React from 'react';
import InfoPopover from '../InfoPopover.jsx';
import { layer3AnnualAud } from '../../data/compute.js';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function money(n) {
  return n == null ? '—' : `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatMonth(m) {
  if (!m) return '—';
  const [y, mo] = m.split('-').map(Number);
  return `${MONTH_NAMES[mo - 1]} ${y}`;
}

export default function RoiLayers({ state }) {
  const c = state.cumulativeTotals;
  const cfg = state.config;
  const layer1 = c.financial.layer1SavingAud;
  const layer2Accrued = c.financial.layer2SavingAud; // canonical headline
  const layer2AnnualScope = cfg.counterfactual.layer2ScopeTotalAudPerYr;
  const layer3Annual = layer3AnnualAud(cfg);
  const combined12 = c.financial.combinedLayer12SavingAud;
  const first = formatMonth(c.coverage.firstMonth);
  const last = formatMonth(c.coverage.lastMonth);
  const totalMonths = c.coverage.totalMonths;
  const period = `${first} – ${last}`;

  return (
    <>
      <p className="small nowrap">Running totals covering <strong className="nowrap">{period}</strong></p>
      <p className="small nowrap">{totalMonths} month{totalMonths === 1 ? '' : 's'} of data</p>
      <div className="grid cols-3">
        <div className="metric">
          <div className="label">Layer 1 — Solar + Battery</div>
          <div className="value green">{money(layer1)}</div>
          <div className="sub">Total for <span className="nowrap">{period}</span></div>
          <InfoPopover label="What Layer 1 means" className="metric-info">
            Money saved because your solar panels and battery cover most of
            your home's own electricity use instead of buying it all from the
            grid, plus credit for any excess exported back to the grid.
          </InfoPopover>
        </div>
        <div className="metric">
          <div className="label">Layer 2 — EV vs Cerato</div>
          <div className="value green">{money(layer2Accrued)}</div>
          <div className="sub">Total for <span className="nowrap">{period}</span></div>
          <InfoPopover label="What Layer 2 means" className="metric-info">
            Money saved by driving an EV instead of the old petrol car — fuel +
            servicing you'd have paid for the petrol car, minus what it
            actually costs to charge the EV: paid public charging, plus home
            charging (the grid-sourced share at the import rate, and the
            solar/battery share at the feed-in credit it displaced — that
            energy would otherwise have been exported). (For reference, a
            full year of that fuel+servicing budget is
            {' '}{money(layer2AnnualScope)}; the number above is the real
            running total for {period}, not a projection.)
          </InfoPopover>
        </div>
        <div className="metric">
          <div className="label">Layer 3 — Lease vs loan</div>
          <div className="value blue nowrap">{money(layer3Annual)}/yr</div>
          <div className="sub">Fixed yearly amount, every year</div>
          <InfoPopover label="What Layer 3 means" className="metric-info">
            The after-tax advantage of financing the EV through the novated
            lease instead of a private car loan at 7%. Paying the lease and
            running costs from pre-tax salary (32% marginal rate) plus GST
            credits outweighs the lease&apos;s higher effective finance rate
            (12.82% effective p.a. vs the stated 9.39%) — worth about $16,374
            over the 5-year term. This is a fixed yearly figure set by the
            lease terms, not something that changes with energy usage.
          </InfoPopover>
        </div>
      </div>

      <h3 style={{ marginTop: '1rem' }}>
        Combined household benefit for <span className="nowrap">{period}</span> (breakdown, not blended)
        <InfoPopover label="How these layers relate" className="section-info">
          Layers are kept separate to avoid double-counting: 1 &amp; 2 are
          running totals from energy data; 3 is a fixed annual figure from
          the lease-vs-loan comparison and is not summed into the accrued
          total.
        </InfoPopover>
      </h3>
      <div className="table-scroll">
        <table className="digest">
          <tbody>
            <tr><td>Layer 1 (this period)</td><td>{money(layer1)}</td></tr>
            <tr><td>Layer 2 (this period)</td><td>{money(layer2Accrued)}</td></tr>
            <tr><td><strong>Layers 1+2 total</strong></td><td><strong>{money(combined12)}</strong></td></tr>
            <tr><td>Layer 3 (fixed, per year)</td><td>{money(layer3Annual)}/yr</td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
