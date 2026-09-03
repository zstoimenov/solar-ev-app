// SolarForecast - the next 7 days, arranged around the decision rather than
// around the calendar.
//
// It leads with the answer (the best solar day), then draws the whole week as
// ONE strip of seven columns, then says everything about whichever day is
// selected in a card underneath, and finally shows the coming weekend as a
// two-up card - the days the car normally gets charged.
//
// WHY A STRIP (v2.14). The panel used to render the same seven days three
// times over: two full rows at the top, a sparkline on the toggle, and the
// weekend card. Three idioms for one set of facts, 735px closed and 1172px
// open on a 915px phone, and four to five lines of prose per day. The strip
// is one rendering of the week - every day permanently visible, comparable by
// height on a shared scale - and the per-day prose collapses into one card
// that follows the selection. Nothing was dropped: the temperatures, the
// likely range, the spare-for-the-car figure and the best/quietest notes all
// live in that card, and the weekend keeps its own card as before.
//
// The "Rest of the week" toggle is gone with the rows. It existed because the
// other five days had nowhere to be; on the strip they are simply there, so a
// rotating day off no longer costs a tap to look up.
//
// Sunrise and sunset were also dropped from here (v2.14). They were printed
// identically on both featured rows, and Home's sun curve already shows them
// against the shape of the day, which is where they mean something.
//
// The kWh figures are NOT modelled from panel specs. The forecast supplies
// daily shortwave radiation; data/forecast.js fits kWh-per-MJ from this
// household's own history and applies it (see that file's header). Three
// consequences the UI has to be honest about, and does:
//
//   1. Until there is enough history to fit that factor, there are no kWh
//      figures at all - the panel ranks the week on sunshine hours instead
//      and says what is missing.
//   2. Each figure is the middle of a range, so the range is drawn INTO the
//      column (a solid stem to the low end, a dim extent to the high one, a
//      bright line at the middle) rather than described in a footnote.
//   3. It is a daily total. It does not know when in the day the sun and the
//      load line up, which is why nothing here is expressed in dollars.
//
// It is also the only screen in the app that makes an outbound request, so
// it stays off until the household picks a location, and it says where the
// data goes before they do.

import React, { useState } from 'react';
import InfoPopover from '../InfoPopover.jsx';
import { Lede } from '../Screens/parts.jsx';
import { ClearIcon, PartlyCloudyIcon, CloudyIcon, RainIcon } from './icons.jsx';
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

// The same thing again, short enough to sit under a 44px-wide column.
function stripLabel(dateStr, index) {
  if (index === 0) return 'Today';
  const d = dayOf(dateStr);
  return Number.isNaN(d.getTime()) ? dateStr : SHORT_DAYS[d.getDay()];
}

