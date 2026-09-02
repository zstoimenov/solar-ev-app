// forecast.js - the 7-day weather forecast and the expected solar yield
// derived from it. This is the ONLY part of the app that talks to the
// internet, and it stays inside the same rules as everything else:
//
//   * No API key. Open-Meteo needs none, which is what makes this possible
//     at all - the bundle is public, so it can never carry a token (the same
//     reason cloud sync was declined; see CLAUDE.md).
//   * Opt-in. Nothing is fetched until the household picks a location, so
//     the app makes no outbound request on its own.
//   * Coordinates are rounded to 0.1 degrees (~11 km) before they are stored
//     or sent. A forecast does not need to know which house this is, and no
//     coordinate is ever committed to the repo - the presets below are plain
//     public geography and none of them is a default.
//   * Energy only. Nothing here produces a dollar figure; monthlyDigests
//     remains the sole source of every financial number.
//
// THE YIELD NUMBER IS CALIBRATED FROM YOUR OWN DATA, not modelled from panel
// specs. The forecast supplies daily shortwave radiation (MJ/m2); your own
// history supplies what that radiation actually produced on this roof. The
// fitted kWh-per-MJ factor therefore already contains the array size, tilt,
// azimuth, shading, soiling and inverter clipping - none of which anyone has
// to type in, and all of which drift over time. A specs-based model would be
// a guess dressed up as a number, which this app refuses everywhere else.
//
// If there is not enough history to fit that factor, there is NO kWh
// estimate - the panel shows temperature and sunshine and says so. Same rule
// as daily.js:seasonalCheck(): no verdict without the data to support one.
//
// CALIBRATE ON THE SAME MODEL YOU PREDICT WITH. The factor used to be fitted
// against the ERA5 reanalysis (archive-api) and then applied to live forecast
// radiation. Those are different products with different biases, so whatever
// offset sat between them was baked into every projection as a silent scale
// error that more data could never remove - it only made the app more
// confident about it. History now comes from the HISTORICAL FORECAST API,
// which is the archived output of the same models that produce the live
// forecast, so the fit absorbs that model's own bias instead of a stranger's.
// The reanalysis is kept only as a fallback for when that endpoint is
// unavailable, and the panel records which one produced the number.
//
// The forecast also checks its own homework: see data/forecastAccuracy.js.
// Every projection is logged and later scored against what the roof actually
// produced, which is what turns the error bars from "this roof's scatter" into
// "how wrong this panel has actually been, N days ahead".

import { getState, putState, getWeatherCache, putWeatherCache, getForecastLog, putForecastLog } from './db.js';
import { recordProjection, scoreForecastLog, bandForLead, dateKey, daysBetween } from './forecastAccuracy.js';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
// Archived output of the live forecast models - the correct thing to fit
// against. Coverage begins in 2022.
const HISTORICAL_FORECAST_URL = 'https://historical-forecast-api.open-meteo.com/v1/forecast';
const HISTORICAL_FORECAST_FROM = '2022-01-01';
// ERA5 reanalysis. Different model, different bias: fallback only.
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const HISTORY_SOURCES = [
  { id: 'historical-forecast', url: HISTORICAL_FORECAST_URL, from: HISTORICAL_FORECAST_FROM },
  { id: 'archive', url: ARCHIVE_URL, from: null }
];

// How long a fetched forecast is treated as current. Open-Meteo updates
// hourly; refetching more often than this buys nothing and is rude to a free
// service. The cached copy is also what the panel shows when offline.
const FORECAST_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
const FETCH_TIMEOUT_MS = 10000;
// After a failed attempt, don't hammer the service (or the user's data) on
// every screen change - a second panel mounting 200ms later will fail the
// same way. Cleared by the panel's explicit Refresh button.
const FAILURE_COOLDOWN_MS = 60 * 1000;

// The archive endpoint runs a few days behind real time, so calibration
// always stops short of today rather than asking for days that do not exist.
const ARCHIVE_LAG_DAYS = 6;
const MAX_HISTORY_DAYS = 760; // ~2 years is plenty to fit one ratio

// Minimum evidence before a kWh figure is shown at all.
const MIN_DAILY_PAIRS = 30;
const MIN_MONTHLY_PAIRS = 6;

// A daily fit only earns preference over a monthly one once it has seen
// enough of the year. Thirty consecutive days is thirty days of ONE season:
// kWh per MJ is not the same in January as in July (heat derating, inverter
// clipping, a lower winter sun through the same trees), so a winter-only
// ratio applied in summer is worse than a monthly fit spanning two years.
// Below this, a qualifying monthly fit wins; with no monthly fit available,
// the daily one still runs, because some evidence beats none.
const MIN_SEASON_MONTHS = 6;

