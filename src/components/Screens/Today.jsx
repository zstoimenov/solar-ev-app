// Today - the answer screen. Everything here is visible on open: no
// collapsed panels, no tapping required to learn how the household is doing.
//
// Order is deliberate: anything that needs attention, then the headline
// saving, then payback, then the month in progress, then what's coming.
//
// Every figure is real or absent. Where a number cannot be derived (no daily
// rows yet, no payback block, not enough history for a seasonal comparison)
// the block is simply not rendered - nothing is estimated to fill a gap.

import React from 'react';
import InfoPopover from '../InfoPopover.jsx';
import { AlertIcon, CheckCircleIcon, ClockIcon } from '../Dashboard/icons.jsx';
import { monthToDate, paceToMonthEnd, typicalForMonth, seasonalCheck } from '../../data/daily.js';
import { backupStaleness } from '../../data/storage.js';

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

function kwh(n) {
  return n == null ? '—' : Math.round(n).toLocaleString('en-AU');
}

// A ring rather than a bar: payback is one proportion of one whole, and the
// ring reads at a glance from across the kitchen.
function PaybackRing({ pct }) {
  const r = 40;
  const circumference = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(100, pct ?? 0)) / 100;
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" className="payback-ring" aria-hidden="true">
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

export default function Today({ state, appMeta, onGoTo }) {
  const c = state.cumulativeTotals;
  const digests = state.monthlyDigests;
  const daily = state.dailySeries ?? [];

  const combined = c.financial?.combinedLayer12SavingAud ?? null;
  const months = c.coverage?.totalMonths ?? digests.length;
  const perMonth = combined != null && months ? combined / months : null;

  // Per-day uses the real days covered, not months x 30 - a partial first or
  // last month would otherwise quietly inflate the rate.
  const totalDays = digests.reduce((a, d) => a + (d.daysInPeriod ?? 0), 0);
  const perDay = combined != null && totalDays ? combined / totalDays : null;

  const totals = c.paybackTotals;
  const paybackPct =
    totals && totals.oopAud ? (totals.recoveredAud / totals.oopAud) * 100 : null;
  const paidOff = (c.payback ?? []).filter((p) => (p.remainingAud ?? 1) <= 0);
  const nextComponent = (c.payback ?? []).find((p) => (p.remainingAud ?? 0) > 0);

  // The month in progress comes from the daily rows when they exist. Without
  // them there is nothing to say that the Energy screen doesn't already show,
  // so the card is omitted rather than filled with the last full month.
  const latestMonth = digests.length ? digests[digests.length - 1].month : null;
  const dailyMonth = daily.length ? daily[daily.length - 1].date.slice(0, 7) : null;
  const mtd = dailyMonth ? monthToDate(daily, dailyMonth) : null;
  const pace = paceToMonthEnd(mtd);
  const typical = dailyMonth ? typicalForMonth(digests, dailyMonth) : null;

  const season = seasonalCheck(daily);
  const stale = backupStaleness({
    monthCount: digests.length,
    lastExportedCount: appMeta.lastExportedCount,
    lastExportedAt: appMeta.lastExportedAt
  });

  return (
    <div className="screen">
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

      <div className="panel headline-panel">
        <div className="label">Saved so far</div>
        <div className="headline-value">{money(combined)}</div>
        <div className="sub">
          {c.coverage?.firstMonth ? `Since ${monthLabel(c.coverage.firstMonth)}` : ''}
          {months ? ` · ${months} month${months === 1 ? '' : 's'} tracked` : ''}
        </div>
        <div className="mini-grid">
          <div className="mini-metric">
            <div className="label">Per month</div>
            <div className="mini-value">{money(perMonth)}</div>
          </div>
          <div className="mini-metric">
            <div className="label">Per day</div>
            <div className="mini-value">{money(perDay, 2)}</div>
          </div>
        </div>
        <InfoPopover label="What this total covers" className="metric-info">
          Money kept by your solar and battery, plus the saving from driving
          electric instead of the old petrol car. It does not include the
          lease-versus-loan advantage, which is a fixed yearly figure and is
          deliberately never added in — see the Money screen.
        </InfoPopover>
      </div>

      {totals && (
        <div className="panel payback-panel">
          <div className="payback-ring-wrap">
            <PaybackRing pct={paybackPct} />
            <div className="payback-ring-label">
              <div className="payback-pct">{paybackPct == null ? '—' : `${Math.round(paybackPct)}%`}</div>
              <div className="label">paid back</div>
            </div>
          </div>
          <div className="payback-copy">
            <div className="payback-headline">{money(totals.remainingAud)} left to recover</div>
            <p className="small">
              Of {money(totals.oopAud)} spent on hardware.
              {nextComponent?.estPaybackYear && nextComponent.estPaybackYear !== 'Paid off'
                ? ` At the current rate you break even in ${nextComponent.estPaybackYear}.`
                : ''}
            </p>
            {paidOff.length > 0 && (
              <div className="chip-row">
                {paidOff.map((p) => (
                  <span className="chip ok" key={p.component}>{p.component} done</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {mtd && (
        <div className="panel">
          <div className="panel-head">
            <h3 className="panel-title">{monthLabel(mtd.month)} so far</h3>
            <span className="small">day {mtd.daysCovered} of {mtd.daysInMonth}</span>
          </div>
          <div className="stat-row">
            <div className="stat">
              <div className="stat-value accent">{kwh(mtd.solarKwh)}<span className="unit">kWh</span></div>
              <div className="label">generated</div>
            </div>
            {mtd.evKwh != null && (
              <div className="stat">
                <div className="stat-value purple">{kwh(mtd.evKwh)}<span className="unit">kWh</span></div>
                <div className="label">into the car</div>
              </div>
            )}
            {mtd.gridImportKwh != null && (
              <div className="stat">
                <div className="stat-value red">{kwh(mtd.gridImportKwh)}<span className="unit">kWh</span></div>
                <div className="label">bought</div>
              </div>
            )}
          </div>
          <Sparkline rows={state.dailySeries.filter((r) => r.date.slice(0, 7) === mtd.month)} />
          {pace != null && (
            <p className="panel-foot">
              On pace for <strong>{kwh(pace)} kWh</strong>
              {typical ? `, against a typical ${monthLabel(mtd.month).split(' ')[0]} of ${kwh(typical.kwh)}` : ''}.
              {typical && (
                <InfoPopover label="Where 'typical' comes from" className="section-info">
                  The average of your own {typical.years} previous complete{' '}
                  {monthLabel(mtd.month).split(' ')[0]}
                  {typical.years === 1 ? '' : 's'}. Partial months are excluded so a
                  short month cannot drag the figure down. The pace is a straight
                  line from the days covered so far, not a weather forecast.
                </InfoPopover>
              )}
            </p>
          )}
        </div>
      )}

      <div className="panel">
        <h3 className="panel-title">Coming up</h3>
        <div className="milestone-list">
          {paidOff.map((p) => (
            <div className="milestone" key={p.component}>
              <span className="milestone-icon done"><CheckCircleIcon /></span>
              <div>{p.component} paid for itself</div>
            </div>
          ))}
          {nextComponent && (
            <div className="milestone">
              <span className="milestone-icon"><ClockIcon /></span>
              <div>
                {nextComponent.component} — {money(nextComponent.remainingAud)} to go
                {nextComponent.estPaybackYear && nextComponent.estPaybackYear !== 'Paid off'
                  ? ` · about ${nextComponent.estPaybackYear}` : ''}
              </div>
            </div>
          )}
          {stale && (
            <div className="milestone">
              <span className="milestone-icon warn"><AlertIcon /></span>
              <div>
                {stale.text}{' '}
                <button className="linkish" onClick={() => onGoTo('Data')}>Back up now</button>
              </div>
            </div>
          )}
          {!paidOff.length && !nextComponent && !stale && (
            <p className="small">Nothing needs your attention.</p>
          )}
        </div>
      </div>

      {!mtd && latestMonth && (
        <p className="small screen-foot">
          Day-by-day figures start from your next monthly upload — earlier months
          were ingested before the app kept them.
        </p>
      )}
    </div>
  );
}

// A bar per day of the month in progress. Pure SVG-free CSS bars: this is a
// glance, not a chart, and it has to stay legible at 412px.
function Sparkline({ rows }) {
  const vals = rows.map((r) => r.solarKwh);
  const max = Math.max(...vals.filter((v) => v != null), 0);
  if (!max) return null;
  return (
    <>
      <div className="sparkline">
        {rows.map((r) => (
          <div
            key={r.date}
            className={`spark-bar${r.solarKwh == null ? ' empty' : ''}`}
            style={r.solarKwh == null ? undefined : { height: `${Math.max(4, (r.solarKwh / max) * 100)}%` }}
            title={`${r.date}: ${r.solarKwh == null ? 'no reading' : `${r.solarKwh} kWh`}`}
          />
        ))}
      </div>
      <div className="sparkline-axis">
        <span>{rows[0]?.date.slice(-2)} {MONTH_NAMES[Number(rows[0]?.date.slice(5, 7)) - 1]?.slice(0, 3)}</span>
        <span>{rows[rows.length - 1]?.date.slice(-2)} {MONTH_NAMES[Number(rows[rows.length - 1]?.date.slice(5, 7)) - 1]?.slice(0, 3)}</span>
      </div>
    </>
  );
}
