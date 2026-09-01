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

import React from 'react';
import InfoPopover from '../InfoPopover.jsx';
import { Lede, CompareBar, ProgressRow } from './parts.jsx';
import { layer3AnnualAud } from '../../data/compute.js';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function money(n, dp = 0) {
  return n == null
    ? '—'
    : `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

function monthLabel(m) {
  if (!m) return '—';
  const [y, mo] = m.split('-').map(Number);
  return `${MONTH_NAMES[mo - 1]} ${y}`;
}

// Component names come from the household's own config (brand/model), but
// the row is about the payback of the *thing*, not the brand.
const BRAND_STRIP = /\s*[(]?\b(wattpilot|byd\s*hvm)\b[)]?\s*/gi;
const simplifyName = (name) =>
  name ? name.replace(BRAND_STRIP, ' ').replace(/\s{2,}/g, ' ').trim() : name;

export default function Money({ state }) {
  const c = state.cumulativeTotals;
  const digests = state.monthlyDigests;
  const f = c.financial ?? {};
  const layer3 = layer3AnnualAud(state.config);
  const payback = c.payback ?? [];
  const totals = c.paybackTotals;
  const preTracking = c.paybackPreTracking;

  const latest = digests.length ? digests[digests.length - 1] : null;

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

  return (
    <div className="screen">
      <div className="panel">
        <h3 className="panel-title">What it has saved</h3>
        <Lede>
          <strong>{money(f.combinedLayer12SavingAud)}</strong> since{' '}
          {monthLabel(c.coverage?.firstMonth)}, from two separate things.
        </Lede>

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
            A fixed yearly figure set by the lease terms, not by anything the system does.
            Kept out of the total above on purpose. <span className="stream-layer">Layer 3</span>
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
          <h3 className="panel-title">Your {monthLabel(latest.month)} bill</h3>
          <Lede>
            The system took <strong>{money(latest.baselineGridCostAud - latest.actualGridCostAud)}</strong> off
            this month&apos;s electricity.
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
        </div>
      )}

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