// A day with real sunlight but essentially no production is an inverter or
// comms outage, not weather - Perth does not hand out zero-kWh days. Left in,
// each one drags the fitted factor down permanently.
const OUTAGE_KWH = 0.5;
const OUTAGE_RADIATION_MJ = 2;

// The band is a ratio (produced / fitted), so a heavily overcast day divides
// by a very small number and returns a wild answer. Those tails, not the
// weather, were setting the 20th and 80th percentiles. Only days above a
// share of the sample's own median radiation contribute to the band.
const BAND_RADIATION_FLOOR_SHARE = 0.3;
const MIN_BAND_PAIRS = 20;

// A projection above everything the array has ever produced is a fault in the
// factor, not a good day. Clamped a little above the observed record so a
// genuine new best is still allowed.
const CAP_HEADROOM = 1.1;
const MIN_CAP_SAMPLES = 60;

// Recency. A roof is not the same roof it was two years ago: panels degrade,
// dirt builds up, a tree grows into the afternoon sun. Weighting the fit by
// age lets it track that drift without throwing away the older days that give
// the seasonal picture its shape. One year to half weight is slow enough that
// a single dirty month cannot swing it.
const RECENCY_HALF_LIFE_DAYS = 365;

// Seasonality. kWh per MJ is not one number across the year: a 40C February
// day derates the panels and clips the inverter, and the same MJ arriving
// through a low winter sun meets more shade. One global ratio splits the
// difference and is wrong at both ends of the year. These are multiplicative
// adjustments to the global ratio, one per half-month, each fitted from a
// wide window around it so neighbouring days cannot jump.
const SEASON_BUCKETS = 24;
const SEASON_WINDOW_DAYS = 45;
const MIN_SEASON_SAMPLES = 30;
const SEASON_CLAMP = { low: 0.75, high: 1.25 };

// "Spare for the car", measured rather than subtracted. Neighbours are days
// whose production was within this much of the day being projected.
const SPARE_TOLERANCE = 0.2;
const SPARE_SEASON_WINDOW_DAYS = 60;
const MIN_SPARE_NEIGHBOURS = 15;

export const FORECAST_DAYS = 7;

// Public geography, not anybody's address: coarse anchors for the Perth
// metro area so the location can be set with one tap instead of typing
// coordinates. There is deliberately NO default - the household picks.
export const LOCATION_PRESETS = [
  { label: 'Perth (city centre)', latitude: -31.9, longitude: 115.9 },
  { label: 'Northern suburbs (Joondalup)', latitude: -31.7, longitude: 115.8 },
  { label: 'Eastern suburbs (Midland)', latitude: -31.9, longitude: 116.0 },
  { label: 'Southern suburbs (Cockburn)', latitude: -32.1, longitude: 115.8 },
  { label: 'Rockingham / Mandurah', latitude: -32.4, longitude: 115.8 }
];

// 0.1 degrees is about 11 km - enough to place a forecast, not enough to
// place a household.
export const roundCoord = (n) => Math.round(Number(n) * 10) / 10;

// LOCAL dates, not UTC. Perth is UTC+8, so toISOString() names yesterday for
// the whole of the local morning - which shifted the archive window by a day
// and quietly cost a calibration pair every time the app was opened early.
// Open-Meteo is asked for timezone=auto and answers in local dates too, so
// these line up with dailySeries[] as stored.
const iso = dateKey;
const addDays = (date, n) => {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + n);
  return d;
};
const dayFromIso = (s) => new Date(`${s}T00:00:00`);

// --- Config ---------------------------------------------------------------
// The location lives in the household's own config, which is private to this
// browser and to their backup file. Written through getState() rather than
// through whatever scoped view a screen happens to hold, so a filtered
// dashboard state can never be written back over the real store.
export function forecastConfig(config) {
  const f = config?.forecast;
  if (!f || f.latitude == null || f.longitude == null) return null;
  return { latitude: f.latitude, longitude: f.longitude, label: f.label ?? null };
}

export async function saveForecastLocation(location) {
  const current = await getState();
  const next = {
    ...current,
    config: {
      ...current.config,
      forecast: location && {
        latitude: roundCoord(location.latitude),
        longitude: roundCoord(location.longitude),
        label: location.label ?? null
      }
    }
  };
  if (!location) delete next.config.forecast;
  await putState(next);
  return next;
}

