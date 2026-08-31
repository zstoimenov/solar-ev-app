// Car - is driving electric paying, and when should I charge?
//
// Wraps the existing EV tiles. The headline is deliberately the SOURCE MIX
// rather than a cost-per-100km: the distance and consumption figures needed
// for a per-kilometre number live in config.ev, whose shape this code has
// never read, and inventing one would be a guess. The mix is real data.

import React from 'react';
import EvChargingSplit from '../Dashboard/EvChargingSplit.jsx';
import PlanComparison from '../Dashboard/PlanComparison.jsx';
import InfoPopover from '../InfoPopover.jsx';

const kwh = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-AU'));
const money = (n) =>
  n == null ? '—' : `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Car({ state }) {
  const ev = state.cumulativeTotals.ev ?? {};
  // Share that came off the roof or out of the battery rather than being
  // bought - the single number that explains why charging at home is cheap.
  const ownShare =
    ev.fromPvPct != null || ev.fromBatteryPct != null
      ? Math.round((ev.fromPvPct ?? 0) + (ev.fromBatteryPct ?? 0))
      : null;

  return (
    <div className="screen">
      <div className="panel headline-panel">
        <div className="label">Charged from your own energy</div>
        <div className="headline-value green">
          {ownShare == null ? '—' : `${ownShare}%`}
        </div>
        <div className="sub">
          {kwh(ev.totalChargedKwh)} kWh charged in this range
        </div>
        <div className="mini-grid">
          <div className="mini-metric">
            <div className="label">Paid away from home</div>
            <div className="mini-value">{money(ev.totalAwayChargingCostAud)}</div>
            <div className="sub">public and road-trip charging</div>
          </div>
          <div className="mini-metric">
            <div className="label">All charging cost</div>
            <div className="mini-value">{money(ev.totalEvElectricityCostAud)}</div>
            <div className="sub">including home charging</div>
          </div>
        </div>
        <InfoPopover label="Why home charging still costs something" className="metric-info">
          Charging at home is not free. The grid-sourced share is paid at the
          import rate, and the solar or battery share gives up the feed-in
          credit that energy would have earned by being exported. Both are
          counted, which is what stops the solar saving and the driving saving
          double-counting the same kilowatt-hours.
        </InfoPopover>
      </div>

      <div className="panel">
        <h3 className="panel-title">Where the charge came from</h3>
        <EvChargingSplit state={state} />
      </div>

      <div className="panel">
        <h3 className="panel-title">Would a different plan be cheaper?</h3>
        <PlanComparison state={state} />
      </div>
    </div>
  );
}