// "Thu 3 Sep" beside Today and Tomorrow, "9 Sep" beside a day already named
// by its weekday - otherwise the detail card reads "Wednesday  Wed 9 Sep".
function shortDate(dateStr, index) {
  const d = dayOf(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return index <= 1 ? `${SHORT_DAYS[d.getDay()]} ${day}` : day;
}

const kwh = (n) => (n == null ? '—' : `${Math.round(n)} kWh`);
const deg = (n) => (n == null ? '—' : `${Math.round(n)}°`);

// What the sky is doing, from the cloud cover and rainfall the forecast
// already returns and the panel used to throw away. Four states is all the
// resolution a daily mean supports, and each carries a word as well as a
// glyph - a picture alone is not a label.
function skyFor(day) {
  if (day.rainMm != null && day.rainMm >= 1) {
    return { Icon: RainIcon, label: day.rainMm >= 5 ? 'Rain' : 'Showers' };
  }
  if (day.cloudPct == null) return { Icon: ClearIcon, label: 'Clear' };
  if (day.cloudPct >= 70) return { Icon: CloudyIcon, label: 'Overcast' };
  if (day.cloudPct >= 30) return { Icon: PartlyCloudyIcon, label: 'Some cloud' };
  return { Icon: ClearIcon, label: 'Clear' };
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

// The week as seven columns on one shared scale, so the answer to "which day"
// is a shape rather than seven numbers to compare in your head.
//
// Each column stacks the uncertainty rather than hiding it: a solid stem up
// to the LOW end of the likely range, a dim extent from there to the HIGH
// end, and a bright line at the middle - the figure quoted everywhere else.
// A monthly-fitted calibration has no daily band, so those columns are a
// plain fill and the InfoPopover says why.
//
// One hue throughout (the accent), because this is a magnitude: brightness
// and height carry it, and nothing here is a category. The best day is marked
// by a dot AND named in the verdict above; the selected day by a ring AND the
// card below - colour is never the only thing saying which is which.
function WeekStrip({ days, scaleMax, hasKwh, bestDate, selectedDate, onSelect }) {
  const pct = (v) => (v == null || !(scaleMax > 0) ? 0 : Math.min(100, (v / scaleMax) * 100));

  return (
    <div className="fc-strip" role="group" aria-label="The next seven days">
      {days.map((d) => {
        const value = hasKwh ? d.kwh : d.sunshineHours;
        const hasBand = hasKwh && d.kwhLow != null && d.kwhHigh != null;
        const top = hasBand ? Math.max(d.kwhHigh, d.kwh ?? 0) : value;
        const topPct = pct(top);
        // Heights inside the stack are relative to the stack, not the track.
        const within = (v) => (topPct > 0 ? Math.min(100, (pct(v) / topPct) * 100) : 0);
        const isBest = d.date === bestDate;
        const isSelected = d.date === selectedDate;
        const { Icon, label: skyLabel } = skyFor(d);
        const shown = value == null ? '—' : hasKwh ? Math.round(value) : `${Math.round(value)}h`;

        const classes = ['fc-col'];
        if (isSelected) classes.push('selected');
        if (isBest) classes.push('best');
        if (d.weekday === 0 || d.weekday === 6) classes.push('weekend');

        return (
          <button
            key={d.date}
            type="button"
            className={classes.join(' ')}
            aria-pressed={isSelected}
            aria-label={
              `${d.spoken}, ${d.dateLabel}. ${skyLabel}. ` +
              (value == null
                ? 'No figure.'
                : hasKwh ? `${Math.round(value)} kilowatt hours.` : `${Math.round(value)} hours of sun.`) +
              (isBest ? ' Best day this week.' : '')
            }
            onClick={() => onSelect(d.date)}
          >
            <span className="fc-col-flag" aria-hidden="true">{isBest ? '●' : ''}</span>
            <span className="fc-col-sky" aria-hidden="true"><Icon width="16" height="16" /></span>
            <span className="fc-col-value">{shown}</span>
            <span className="fc-col-track">
              <span className="fc-col-stack" style={{ height: `${topPct}%` }}>
                {hasBand ? (
                  <>
                    <span className="fc-col-band" />
                    <span className="fc-col-solid" style={{ height: `${within(d.kwhLow)}%` }} />
                    <span className="fc-col-mark" style={{ bottom: `${within(d.kwh)}%` }} />
                  </>
                ) : (
                  <span className="fc-col-solid" style={{ height: '100%' }} />
                )}
              </span>
            </span>
            <span className="fc-col-label">{d.stripLabel}</span>
          </button>
        );
      })}
    </div>
  );
}

// Everything the old day row said, for ONE day at a time: the figure and its
// likely range, the sky in a word, the temperatures, and what is going spare
// for the car. It follows the strip's selection and starts on today.
function DayDetail({ day, hasKwh }) {
  const { Icon, label: skyLabel } = skyFor(day);
  // "16-16 kWh" is what rounding does to a tight band, and it reads as a
  // bug. Only show a range once the two ends round to different numbers.
  const lo = day.kwhLow == null ? null : Math.round(day.kwhLow);
  const hi = day.kwhHigh == null ? null : Math.round(day.kwhHigh);
  const range = hasKwh && lo != null && hi != null && hi > lo ? `${lo}–${hi}` : null;

  return (
    <div className="fc-detail">
      <div className="fc-detail-head">
        <span className="fc-detail-day">
          {day.spoken}
          <span className="fc-detail-date">{day.dateLabel}</span>
        </span>
        <span className="fc-detail-value">
          {hasKwh
            ? kwh(day.kwh)
            : day.sunshineHours == null ? '—' : `${Math.round(day.sunshineHours)} h sun`}
          {range && <span className="fc-detail-range">likely {range}</span>}
        </span>
      </div>

      <div className="fc-detail-stats">
        <span className="fc-detail-stat">
          <span className="fc-detail-icon" aria-hidden="true"><Icon width="15" height="15" /></span>
          {skyLabel}
        </span>
        <span className="fc-detail-stat">{deg(day.tMinC)}–{deg(day.tMaxC)}</span>
        {day.spareKwh != null && (
          <span className="fc-detail-stat">
            <strong>{kwh(day.spareKwh)}</strong> spare for the car
          </span>
        )}
      </div>

      {day.note && <div className="fc-detail-note">{day.note}</div>}
    </div>
  );
}

// The coming weekend as ONE card: the two days side by side, each with its
// own figure and bar so they are directly comparable, plus the combined
// total. Saturday and Sunday are when the car goes on the charger, so they
// keep a card of their own even though the strip above also shows them - the
// question it answers is "which of the two", not "which day of the week".
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
  // Which column the detail card is showing. null means "today", resolved
  // below - storing the date itself would go stale the moment the forecast
  // rolls over at midnight.
  const [picked, setPicked] = useState(null);

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
      stripLabel: stripLabel(d.date, i),
      dateLabel: shortDate(d.date, i),
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

  // The coming weekend keeps a card of its own. Any 7-day window contains
  // exactly one Saturday and one Sunday, so both are always available.
  const saturday = days.find((d) => d.weekday === 6) ?? null;
  const sunday = days.find((d) => d.weekday === 0) ?? null;
  const weekend = saturday && sunday ? [saturday, sunday] : null;

  // One scale for every column in the panel, so days are comparable by
  // height and the weekend card's bars line up with the strip's.
  const scaleMax = hasKwh
    ? Math.max(...days.map((d) => d.kwhHigh ?? d.kwh ?? 0), 0)
    : Math.max(...days.map((d) => d.sunshineHours ?? 0), 0);

  const noteFor = (d) => {
    if (!hasKwh) return null;
    if (best && d.date === best.date) return 'The best day this week.';
    if (quietest && d.date === quietest.date) return 'The quietest day this week.';
    return null;
  };
  for (const d of days) d.note = noteFor(d);

  // The selection falls back to today whenever the picked day is not in the
  // window any more - which is what happens the first time the app is opened
  // on the following day.
  const selected = days.find((d) => d.date === picked) ?? days[0] ?? null;

  const bestLift =
    hasKwh && best && otherAvg ? Math.round(((best.kwh - otherAvg) / otherAvg) * 100) : null;

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

      {/* The answer, at the size of the answer. One line: the strip below
          shows how far ahead it is, so the old two-sentence sub-line only
          restated what the columns already say. */}
      {best && (
        <div className="fc-verdict">
          <div className="fc-verdict-top">
            <span className="label">{hasKwh ? 'Best day this week' : 'Sunniest day this week'}</span>
            {bestLift != null && bestLift > 0 && (
              <span className="fc-verdict-lift">+{bestLift}% on the rest</span>
            )}
          </div>
          <div className="fc-verdict-head">
            <span className="fc-verdict-day">{best.spoken}</span>
            {hasKwh
              ? <span className="fc-verdict-value">{kwh(best.kwh)}</span>
              : best.sunshineHours != null
                && <span className="fc-verdict-value">{Math.round(best.sunshineHours)} h sun</span>}
          </div>
        </div>
      )}

      <WeekStrip
        days={days}
        scaleMax={scaleMax}
        hasKwh={hasKwh}
        bestDate={best?.date ?? null}
        selectedDate={selected?.date ?? null}
        onSelect={setPicked}
      />

      {selected && <DayDetail day={selected} hasKwh={hasKwh} />}

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
            <p>
              Each column is read from the bottom up: the solid part is the low end of
              the likely range, the dim part above it the high end, and the bright line
              is the figure quoted — the middle. Tap a column to see that day in full.
              {cal.lowRatio == null && ' A monthly-fitted estimate has no daily range, so the columns are a plain fill until there are enough daily readings.'}
            </p>

            {leadRows.length > 0 ? (
              <>
                <p>
                  That range is measured, not assumed: every figure this panel has
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
                  ? 'The range is the middle 60% of your own days around the fit. It does not yet include the weather forecast itself being wrong, which grows through the week: day six or seven is a much softer number than tomorrow.'
                  : 'There is no range on the columns yet.'}{' '}
                Every figure shown here is now recorded and checked against what actually
                happened, so the columns become a measured range instead. Real production only
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
                : '"Spare for the car" is the day’s expected production less what your house alone has typically drawn per day over recent months. It is a whole-day energy figure, not a plan for the day: it does not know when the sun and your appliances coincide, or where the battery will be sitting. Once there are enough comparable days on record it switches to what actually went spare on them.'}
            </p>
            {spareIsMeasured && (
              <p className="small">
                It counts what left the property, so it stays on the cautious side: energy
                the car could have taken from the battery is not in it, because whether that
                is there tomorrow depends on where the battery is sitting.
              </p>
            )}
            <p>
              The sky icon is the day&apos;s average cloud cover and expected rainfall, which
              is why a bright day can still sit under a cloud: it is a daily mean, not an
              hour-by-hour outlook. Sunrise and sunset are on the Home screen, drawn against
              the shape of the day.
            </p>
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