// --- Network --------------------------------------------------------------
// Marks the messages this module wrote itself, so a browser-level string
// like "Failed to fetch" is never shown to a household as an explanation.
class ForecastError extends Error {}

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new ForecastError(`The weather service answered with an error (${res.status}).`);
    return await res.json();
  } catch (e) {
    if (e instanceof ForecastError) throw e;
    if (e.name === 'AbortError') throw new ForecastError('The weather service did not answer in time.');
    // Offline, blocked, DNS - normal conditions, not an app fault. Callers
    // fall back to the cached copy.
    throw new ForecastError('Could not reach the weather service — check your connection.');
  } finally {
    clearTimeout(timer);
  }
}

// Open-Meteo returns parallel arrays under `daily`, one entry per day. Any
// field can come back null for a given day; the null convention applies -
// a missing reading is null, never 0.
function zipDaily(daily) {
  if (!daily || !Array.isArray(daily.time)) return [];
  const at = (key, i) => {
    const arr = daily[key];
    const v = Array.isArray(arr) ? arr[i] : null;
    return v == null || Number.isNaN(v) ? null : v;
  };
  return daily.time.map((date, i) => ({
    date,
    tMaxC: at('temperature_2m_max', i),
    tMinC: at('temperature_2m_min', i),
    // MJ/m2 over the day - the physical driver of production.
    radiationMj: at('shortwave_radiation_sum', i),
    sunshineHours: at('sunshine_duration', i) == null ? null : at('sunshine_duration', i) / 3600,
    cloudPct: at('cloud_cover_mean', i),
    rainMm: at('precipitation_sum', i)
  }));
}

export async function fetchForecast({ latitude, longitude }) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    daily: [
      'temperature_2m_max',
      'temperature_2m_min',
      'shortwave_radiation_sum',
      'sunshine_duration',
      'cloud_cover_mean',
      'precipitation_sum'
    ].join(','),
    timezone: 'auto',
    forecast_days: String(FORECAST_DAYS)
  });
  const json = await getJson(`${FORECAST_URL}?${params}`);
  return zipDaily(json.daily);
}

// Daily radiation for the past, used only to calibrate against your own
// production. `sourceId` picks which archive answers: the historical forecast
// (same models as the live forecast, and the default) or the ERA5 reanalysis.
export async function fetchRadiationHistory({ latitude, longitude }, startDate, endDate, sourceId = HISTORY_SOURCES[0].id) {
  const source = HISTORY_SOURCES.find((s) => s.id === sourceId) ?? HISTORY_SOURCES[0];
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    start_date: startDate,
    end_date: endDate,
    daily: 'shortwave_radiation_sum',
    timezone: 'auto'
  });
  const json = await getJson(`${source.url}?${params}`);
  const byDate = {};
  for (const row of zipDaily(json.daily)) {
    if (row.radiationMj != null) byDate[row.date] = row.radiationMj;
  }
  return byDate;
}

// What window of history is worth having: back to the first ingested month,
// bounded by how far the source goes and by how much is useful to fit on.
function historyWindow(state, source) {
  const firstMonth = state?.monthlyDigests?.[0]?.month;
  const earliest = firstMonth ? dayFromIso(`${firstMonth}-01`) : null;
  const end = addDays(new Date(), -ARCHIVE_LAG_DAYS);
  const floor = addDays(end, -MAX_HISTORY_DAYS);
  let start = earliest && earliest > floor ? earliest : floor;
  if (source.from && iso(start) < source.from) start = dayFromIso(source.from);
  return start < end ? { from: iso(start), to: iso(end) } : null;
}

// Fetch only what is missing. The old code refetched roughly two years of
// daily rows every day despite the comment promising it extended the tail;
// on a stable cache this is now a one-day request, and usually none at all.
// A cache from a DIFFERENT source is discarded rather than merged - mixing
// two radiation models inside one fit is the bias this change removes.
async function loadHistory(location, state, cached, force) {
  let lastError = null;
  for (const source of HISTORY_SOURCES) {
    const want = historyWindow(state, source);
    if (!want) continue;
    const reusable = !force && cached?.source === source.id && cached?.byDate ? cached : null;
    const gaps = [];
    if (!reusable) {
      gaps.push([want.from, want.to]);
    } else {
      if (want.from < reusable.from) gaps.push([want.from, iso(addDays(dayFromIso(reusable.from), -1))]);
      if (want.to > reusable.to) gaps.push([iso(addDays(dayFromIso(reusable.to), 1)), want.to]);
    }
    if (!gaps.length) return { history: reusable, error: null };

    try {
      const byDate = { ...(reusable?.byDate ?? {}) };
      for (const [from, to] of gaps) {
        Object.assign(byDate, await fetchRadiationHistory(location, from, to, source.id));
      }
      return {
        history: {
          source: source.id,
          fetchedAt: new Date().toISOString(),
          from: reusable ? (want.from < reusable.from ? want.from : reusable.from) : want.from,
          to: want.to,
          byDate
        },
        error: null
      };
    } catch (e) {
      // Try the fallback source before giving up; a household with no history
      // at all gets no kWh figure, which is a much worse outcome than one
      // fitted on the reanalysis and labelled as such.
      lastError = e.message;
    }
  }
  return { history: cached ?? null, error: lastError };
}

