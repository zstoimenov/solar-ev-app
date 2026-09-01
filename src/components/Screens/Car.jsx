// Car - "is driving electric paying, and when should I charge?"
//
// Leads with money, because that is the question. The pre-v2.1 screen led
// with "61% charged from your own energy" and then spent a doughnut, a
// stacked bar chart and a two-row legend on the same split - three
// renderings of one fact, and the doughnut's two "public" slices were
// coloured #a78bfa and #60a5fa, a pair with a colour-vision separation of
// 0.3 (i.e. identical). Both charts are gone; one labelled split bar
// remains, with free and paid public folded into "Away from home".

import React, { useState } from 'react';
import BestChargeDay from '../Dashboard/BestChargeDay.jsx';
import PlanComparison from '../Dashboard/PlanComparison.jsx';
import InfoPopover from '../InfoPopover.jsx';
import { BigStat, Lede, SplitBar, SOURCE_COLORS, RangeChips, rangeLabel, Deltas } from './parts.jsx';
import { monthComparison } from '../../data/compare.js';

const money = (n, dp = 0) =>
  n == null
    ? '—'
    : `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

const sumKey = (rows, key) =>
  rows.reduce((acc, d) => (d[key] == null ? acc : (acc ?? 0) + d[key]), null);

export default function Car({ scopes, months, rangeFilter, allDigests, fullState }) {
  // The window is the useful default here: the charging mix a year ago says
  // little about what the car costs to run now.
  const [range, setRange] = useState('window');
  const state = scopes[range];
  const ev = state.cumulativeTotals.ev ?? {};
  const digests = state.monthlyDigests;

  // The Layer 2 story, told as the comparison it actually is.
  const petrolWouldHaveCost = sumKey(digests, 'ceratoCounterfactualAud');
  const chargingCost = ev.totalEvElectricityCostAud;
  const saved = state.cumulativeTotals.financial?.layer2SavingAud ?? null;

  // Away-from-home charging is one category: free workplace and paid public
  // are both "not off your roof". What separates them is cost, and cost is
  // shown above in dollars rather than as two indistinguishable colours.
  const away = (ev.workChargingKwh ?? 0) + (ev.publicTripKwh ?? 0);

  // Only a single month can be compared against the month before it and the
  // same month a year earlier; a range has no such counterpart.
  const savedVs = range === 'month' && digests.length === 1
    ? monthComparison(allDigests, digests[0].month, 'layer2SavingAud')
    : null;
  const chargedVs = range === 'month' && digests.length === 1
    ? monthComparison(allDigests, digests[0].month, 'evTotalChargedKwh')
    : null;

  return (
    <div className="screen">
      {months.length > 1 && <RangeChips value={range} onChange={setRange} />}
      {range === 'window' && rangeFilter && (
        <div className="range-filter-row">{rangeFilter}</div>
      )}

      <BigStat
        label="Saved by driving electric"
        value={money(saved)}
        sub={rangeLabel(range, digests)}
        tone="green"
      >
        <Lede>
          {petrolWouldHaveCost != null && chargingCost != null ? (
            <>Petrol and servicing would have cost <strong>{money(petrolWouldHaveCost)}</strong>.
            Charging cost <strong>{money(chargingCost)}</strong>.</>
          ) : (
            <>Petrol and servicing avoided, less what the charging actually cost.</>
          )}
        </Lede>
        <InfoPopover label="Why home charging is counted as a cost" className="metric-info">
          Charging at home is not free. The grid-sourced share is paid at the
          import rate, and the solar or battery share gives up the feed-in
          credit that energy would have earned by being exported. Counting both
          is what stops the solar saving and the driving saving claiming the
          same kilowatt-hours twice.
        </InfoPopover>
        <Deltas comparison={savedVs} format={(n) => money(n)} />
      </BigStat>

      <div className="panel">
        <div className="panel-head">
          <h3 className="panel-title">Where the charge came from</h3>
          <span className="small">
            {ev.totalChargedKwh == null ? '—' : Math.round(ev.totalChargedKwh).toLocaleString('en-AU')} kWh
          </span>
        </div>
        <SplitBar
          segments={[
            { label: 'Straight off the roof', value: ev.fromPvKwh, color: SOURCE_COLORS.solar },
            { label: 'Out of the battery', value: ev.fromBatteryKwh, color: SOURCE_COLORS.battery },
            { label: 'Bought from the grid', value: ev.fromHomeGridKwh, color: SOURCE_COLORS.grid },
            { label: 'Away from home', value: away, color: SOURCE_COLORS.away }
          ]}
        />
        <p className="panel-foot">
          The bigger the first two, the cheaper the car is to run — that energy
          costs you only the feed-in credit you gave up.
        </p>
        <Deltas comparison={chargedVs} unit=" kWh" />
      </div>

      <BestChargeDay state={fullState} />

      <div className="panel">
        <h3 className="panel-title">Would a different plan be cheaper?</h3>
        <PlanComparison state={state} />
      </div>
    </div>
  );
}
