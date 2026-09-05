// Money - "what has it saved, and when does it pay back?"
//
// Replaces the RoiLayers + PaybackProgress tiles, which between them showed
// every figure twice: RoiLayers rendered three metric cards and then a table
// repeating the same three numbers, and PaybackProgress rendered a stacked
// bar chart and then a table repeating that. Each fact now appears once.
//
// The model is untouched. Layers keep their numbers, their separation and
// their caveats; they only lose their jargon and their duplicate rendering.
// Layer 3 is still never summed into the accrued total.

import React, { useState } from 'react';
import InfoPopover from '../InfoPopover.jsx';
import { Lede, CompareBar, ProgressRow, RangeChips, monthLabel, Deltas } from './parts.jsx';
import { monthComparison } from '../../data/compare.js';
import WholeBillComparison from '../Dashboard/WholeBillComparison.jsx';
import { layer3AnnualAud } from '../../data/compute.js';

function money(n, dp = 0) {
  return n == null
    ? '—'
    : `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

// Component names come from the household's own config (brand/model), but
// the row is about the payback of the *thing*, not the brand.
const BRAND_STRIP = /\s*[(]?\b(wattpilot|byd\s*hvm)\b[)]?\s*/gi;
const simplifyName = (name) => {
  if (!name) return name;
  const stripped = name.replace(BRAND_STRIP, ' ').replace(/\s{2,}/g, ' ').trim();
  // Re-capitalise: stripping the brand off "Wattpilot charger" leaves a row
  // labelled "charger" in lower case, beside "Solar panels" and "Battery".
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
};

export default function Money({ scopes, months, rangeFilter, allDigests }) {
  // All time is the default: this is the screen about what the whole
  // investment has returned. The other two periods answer "and lately?".
  const [range, setRange] = useState('all');
  const state = scopes[range];
  const c = state.cumulativeTotals;
  const digests = state.monthlyDigests;
  const f = c.financial ?? {};
  const layer3 = layer3AnnualAud(state.config);
  const payback = c.payback ?? [];
  const totals = c.paybackTotals;
  const preTracking = c.paybackPreTracking;

  const latest = digests.length ? digests[digests.length - 1] : null;

  // A single month is the only period with a "month before" and a "same
  // month last year" to be held against.
  const savedVs = range === 'month' && digests.length === 1
    ? monthComparison(allDigests, digests[0].month, 'combinedSavingAud')
    : null;
  const billVs = range === 'month' && digests.length === 1
    ? monthComparison(allDigests, digests[0].month, 'actualGridCostAud')
    : null;

  const streams = [
    {
      name: 'Solar and battery',
      layer: 'Layer 1',
      value: f.layer1SavingAud,
      why: 'Power you did not have to buy, plus credit for what you sold back.',
      tone: 'green'
    },
    {
      name: 'Driving electric',
      layer: 'Layer 2',
      value: f.layer2SavingAud,
      why: 'Petrol and servicing avoided, less what the charging actually cost.',
      tone: 'green'
    }
  ];

  // The period is part of the sentence, not a caption under it - a savings
  // figure with no period attached is unreadable.
  const first = c.coverage?.firstMonth;
  const last = c.coverage?.lastMonth;
  const period =
    range === 'all'
      ? <>since {monthLabel(first)}</>
      : first === last
        ? <>in {monthLabel(first)}</>
        : <>from {monthLabel(first)} to {monthLabel(last)}</>;

  return (
    <div className="screen">
      {months.length > 1 && <RangeChips value={range} onChange={setRange} />}
      {range === 'window' && rangeFilter && (
        <div className="range-filter-row">{rangeFilter}</div>
      )}

      <div className="panel">
        <h3 className="panel-title">What it has saved</h3>
        <Lede>
          <strong>{money(f.combinedLayer12SavingAud)}</strong> {period}, from two
          separate things.
        </Lede>

        <Deltas comparison={savedVs} format={(n) => money(n)} />

        <div className="stream-list">
          {streams.map((s) => (
            <div className="stream" key={s.name}>
              <div className="stream-head">
                <span className="stream-name">{s.name}</span>
                <span className={`stream-value ${s.tone}`}>{money(s.value)}</span>
              </div>
              <div className="stream-why">{s.why} <span className="stream-layer">{s.layer}</span></div>
            </div>
          ))}
        </div>

        <div className="stream apart">
          <div className="stream-head">
            <span className="stream-name">Lease over a loan</span>
            <span className="stream-value blue">{money(layer3)}<span className="unit">/yr</span></span>
          </div>
          <div className="stream-why">
            A fixed yearly figure set by the lease terms, not by anything the system
            does — so it does not change with the period selected, and it is kept out
            of the total above on purpose. <span className="stream-layer">Layer 3</span>
            <InfoPopover label="What the lease advantage is" className="section-info">
              The after-tax advantage of financing the EV through the novated lease
              instead of a private car loan at 7%. Paying the lease and running costs
              from pre-tax salary (32% marginal rate) plus GST credits outweighs the
              lease&apos;s higher effective finance rate (12.82% effective p.a. vs the
              stated 9.39%) — worth about $16,374 over the 5-year term. It does not
              change with energy usage, which is why it is never added to the running
              total.
            </InfoPopover>
          </div>
        </div>
      </div>

      {latest && latest.actualGridCostAud != null && latest.baselineGridCostAud != null && (
        <div className="panel">
          {/* A partial month says so in both the heading and the sentence. The
              figures are a few days against a whole month by definition, and
              read as a full month's bill they look like a collapse. */}
          <h3 className="panel-title">
            Your {monthLabel(latest.month)} bill{latest.partialMonth ? ' so far' : ''}
          </h3>
          <Lede>
            The system took <strong>{money(latest.baselineGridCostAud - latest.actualGridCostAud)}</strong> off
            {latest.partialMonth
              ? ` the first ${latest.daysInPeriod} day${latest.daysInPeriod === 1 ? '' : 's'} of that month.`
              : " that month's electricity."}
          </Lede>
          <CompareBar
            actual={latest.actualGridCostAud}
            reference={latest.baselineGridCostAud}
            actualLabel="What you pay"
            referenceLabel="Without solar or battery"
            format={(n) => money(n)}
            tone="good"
          />
          <p className="panel-foot">
            Both include the same daily supply charge, so the gap is the real
            difference the system made rather than an artefact of the connection fee.
          </p>
          {/* A bill going DOWN is the good direction, unlike every other
              comparison on this screen. */}
          <Deltas comparison={billVs} format={(n) => money(n)} higherIsBetter={false} />
        </div>
      )}

      {/* What the same usage would have cost on a different rate card. Needs
          the half-hourly profile, so it renders only for months imported
          from a Synergy interval file. */}
      <WholeBillComparison digests={digests} config={state.config} />

      {payback.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h3 className="panel-title">Paying back the hardware</h3>
            {totals && (
              <span className="small">
                {money(totals.recoveredAud)} of {money(totals.oopAud)}
              </span>
            )}
          </div>
          {range !== 'all' && (
            <p className="panel-foot">
              Payback always counts every month you have, whatever period is selected
              above — it is what the hardware has recovered in total, not in a window.
            </p>
          )}
          <div className="progress-list">
            {payback.map((p) => {
              const oop = p.oopAud || 1;
              const est = ((p.recoveredPreTrackingAud ?? 0) / oop) * 100;
              const tracked = (((p.recoveredAud ?? 0) - (p.recoveredPreTrackingAud ?? 0)) / oop) * 100;
              const done = (p.remainingAud ?? 1) <= 0;
              return (
                <ProgressRow
                  key={p.component}
                  name={simplifyName(p.component)}
                  status={done ? 'Paid off' : `${money(p.remainingAud)} to go`}
                  statusTone={done ? 'good' : ''}
                  parts={[
                    { pct: est, color: '#a3854e' },
                    { pct: tracked, color: '#34d399' }
                  ]}
                  caption={
                    done
                      ? `Cost ${money(p.oopAud)}`
                      : `${money(p.recoveredAud)} of ${money(p.oopAud)}${
                          p.estPaybackYear && p.estPaybackYear !== 'Paid off'
                            ? ` · about ${p.estPaybackYear}` : ''
                        }`
                  }
                />
              );
            })}
          </div>

          {preTracking && (
            <p className="panel-foot">
              <span className="swatch-inline" style={{ background: '#a3854e' }} />
              {money(preTracking.estimatedAud)} of this is an estimate for{' '}
              {monthLabel(preTracking.fromMonth)} – {monthLabel(preTracking.toMonth)}, before any
              meter data existed.
              <InfoPopover label="How the pre-tracking estimate works" className="section-info">
                This system was installed on {preTracking.installDate}, {preTracking.gapMonths} months
                before your earliest tracked data. There is no Fronius/Wattpilot data for
                that gap — it was never captured, not just un-ingested — so it is filled with
                an estimate: your tracked period&apos;s average Layer 1 saving
                (${preTracking.avgMonthlyRateUsedAud}/month) × the gap in months. This is
                rougher than every other figure in this app: if the gap predates your battery
                or EV, their savings are baked into that average and this will overstate what
                solar-only was actually saving back then. It affects this panel only — the
                savings above stay exactly what your tracked data shows.
              </InfoPopover>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
