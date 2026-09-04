// MonthStory - the month just gone, said in words, and then explained.
//
// Two halves, and they are deliberately about DIFFERENT things:
//
//   - The top is the month's ENERGY in plain sentences: what the roof made
//     against a typical month of the same name, how much of the house ran on
//     its own power, what the car took and where from.
//   - The bottom is the month's MONEY, decomposed. "The saving is $75 higher
//     than a year earlier" - and then the five stored figures that difference
//     is made of, biggest mover first.
//
// Keeping them apart is what stops this being a third rendering of numbers
// already on screen. The panel above it ("<Month> so far") is the month IN
// PROGRESS, in kWh, as a pace. This one is the month as ingested, and it is
// the only place the completed month's money is broken down.
//
// WHY THE MONEY BREAKDOWN IS ALLOWED TO EXIST. See data/insights.js: the
// combined saving is exactly the sum of five figures already stored on the
// digest, so the change in it is five subtractions - nothing apportioned or
// modelled. That also makes it checkable, and the check is shown: when the
// parts do not add up to the total (a pre-v1.10 month with no home-charging
// figure, usually), the panel prints an explicit "not accounted for" row and
// points at Recompute Financials. It does NOT quietly spread the difference
// across the other rows to make the arithmetic look clean.
//
// The volume/price split is shown for the LARGEST mover only. "You exported
// less" and "the feed-in rate was cut" are different news and a household
// should be told which one it was - but five of those lines is a spreadsheet,
// and the answer to "why" is almost always the top row.
//
// Two reference months are offered (a year earlier, the month before) because
// they answer different questions, and the year-earlier one leads: in Perth
// most month-on-month movement is just the season turning.

import React, { useState } from 'react';
import InfoPopover from '../InfoPopover.jsx';
import { Lede, monthLabel } from '../Screens/parts.jsx';
import { savingAttribution, attributionOptions, monthNarrative } from '../../data/insights.js';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function longMonth(m) {
  if (!m) return '—';
  const [y, mo] = m.split('-').map(Number);
  return `${MONTH_NAMES[mo - 1]} ${y}`;
}