// --- Calibration ----------------------------------------------------------
// A ratio estimator through the origin (total kWh / total MJ), not a
// least-squares line with an intercept: zero radiation must mean zero
// production, and an intercept would let the fit promise output at night.
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

// Day of the year, 0-365, used for every seasonal comparison. Leap years
// shift it by a day late in the year, which is far inside the window widths
// these are compared over.
function dayOfYear(dateIso) {
  const d = dayFromIso(dateIso);
  return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
}

// Distance between two days of the year, the short way round, so 28 December
// and 3 January are six days apart rather than 359.
function seasonDistance(a, b) {
  const raw = Math.abs(a - b);
  return Math.min(raw, 365 - raw);
}

// Exponential decay by age, so recent days count for more without older ones
// being thrown away. Applied to the LEVEL (the fitted ratio), never to the
// band: a spread is not something that decays, and the accuracy log supersedes
// the fit's band anyway once it has measured one.
function recencyWeight(dateIso, todayIso) {
  const age = daysBetween(dateIso, todayIso);
  if (age == null || age <= 0) return 1;
  return Math.pow(0.5, age / RECENCY_HALF_LIFE_DAYS);
}

function fit(pairs, todayIso = iso(new Date())) {
  let radTotal = 0;
  let kwhTotal = 0;
  for (const p of pairs) {
    const w = p.date ? recencyWeight(p.date, todayIso) : 1;
    radTotal += w * p.radiationMj;
    kwhTotal += w * p.kwh;
  }
  if (!(radTotal > 0)) return null;
  const kwhPerMj = kwhTotal / radTotal;

  // The band comes only from days with enough sunlight for the ratio to mean
  // anything. On a 3 MJ winter day the denominator is tiny and the ratio
  // swings wildly; those days were setting the percentiles and inflating the
  // range on every OTHER day. If the floor leaves too few pairs to be worth
  // a percentile, fall back to the whole sample rather than a band of three.
  const rads = pairs.map((p) => p.radiationMj).filter((r) => r > 0).sort((a, b) => a - b);
  const floor = (percentile(rads, 0.5) ?? 0) * BAND_RADIATION_FLOOR_SHARE;
  let banded = pairs.filter((p) => p.radiationMj >= floor && p.radiationMj > 0);
  if (banded.length < MIN_BAND_PAIRS) banded = pairs.filter((p) => p.radiationMj > 0);
  const ratios = banded.map((p) => p.kwh / (kwhPerMj * p.radiationMj)).sort((a, b) => a - b);

  return {
    kwhPerMj,
    samples: pairs.length,
    // The middle 60% of your own day-to-day scatter around the fit. Used as
    // the band, so the panel can show a range instead of false precision.
    lowRatio: percentile(ratios, 0.2),
    highRatio: percentile(ratios, 0.8)
  };
}

// How many distinct calendar months a set of dated pairs touches. Coverage,
// not count, is what says whether a daily fit has seen the year.
function monthsCovered(pairs) {
  return new Set(pairs.map((p) => p.date.slice(5, 7))).size;
}

