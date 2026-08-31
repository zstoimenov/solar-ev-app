// DailyCalendar - a month of daily production as a calendar heatmap, from
// the optional dailySeries[] rows. This is the view the app could never
// render before v2: the daily numbers were parsed and discarded.
//
// A calendar rather than a bar chart because the question it answers is
// "which days were bad, and were they together?" - weekends, a cloudy run,
// a week of soiling. Weekday alignment carries that; a bar chart does not.

import React from 'react';
import InfoPopover from '../InfoPopover.jsx';
import { bestDay, zeroDays, daysInMonth } from '../../data/daily.js';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// Monday-first index (JS getDay() is Sunday-first).
function mondayIndex(year, month0, day) {
  return (new Date(year, month0, day).getDay() + 6) % 7;
}

// Four steps, not a continuous gradient: a reader can name a cell's bucket
// at a glance, which a smooth ramp makes impossible on a small screen.
function bucket(value, max) {
  if (value == null) return null;
  const t = max > 0 ? value / max : 0;
  if (t < 0.33) return 0;
  if (t < 0.55) return 1;
  if (t < 0.8) return 2;
  return 3;
}

export default function DailyCalendar({ rows, month }) {
  if (!rows?.length || !month) return null;

  const [year, mon] = month.split('-').map(Number);
  const total = daysInMonth(month);
  const byDay = new Map(rows.map((r) => [Number(r.date.slice(-2)), r]));
  const max = Math.max(...rows.map((r) => r.solarKwh ?? 0), 0);

  const lead = mondayIndex(year, mon - 1, 1);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push({ key: `pad-${i}`, pad: true });
  for (let d = 1; d <= total; d++) {
    const row = byDay.get(d);
    cells.push({
      key: `d-${d}`,
      day: d,
      value: row?.solarKwh ?? null,
      level: bucket(row?.solarKwh, max)
    });
  }

  const best = bestDay(rows);
  const zeros = zeroDays(rows);

  return (
    <div className="calendar">
      <div className="calendar-grid calendar-head">
        {WEEKDAYS.map((w, i) => <div key={i} className="calendar-weekday">{w}</div>)}
      </div>
      <div className="calendar-grid">
        {cells.map((c) =>
          c.pad ? (
            <div key={c.key} className="calendar-cell pad" />
          ) : (
            <div
              key={c.key}
              className={`calendar-cell${c.level == null ? ' nodata' : ` lvl-${c.level}`}`}
              title={`${month}-${String(c.day).padStart(2, '0')}: ${c.value == null ? 'no reading' : `${c.value} kWh`}`}
            >
              <span className="calendar-day">{c.day}</span>
              <span className="calendar-kwh">{c.value == null ? '' : Math.round(c.value)}</span>
            </div>
          )
        )}
      </div>

      <div className="calendar-legend">
        <span className="small">Quiet</span>
        <span className="calendar-ramp" />
        <span className="small">Best</span>
      </div>

      <p className="panel-foot">
        {best && <>Best day <strong>{best.solarKwh} kWh</strong> on the {Number(best.date.slice(-2))}th</>}
        {zeros > 0 && <> · {zeros} day{zeros === 1 ? '' : 's'} at zero</>}
        <InfoPopover label="About blank days" className="section-info">
          A blank cell is a day the upload did not cover — no reading, which is
          not the same as a day that produced nothing. Days that genuinely
          produced nothing show a 0.
        </InfoPopover>
      </p>
    </div>
  );
}