const money = (n) =>
  `$${Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// A signed amount with the sign as a character, never as colour alone.
const signed = (n) => `${n < 0 ? '−' : '+'}${money(n)}`;

const kwh = (n) => `${Math.round(n).toLocaleString('en-AU')} kWh`;

// The quantity behind a part, in whatever unit it is counted in.
const qty = (n, unit) =>
  unit === 'kWh' ? kwh(n) : `${Math.round(n).toLocaleString('en-AU')} ${unit}`;

// Cents per kWh reads better than dollars for a rate, and it is the unit the
// tariff pages already use.
const rate = (p, unit) =>
  unit === 'kWh' ? `${(p * 100).toFixed(1)}c/kWh` : `${money(p)}/${unit.replace(/s$/, '')}`;

function Sentence({ segments }) {
  return (
    <p className="lede story-line">
      {segments.map((s, i) =>
        s.em ? <strong key={i}>{s.text}</strong> : <React.Fragment key={i}>{s.text}</React.Fragment>
      )}
    </p>
  );
}

export default function MonthStory({ state }) {
  const digests = state?.monthlyDigests ?? [];
  // The last COMPLETE month, not simply the last one. A partial month is four
  // days against thirty and every comparison it makes is dominated by that:
  // the biggest mover comes out as "the length of the month", which is true,
  // useless, and buries everything worth knowing. The rest of the app already
  // takes this line - typicalForMonth() excludes partial months for the same
  // reason - and the month in progress is what the panel ABOVE this one is
  // for. Falls back to the latest month when nothing is complete yet, where
  // the partial note below carries the warning.
  const complete = digests.filter((d) => d.partialMonth !== true);
  const latest = complete.length
    ? complete[complete.length - 1]
    : digests.length ? digests[digests.length - 1] : null;
  const month = latest?.month ?? null;

  const options = month ? attributionOptions(digests, month) : [];
  const [pick, setPick] = useState(0);

  if (!month) return null;

  const narrative = monthNarrative(digests, state.dailySeries ?? [], month);
  // The reference can fall out of range when the selected index outlives the
  // options (a restore with less history), so clamp rather than index blindly.
  const option = options[Math.min(pick, options.length - 1)] ?? null;
  const attribution = option ? savingAttribution(digests, month, option.month) : null;

  // Nothing to say at all - no sentences and no comparison - is a real state
  // on a first month, and an empty panel is worse than no panel.
  if (!narrative.length && !attribution) return null;

  const lead = attribution?.lead ?? null;
  const flat = attribution != null && Math.abs(attribution.totalDelta) < 0.5;

  return (
    <div className="panel">
      <div className="panel-head">
        <h3 className="panel-title">{longMonth(month)}</h3>
        <span className="small">
          {latest.partialMonth ? 'part of a month so far' : 'the month just gone'}
        </span>
      </div>

      {narrative.map((f) => (
        <Sentence key={f.key} segments={f.segments} />
      ))}

      {attribution && (
        <div className="story-money">
          <div className="story-compare-head">
            <span className="label">Against {monthLabel(attribution.reference)}</span>
            {options.length > 1 && (
              <div className="mini-toggle" role="group" aria-label="Compare against">
                {options.map((o, i) => (
                  <button
                    key={o.key}
                    className={i === Math.min(pick, options.length - 1) ? 'active' : ''}
                    aria-pressed={i === Math.min(pick, options.length - 1)}
                    onClick={() => setPick(i)}
                  >
                    {o.key === 'lastYear' ? 'Year' : 'Month'}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Lede>
            {flat ? (
              <>The saving came out <strong>about level</strong> with {option.caption}.</>
            ) : (
              <>
                The saving is <strong>{money(attribution.totalDelta)}{' '}
                {attribution.totalDelta > 0 ? 'higher' : 'lower'}</strong> than {option.caption}.
                {' '}Here is where that came from.
              </>
            )}
          </Lede>

          <div className="attrib">
            {attribution.parts.map((p) => (
              <div className="attrib-row" key={p.key}>
                <span className="attrib-label">
                  {p.label}
                  {p.folded && <span className="attrib-caption">{p.folded} smaller items</span>}
                </span>
                <span
                  className={`attrib-amount ${
                    Math.abs(p.delta) < 0.005 ? '' : p.delta > 0 ? 'good' : 'bad'
                  }`}
                >
                  {signed(p.delta)}
                </span>
              </div>
            ))}

            {/* The residual is a row like any other, and named for what it is.
                Hiding it would make every other row look more certain than it
                is - see insights.js on why the check is not negotiable. */}
            {attribution.residual != null && (
              <div className="attrib-row">
                <span className="attrib-label">
                  Not accounted for
                  <span className="attrib-caption">
                    this month is missing a stored figure — Recompute Financials fills it in
                  </span>
                </span>
                <span className="attrib-amount">{signed(attribution.residual)}</span>
              </div>
            )}
          </div>

          {/* The biggest mover, split into how much moved and what it was
              worth. Only one, and only when both rates are recoverable. */}
          {lead?.split && lead.split.shape !== 'none' && (
            <p className="attrib-split">
              <strong>{lead.label}</strong>:{' '}
              {lead.split.shape !== 'price' && (
                <>
                  {lead.split.volumeLabel} moved from{' '}
                  <strong>{qty(lead.split.q0, lead.split.unit)}</strong> to{' '}
                  <strong>{qty(lead.split.q1, lead.split.unit)}</strong>
                  {lead.split.shape === 'both' && <> ({signed(lead.split.volumeDelta)})</>}
                </>
              )}
              {lead.split.shape === 'both' && ', and '}
              {lead.split.shape === 'volume' && <>, while {lead.split.priceLabel} barely changed.</>}
              {lead.split.shape !== 'volume' && (
                <>
                  {lead.split.shape === 'price' && <>{lead.split.volumeLabel} barely changed, but </>}
                  {lead.split.priceLabel} went from{' '}
                  <strong>{rate(lead.split.p0, lead.split.unit)}</strong> to{' '}
                  <strong>{rate(lead.split.p1, lead.split.unit)}</strong>
                  {lead.split.shape === 'both' && <> ({signed(lead.split.priceDelta)})</>}.
                </>
              )}
            </p>
          )}

          {attribution.partial && (
            <p className="attrib-note">
              {attribution.subjectPartial && attribution.referencePartial
                ? 'Both months are partial, so these are not whole-month figures.'
                : attribution.subjectPartial
                  ? `${longMonth(attribution.month)} is only part of a month so far, so it sits below a whole month by definition — read this as progress, not a drop.`
                  : `${monthLabel(attribution.reference)} was only a partial month, so it is a low bar to clear.`}
            </p>
          )}

          <div className="panel-foot">
            Every figure here is one already stored for each month, subtracted.
            <InfoPopover label="How this breakdown is worked out" className="section-info">
              <p>
                Your combined saving is exactly five stored figures added up: the grid
                cost your own power avoided, the credit for what you exported, the petrol
                the car did not burn, less what you paid to charge it in public and less
                what its home charging cost you. So the difference between two months is
                those same five figures, subtracted. Nothing here is estimated,
                apportioned or modelled.
              </p>
              <p>
                Because it is a plain sum, it can be checked — and it is, every time. If
                the parts do not add up to the change in the total, the gap is shown as
                its own row rather than being spread across the others. That normally
                means the month predates the home-charging figure; the Recompute
                Financials button on the Data screen fills it in from what is already
                stored, without re-uploading anything.
              </p>
              {lead?.split && (
                <p>
                  The largest mover is split into two: how much energy moved, and what it
                  was worth per unit. They are different news — you can do something about
                  the first, and only your retailer moves the second. The two add up to
                  the row above exactly.
                </p>
              )}
              <p>
                A year earlier is the comparison that means the most here: in Perth, most
                of the difference between one month and the next is just the season
                turning, and the same month a year ago removes it. The month before is
                offered too, for when the recent direction is what you are after.
              </p>
            </InfoPopover>
          </div>
        </div>
      )}

      {!attribution && narrative.length > 0 && (
        <p className="panel-foot">
          A second {MONTH_NAMES[Number(month.slice(5, 7)) - 1]} of data will let this say
          why the saving moved, rather than only what the month did.
        </p>
      )}
    </div>
  );
}