// One multiplicative adjustment per half-month, each fitted from every pair
// within SEASON_WINDOW_DAYS of that point in the year - so the windows overlap
// heavily and the factor moves smoothly through the year instead of stepping
// at month boundaries. A bucket with too few days in its window stays null and
// that part of the year simply gets the global ratio, which is the same "no
// verdict without the data" rule used everywhere else.
function seasonalFactors(pairs, kwhPerMj, todayIso) {
  if (!(kwhPerMj > 0) || !pairs.length) return null;
  const withDoy = pairs.map((p) => ({ ...p, doy: dayOfYear(p.date) }));
  const factors = new Array(SEASON_BUCKETS).fill(null);
  let fitted = 0;

  for (let b = 0; b < SEASON_BUCKETS; b += 1) {
    const centre = ((b + 0.5) / SEASON_BUCKETS) * 365;
    let expected = 0;
    let actual = 0;
    let n = 0;
    for (const p of withDoy) {
      if (seasonDistance(p.doy, centre) > SEASON_WINDOW_DAYS) continue;
      const w = recencyWeight(p.date, todayIso);
      expected += w * p.radiationMj * kwhPerMj;
      actual += w * p.kwh;
      n += 1;
    }
    if (n < MIN_SEASON_SAMPLES || !(expected > 0)) continue;
    factors[b] = Math.min(SEASON_CLAMP.high, Math.max(SEASON_CLAMP.low, actual / expected));
    fitted += 1;
  }
  return fitted ? { factors, fitted } : null;
}

// The seasonal adjustment for one date, or 1 when this part of the year has
// not been seen often enough to say anything.
export function seasonalFactorFor(calibration, dateIso) {
  const s = calibration?.seasonal;
  if (!s || !dateIso) return 1;
  const b = Math.min(SEASON_BUCKETS - 1, Math.floor((dayOfYear(dateIso) / 365) * SEASON_BUCKETS));
  return s.factors[b] ?? 1;
}

// The one definition of the unadjusted projection: radiation, this roof's
// fitted ratio, and where in the year the day falls. Both the panel and the
// accuracy log's scoring go through this, so a measured bias can never be
// measured against a differently-derived number than the one on screen.
export function rawKwhFor(calibration, radiationMj, dateIso) {
  if (!(calibration?.kwhPerMj > 0) || radiationMj == null) return null;
  return radiationMj * calibration.kwhPerMj * seasonalFactorFor(calibration, dateIso);
}

// The most this array has ever produced in a day, with a little headroom.
// Only from a decent run of days: on a handful of rows the "record" is just
// the sunniest day so far and would clip every good day thereafter.
function observedCap(dailySeries) {
  const values = (dailySeries ?? []).map((r) => r.solarKwh).filter((v) => v != null && v > 0);
  if (values.length < MIN_CAP_SAMPLES) return null;
  return Math.max(...values) * CAP_HEADROOM;
}

// What has ACTUALLY gone spare, day by day, and how much the roof made that
// day. Surplus is the energy that demonstrably had nowhere else to go: what
// was exported, plus what the car took straight off the panels (which would
// otherwise have been exported too, and must be added back or a day the car
// charged would read as a day with no surplus).
//
// Deliberately NOT including what the car drew from the battery. That energy
// was stored PV, but it displaced the evening house draw rather than being
// surplus, and whether it is available tomorrow depends on the battery's state
// of charge, which nothing here knows. Leaving it out makes the figure err
// low, which is the safe direction for "how much can the car have".
//
// A day whose EV-from-PV was never recorded counts only its export, for the
// same reason: understating the spare is safer than inventing it.
function spareSamples(dailySeries) {
  const rows = [];
  for (const r of dailySeries ?? []) {
    if (r?.date == null || r.solarKwh == null || r.gridExportKwh == null) continue;
    rows.push({
      date: r.date,
      doy: dayOfYear(r.date),
      solarKwh: r.solarKwh,
      surplusKwh: Math.max(0, r.gridExportKwh + (r.evPvKwh ?? 0))
    });
  }
  return rows.length ? rows : null;
}

// "Spare for the car" as a measurement rather than a subtraction: on the days
// this roof made about as much as the day being projected, how much actually
// went spare? It needs no assumption about when the sun and the load coincide,
// no model of the battery, and no separate house-load figure - all of that is
// already inside what was really exported.
//
// Neighbours are matched on production first and, when there are enough of
// them, on time of year as well: 30 kWh in February is not 30 kWh in July once
// the air conditioning is running.
export function measuredSpare(calibration, dayKwh, dateIso) {
  const rows = calibration?.spare;
  if (!rows || !(dayKwh > 0)) return null;

  const near = rows.filter(
    (r) => Math.abs(r.solarKwh - dayKwh) <= dayKwh * SPARE_TOLERANCE
  );
  if (near.length < MIN_SPARE_NEIGHBOURS) return null;

  let sample = near;
  let basis = 'measured';
  if (dateIso) {
    const doy = dayOfYear(dateIso);
    const seasonal = near.filter((r) => seasonDistance(r.doy, doy) <= SPARE_SEASON_WINDOW_DAYS);
    if (seasonal.length >= MIN_SPARE_NEIGHBOURS) {
      sample = seasonal;
      basis = 'measured-seasonal';
    }
  }
  const sorted = sample.map((r) => r.surplusKwh).sort((a, b) => a - b);
  return { kwh: percentile(sorted, 0.5), basis, n: sample.length };
}

