// PlanComparison - estimated EV-charging-only cost under each cataloged
// tariff plan (config.tariffPlans, see the Ingest tab's Tariff Plans
// sub-tab), for the active date range's uploaded charging sessions.
//
// Scope, spelled out because it's easy to overstate: this compares plans
// using ONLY your EV's charging energy and timing (from the mobile app's
// session log) - it does NOT cover the rest of your household's usage
// (fridge, lights, aircon, etc.), which still has no time-of-day data
// available. It's also a GROSS figure: it assumes every kWh the EV drew was
// billed at grid rates, when in reality some of it came from solar/battery
// (that split isn't known per-session - only as a daily total). Treat this
// as "the most your EV charging could have cost under each plan", not your
// real bill.

import React from 'react';
import InfoPopover from '../InfoPopover.jsx';
import { splitSessionsByBand } from '../../data/evTimeOfUseSplit.js';
import { financialYearOf } from '../../data/tariffSchedule.js';

function money(n) {
  return n == null ? '—' : `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Flattens the (planName, financialYear, bandLabel) rows from
// config.tariffPlans back into one object per plan-year, each carrying its
// full band list.
function groupPlans(tariffPlans) {
  const map = new Map();
  for (const p of tariffPlans ?? []) {
    const fy = financialYearOf(p);
    const key = `${p.planName}__${fy}`;
    if (!map.has(key)) {
      map.set(key, { planName: p.planName, financialYear: fy, supplyChargeCPerDay: p.supplyChargeCPerDay, bands: [] });
    }
    map.get(key).bands.push({ label: p.bandLabel, from: p.from, to: p.to, priceCentsPerKwh: p.priceCentsPerKwh });
  }
  return [...map.values()].sort((a, b) => a.planName.localeCompare(b.planName) || a.financialYear.localeCompare(b.financialYear));
}

export default function PlanComparison({ state }) {
  const plans = groupPlans(state.config.tariffPlans);
  const sessions = state.evChargingSessions ?? [];
  const totalSessionKwh = sessions.reduce((a, s) => a + (s.energyKwh || 0), 0);

  if (plans.length === 0 || sessions.length === 0) {
    return (
      <p className="small">
        Needs at least one plan in the <strong>Tariff Plans</strong> catalog and some
        uploaded <strong>EV Sessions</strong> data (both on the Ingest tab) for the
        active date range. {plans.length === 0 && 'No plans logged yet. '}
        {sessions.length === 0 && 'No charging sessions uploaded yet.'}
      </p>
    );
  }

  const rows = plans.map((plan) => {
    const byBand = splitSessionsByBand(sessions, plan.bands);
    const costAud = plan.bands.reduce((sum, b) => sum + (byBand[b.label] ?? 0) * (b.priceCentsPerKwh / 100), 0);
    return { ...plan, costAud };
  });
  const cheapest = Math.min(...rows.map((r) => r.costAud));

  return (
    <>
      <p className="small">
        Estimated cost of just your EV's charging (
        <strong>{totalSessionKwh.toLocaleString('en-AU', { maximumFractionDigits: 1 })} kWh</strong> across{' '}
        {sessions.length} session{sessions.length === 1 ? '' : 's'} in range) under each
        plan's usage rates - cheapest highlighted.
        <InfoPopover label="What this does and doesn't cover" className="section-info">
          Covers EV charging only, not your whole electricity bill - general home usage
          (fridge, lights, aircon, etc.) has no time-of-day data yet. It's also a gross
          figure: it assumes every kWh shown was billed at grid rates, when in reality
          some came from solar/battery (that split isn't known per charging session, only
          as a daily total). Excludes the daily supply charge, which applies to your whole
          account regardless of which plan you'd pick for EV charging.
        </InfoPopover>
      </p>
      <div className="table-scroll">
        <table className="digest table-nowrap">
          <thead><tr><th>Plan</th><th>FY</th><th>Est. EV charging cost</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.planName}-${r.financialYear}`}>
                <td>{r.planName}</td>
                <td>{r.financialYear}</td>
                <td className={r.costAud === cheapest ? 'digest-ok' : ''}>
                  <strong>{money(r.costAud)}</strong>{r.costAud === cheapest ? ' ✓' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
