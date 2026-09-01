// DailyCalendar - a month of daily production as a calendar heatmap, from
// the optional dailySeries[] rows. This is the view the app could never
// render before v2: the daily numbers were parsed and discarded.
//
// A calendar rather than a bar chart because the question it answers is
// "which days were bad, and were they together?" - a run of cloudy days, a
// weekend pattern, a week of soiling. Weekday alignment carries that; a bar
// chart does not.
//
// Magnitude is a SEQUENTIAL encoding, so it is one hue from dim to bright,
// never a rainbow. The per-cell kWh figure was removed in the v2.1 content
// pass: at 412px it made every cell a cramped two-line block, and the exact
// value of one day is a detail (the tooltip and the summary line below carry
// it) while the pattern is the point.

import React from 'react';
import InfoPopover from '../InfoPopover.jsx';
import { bestDay, zeroDays, daysInMonth } from '../../data/daily.js';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Monday-first index (JS getDay() is Sunday-first).
function mondayIndex(year, month0, day) {
  return (new Date(year, month0, day).getDay() + 6) % 7;
}

// Four steps rather than a continuous ramp: a reader can name a cell's
// bucket at a glance, which a smooth gradient makes impossible at this size.
function bucket(value, max) {
  if (value == null) return null;
  const t = max > 0 ? value / max : 0;
  if (t < 0.3) return 0;
  if (t < 0.55) return 1;
  if (t < 0.8) return 2;
  return 3;
}

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

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
  const withSolar = rows.filter((r) => r.solarKwh != null);
  const worst = withSolar.length
    ? withSolar.reduce((a, b) => (b.solarKwh < a.solarKwh ? b : a))
    : null;

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
              title={`${c.day} ${MONTHS[mon - 1]}: ${c.value == null ? 'no reading' : `${c.value} kWh`}`}
            >
              <span className="calendar-day">{c.day}</span>
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
        {best && <>Best day <strong>{best.solarKwh} kWh</strong> on the {ordinal(Number(best.date.slice(-2)))}</>}
        {worst && best && worst.date !== best.date && (
          <> · quietest <strong>{worst.solarKwh} kWh</strong> on the {ordinal(Number(worst.date.slice(-2)))}</>
        )}
        {zeros > 0 && <> · {zeros} day{zeros === 1 ? '' : 's'} at zero</>}
        <InfoPopover label="Reading this calendar" className="section-info">
          Brighter is a bigger day, shaded against this month&apos;s own best day.
          Tap or hover a square for its exact figure. An outlined square is a day
          the upload did not cover — no reading, which is not the same as a day
          that produced nothing; those show as the dimmest shade.
        </InfoPopover>
      </p>
    </div>
  );
}