// The figure the panels show, with the honest fallback behind it: the measured
// one when this household has enough comparable days, otherwise the old
// production-minus-typical-house-load subtraction, which knows nothing about
// timing or the battery and is labelled accordingly.
export function spareForDay(calibration, day, houseLoadPerDay) {
  if (day?.kwh == null) return null;
  const measured = measuredSpare(calibration, day.kwh, day.date);
  if (measured) return measured;
  if (houseLoadPerDay == null) return null;
  return { kwh: Math.max(0, day.kwh - houseLoadPerDay), basis: 'subtracted', n: null };
}

// Prefers day-level pairs (dailySeries x archive radiation). Falls back to
// whole-month totals, which every ingested month has, when there are not yet
// 30 days of daily rows - months ingested before v2 have no daily rows at
// all, so on a real store the monthly path is what runs first.
export function calibrate(state, radiationByDate, todayIso = iso(new Date())) {
  if (!radiationByDate || !Object.keys(radiationByDate).length) return null;

  const daily = Array.isArray(state?.dailySeries) ? state.dailySeries : [];
  const capKwh = observedCap(daily);
  const spare = spareSamples(daily);
  const dailyPairs = [];
  let outageDays = 0;
  for (const row of daily) {
    const rad = radiationByDate[row.date];
    if (rad == null || row.solarKwh == null) continue;
    // An outage is not a weather observation. Excluded rather than zeroed:
    // there is no honest kWh to pair with that day's sunlight.
    if (row.solarKwh < OUTAGE_KWH && rad >= OUTAGE_RADIATION_MJ) {
      outageDays += 1;
      continue;
    }
    dailyPairs.push({ date: row.date, radiationMj: rad, kwh: row.solarKwh });
  }
  const seasonMonths = monthsCovered(dailyPairs);
  const dailyFit = dailyPairs.length >= MIN_DAILY_PAIRS ? fit(dailyPairs, todayIso) : null;
  // Only a daily fit can carry a seasonal shape: whole-month totals have one
  // point per month, which is the very thing being adjusted for.
  const seasonal = dailyFit ? seasonalFactors(dailyPairs, dailyFit.kwhPerMj, todayIso) : null;

  // A daily fit that has seen enough of the year wins outright. One that has
  // not waits for the monthly fit below, and only runs if that cannot.
  if (dailyFit && seasonMonths >= MIN_SEASON_MONTHS) {
    return { ...dailyFit, method: 'daily', seasonMonths, outageDays, capKwh, seasonal, spare };
  }

  // Monthly fallback: sum the archive's radiation over each COMPLETE month
  // and pair it with that month's stored production. A partial month would
  // pair a short month's kWh with a full month's radiation.
  const radByMonth = {};
  const daysByMonth = {};
  for (const [date, mj] of Object.entries(radiationByDate)) {
    const m = date.slice(0, 7);
    radByMonth[m] = (radByMonth[m] ?? 0) + mj;
    daysByMonth[m] = (daysByMonth[m] ?? 0) + 1;
  }
  const monthlyPairs = [];
  for (const d of state?.monthlyDigests ?? []) {
    if (d.partialMonth === true || d.solarProductionKwh == null) continue;
    const rad = radByMonth[d.month];
    // Only months the archive covered end to end - a half-fetched month
    // would understate the radiation and inflate the factor.
    if (rad == null || daysByMonth[d.month] < (d.daysInPeriod ?? 28)) continue;
    // Dated at mid-month, purely so the recency weight has something to age.
    monthlyPairs.push({ date: `${d.month}-15`, radiationMj: rad, kwh: d.solarProductionKwh });
  }
  if (monthlyPairs.length >= MIN_MONTHLY_PAIRS) {
    const f = fit(monthlyPairs, todayIso);
    // No band on a monthly fit: month-to-month scatter is far tighter than
    // day-to-day scatter, so quoting it as a daily range would understate
    // the real spread. A single figure with the caveat is the honest form.
    // (A measured band can still arrive later from the accuracy log, which
    // observes daily misses directly rather than inferring them from a fit.)
    if (f) {
      return { ...f, lowRatio: null, highRatio: null, method: 'monthly', outageDays, capKwh, spare };
    }
  }

  // Some evidence beats none: a daily fit too narrow to have seen the year is
  // still better than no figure, so it runs when no monthly fit qualifies.
  if (dailyFit) {
    return { ...dailyFit, method: 'daily', seasonMonths, outageDays, capKwh, seasonal, spare, narrowSeason: true };
  }

  return {
    method: null,
    samples: dailyPairs.length || monthlyPairs.length,
    dailyPairs: dailyPairs.length,
    monthlyPairs: monthlyPairs.length,
    seasonMonths,
    outageDays
  };
}

