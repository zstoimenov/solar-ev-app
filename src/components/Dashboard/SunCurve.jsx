// SunCurve - the day drawn from sunrise to sunset, with the forecast yield
// spread across the hours the sun is actually expected to arrive in.
//
// WHAT THIS IS AND IS NOT. The total is the SAME figure the Energy screen's
// forecast panel shows for that day: fitted from this roof's own history,
// corrected by the measured bias, capped at what the array has done (see
// data/forecast.js). Nothing new is computed here. What the curve adds is
// the shape, and the shape is the forecast's own hourly radiation - so a
// cloudy morning shows as a dented morning rather than being smoothed into
// a tidy bell.
//
// The hour-by-hour kWh figures are still a DIVISION of a daily total, not
// seven measurements. This household's data is one row per day
// (dailySeries[]), so there is nothing to score an hourly claim against the
// way forecastAccuracy.js scores the daily one. The panel says that in as
// many words rather than letting a smooth curve imply a precision that is
// not there - it is a picture of when the sun turns up, and the number on it
// is only as good as the daily figure it came from.
//
// It degrades in the two ways the rest of the app does: no location, no
// panel (nothing is fetched until the household opts in), and no fitted kWh,
// no kWh - the curve and the daylight window still draw, with a line saying
// what is missing.

import React, { useState } from 'react';
import InfoPopover from '../InfoPopover.jsx';
import { Lede } from '../Screens/parts.jsx';
import useForecast from './useForecast.js';
import { dayShape, shareBefore } from '../../data/forecast.js';

const W = 320;
const H = 128;
const PAD_T = 12;
const PAD_B = 24;

