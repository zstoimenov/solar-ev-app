// WholeBillComparison - what the household's WHOLE electricity bill would
// have cost on each rate card it has on file.
//
// This is the comparison the app refused to build until now. Until the
// Synergy download carried 30-minute rows, no data source here had a
// time-of-day split of general household usage, so a whole-of-bill
// comparison could only have been produced by assuming what share of usage
// fell in each band - a guess dressed up as a number. The split is now
// measured, so the comparison is real.
//
// It does NOT replace Car's PlanComparison, which prices EV charging only
// from the Wattpilot session log. The two answer related but different
// questions - "which plan suits the house" and "which plan suits the car" -
// and the EV one still knows something this cannot: which kWh were the car's.
//
// Included: usage priced band by band, plus the daily supply charge, because
// it is part of a real bill and differs between plans. Excluded: the feed-in
// credit, which is set by the state's DEBS scheme rather than the retail
// plan, so it is identical either way and cannot change the ranking.

import React from 'react';
import InfoPopover from '../InfoPopover.jsx';
import { Lede } from '../Screens/parts.jsx';
import { mergeProfiles } from '../../data/intervals.js';
import { comparePlansOnProfile } from '../../data/planPricing.js';

const money = (n, dp = 2) =>
  n == null ? '—' : `$${n.toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

function shortFy(fy) {
  const m = /^FY\d{2}(\d{2})-(\d{2})$/.exec(fy ?? '');
  return m ? `${m[1]}/${m[2]}` : fy;
}

export default function WholeBillComparison({ digests, config }) {
  const plans = config?.tariffPlans ?? [];
  const profile = mergeProfiles(digests);

  // Nothing to say at all without rate cards - the Data screen's Tariff
  // Plans page is where they come from, and PlanComparison already nags
  // about that on Car.
  if (!plans.length) return null;

  if (!profile) {
    return (
      <div className="panel">
        <h3 className="panel-title">Would a different plan be cheaper?</h3>
        <p className="small">
          Upload a Synergy interval file (the 30-minute one) with your next month and this
          will price your whole bill on every rate card you have on file. Months imported
          from a daily-only file have no time-of-day split, and a bill cannot be estimated
          without one.
        </p>
      </div>
    );
  }

  // Price on the rate cards that were current for the months being priced.
  const financialYears = [...new Set(
    digests.filter((d) => d.intervalProfile && d.financialYear).map((d) => d.financialYear)
  )];
  const result = comparePlansOnProfile(plans, profile, profile.days, { financialYears });
  if (!result) return null;

  const { rows, cheapestByFy, cheapest, dearest, importKwh, days, fyFallback } = result;
  const spread = cheapest && dearest ? dearest.totalAud - cheapest.totalAud : null;
  const coverageWarnings = rows.filter((r) => r.coverageMin !== 1440);
  const unpriced = rows.filter((r) => r.unpricedKwh > 0.05);
  const monthCount = profile.months.length;

  return (
    <div className="panel">
      <div className="panel-head">
        <h3 className="panel-title">Would a different plan be cheaper?</h3>
        <span className="small">{Math.round(importKwh).toLocaleString('en-AU')} kWh · {days} days</span>
      </div>

      {cheapest && dearest && cheapest.planName !== dearest.planName ? (
        <Lede>
          On the {days} days of half-hourly data, <strong>{cheapest.planName}</strong> works
          out cheapest at <strong>{money(cheapest.totalAud)}</strong> — {money(spread)} less
          than {dearest.planName}.
        </Lede>
      ) : (
        <Lede>
          Your {monthCount === 1 ? 'month' : `${monthCount} months`} of half-hourly data,
          priced on every rate card you have on file.
        </Lede>
      )}

      <div className="table-scroll">
        <table className="digest table-nowrap">
          <thead>
            <tr><th>FY</th><th>Plan</th><th>Usage</th><th>Supply</th><th>Total</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isCheapest = cheapestByFy.get(r.financialYear)?.planName === r.planName;
              return (
                <tr key={`${r.planName}-${r.financialYear}`}>
                  <td>{shortFy(r.financialYear)}</td>
                  <td>{r.planName}{r.coverageMin !== 1440 ? ' ⚠' : ''}</td>
                  <td>{money(r.usageAud)}</td>
                  <td>{money(r.supplyAud)}</td>
                  <td className={isCheapest ? 'digest-ok' : ''}>
                    <strong>{money(r.totalAud)}</strong>{isCheapest ? ' ✓' : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="panel-foot">
        {monthCount < 12
          ? `Based on ${monthCount === 1 ? 'one month' : `${monthCount} months`} — read it as the gap on this usage shape, not a yearly figure. Perth usage moves with the seasons, so a full year of half-hourly data is what makes an annual comparison honest.`
          : 'Based on a full year of half-hourly data, so the seasonal swing is already in it.'}
        <InfoPopover label="What is and is not in these figures" className="section-info">
          <p>
            Every half hour you imported is priced at whatever the plan charges in that
            band, then the plan&apos;s daily supply charge is added for the days covered.
            The supply charge is included because it is part of a real bill and it differs
            between plans — a plan can buy a cheap daytime rate with a bigger fixed fee.
          </p>
          <p>
            The feed-in credit is excluded: it comes from the state&apos;s DEBS scheme, not
            from your retail plan, so it is the same whichever of these you pick and cannot
            change the ranking.
          </p>
          <p>
            Plans are only compared against others from the same financial year — an older
            year&apos;s prices would win on age rather than on merit. This prices the
            months that have half-hourly data, which may be fewer than the period selected
            at the top of the screen.
          </p>
        </InfoPopover>
      </p>

      {fyFallback && (
        <p className="small">
          No rate card on file for {financialYears.join(', ')}, so these are priced on the
          years you do have. Add the current year&apos;s rates on the Data screen for a
          like-for-like figure.
        </p>
      )}
      {coverageWarnings.length > 0 && (
        <p className="small">
          ⚠ {coverageWarnings.map((r) => `${r.planName} (${r.financialYear})`).join(', ')}: this
          plan&apos;s bands do not cover exactly 24 hours, so energy in the gaps is unpriced
          (or double-priced where they overlap) and its total is unreliable. Check the band
          times on the Data screen.
        </p>
      )}
      {unpriced.length > 0 && coverageWarnings.length === 0 && (
        <p className="small">
          ⚠ {Math.round(unpriced[0].unpricedKwh)} kWh fell outside every band on{' '}
          {unpriced.map((r) => r.planName).join(', ')} and is not included in that total.
        </p>
      )}
    </div>
  );
}
