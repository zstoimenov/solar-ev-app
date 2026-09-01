// Energy - "is the system doing its job?"
//
// Three questions, in order:
//   1. Is it producing what it should?      -> a sentence + a comparison bar
//   2. Where did the power actually go?     -> two complementary splits
//   3. Which days were good and bad?        -> the calendar (month range only)
//
// Question 2 is the one a household actually asks about solar and the one
// the pre-v2.1 screen never answered: it led with a bare "151 kWh", which
// means nothing without a reference, and then offered a four-series
// dual-axis chart. Both are gone.

import React, { useState } from 'react';
import SolarForecast from '../Dashboard/SolarForecast.jsx';
import MonthlyProduction from '../Dashboard/MonthlyProduction.jsx';
import MonthlyComparison from '../Dashboard/MonthlyComparison.jsx';
import DailyCalendar from '../Dashboard/DailyCalendar.jsx';
import TimeOfDayProfile from '../Dashboard/TimeOfDayProfile.jsx';
import InfoPopover from '../InfoPopover.jsx';
import { Lede, SplitBar, CompareBar, SOURCE_COLORS, RangeChips, RANGES, Deltas } from './parts.jsx';
import { dailyForMonth, monthToDate, paceToMonthEnd, typicalForMonth } from '../../data/daily.js';
import { monthComparison } from '../../data/compare.js';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const kwh = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-AU'));

// Null-preserving sum: a column with no values at all is "no data", not 0.
const sumKey = (rows, key) =>
  rows.reduce((acc, d) => (d[key] == null ? acc : (acc ?? 0) + d[key]), null);

