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

// "FY2025-26" -> "25/26" - the table column needs to fit a 412px-wide
// screen alongside the Plan and cost columns; the full "FYyyyy-yy" form is
// kept everywhere else (Ingest tab's Tariff Plans catalog, this tile's own
// coverage-warning sentence) since those aren't column-width constrained.
function shortFy(fy) {
  const m = /^FY\d{2}(\d{2})-(\d{2})$/.exec(fy ?? '');
  return m ? `${m[1]}/${m[2]}` : fy;
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
  // Sort FY first so each financial year reads as its own group - plans are
  // only compared against others in the SAME FY (comparing FY2025-26 prices
  // against FY2026-27 prices would just crown the older, cheaper year).
  return [...map.values()].sort((a, b) => a.financialYear.localeCompare(b.financialYear) || a.planName.localeCompare(b.planName));
}

// Total minutes/day a plan's bands cover. 1440 = exactly the full day; less
// means a gap (energy charged in it silently prices at $0 - see
// splitSessionsByBand), more means overlapping bands double-price energy.
function bandCoverageMinutes(bands) {
  const mins = (hhmm) => {
    const [h, m] = (hhmm ?? '00:00').split(':').map(Number);
    return h * 60 + m;
  };
  return bands.reduce((total, b) => {
    const from = mins(b.from);
    const toRaw = mins(b.to);
    const to = toRaw <= from ? toRaw + 1440 : toRaw;
    return total + (to - from);
  }, 0);
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
    return { ...plan, costAud, coverageMin: bandCoverageMinutes(plan.bands) };
  });
  // Cheapest is per financial year - different FYs are different price
  // vintages, not competing options you could pick between today.
  const cheapestByFy = new Map();
  for (const r of rows) {
    const cur = cheapestByFy.get(r.financialYear);
    if (cur == null || r.costAud < cur) cheapestByFy.set(r.financialYear, r.costAud);
  }
  const coverageWarnings = rows.filter((r) => r.coverageMin !== 1440);

  return (
    <>
      <p className="small">
        Estimated cost of just your EV's charging (
        <strong className="nowrap">
          {totalSessionKwh.toLocaleString('en-AU', { maximumFractionDigits: 1 })} kWh
        </strong>{' '}
        across {sessions.length} session{sessions.length === 1 ? '' : 's'} in range) under each
        plan's usage rates - cheapest per financial year highlighted.
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
          <thead><tr><th>FY</th><th>Plan</th><th>Est. EV charging cost</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const isCheapest = r.costAud === cheapestByFy.get(r.financialYear);
              return (
                <tr key={`${r.planName}-${r.financialYear}`}>
                  <td>{shortFy(r.financialYear)}</td>
                  <td>{r.planName}{r.coverageMin !== 1440 ? ' ⚠' : ''}</td>
                  <td className={isCheapest ? 'digest-ok' : ''}>
                    <strong>{money(r.costAud)}</strong>{isCheapest ? ' ✓' : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {coverageWarnings.length > 0 && (
        <p className="small">
          ⚠ {coverageWarnings.map((r) => `${r.planName} (${r.financialYear})`).join(', ')}:
          this plan's time bands cover {coverageWarnings[0].coverageMin < 1440 ? 'less' : 'more'} than
          the full 24h day — energy in uncovered gaps is not priced (and overlapping bands
          double-price it), so its estimate is unreliable. Check the plan's band times on the
          Ingest tab's Tariff Plans page.
        </p>
      )}
    </>
  );
}
