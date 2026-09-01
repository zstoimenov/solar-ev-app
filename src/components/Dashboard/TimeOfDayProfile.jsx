// TimeOfDayProfile - when in the day this household actually buys power, and
// when it sells it.
//
// This is the first thing in the app that can answer "when", and it only
// appears for months whose Synergy download carried 30-minute rows. Months
// imported from a daily-granularity file have no profile and the panel does
// not render - it never fills the gap with an assumption.
//
// ENERGY ONLY, deliberately. Knowing the shape of a month is exactly what a
// whole-of-bill tariff comparison needs, but pricing it is a financial
// computation and buildDigest.js stays the only place those are made. The
// panel therefore says when, not what it cost.
//
// Rendered as one labelled row per window rather than a stacked bar in five
// colours: five categorical colours cannot be made colour-vision-safe on
// this surface (see SOURCE_COLORS in Screens/parts.jsx), and a share per row
// is easier to read on a phone than five slices of one bar anyway.

import React from 'react';
import InfoPopover from '../InfoPopover.jsx';
import { Lede, ProgressRow, SOURCE_COLORS } from '../Screens/parts.jsx';
import {
  bandsFromPlans, bandTotals, mergeProfiles, profileTotals, exportShareInWindow
} from '../../data/intervals.js';

// "06:00" -> "6am", "15:00" -> "3pm", "23:30" -> "11:30pm"
function clock(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}${suffix}` : `${h12}${suffix}`;
}

const kwh = (n) => (n == null ? '—' : `${Math.round(n).toLocaleString('en-AU')} kWh`);
const pct = (n) => (n == null ? '—' : `${Math.round(n)}%`);

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const monthName = (m) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

export default function TimeOfDayProfile({ digests, config }) {
  const profile = mergeProfiles(digests);
  if (!profile) return null;

  const totals = profileTotals(profile);
  if (!(totals?.importKwh > 0)) return null;

  // Borrow the household's own rate-card bands where there are any: the
  // split worth seeing is the one they are actually charged on.
  const fy = digests.find((d) => d.intervalProfile)?.financialYear ?? null;
  const { planName, bands } = bandsFromPlans(config, fy);
  const rows = bandTotals(profile, bands);
  const biggest = rows.reduce((a, b) => (b.importKwh > a.importKwh ? b : a), rows[0]);

  // The feed-in window: the same hours the rate card calls Peak, or the
  // standard afternoon window when there is no rate card to borrow from.
  const peakBand = bands.find((b) => /peak/i.test(b.label) && !/off/i.test(b.label));
  const exportWindow = peakBand ?? { from: '15:00', to: '21:00' };
  const exportSplit = exportShareInWindow(profile, exportWindow.from, exportWindow.to);

  // The period named here is the period the PROFILE covers, which is not
  // the screen's selected range: only months imported from a 30-minute file
  // have one. Saying "over 12 months" when two of them carry half-hourly
  // data would be a straightforwardly false sentence.
  const monthCount = profile.months.length;
  const period =
    monthCount === 1
      ? `in ${monthName(profile.months[0])}`
      : `across the ${monthCount} months with half-hourly data`;

  return (
    <div className="panel">
      <div className="panel-head">
        <h3 className="panel-title">When you buy power</h3>
        <span className="small">{kwh(totals.importKwh)}</span>
      </div>

      <Lede>
        <strong>{pct(biggest.importPct)}</strong> of the power you bought {period} came
        between <strong>{clock(biggest.from)}</strong> and <strong>{clock(biggest.to)}</strong>.
      </Lede>

      <div className="progress-list">
        {rows.map((b) => (
          <ProgressRow
            key={`${b.from}-${b.to}-${b.label}`}
            name={`${clock(b.from)} – ${clock(b.to)}`}
            status={pct(b.importPct)}
            parts={[{ pct: b.importPct ?? 0, color: SOURCE_COLORS.grid }]}
            caption={`${kwh(b.importKwh)} bought${planName ? ` · ${b.label}` : ''}`}
          />
        ))}
      </div>

      {exportSplit && (
        <p className="panel-foot">
          Of the {kwh(totals.exportKwh)} you sent back, <strong>{pct(exportSplit.insidePct)}</strong>{' '}
          went out between {clock(exportWindow.from)} and {clock(exportWindow.to)} — the window a
          two-rate feed-in tariff pays differently for.
          <InfoPopover label="Why that share matters" className="section-info">
            A feed-in tariff with a higher afternoon rate cannot be applied to a monthly
            export total, because the total does not say when the energy left. Until this
            data existed the app deliberately left the export credit on a single rate rather
            than assume a share. This is the measured share for the period shown; applying
            it to the credit is a separate change.
          </InfoPopover>
        </p>
      )}

      <p className="panel-foot">
        From {monthCount === 1 ? 'one month' : `${monthCount} months`} of 30-minute meter data
        ({profile.days} days).
        {profile.includesUnbilled && ' Includes days Synergy has not billed yet.'}
        <InfoPopover label="Where this comes from" className="section-info">
          <p>
            Your Synergy interval download has one row per half hour for both directions.
            Those rows are folded at import into 48 half-hourly buckets per month and the
            raw rows are discarded — a month is 1,440 rows but under a kilobyte once
            aggregated, so your backup file stays small.
          </p>
          <p>
            Buckets are labelled by when they start: 7:30 covers 7:30 to 8:00. Months
            imported from a daily-granularity file have no profile and are simply left out
            of this panel rather than estimated.
          </p>
          <p>
            These are meter readings, so they show what crossed the meter — not what your
            solar produced or the house consumed behind it. Nothing here is priced: what
            this costs depends on the rate card, and that comparison is a separate piece
            of work.
          </p>
        </InfoPopover>
      </p>
    </div>
  );
}