export default function Energy({ state, fullState, rangeFilter, onConfigChange }) {
  const daily = fullState.dailySeries ?? [];
  const digests = state.monthlyDigests;

  const dailyMonth = daily.length ? daily[daily.length - 1].date.slice(0, 7) : null;
  const [range, setRange] = useState(dailyMonth ? 'month' : 'window');
  const [showTable, setShowTable] = useState(false);

  const effectiveRange = range === 'month' && !dailyMonth ? 'window' : range;
  const isMonth = effectiveRange === 'month';

  const monthRows = dailyMonth ? dailyForMonth(daily, dailyMonth) : [];
  const mtd = dailyMonth ? monthToDate(daily, dailyMonth) : null;
  const pace = paceToMonthEnd(mtd);
  const typical = dailyMonth ? typicalForMonth(fullState.monthlyDigests, dailyMonth) : null;

  const rangeDigests = effectiveRange === 'all' ? fullState.monthlyDigests : digests;
  const scopeDigests = isMonth
    ? fullState.monthlyDigests.filter((d) => d.month === dailyMonth)
    : rangeDigests;

  // The two flows, from whichever scope is selected.
  const generated = sumKey(scopeDigests, 'solarProductionKwh');
  const exported = sumKey(scopeDigests, 'gridExportKwh');
  const consumed = sumKey(scopeDigests, 'totalConsumptionKwh');
  const imported = sumKey(scopeDigests, 'gridImportFroniusKwh');
  const ownUsed = sumKey(scopeDigests, 'ownConsumptionKwh');
  const selfUsedSolar = generated != null && exported != null ? Math.max(0, generated - exported) : null;

  const monthName = dailyMonth ? MONTH_NAMES[Number(dailyMonth.slice(5, 7)) - 1] : '';
  const pacePct =
    pace != null && typical?.kwh ? Math.round(((pace - typical.kwh) / typical.kwh) * 100) : null;

  // Same month last year is the comparison that takes the season out of it;
  // the month before is here because it is the one people look for first.
  const production = isMonth
    ? monthComparison(fullState.monthlyDigests, dailyMonth, 'solarProductionKwh')
    : null;

  const scopeLabel = isMonth
    ? monthName
    : effectiveRange === 'all'
      ? 'all time'
      : `${rangeDigests.length} month${rangeDigests.length === 1 ? '' : 's'}`;

  return (
    <div className="screen">
      <RangeChips
        value={effectiveRange}
        onChange={setRange}
        options={dailyMonth ? RANGES : RANGES.filter((r) => r !== 'month')}
      />

      {effectiveRange === 'window' && rangeFilter && (
        <div className="range-filter-row">{rangeFilter}</div>
      )}

      {/* 0. What is coming. The only forward-looking block in the app, and
          the only one that leaves the device - it sits above the history
          because "should I charge the car tomorrow" is answerable today. */}
      <SolarForecast state={fullState} onConfigChange={onConfigChange} />

      {/* 1. Producing what it should? */}
      <div className="panel">
        <h3 className="panel-title">Production</h3>
        {isMonth && pacePct != null ? (
          <>
            <Lede>
              {monthName} is on track to finish{' '}
              <strong>{Math.abs(pacePct)}% {pacePct >= 0 ? 'ahead of' : 'behind'}</strong> normal.
            </Lede>
            <CompareBar
              actual={pace}
              reference={typical.kwh}
              actualLabel={`On pace for (day ${mtd.daysCovered} of ${mtd.daysInMonth})`}
              referenceLabel={`Typical ${monthName}`}
            />
            <InfoPopover label="Where 'normal' comes from" className="section-info">
              The average of your own {typical.years} previous complete {monthName}
              {typical.years === 1 ? '' : 's'}, partial months excluded. The pace is a
              straight line from the days covered so far, not a weather forecast.
            </InfoPopover>
            <Deltas comparison={production} unit=" kWh" />
          </>
        ) : (
          <Lede>
            <strong>{kwh(generated)} kWh</strong> generated over {scopeLabel}
            {scopeDigests.length > 1 && generated != null
              ? <> — an average of <strong>{kwh(generated / scopeDigests.length)} kWh</strong> a month</>
              : ''}.
          </Lede>
        )}
        {isMonth && pacePct == null && <Deltas comparison={production} unit=" kWh" />}
      </div>

      {/* 2. Where did it go? The question the old screen never answered. */}
      {generated != null && selfUsedSolar != null && (
        <div className="panel">
          <h3 className="panel-title">Where your solar went</h3>
          <SplitBar
            segments={[
              { label: 'Used in the house', value: selfUsedSolar, color: SOURCE_COLORS.battery },
              { label: 'Sold back to the grid', value: exported, color: SOURCE_COLORS.solar }
            ]}
          />
          <p className="panel-foot">
            Energy you use yourself is worth the full import rate; energy you export
            earns only the feed-in credit, which is far less.
          </p>
        </div>
      )}

      {consumed != null && ownUsed != null && (
        <div className="panel">
          <h3 className="panel-title">Where the house got its power</h3>
          <SplitBar
            segments={[
              { label: 'Your own solar and battery', value: ownUsed, color: SOURCE_COLORS.battery },
              { label: 'Bought from the grid', value: imported, color: SOURCE_COLORS.grid }
            ]}
          />
        </div>
      )}

      {/* 2b. WHEN did the house buy it? Only for months whose Synergy
          download carried 30-minute rows - it renders nothing otherwise. */}
      <TimeOfDayProfile digests={scopeDigests} config={fullState.config} />

      {/* 3. Which days were good and bad? */}
      <div className="panel">
        <div className="panel-head">
          <h3 className="panel-title">{isMonth && !showTable ? 'Day by day' : 'Month by month'}</h3>
          <button className="ghost small-btn" onClick={() => setShowTable((v) => !v)}>
            {showTable ? 'Show chart' : 'Show numbers'}
          </button>
        </div>
        {showTable ? (
          <MonthlyComparison state={{ ...state, monthlyDigests: rangeDigests }} />
        ) : isMonth ? (
          <DailyCalendar rows={monthRows} month={dailyMonth} />
        ) : (
          <MonthlyProduction state={{ ...state, monthlyDigests: rangeDigests }} />
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