// "06:23" -> "6:23am". Local clock strings throughout, never a Date - the
// forecast answers on the household's own clock and parsing it into a Date
// is how UTC drift gets back in (see data/forecast.js).
function clock(hhmm) {
  if (!hhmm) return null;
  const [h, m] = String(hhmm).split('T').pop().split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}${suffix}` : `${h12}${suffix}`;
}

// Fractional hours -> "1pm" / "1:30pm", for the peak label.
function clockFromHours(hours) {
  if (hours == null) return null;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return clock(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
}

function duration(hours) {
  if (hours == null) return null;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

const kwh = (n, dp = 0) => (n == null ? '—' : `${n.toFixed(dp)} kWh`);

// Local date, matching the dates the forecast rows are keyed on.
function localToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function Chart({ shape, nowHour }) {
  const lit = shape.hours.filter((h) => h.share > 0.001);
  if (!lit.length) return null;

  // The window drawn: the daylight the forecast reports, widened to whatever
  // radiation actually falls outside it so no part of the curve is clipped.
  const start = Math.min(Math.floor(shape.sunriseHour ?? lit[0].hour), lit[0].hour);
  const end = Math.max(Math.ceil(shape.sunsetHour ?? lit[lit.length - 1].hour + 1), lit[lit.length - 1].hour + 1);
  const span = Math.max(1, end - start);
  const x = (h) => ((h - start) / span) * W;
  const base = H - PAD_B;
  const yMax = Math.max(...lit.map((h) => h.share));
  const y = (s) => PAD_T + (1 - s / yMax) * (base - PAD_T);

  // A point per hour at the middle of that hour, joined with straight
  // segments. No spline: a curve fitted through these would overshoot
  // between them and invent radiation that was never forecast.
  //
  // Every point is CLAMPED into the drawn window. The hour marks sit at the
  // middle of their hour, so the first and last of them fall half an hour
  // outside [start, end] - unclamped (and with the SVG's overflow visible)
  // that painted the curve outside its own box and over the panel's padding.
  const clampX = (h) => Math.max(0, Math.min(W, x(h)));
  const pts = shape.hours
    .filter((h) => h.hour + 1 >= start && h.hour <= end)
    .map((h) => `${clampX(h.hour + 0.5).toFixed(1)},${y(h.share).toFixed(1)}`);
  const path = `M${clampX(start).toFixed(1)},${base} L${pts.join(' L')} L${clampX(end).toFixed(1)},${base} Z`;

  const nowX = nowHour != null && nowHour >= start && nowHour <= end ? x(nowHour) : null;

  return (
    <svg
      className="sun-curve" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={
        `Forecast sun from ${clock(shape.sunrise) ?? 'sunrise'} to ${clock(shape.sunset) ?? 'sunset'}` +
        `, strongest around ${clockFromHours(shape.peak.hour + 0.5)}`
      }
    >
      <defs>
        <linearGradient id="sun-curve-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.75" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.08" />
        </linearGradient>
      </defs>

      <path d={path} fill="url(#sun-curve-fill)" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
      <line x1="0" y1={base} x2={W} y2={base} stroke="var(--border)" strokeWidth="1" />

      {/* Where the day has got to. Only ever drawn for today. */}
      {nowX != null && (
        <>
          <line
            x1={nowX} y1={PAD_T - 6} x2={nowX} y2={base}
            stroke="var(--text)" strokeWidth="1" strokeDasharray="3 3" opacity="0.7"
          />
          <text x={Math.min(W - 16, nowX + 4)} y={PAD_T - 1} className="sun-curve-tick">now</text>
        </>
      )}

      <text x="2" y={H - 8} className="sun-curve-tick">{clock(shape.sunrise) ?? ''}</text>
      <text x={W - 2} y={H - 8} textAnchor="end" className="sun-curve-tick">{clock(shape.sunset) ?? ''}</text>
    </svg>
  );
}

export default function SunCurve({ state }) {
  const { data } = useForecast(state);
  const [offset, setOffset] = useState(0);

  const days = data?.days ?? [];
  if (!data?.location || !days.length) return null;

  const today = localToday();
  const todayIndex = Math.max(0, days.findIndex((d) => d.date === today));
  const day = days[todayIndex + offset] ?? days[todayIndex];
  const shape = day ? dayShape(day) : null;
  // No hourly radiation (an older cached forecast, or a response without the
  // block): the daily figure is still on Energy, so say nothing here rather
  // than drawing a shape that was not forecast.
  if (!shape) return null;

  const isToday = offset === 0 && day.date === today;
  const now = new Date();
  const nowHour = isToday ? now.getHours() + now.getMinutes() / 60 : null;
  const done = isToday ? shareBefore(shape, nowHour) : null;
  const toCome = shape.totalKwh != null && done != null ? shape.totalKwh * (1 - done) : null;
  const peakLabel = clockFromHours(shape.peak.hour + 0.5);

  return (
    <div className="panel">
      <div className="panel-head">
        <h3 className="panel-title">{offset === 0 ? "Today's sun" : "Tomorrow's sun"}</h3>
        <div className="mini-toggle" role="group" aria-label="Day">
          {['Today', 'Tomorrow'].map((label, i) => (
            <button
              key={label}
              className={i === offset ? 'active' : ''}
              aria-pressed={i === offset}
              onClick={() => setOffset(i)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {shape.totalKwh != null ? (
        <Lede>
          {offset === 0 ? 'Today' : 'Tomorrow'} should give about{' '}
          <strong>{kwh(shape.totalKwh)}</strong>, strongest around{' '}
          <strong>{peakLabel}</strong>
          {toCome != null && <> — about <strong>{kwh(toCome)}</strong> of it still to come</>}.
        </Lede>
      ) : (
        <Lede>
          The sun is up for <strong>{duration(shape.daylightHours) ?? '—'}</strong>, strongest around{' '}
          <strong>{peakLabel}</strong>. A kWh figure needs more of your own history before
          this can say how much that is worth in production.
        </Lede>
      )}

      <Chart shape={shape} nowHour={nowHour} />

      {/* a div, not a p: InfoPopover opens a block element and a browser
          silently closes a paragraph around one */}
      <div className="panel-foot">
        Sunrise <strong>{clock(shape.sunrise) ?? '—'}</strong> · sunset{' '}
        <strong>{clock(shape.sunset) ?? '—'}</strong>
        {shape.daylightHours != null && <> · <strong>{duration(shape.daylightHours)}</strong> of daylight</>}
        <InfoPopover label="How this curve is worked out" className="section-info">
          The height of the curve is the weather forecast's own hourly sunshine for your
          area, so a cloudy morning shows as a dip rather than being smoothed over.
          {shape.totalKwh != null && (
            <> The day's total is the same figure the Energy screen shows for {offset === 0 ? 'today' : 'tomorrow'} —
            worked out from what this roof has actually produced per unit of sunshine, not
            from panel specifications — and the curve simply spreads it across the hours.</>
          )}
          {' '}The hourly figures are that division, not measurements: your data is one row
          per day, so there is nothing to check an hour-by-hour claim against. Read it as
          when the sun turns up, not as a promise about 2pm.
        </InfoPopover>
      </div>
    </div>
  );
}