// --- Projection -----------------------------------------------------------
// Three things happen to the raw fitted number, in this order, and each is
// applied only when it has been earned:
//
//   1. the measured bias, if the accuracy log has enough scored days to say
//      this roof reliably lands above or below the fit;
//   2. the observed ceiling, so a bad factor cannot print a day the array has
//      never come close to;
//   3. the band - the accuracy log's measured spread FOR THAT LEAD DAY when
//      it has one, so Sunday visibly looks softer than tomorrow, falling back
//      to the pooled spread, and only then to the fit's own residual scatter,
//      which does not contain the forecast's error at all.
export function projectDays(forecastRows, calibration, accuracy = null, today = iso(new Date())) {
  const usable = calibration?.kwhPerMj != null;
  const bias = accuracy?.biasFactor ?? 1;
  const cap = (v) => (v != null && calibration?.capKwh != null ? Math.min(v, calibration.capKwh) : v);

  return (forecastRows ?? []).map((row) => {
    const raw = usable ? rawKwhFor(calibration, row.radiationMj, row.date) : null;
    let kwh = raw == null ? null : raw * bias;

    const lead = daysBetween(today, row.date);
    const measured = lead == null ? null : bandForLead(accuracy, lead);
    // A measured band is a ratio against the RAW fit, exactly as the bias is,
    // so both are applied to the raw figure and never to each other. The fit's
    // own residual band is a ratio around the figure being shown instead.
    const edge = (ratio) => (raw != null && ratio != null ? raw * ratio : null);
    const fitEdge = (ratio) => (kwh != null && ratio != null ? kwh * ratio : null);
    let low = measured ? edge(measured.low) : fitEdge(calibration?.lowRatio);
    let high = measured ? edge(measured.high) : fitEdge(calibration?.highRatio);

    // The bias is a pooled figure and the band is per lead day, so on a lead
    // day whose own median sits a little away from the pool - or when the
    // bias is below the threshold to apply at all - the mark could land
    // outside its own band. It is a small nudge, and a mark drawn off the end
    // of its range reads as a bug whatever the arithmetic behind it.
    if (kwh != null && low != null && high != null) kwh = Math.min(Math.max(kwh, low), high);

    // The ceiling applies last, to the whole range: nothing drawn should
    // claim a day this array has never come close to.
    kwh = cap(kwh);
    low = cap(low);
    high = cap(high);

    return {
      ...row,
      kwh,
      kwhRaw: raw,
      leadDays: lead,
      bandSource: measured ? measured.source : calibration?.lowRatio != null ? 'fit' : null,
      kwhLow: low,
      kwhHigh: high
    };
  });
}

// Typical daily household draw EXCLUDING the car, from the most recent
// complete months. Used to turn "34 kWh on Thursday" into "about this much
// spare for the car" - daily energy only: it does not model when in the day
// the sun and the load actually line up, and the panel says so.
export function typicalHouseLoadPerDay(digests, monthsBack = 3) {
  const complete = (digests ?? []).filter(
    (d) => d.partialMonth !== true && d.totalConsumptionKwh != null && d.daysInPeriod
  );
  const recent = complete.slice(-monthsBack);
  if (!recent.length) return null;
  let kwh = 0;
  let days = 0;
  for (const d of recent) {
    const ev = (d.evFromPvKwh ?? 0) + (d.evFromBatteryKwh ?? 0) + (d.evFromHomeGridKwh ?? 0);
    kwh += Math.max(0, d.totalConsumptionKwh - ev);
    days += d.daysInPeriod;
  }
  return days > 0 ? kwh / days : null;
}

