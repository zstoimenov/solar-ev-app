// Home - "is there anything to do, what is happening now, and what has it all
// added up to?"
//
// Ordered by RATE OF CHANGE, not by importance (v2.15). Everything above the
// fold changes between one open and the next; everything below it steps once
// a month at ingest. The screen used to be the other way round: it opened on
// "$12,480 saved so far", a figure that had not moved since the last upload,
// and a household opening the app on a Tuesday was shown last month's news.
//
// Four blocks, in this order:
//   1. Anything wrong or owed  - alarms first, then the two chores. The
//      chores are quietly styled but sit HIGH, because "your data stops two
//      months ago" changes how every figure below it should be read.
//   2. What is happening now   - the week's verdict, then today's sun curve.
//   3. This month so far       - pace against a normal month of the same name.
//   4. What it has all added up to - one panel: the total, the payback ring
//      and the milestones.
//
// Block 4 was three panels until v2.15, and two of them said the same thing:
// the ring said "$8,400 to go, on track for 2031" and the Milestones panel
// then said "Battery - $8,400 to go, about 2031". That is the app's own "one
// fact, one rendering" rule broken on its own landing screen. The milestone
// list now carries only what the ring cannot: which components are already
// paid off.
//
// What was deliberately REMOVED in the v2.1 content pass, and stays removed:
//   - "per day" alongside "per month" and the total. Three phrasings of one
//     number is not three facts.
//   - the three raw month-to-date kWh figures (generated / into the car /
//     bought). "151 kWh" tells a household nothing without a reference, and
//     the reference is what the comparison bar now supplies.
//   - the daily sparkline. It was decoration: pretty, unreadable, and the
//     day-level detail properly belongs on Energy's calendar.
//
// Every block still renders only when its inputs exist. Nothing is estimated
// to keep the layout even.

import React from 'react';
import InfoPopover from '../InfoPopover.jsx';
import { AlertIcon, CheckCircleIcon, ClockIcon } from '../Dashboard/icons.jsx';
import { BigStat, Lede, CompareBar } from './parts.jsx';
import { monthToDate, paceToMonthEnd, typicalForMonth, seasonalCheck } from '../../data/daily.js';
import { backupStaleness, ingestStaleness } from '../../data/storage.js';
import ForecastAlert from '../ForecastAlert.jsx';
import WeekVerdict from '../Dashboard/WeekVerdict.jsx';
import SunCurve from '../Dashboard/SunCurve.jsx';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function money(n, dp = 0) {
  return n == null
    ? '—'
    : `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

function monthLabel(month) {
  if (!month) return '—';
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function PaybackRing({ pct }) {
  const r = 40;
  const circumference = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(100, pct ?? 0)) / 100;
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">
      <circle cx="48" cy="48" r={r} fill="none" stroke="var(--border)" strokeWidth="10" />
      <circle
        cx="48" cy="48" r={r} fill="none" stroke="var(--green)" strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${circumference * filled} ${circumference}`}
        transform="rotate(-90 48 48)"
      />
    </svg>
  );
}

