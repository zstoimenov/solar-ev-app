// SolarForecast - the next 7 days, arranged around the decision rather than
// around the calendar.
//
// It leads with the answer (the best solar day and by how much), then today
// and tomorrow as full rows, then the rest of the week behind a toggle, and
// finally ONE combined card for the coming weekend - the days the car
// normally gets charged.
//
// The weekend is a card rather than two more rows because two more rows made
// the panel too tall to take in at a glance, which was the whole point of
// the rework. A rotating weekday off is still covered without any roster
// configuration: the best day of the week is named in the verdict block at
// the top whichever day it falls on, and the toggle lists the rest.
//
// The kWh figures are NOT modelled from panel specs. The forecast supplies
// daily shortwave radiation; data/forecast.js fits kWh-per-MJ from this
// household's own history and applies it (see that file's header). Three
// consequences the UI has to be honest about, and does:
//
//   1. Until there is enough history to fit that factor, there are no kWh
//      figures at all - the panel ranks the week on sunshine hours instead
//      and says what is missing.
//   2. Each figure is the middle of a range, so the range is drawn as the
//      bar itself rather than described in a footnote.
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
import {
  LOCATION_PRESETS, roundCoord, saveForecastLocation, typicalHouseLoadPerDay, spareForDay
} from '../../data/forecast.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const dayOf = (dateStr) => new Date(`${dateStr}T00:00:00`);

// How a person says the day out loud. Today and tomorrow win over the
// weekday name - "Saturday" is useless when Saturday is tomorrow.
function spokenDay(dateStr, index) {
  if (index === 0) return 'Today';
  if (index === 1) return 'Tomorrow';
  const d = dayOf(dateStr);
  return Number.isNaN(d.getTime()) ? dateStr : DAY_NAMES[d.getDay()];
}

function shortDate(dateStr) {
  const d = dayOf(dateStr);
  return Number.isNaN(d.getTime()) ? '' : `${SHORT_DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

const kwh = (n) => (n == null ? '—' : `${Math.round(n)} kWh`);
const deg = (n) => (n == null ? '—' : `${Math.round(n)}°`);

// Sunrise/sunset, formatted from the local clock STRING the forecast returns
// ("2026-09-02T06:23"). Deliberately not parsed into a Date - the whole
// module treats these as local clock times, and a Date is how UTC drift gets
// back in (see data/forecast.js).
function sunClock(stamp) {
  const clock = String(stamp ?? '').split('T')[1];
  if (!clock) return null;
  const [h, m] = clock.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}${suffix}` : `${h12}${suffix}`;
}