// The best day in the window to put the car on the charger: the most
// projected production, with the house's own typical draw taken off so the
// figure is what is actually going spare.
export function bestChargeDay(projected, houseLoadPerDay, calibration = null) {
  const withKwh = (projected ?? []).filter((d) => d.kwh != null);
  if (!withKwh.length) return null;
  const scored = withKwh.map((d) => {
    const spare = spareForDay(calibration, d, houseLoadPerDay);
    return { ...d, spareKwh: spare?.kwh ?? null, spareBasis: spare?.basis ?? null, spareDays: spare?.n ?? null };
  });
  const best = scored.reduce((a, b) => (b.kwh > a.kwh ? b : a));
  const rest = scored.filter((d) => d.date !== best.date);
  const averageOther = rest.length ? rest.reduce((a, d) => a + d.kwh, 0) / rest.length : null;
  return { best, averageOther, days: scored };
}

// --- Cache orchestration --------------------------------------------------
// Returns everything the panels need, from cache when it is fresh (or when
// the network is unavailable) and from the API when it is not. Never throws
// for a network problem: the failure is returned alongside whatever cached
// data still exists, so the panel degrades instead of disappearing.
const inFlight = new Map(); // location key -> promise, so two panels share one fetch
const lastFailure = new Map(); // location key -> { at, message }

export async function loadForecast(state, { force = false } = {}) {
  const location = forecastConfig(state?.config);
  if (!location) return { location: null, days: [], calibration: null, accuracy: null, error: null, fetchedAt: null };
  const key = `${location.latitude},${location.longitude}`;
  if (!force && inFlight.has(key)) return inFlight.get(key);
  const p = loadForecastUncached(state, location, key, force).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

async function loadForecastUncached(state, location, key, force) {
  const cached = await getWeatherCache();
  const sameSpot =
    cached?.location?.latitude === location.latitude &&
    cached?.location?.longitude === location.longitude;
  const now = Date.now();

  let forecastRows = sameSpot ? cached?.forecast?.days ?? null : null;
  let fetchedAt = sameSpot ? cached?.forecast?.fetchedAt ?? null : null;
  let history = sameSpot ? cached?.history ?? null : null;
  let error = null;

  const forecastStale = !forecastRows || force || now - new Date(fetchedAt ?? 0).getTime() > FORECAST_TTL_MS;

  // Still inside the cool-down from a recent failure: report that failure
  // again rather than repeating a request that is going to fail too.
  const recentFailure = lastFailure.get(key);
  if (!force && recentFailure && now - recentFailure.at < FAILURE_COOLDOWN_MS) {
    return assemble(state, { location, fetchedAt, history, forecastRows, error: recentFailure.message });
  }

  if (forecastStale) {
    try {
      forecastRows = await fetchForecast(location);
      fetchedAt = new Date().toISOString();
    } catch (e) {
      error = e.message;
    }
  }

  // Deliberately NOT gated on the forecast fetch having succeeded. It used to
  // be, which meant one bad forecast request also froze the calibration
  // history - two independent endpoints failing together for no reason.
  const fetchedHistory = await loadHistory(location, state, history, force);
  if (fetchedHistory.history) history = fetchedHistory.history;
  error = error ?? fetchedHistory.error;

  if (error) lastFailure.set(key, { at: Date.now(), message: error });
  else lastFailure.delete(key);

  if (forecastRows || history) {
    await putWeatherCache({
      version: 2,
      location,
      forecast: forecastRows ? { fetchedAt, days: forecastRows } : cached?.forecast ?? null,
      history: history ?? cached?.history ?? null
    });
  }

  return assemble(state, { location, fetchedAt, history, forecastRows, error });
}

// Calibrate, score the accuracy log, project, and log today's projection back
// for scoring later. Shared by the normal path and the cool-down path so the
// two can never disagree about what the panel is being handed.
async function assemble(state, { location, fetchedAt, history, forecastRows, error }) {
  const calibration = calibrate(state, history?.byDate);
  if (calibration && history?.source) calibration.radiationSource = history.source;

  // The log is scored against the CURRENT factor, so a fit that has since
  // improved is not judged on the misses of the one it replaced.
  const log = await getForecastLog();
  const accuracy = calibration?.kwhPerMj
    ? scoreForecastLog(log, state?.dailySeries, (mj, date) => rawKwhFor(calibration, mj, date))
    : null;

  const days = projectDays(forecastRows ?? [], calibration, accuracy);

  // Record what the forecast said, keyed on when it was FETCHED - so the same
  // cached forecast read twice, or read again tomorrow, never writes a second
  // copy or relabels a three-day-out call as a two-day-out one.
  if (forecastRows?.length && fetchedAt) {
    const updated = recordProjection(log, forecastRows, fetchedAt);
    if (updated) await putForecastLog(updated);
  }

  return { location, fetchedAt, error, calibration, accuracy, days };
}