export default function Home({ state, appMeta, onGoTo }) {
  const c = state.cumulativeTotals;
  const digests = state.monthlyDigests;
  const daily = state.dailySeries ?? [];

  const combined = c.financial?.combinedLayer12SavingAud ?? null;
  const months = c.coverage?.totalMonths ?? digests.length;
  const perMonth = combined != null && months ? combined / months : null;

  const totals = c.paybackTotals;
  const paybackPct =
    totals && totals.oopAud ? (totals.recoveredAud / totals.oopAud) * 100 : null;
  const paidOff = (c.payback ?? []).filter((p) => (p.remainingAud ?? 1) <= 0);
  const nextComponent = (c.payback ?? []).find((p) => (p.remainingAud ?? 0) > 0);

  const dailyMonth = daily.length ? daily[daily.length - 1].date.slice(0, 7) : null;
  const mtd = dailyMonth ? monthToDate(daily, dailyMonth) : null;
  const pace = paceToMonthEnd(mtd);
  const typical = dailyMonth ? typicalForMonth(digests, dailyMonth) : null;

  // This month's money and self-sufficiency come from the digest, which is
  // the source of truth for both - the daily rows carry energy only.
  const monthDigest = dailyMonth ? digests.find((d) => d.month === dailyMonth) : null;

  const season = seasonalCheck(daily);

  // The two chores. Different failures with different fixes, so two helpers
  // and two rows rather than one merged nag: overdue means "upload the files
  // you have not imported", stale means "get a copy of what is here off this
  // phone". See data/storage.js.
  const overdue = ingestStaleness({ lastMonth: c.coverage?.lastMonth ?? state.meta?.dateRange?.last });
  const stale = backupStaleness({
    monthCount: digests.length,
    lastExportedCount: appMeta.lastExportedCount,
    lastExportedAt: appMeta.lastExportedAt
  });

  const pacePct =
    pace != null && typical?.kwh ? Math.round(((pace - typical.kwh) / typical.kwh) * 100) : null;

  return (
    <div className="screen">
      {/* 1. Anything wrong or owed ------------------------------------- */}

      {/* Anything the phone should have said and could not - see
          ForecastAlert.jsx. It renders nothing unless alerts are on and one is
          actually due, and showing it here counts as having been delivered. */}
      <ForecastAlert state={state} onGoTo={onGoTo} />

      {season?.below && (
        <div className="attention">
          <span className="attention-icon"><AlertIcon /></span>
          <div className="attention-body">
            <div className="attention-title">
              Solar is running {Math.abs(season.pct)}% under this time of year
            </div>
            <p className="attention-text">
              The last {season.days} days averaged {season.actualPerDay} kWh against
              the {season.expectedPerDay} kWh this part of the year normally gives.
              Worth checking for panel soiling or new shading.
            </p>
            <div className="attention-actions">
              <button className="ghost small-btn" onClick={() => onGoTo('Energy')}>
                See the daily figures
              </button>
              <InfoPopover label="How this comparison is made">
                Your last {season.days} days of production, against {season.samples} days
                from the same time of year in earlier years of your own data (within a
                week either side of each date). It only appears once there is at least a
                full year of daily history to compare against — before that there is no
                honest seasonal baseline, so no verdict is offered.
              </InfoPopover>
            </div>
          </div>
        </div>
      )}

      {overdue && (
        <div className="chore">
          <span className="chore-icon"><AlertIcon /></span>
          <span className="chore-text">{overdue.text}</span>
          <button className="ghost small-btn" onClick={() => onGoTo('Data')}>Upload</button>
        </div>
      )}

      {stale && (
        <div className="chore">
          <span className="chore-icon"><AlertIcon /></span>
          <span className="chore-text">{stale.text}</span>
          <button className="ghost small-btn" onClick={() => onGoTo('Data')}>Back up</button>
        </div>
      )}

      {/* 2. What is happening now --------------------------------------
          Both render nothing until a forecast location is set - the app makes
          no outbound request on its own - and the curve renders nothing when
          the cached forecast carries no hourly shape. See SunCurve.jsx. */}
      <WeekVerdict state={state} />
      <SunCurve state={state} />

      {/* 3. This month so far ------------------------------------------ */}
      {mtd && (
        <div className="panel">
          <div className="panel-head">
            <h3 className="panel-title">{monthLabel(mtd.month)} so far</h3>
            <span className="small">day {mtd.daysCovered} of {mtd.daysInMonth}</span>
          </div>

          {pacePct != null ? (
            <>
              <Lede>
                At this rate {MONTH_NAMES[Number(mtd.month.slice(5, 7)) - 1]} finishes{' '}
                <strong>{Math.abs(pacePct)}% {pacePct >= 0 ? 'ahead of' : 'behind'}</strong> a normal
                {' '}{MONTH_NAMES[Number(mtd.month.slice(5, 7)) - 1]}.
              </Lede>
              <CompareBar
                actual={pace}
                reference={typical.kwh}
                actualLabel="On pace for"
                referenceLabel={`Typical ${MONTH_NAMES[Number(mtd.month.slice(5, 7)) - 1]}`}
              />
              <InfoPopover label="Where 'typical' comes from" className="section-info">
                The average of your own {typical.years} previous complete{' '}
                {MONTH_NAMES[Number(mtd.month.slice(5, 7)) - 1]}
                {typical.years === 1 ? '' : 's'}. Partial months are excluded so a short
                month cannot drag the figure down. The pace is a straight line from the
                days covered so far — not a weather forecast.
              </InfoPopover>
            </>
          ) : (
            <Lede>
              <strong>{Math.round(mtd.solarKwh).toLocaleString('en-AU')} kWh</strong> generated
              over {mtd.daysCovered} days. A second {MONTH_NAMES[Number(mtd.month.slice(5, 7)) - 1]}{' '}
              of data will give this something to compare against.
            </Lede>
          )}

          {monthDigest && (
            <p className="panel-foot">
              {monthDigest.combinedSavingAud != null && (
                <><strong>{money(monthDigest.combinedSavingAud)}</strong> saved this month</>
              )}
              {monthDigest.selfSufficiencyPct != null && (
                <> · your own power covered <strong>{Math.round(monthDigest.selfSufficiencyPct)}%</strong> of
                what the house used</>
              )}
            </p>
          )}
        </div>
      )}

      {/* 4. What it has all added up to ---------------------------------
          One panel, because it is one story told at three sizes: the total,
          how much of the hardware that total has bought back, and which
          pieces are square. The ring already says what is left to go and
          when, so the milestone list carries only what is already done. */}
      <BigStat
        label="Saved so far"
        value={money(combined)}
        tone="green"
      >
        <Lede>
          {perMonth != null
            ? <>About <strong>{money(perMonth)} a month</strong> since {monthLabel(c.coverage?.firstMonth)}.</>
            : <>Across {months} month{months === 1 ? '' : 's'} of data.</>}
          <InfoPopover label="What this total covers" className="section-info">
            Money kept by your solar and battery, plus the saving from driving
            electric instead of the old petrol car. It does not include the
            lease-versus-loan advantage, which is a fixed yearly figure and is
            deliberately never added in — see the Money screen.
          </InfoPopover>
        </Lede>

        {totals && (
          <div className="allsaved-payback">
            <div className="payback-ring-wrap">
              <PaybackRing pct={paybackPct} />
              <div className="payback-ring-label">
                <div className="payback-pct">{paybackPct == null ? '—' : `${Math.round(paybackPct)}%`}</div>
                <div className="label">paid back</div>
              </div>
            </div>
            <div className="payback-copy">
              <div className="payback-headline">{money(totals.remainingAud)} to go</div>
              <p className="small">
                of the {money(totals.oopAud)} the hardware cost
                {nextComponent?.estPaybackYear && nextComponent.estPaybackYear !== 'Paid off'
                  ? `, on track for ${nextComponent.estPaybackYear}`
                  : ''}.
              </p>
            </div>
          </div>
        )}

        {paidOff.length > 0 && (
          <div className="milestone-list allsaved-milestones">
            {paidOff.map((p) => (
              <div className="milestone" key={p.component}>
                <span className="milestone-icon done"><CheckCircleIcon /></span>
                <div>{p.component} has paid for itself</div>
              </div>
            ))}
          </div>
        )}

        {/* Nothing paid off yet: name the one being worked on, since the
            list above would otherwise be empty and say nothing at all. */}
        {paidOff.length === 0 && nextComponent && (
          <div className="milestone-list allsaved-milestones">
            <div className="milestone">
              <span className="milestone-icon"><ClockIcon /></span>
              <div>Paying off {nextComponent.component} first</div>
            </div>
          </div>
        )}
      </BigStat>

      {!mtd && (
        <p className="small screen-foot">
          Day-by-day figures start from your next monthly upload — earlier months
          were ingested before the app kept them.
        </p>
      )}
    </div>
  );
}