function daylightLabel(hours) {
  if (hours == null) return null;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

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

// One day, as a labelled row: the range bar carries the uncertainty, the
// caption says what the day is FOR rather than restating the number.
// `showSun` is set only on the featured rows (today, tomorrow, and Sunday on
// a Friday). The rest-of-week list stays as terse as it was - that panel was
// deliberately kept short, and a third line per day undoes it.
function DayRow({ day, scaleMax, hasKwh, highlight, showSun = false }) {
  const pctOf = (v) => (v == null || !(scaleMax > 0) ? 0 : Math.min(100, (v / scaleMax) * 100));
  const value = hasKwh ? day.kwh : day.sunshineHours;
  const hasBand = hasKwh && day.kwhLow != null && day.kwhHigh != null;

  return (
    <div className={`fc-row${highlight ? ' best' : ''}`}>
      <div className="fc-row-head">
        <span className="fc-row-name">
          {day.spoken}
          <span className="fc-row-date">{day.dateLabel} · {deg(day.tMinC)}–{deg(day.tMaxC)}</span>
        </span>
        <span className="fc-row-value">
          {hasKwh
            ? kwh(value)
            : value == null ? '—' : `${Math.round(value)} h sun`}
        </span>
      </div>

      <div className="fc-track">
        {hasBand ? (
          <>
            <div
              className="fc-band"
              style={{ left: `${pctOf(day.kwhLow)}%`, width: `${pctOf(day.kwhHigh) - pctOf(day.kwhLow)}%` }}
            />
            <div className="fc-mark" style={{ left: `${pctOf(day.kwh)}%` }} />
          </>
        ) : (
          <div className="fc-fill" style={{ width: `${pctOf(value)}%` }} />
        )}
      </div>

      {showSun && (day.sunrise || day.sunset) && (
        <div className="fc-row-sun">
          Sun {sunClock(day.sunrise) ?? '—'} to {sunClock(day.sunset) ?? '—'}
          {day.daylightHours != null && ` · ${daylightLabel(day.daylightHours)} of daylight`}
        </div>
      )}

      {day.note && <div className="fc-row-note">{day.note}</div>}
    </div>
  );
}

// The coming weekend as ONE card: the two days side by side, each with its
// own figure and bar so they are directly comparable, plus the combined
// total. It replaces two more full-height rows - the panel was getting too
// tall to take in at a glance, which is what the rework was for.
function WeekendCard({ days, scaleMax, hasKwh }) {
  const [sat, sun] = days;
  const valueOf = (d) => (hasKwh ? d.kwh : d.sunshineHours);
  const shown = (d) =>
    valueOf(d) == null ? '—' : hasKwh ? Math.round(d.kwh) : `${Math.round(d.sunshineHours)} h`;

  const totalKwh = hasKwh && sat.kwh != null && sun.kwh != null ? sat.kwh + sun.kwh : null;
  const totalSpare =
    sat.spareKwh != null && sun.spareKwh != null ? sat.spareKwh + sun.spareKwh : null;
  // Which of the two is worth choosing. Marked with a tick and named in
  // words, never by colour alone.
  const better =
    valueOf(sat) != null && valueOf(sun) != null
      ? valueOf(sun) > valueOf(sat) ? sun : sat
      : null;

  return (
    <div className="fc-weekend">
      <div className="fc-weekend-head">
        <span className="label">This weekend</span>
        <span className="small">
          {totalKwh != null ? `${Math.round(totalKwh)} kWh` : ''}
          {totalKwh != null && totalSpare != null ? ` · ${Math.round(totalSpare)} spare` : ''}
        </span>
      </div>

      <div className="fc-weekend-days">
        {days.map((d) => {
          const isBetter = better && d.date === better.date;
          const pct = scaleMax > 0 && valueOf(d) != null
            ? Math.min(100, (valueOf(d) / scaleMax) * 100)
            : 0;
          return (
            <div className="fc-weekend-day" key={d.date}>
              <div className="fc-weekend-day-head">
                <span className={isBetter ? 'fc-weekend-name best' : 'fc-weekend-name'}>
                  {DAY_NAMES[d.weekday]}{isBetter ? ' ✓' : ''}
                </span>
                <span className="fc-weekend-value">{shown(d)}</span>
              </div>
              <div className="fc-weekend-track">
                <div className={isBetter ? 'fc-weekend-fill best' : 'fc-weekend-fill'} style={{ width: `${pct}%` }} />
              </div>
              <div className="fc-weekend-sub">
                {d.spareKwh != null ? `${Math.round(d.spareKwh)} kWh spare · ` : ''}
                {deg(d.tMinC)}–{deg(d.tMaxC)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="fc-weekend-foot">
        {hasKwh ? 'kWh expected' : 'Hours of sun'}
        {better ? ` · ${DAY_NAMES[better.weekday]} is the better of the two.` : ''}
      </div>
    </div>
  );
}

export default function SolarForecast({ state, onConfigChange }) {
  const { data, loading, reload, hasLocation } = useForecast(state);
  const [changing, setChanging] = useState(false);
  const [showAll, setShowAll] = useState(false);

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

  const raw = data?.days ?? [];
  const cal = data?.calibration;
  const hasKwh = raw.some((d) => d.kwh != null);

  // What the house itself usually draws in a day, so a day's production can
  // be reported as what is actually going spare for the car. Energy only.
  const houseLoad = typicalHouseLoadPerDay(state?.monthlyDigests);

  const days = raw.map((d, i) => {
    // Measured from days this roof actually had, where there are enough of
    // them; the old production-minus-house-load subtraction otherwise.
    const spare = hasKwh ? spareForDay(cal, d, houseLoad) : null;
    return {
      ...d,
      index: i,
      weekday: dayOf(d.date).getDay(),
      spoken: spokenDay(d.date, i),
      dateLabel: shortDate(d.date),
      spareKwh: spare?.kwh ?? null,
      spareBasis: spare?.basis ?? null,
      spareDays: spare?.n ?? null
    };
  });
  const spareIsMeasured = days.some((d) => d.spareBasis?.startsWith('measured'));
  const spareSampleDays = days.find((d) => d.spareBasis?.startsWith('measured'))?.spareDays ?? null;

  const ranked = days.filter((d) => (hasKwh ? d.kwh != null : d.radiationMj != null))
    .sort((a, b) => (hasKwh ? b.kwh - a.kwh : b.radiationMj - a.radiationMj));
  const best = ranked[0] ?? null;
  const others = ranked.slice(1);
  const otherAvg = hasKwh && others.length
    ? others.reduce((a, d) => a + d.kwh, 0) / others.length
    : null;
  const quietest = ranked.length > 1 ? ranked[ranked.length - 1] : null;

  // Only the two days decided in the next 24 hours get a full row - except
  // on a Friday, when the weekend starts tomorrow: Sunday joins as a third
  // row so the whole weekend is on screen as rows, and the card below drops
  // out rather than showing Saturday twice.
  const featured = days.filter((d) => d.index <= 1);
  if (days[1]?.weekday === 6 && days[2]) featured.push(days[2]);
  const inRows = new Set(featured.map((d) => d.date));
  const rest = days.filter((d) => !inRows.has(d.date));

  // The coming weekend as one card. Any 7-day window contains exactly one
  // Saturday and one Sunday, so both are always available - but the card is
  // shown ONLY while both are still ahead of the rows above. Once either has
  // become today or tomorrow (Friday, Saturday, Sunday) the rows are the
  // weekend, and a card would only repeat them.
  const saturday = days.find((d) => d.weekday === 6) ?? null;
  const sunday = days.find((d) => d.weekday === 0) ?? null;
  const weekend =
    saturday && sunday && !inRows.has(saturday.date) && !inRows.has(sunday.date)
      ? [saturday, sunday]
      : null;

  // One scale for every bar in the panel, so rows are comparable by length.
  const scaleMax = hasKwh
    ? Math.max(...days.map((d) => d.kwhHigh ?? d.kwh ?? 0), 0)
    : Math.max(...days.map((d) => d.sunshineHours ?? 0), 0);

  const noteFor = (d) => {
    if (!hasKwh) return null;
    if (best && d.date === best.date) {
      return d.spareKwh != null
        ? `Best of the week — about ${kwh(d.spareKwh)} spare for the car.`
        : 'Best of the week.';
    }
    if (quietest && d.date === quietest.date) return 'The quietest day this week.';
    if (d.spareKwh != null) return `About ${kwh(d.spareKwh)} spare for the car.`;
    return null;
  };
  for (const d of days) d.note = noteFor(d);

  const spreadPct =
    cal?.lowRatio != null && cal?.highRatio != null
      ? Math.round(((cal.highRatio - cal.lowRatio) / 2) * 100)
      : null;

  // What the panel has actually been measured to get right, as opposed to how
  // tightly this roof scatters around its own fit. Only present once enough
  // logged days have had their real production arrive on a monthly upload.
  const acc = data?.accuracy;
  const measuredPct = acc?.pooled ? Math.round(acc.pooled.mapePct) : null;
  const biasPct = acc?.biasFactor ? Math.round(Math.abs(1 - acc.biasFactor) * 100) : null;
  const leadRows = acc
    ? [0, 1, 2, 3, 4, 5, 6]
        .filter((lead) => acc.byLead?.[lead])
        .map((lead) => ({ lead, ...acc.byLead[lead] }))
    : [];
  const leadName = (lead) => (lead === 0 ? 'Today' : lead === 1 ? 'Tomorrow' : `${lead} days out`);

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

      {/* The answer, at the size of the answer. */}
      {best && (
        <div className="fc-verdict">
          <div className="label">{hasKwh ? 'Best day this week' : 'Sunniest day this week'}</div>
          <div className="fc-verdict-head">
            <span className="fc-verdict-day">{best.spoken}</span>
            {hasKwh && <span className="fc-verdict-value">{kwh(best.kwh)}</span>}
          </div>
          <div className="fc-verdict-sub">
            {hasKwh && otherAvg != null
              ? <>Against {kwh(otherAvg)} on the other days.
                  {best.kwhLow != null && best.kwhHigh != null
                    && ` Likely ${Math.round(best.kwhLow)}–${Math.round(best.kwhHigh)} kWh.`}</>
              : <>{best.dateLabel}
                  {best.sunshineHours != null && ` · ${Math.round(best.sunshineHours)} hours of sun`}</>}
          </div>
        </div>
      )}

      <div className="fc-rows">
        {featured.map((d) => (
          <DayRow
            key={d.date}
            day={d}
            scaleMax={scaleMax}
            hasKwh={hasKwh}
            showSun
            highlight={best && d.date === best.date}
          />
        ))}
      </div>

      {/* The rest of the week: never gone, just not competing for attention.
          This is also where a day off gets looked up. */}
      {rest.length > 0 && (
        <>
          <button className="fc-more" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
            <span className="small">{showAll ? 'Hide the other days' : 'Rest of the week'}</span>
            {!showAll && (
              <span className="fc-spark" aria-hidden="true">
                {days.map((d) => {
                  const v = hasKwh ? d.kwh : d.sunshineHours;
                  const h = scaleMax > 0 && v != null ? Math.max(8, (v / scaleMax) * 100) : 8;
                  return (
                    <span
                      key={d.date}
                      className={best && d.date === best.date ? 'best' : ''}
                      style={{ height: `${h}%` }}
                    />
                  );
                })}
              </span>
            )}
            <span className="small">{showAll ? 'Close' : 'Show'}</span>
          </button>

          {showAll && (
            <div className="fc-rows fc-rows-rest">
              {rest.map((d) => (
                <DayRow key={d.date} day={d} scaleMax={scaleMax} hasKwh={hasKwh} />
              ))}
            </div>
          )}
        </>
      )}

      {weekend && (
        <WeekendCard days={weekend} scaleMax={scaleMax} hasKwh={hasKwh} />
      )}

      {!hasKwh && (
        <div className="panel-foot">
          No kWh estimate yet — that needs enough of your own production to compare
          against past weather
          {cal?.monthlyPairs != null && cal.monthlyPairs > 0
            ? ` (${cal.monthlyPairs} complete month${cal.monthlyPairs === 1 ? '' : 's'} matched so far, 6 needed)`
            : ''}
          . The week is ranked on sunshine hours instead.
          <InfoPopover label="Why there is no kWh figure yet" className="section-info">
            The estimate is not modelled from panel specifications — it is fitted from
            what this roof actually produced on past days with known sunlight, which is
            what makes it account for your tilt, shading and soiling without anyone
            typing them in. Until there are enough matched days (30) or complete months
            (6), there is nothing honest to fit, so no number is shown. Every monthly
            upload brings it closer.
          </InfoPopover>
        </div>
      )}

      {hasKwh && (
        <div className="panel-foot">
          {cal.method === 'daily'
            ? `Fitted from ${cal.samples} of your own days against the sunlight they got`
            : `Fitted from ${cal.samples} complete months against the sunlight they got`}
          {measuredPct != null
            ? `, and has landed within about ${measuredPct}% of what actually happened across ${acc.scoredDays} days since`
            : spreadPct
              ? `, and typically lands within about ${spreadPct}% of the figure shown`
              : ''}.
          {data?.fetchedAt && ` Checked ${timeLabel(data.fetchedAt)}.`}
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
                ? 'It is currently fitted on whole-month totals, because there are not yet 30 days of daily readings. Month-to-month scatter is much tighter than day-to-day scatter, so a single day is a rougher figure than the fit suggests; it sharpens once daily data builds up.'
                : cal.narrowSeason
                  ? `It is fitted on days spanning only ${cal.seasonMonths} months of the year so far, so it has not yet seen how this roof behaves in every season: a hot day loses efficiency, and a low winter sun casts longer shadows. It re-fits as the year fills in.`
                  : 'The fit spans a full year of your own days, so it already carries how this roof behaves across the seasons.'}
            </p>

            {leadRows.length > 0 ? (
              <>
                <p>
                  The range on each bar is measured, not assumed: every figure this panel has
                  shown is recorded and later checked against what your roof actually produced
                  that day. What is drawn is how wrong this panel has really been that far
                  ahead, which is why tomorrow is tighter than Sunday.
                </p>
                <div className="small">
                  {leadRows.map((r) => (
                    <div key={r.lead}>
                      {leadName(r.lead)}: within about {Math.round(r.mapePct)}% ({r.n} days
                      checked)
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p>
                {cal.lowRatio != null
                  ? 'The bar is the middle 60% of your own days around the fit, and the line is the middle of it. It does not yet include the weather forecast itself being wrong, which grows through the week: day six or seven is a much softer number than tomorrow.'
                  : 'There is no range on the bars yet.'}{' '}
                Every figure shown here is now recorded and checked against what actually
                happened, so the bars become a measured range instead. Real production only
                arrives with a monthly upload, so that takes a few weeks to appear.
              </p>
            )}

            {biasPct != null && (
              <p>
                Across those days this roof has run about {biasPct}%{' '}
                {acc.biasFactor < 1 ? 'below' : 'above'} the fitted figure, so the numbers
                above are adjusted to match what it has actually delivered rather than what
                the fit alone would say.
              </p>
            )}

            {acc?.pendingEntries > 0 && (
              <p className="small">
                {acc.pendingEntries} logged{' '}
                {acc.pendingEntries === 1 ? 'figure is' : 'figures are'} still waiting on a
                monthly upload to bring the matching production in.
              </p>
            )}

            {cal.radiationSource === 'archive' && (
              <p className="small">
                Calibrated against the reanalysis archive rather than the forecast models&apos;
                own history, because that service was unavailable. It re-fits against the right
                one automatically once it is back.
              </p>
            )}
            <p>
              {spareIsMeasured
                ? `"Spare for the car" is measured, not assumed: on the ${spareSampleDays} past days when this roof made about as much as the day shown, this is how much energy actually went spare - what was exported, plus what the car took straight off the panels. Your house, your appliances and your battery are all already inside that figure, because it is what really happened.`
                : '"Spare for the car" is the day\u2019s expected production less what your house alone has typically drawn per day over recent months. It is a whole-day energy figure, not a plan for the day: it does not know when the sun and your appliances coincide, or where the battery will be sitting. Once there are enough comparable days on record it switches to what actually went spare on them.'}
            </p>
            {spareIsMeasured && (
              <p className="small">
                It counts what left the property, so it stays on the cautious side: energy
                the car could have taken from the battery is not in it, because whether that
                is there tomorrow depends on where the battery is sitting.
              </p>
            )}
            <p>
              These are daily totals, so nothing here is converted into dollars — the
              same limit that keeps Plan Comparison to EV charging only.
            </p>
          </InfoPopover>
        </div>
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
