// Energy - is the system performing as it should?
//
// Absorbs the old Energy Trends and 12-Month Comparison tiles. They answered
// the same question at two fidelities, so they are one screen with a
// Chart/Table toggle rather than two separate collapsed panels.
//
// The range control lives here rather than in the app chrome: this is the
// only screen where "which months" is a real question. Money and Payback are
// all-time by nature, and Today is about now.

import React, { useState } from 'react';
import EnergyTrends from '../Dashboard/EnergyTrends.jsx';
import MonthlyComparison from '../Dashboard/MonthlyComparison.jsx';
import DailyCalendar from '../Dashboard/DailyCalendar.jsx';
import InfoPopover from '../InfoPopover.jsx';
import { dailyForMonth, monthToDate, paceToMonthEnd, typicalForMonth } from '../../data/daily.js';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const kwh = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-AU'));

function monthName(month) {
  return month ? MONTH_NAMES[Number(month.slice(5, 7)) - 1] : '';
}

// Energy-weighted, matching compute.js:weightedPct - a mean of monthly
// percentages would count a 5-day partial month the same as a 31-day one.
function weightedPct(digests, numKey, denKey) {
  let num = 0;
  let den = 0;
  for (const d of digests) {
    if (d[numKey] == null || d[denKey] == null) continue;
    num += d[numKey];
    den += d[denKey];
  }
  return den > 0 ? Math.round((num / den) * 1000) / 10 : null;
}

export default function Energy({ state, fullState, rangeFilter }) {
  const daily = fullState.dailySeries ?? [];
  const digests = state.monthlyDigests;

  // "This month" means the latest month that has daily rows - the only range
  // where a day-level view is possible at all.
  const dailyMonth = daily.length ? daily[daily.length - 1].date.slice(0, 7) : null;
  const [range, setRange] = useState(dailyMonth ? 'month' : 'window');
  const [view, setView] = useState('chart');

  const effectiveRange = range === 'month' && !dailyMonth ? 'window' : range;
  const showCalendar = effectiveRange === 'month' && view === 'chart';

  const monthRows = dailyMonth ? dailyForMonth(daily, dailyMonth) : [];
  const mtd = dailyMonth ? monthToDate(daily, dailyMonth) : null;
  const pace = paceToMonthEnd(mtd);
  const typical = dailyMonth ? typicalForMonth(fullState.monthlyDigests, dailyMonth) : null;

  const rangeDigests = effectiveRange === 'all' ? fullState.monthlyDigests : digests;
  const rangeSolar = rangeDigests.reduce(
    (a, d) => (d.solarProductionKwh == null ? a : a + d.solarProductionKwh), 0
  );
  const selfSuff = weightedPct(rangeDigests, 'ownConsumptionKwh', 'totalConsumptionKwh');

  const headline =
    effectiveRange === 'month'
      ? { label: `Generated in ${monthName(dailyMonth)}`, value: mtd?.solarKwh, sub:
          mtd ? `${mtd.daysCovered} of ${mtd.daysInMonth} days${
            pace != null ? ` · on pace for ${kwh(pace)}` : ''
          }${typical ? ` against a typical ${kwh(typical.kwh)}` : ''}` : '' }
      : {
          label: effectiveRange === 'all' ? 'Generated, all time' : 'Generated over the selected range',
          value: rangeSolar,
          sub: `${rangeDigests.length} month${rangeDigests.length === 1 ? '' : 's'}`
        };

  const scopedSelfSuff = effectiveRange === 'month'
    ? weightedPct(
        fullState.monthlyDigests.filter((d) => d.month === dailyMonth),
        'ownConsumptionKwh', 'totalConsumptionKwh'
      ) ?? selfSuff
    : selfSuff;

  return (
    <div className="screen">
      <div className="range-chips">
        {dailyMonth && (
          <button
            className={effectiveRange === 'month' ? 'active' : ''}
            onClick={() => { setRange('month'); setView('chart'); }}
          >
            This month
          </button>
        )}
        <button
          className={effectiveRange === 'window' ? 'active' : ''}
          onClick={() => setRange('window')}
        >
          Selected range
        </button>
        <button
          className={effectiveRange === 'all' ? 'active' : ''}
          onClick={() => setRange('all')}
        >
          All time
        </button>
      </div>

      {effectiveRange === 'window' && rangeFilter && (
        <div className="range-filter-row">{rangeFilter}</div>
      )}

      <div className="panel headline-panel">
        <div className="label">{headline.label}</div>
        <div className="headline-value accent">
          {kwh(headline.value)}<span className="unit">kWh</span>
        </div>
        <div className="sub">{headline.sub}</div>
        <div className="mini-grid">
          <div className="mini-metric">
            <div className="label">Self-sufficient</div>
            <div className="mini-value green">{scopedSelfSuff == null ? '—' : `${scopedSelfSuff}%`}</div>
            <div className="sub">of what the house used</div>
          </div>
          {mtd?.gridExportKwh != null && effectiveRange === 'month' && (
            <div className="mini-metric">
              <div className="label">Sold back</div>
              <div className="mini-value">{kwh(mtd.gridExportKwh)}<span className="unit">kWh</span></div>
              <div className="sub">exported to the grid</div>
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3 className="panel-title">
            {showCalendar ? 'Day by day' : 'Month by month'}
          </h3>
          <div className="mini-toggle">
            <button
              className={view === 'chart' ? 'active' : ''}
              onClick={() => setView('chart')}
            >
              Chart
            </button>
            <button
              className={view === 'table' ? 'active' : ''}
              onClick={() => {
                setView('table');
                if (effectiveRange === 'month') setRange('window');
              }}
            >
              Table
            </button>
          </div>
        </div>

        {view === 'table' ? (
          <MonthlyComparison state={{ ...state, monthlyDigests: rangeDigests }} />
        ) : showCalendar ? (
          <DailyCalendar rows={monthRows} month={dailyMonth} />
        ) : (
          <EnergyTrends state={{ ...state, monthlyDigests: rangeDigests }} />
        )}
      </div>

      {!dailyMonth && (
        <p className="small screen-foot">
          Day-by-day figures appear here from your next monthly upload. The
          Fronius and Wattpilot files always contained them — earlier months
          were ingested before the app kept them.
          <InfoPopover label="Why earlier months have no daily view" className="section-info">
            Both exports are one row per day. Until v2 the app summed those rows
            and stored only the monthly totals, so there is nothing to show for
            months ingested before the upgrade. Re-uploading an old month&apos;s
            original file will fill it in.
          </InfoPopover>
        </p>
      )}
    </div>
  );
}
