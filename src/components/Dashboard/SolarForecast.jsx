// SolarForecast - the next 7 days: temperature, and what this roof should
// produce on each of them.
//
// The kWh figures are NOT modelled from panel specs. The forecast supplies
// daily shortwave radiation; data/forecast.js fits kWh-per-MJ from this
// household's own history and applies it (see that file's header). Three
// consequences the UI has to be honest about, and does:
//
//   1. Until there is enough history to fit that factor, there are no kWh
//      figures at all - temperature and sunshine only, and a line saying so.
//   2. The figure is the middle of a range, so the panel states the spread
//      once rather than printing seven false-precision numbers.
//   3. It is a daily total. It does not know when in the day the sun and the
//      load line up, which is why nothing here is expressed in dollars.
//
// It is also the only screen in the app that makes an outbound request, so
// it stays off until the household picks a location, and it says where the
// data goes before they do.

import React, { useState } from 'react';
import InfoPopover from '../InfoPopover.jsx';
import { Lede } from '../Screens/parts.jsx';
import useForecast from './useForecast.js';
import { LOCATION_PRESETS, roundCoord, saveForecastLocation } from '../../data/forecast.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayLabel(dateStr, index) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  const name = index === 0 ? 'Today' : index === 1 ? 'Tomorrow' : DAY_NAMES[d.getDay()];
  return `${name} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// The lede names the day the way a person would say it out loud, which is
// not the same string as the row label ("Fri 4 Sep").
function spokenDay(dateStr, index) {
  if (index === 0) return 'Today';
  if (index === 1) return 'Tomorrow';
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(d.getTime()) ? dateStr : FULL_DAY_NAMES[d.getDay()];
}

const kwh = (n) => (n == null ? '—' : `${Math.round(n)} kWh`);
const deg = (n) => (n == null ? '—' : `${Math.round(n)}°`);

function timeLabel(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}

// Location setup. No coordinate is shipped as a default - the household
// either uses the browser's own location (rounded to ~11 km before it is
// stored or sent) or picks a coarse area from the list.
function LocationSetup({ onSaved }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function pick(location) {
    setBusy(true); setErr(null);
    try {
      await saveForecastLocation(location);
      onSaved?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function useDeviceLocation() {
    if (!navigator.geolocation) { setErr('This browser cannot report a location.'); return; }
    setBusy(true); setErr(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        pick({
          latitude: roundCoord(pos.coords.latitude),
          longitude: roundCoord(pos.coords.longitude),
          label: 'Your area'
        });
      },
      (e) => { setBusy(false); setErr(e.message || 'Location request was refused.'); },
      { timeout: 10000, maximumAge: 3600000 }
    );
  }

  return (
    <div className="forecast-setup">
      <p className="small">
        This is the one part of the app that talks to the internet. Turning it on sends
        an approximate location — rounded to about 11 km, never your address — to the
        Open-Meteo weather service. No account, no key, nothing about your energy data
        leaves this device.
      </p>
      <div className="row">
        <button className="primary" disabled={busy} onClick={useDeviceLocation}>
          Use my location
        </button>
      </div>
      <p className="small" style={{ marginBottom: '.35rem' }}>Or pick an area:</p>
      <div className="forecast-presets">
        {LOCATION_PRESETS.map((p) => (
          <button key={p.label} className="ghost" disabled={busy} onClick={() => pick(p)}>
            {p.label}
          </button>
        ))}
      </div>
      {err && <p className="small err-text">{err}</p>}
    </div>
  );
}

export default function SolarForecast({ state, onConfigChange }) {
  const { data, loading, reload, hasLocation } = useForecast(state);
  const [changing, setChanging] = useState(false);

  if (!hasLocation || changing) {
    return (
      <div className="panel">
        <div className="panel-head">
          <h3 className="panel-title">Next 7 days</h3>
          {changing && (
            <button className="ghost small-btn" onClick={() => setChanging(false)}>Cancel</button>
          )}
        </div>
        {!hasLocation && (
          <Lede>See what the weather should give you this week, before it happens.</Lede>
        )}
        <LocationSetup onSaved={() => { setChanging(false); onConfigChange?.(); }} />
      </div>
    );
  }

  const days = data?.days ?? [];
  const cal = data?.calibration;
  const hasKwh = days.some((d) => d.kwh != null);
  const maxKwh = hasKwh ? Math.max(...days.filter((d) => d.kwh != null).map((d) => d.kwh)) : null;
  const maxRadiation = days.length
    ? Math.max(...days.filter((d) => d.radiationMj != null).map((d) => d.radiationMj), 0)
    : 0;

  // The best day is worth saying in words - it is the one thing on this
  // panel that changes what a household actually does this week.
  const ranked = [...days].filter((d) => d.kwh != null).sort((a, b) => b.kwh - a.kwh);
  const best = ranked[0];
  const bestIndex = best ? days.findIndex((d) => d.date === best.date) : -1;
  const others = ranked.slice(1);
  const otherAvg = others.length ? others.reduce((a, d) => a + d.kwh, 0) / others.length : null;

  const spreadPct =
    cal?.lowRatio != null && cal?.highRatio != null
      ? Math.round(((cal.highRatio - cal.lowRatio) / 2) * 100)
      : null;

  return (
    <div className="panel">
      <div className="panel-head">
        <h3 className="panel-title">Next 7 days</h3>
        <button className="ghost small-btn" onClick={reload} disabled={loading}>
          {loading ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      {data?.error && (
        <div className="banner warn compact">
          <span>
            {data.error}{' '}
            {days.length ? 'Showing the last forecast that came through.' : ''}
          </span>
        </div>
      )}

      {best && otherAvg != null ? (
        <Lede>
          <strong>{spokenDay(best.date, bestIndex)}</strong> is the best solar day this
          week — about <strong>{kwh(best.kwh)}</strong> against{' '}
          {kwh(otherAvg)} on the other days.
        </Lede>
      ) : hasKwh ? null : (
        <Lede>The week ahead, and how much sun it should bring.</Lede>
      )}

      <div className="forecast-list">
        {days.map((d, i) => {
          const width = hasKwh
            ? d.kwh != null && maxKwh > 0 ? (d.kwh / maxKwh) * 100 : 0
            : d.radiationMj != null && maxRadiation > 0 ? (d.radiationMj / maxRadiation) * 100 : 0;
          return (
            <div className={`forecast-day${i === bestIndex ? ' best' : ''}`} key={d.date}>
              <div className="forecast-row">
                <span className="forecast-name">{dayLabel(d.date, i)}</span>
                <span className="forecast-temp">
                  {deg(d.tMinC)}–{deg(d.tMaxC)}
                  {d.rainMm != null && d.rainMm >= 1 && (
                    <span className="forecast-rain"> · {Math.round(d.rainMm)} mm</span>
                  )}
                </span>
                <span className="forecast-kwh">
                  {hasKwh
                    ? kwh(d.kwh)
                    : d.sunshineHours == null ? '—' : `${Math.round(d.sunshineHours)} h sun`}
                </span>
              </div>
              {/* Sequential magnitude: one hue, dim to bright - never a
                  rainbow, same rule as the daily calendar. */}
              <div className="forecast-track">
                <div className="forecast-fill" style={{ width: `${width}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {!hasKwh && (
        <p className="panel-foot">
          No kWh estimate yet — that needs enough of your own production to compare
          against past weather
          {cal?.monthlyPairs != null && cal.monthlyPairs > 0
            ? ` (${cal.monthlyPairs} complete month${cal.monthlyPairs === 1 ? '' : 's'} matched so far, 6 needed)`
            : ''}
          . Temperature and sunshine are the forecast&apos;s own figures.
          <InfoPopover label="Why there is no kWh figure yet" className="section-info">
            The estimate is not modelled from panel specifications — it is fitted from
            what this roof actually produced on past days with known sunlight, which is
            what makes it account for your tilt, shading and soiling without anyone
            typing them in. Until there are enough matched days (30) or complete months
            (6), there is nothing honest to fit, so no number is shown. Every monthly
            upload brings it closer.
          </InfoPopover>
        </p>
      )}

      {hasKwh && (
        <p className="panel-foot">
          {cal.method === 'daily'
            ? `Fitted from ${cal.samples} of your own days against the sunlight they got`
            : `Fitted from ${cal.samples} complete months against the sunlight they got`}
          {spreadPct ? `, and typically lands within about ${spreadPct}% of the figure shown` : ''}.
          {data?.fetchedAt && ` Forecast as of ${timeLabel(data.fetchedAt)}.`}
          <InfoPopover label="How these kWh figures are worked out" className="section-info">
            <p>
              The forecast gives the sunlight energy expected on each day. Your own
              history says how many kWh this roof has produced per unit of that
              sunlight, so the estimate carries your array size, tilt, shading, soiling
              and inverter limits without any of them being entered by hand — and it
              re-fits as your data grows.
            </p>
            <p>
              {cal.method === 'monthly'
                ? 'It is currently fitted on whole-month totals, because there are not yet 30 days of daily readings. Month-to-month scatter is much tighter than day-to-day scatter, so treat a single day as a rougher figure than the fit suggests; it sharpens once daily data builds up.'
                : 'The spread quoted is the middle 60% of your own days around the fit. It does not include the weather forecast being wrong, which grows through the week — day six or seven is a much softer number than tomorrow.'}
            </p>
            <p>
              These are daily totals. The app has no hour-by-hour household usage, so
              nothing here is converted into dollars — the same limit that keeps Plan
              Comparison to EV charging only.
            </p>
          </InfoPopover>
        </p>
      )}

      <div className="forecast-foot-row">
        <span className="small">
          {data?.location?.label ?? 'Set area'} · {data?.location?.latitude}, {data?.location?.longitude}
        </span>
        <button className="ghost small-btn" onClick={() => setChanging(true)}>Change area</button>
      </div>
    </div>
  );
}
