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

import { getState, putState, getWeatherCache, putWeatherCache } from './db.js';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';

// How long a fetched forecast is treated as current. Open-Meteo updates
// hourly; refetching more often than this buys nothing and is rude to a free
// service. The cached copy is also what the panel shows when offline.
const FORECAST_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
const HISTORY_TTL_MS = 24 * 60 * 60 * 1000; // 1 day - only extends the tail
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

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (date, n) => new Date(date.getTime() + n * 86400000);

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
// production. One request covers the whole window.
export async function fetchRadiationHistory({ latitude, longitude }, startDate, endDate) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    start_date: startDate,
    end_date: endDate,
    daily: 'shortwave_radiation_sum',
    timezone: 'auto'
  });
  const json = await getJson(`${ARCHIVE_URL}?${params}`);
  const byDate = {};
  for (const row of zipDaily(json.daily)) {
    if (row.radiationMj != null) byDate[row.date] = row.radiationMj;
  }
  return byDate;
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

function fit(pairs) {
  const radTotal = pairs.reduce((a, p) => a + p.radiationMj, 0);
  const kwhTotal = pairs.reduce((a, p) => a + p.kwh, 0);
  if (!(radTotal > 0)) return null;
  const kwhPerMj = kwhTotal / radTotal;
  const ratios = pairs
    .filter((p) => p.radiationMj > 0)
    .map((p) => p.kwh / (kwhPerMj * p.radiationMj))
    .sort((a, b) => a - b);
  return {
    kwhPerMj,
    samples: pairs.length,
    // The middle 60% of your own day-to-day scatter around the fit. Used as
    // the band, so the panel can show a range instead of false precision.
    lowRatio: percentile(ratios, 0.2),
    highRatio: percentile(ratios, 0.8)
  };
}

// Prefers day-level pairs (dailySeries x archive radiation). Falls back to
// whole-month totals, which every ingested month has, when there are not yet
// 30 days of daily rows - months ingested before v2 have no daily rows at
// all, so on a real store the monthly path is what runs first.
export function calibrate(state, radiationByDate) {
  if (!radiationByDate || !Object.keys(radiationByDate).length) return null;

  const daily = Array.isArray(state?.dailySeries) ? state.dailySeries : [];
  const dailyPairs = [];
  for (const row of daily) {
    const rad = radiationByDate[row.date];
    if (rad == null || row.solarKwh == null) continue;
    dailyPairs.push({ radiationMj: rad, kwh: row.solarKwh });
  }
  if (dailyPairs.length >= MIN_DAILY_PAIRS) {
    const f = fit(dailyPairs);
    if (f) return { ...f, method: 'daily' };
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
    monthlyPairs.push({ radiationMj: rad, kwh: d.solarProductionKwh });
  }
  if (monthlyPairs.length >= MIN_MONTHLY_PAIRS) {
    const f = fit(monthlyPairs);
    // No band on a monthly fit: month-to-month scatter is far tighter than
    // day-to-day scatter, so quoting it as a daily range would understate
    // the real spread. A single figure with the caveat is the honest form.
    if (f) return { ...f, lowRatio: null, highRatio: null, method: 'monthly' };
  }

  return {
    method: null,
    samples: dailyPairs.length || monthlyPairs.length,
    dailyPairs: dailyPairs.length,
    monthlyPairs: monthlyPairs.length
  };
}

// --- Projection -----------------------------------------------------------
export function projectDays(forecastRows, calibration) {
  const usable = calibration?.kwhPerMj != null;
  return (forecastRows ?? []).map((row) => {
    const kwh = usable && row.radiationMj != null ? row.radiationMj * calibration.kwhPerMj : null;
    return {
      ...row,
      kwh,
      kwhLow: kwh != null && calibration.lowRatio != null ? kwh * calibration.lowRatio : null,
      kwhHigh: kwh != null && calibration.highRatio != null ? kwh * calibration.highRatio : null
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
export function bestChargeDay(projected, houseLoadPerDay) {
  const withKwh = (projected ?? []).filter((d) => d.kwh != null);
  if (!withKwh.length) return null;
  const scored = withKwh.map((d) => ({
    ...d,
    spareKwh: houseLoadPerDay == null ? null : Math.max(0, d.kwh - houseLoadPerDay)
  }));
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
  if (!location) return { location: null, days: [], calibration: null, error: null, fetchedAt: null };
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
  const historyStale = !history?.byDate || force || now - new Date(history?.fetchedAt ?? 0).getTime() > HISTORY_TTL_MS;

  // Still inside the cool-down from a recent failure: report that failure
  // again rather than repeating a request that is going to fail too.
  const recentFailure = lastFailure.get(key);
  if (!force && recentFailure && now - recentFailure.at < FAILURE_COOLDOWN_MS) {
    const calibration = calibrate(state, history?.byDate);
    return {
      location,
      fetchedAt,
      error: recentFailure.message,
      calibration,
      days: projectDays(forecastRows ?? [], calibration)
    };
  }

  if (forecastStale) {
    try {
      forecastRows = await fetchForecast(location);
      fetchedAt = new Date().toISOString();
    } catch (e) {
      error = e.message;
    }
  }

  if (historyStale && !error) {
    // Only as far back as there is production data to compare against.
    const firstMonth = state?.monthlyDigests?.[0]?.month;
    const earliest = firstMonth ? new Date(`${firstMonth}-01T00:00:00Z`) : null;
    const end = addDays(new Date(), -ARCHIVE_LAG_DAYS);
    const floor = addDays(end, -MAX_HISTORY_DAYS);
    const start = earliest && earliest > floor ? earliest : floor;
    if (start < end) {
      try {
        const byDate = await fetchRadiationHistory(location, iso(start), iso(end));
        history = { fetchedAt: new Date().toISOString(), from: iso(start), to: iso(end), byDate };
      } catch (e) {
        error = error ?? e.message;
      }
    }
  }

  if (error) lastFailure.set(key, { at: Date.now(), message: error });
  else lastFailure.delete(key);

  if (forecastRows || history) {
    await putWeatherCache({
      version: 1,
      location,
      forecast: forecastRows ? { fetchedAt, days: forecastRows } : cached?.forecast ?? null,
      history: history ?? cached?.history ?? null
    });
  }

  const calibration = calibrate(state, history?.byDate);
  return {
    location,
    fetchedAt,
    error,
    calibration,
    days: projectDays(forecastRows ?? [], calibration)
  };
}
