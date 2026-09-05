// notify.js - deciding whether the forecast has anything worth interrupting
// someone for, and what to say. Pure: no DOM, no IndexedDB, no network, so the
// service worker and the app itself run the SAME decision. That matters,
// because the app's on-open catch-up has to be able to say exactly what the
// notification would have said if it never fired.
//
// The whole design is shaped by one constraint that cannot be engineered away:
// a local notification on Android is fired by Periodic Background Sync, and
// the browser decides when that runs. There is no cron, no guaranteed 6pm.
// So nothing here is scheduled to a time. Each notification has a WINDOW it is
// allowed to fire in and a PERIOD it may only fire once per, and it goes out on
// the first sync that lands inside the window. If no sync lands there, the app
// says it on next open instead. That is also why the windows are hours wide.
//
// The second rule is restraint. A notification that arrives every day stops
// being read by the end of the week, so the daily one only fires when the day
// is genuinely out of the ordinary - well above or below what this time of year
// normally gives, or the best day of the week. An average Tuesday says nothing.
//
// The third rule is the same evidence gate as everywhere else: no notification
// until there is a fitted kWh figure to talk about (see data/forecast.js). A
// push saying "tomorrow looks sunny" is not worth a permission prompt.

import { spareForDay, typicalHouseLoadPerDay } from './forecast.js';
import { vehicleConfig, vehicleShort } from './vehicle.js';
import { dateKey } from './forecastAccuracy.js';

export const NOTIFICATION_TYPES = [
  {
    key: 'weekend',
    label: 'Weekend charging',
    blurb: 'Thursday or Friday: which of Saturday and Sunday to put the car on.'
  },
  {
    key: 'week',
    label: 'Best day this week',
    blurb: 'Sunday evening or Monday: which day this week has the most solar.'
  },
  {
    key: 'tomorrow',
    label: 'When tomorrow stands out',
    blurb:
      'Afternoons, and only when tomorrow is well above or below normal for the ' +
      'time of year, or is the best day left this week. Ordinary days say nothing.'
  }
];

// Quiet hours are fixed rather than configurable. The app already decided once
// (see the rotating-weekday-off note in CLAUDE.md) that a setting is worse than
// a sensible default, and nothing here is urgent enough to arrive at 06:00.
const QUIET_FROM_HOUR = 21;
const QUIET_UNTIL_HOUR = 7;

// How far from normal a day has to be before it is worth a notification.
const STANDOUT_HIGH = 1.25;
const STANDOUT_LOW = 0.75;
// ...and how far above the rest of the week "the best day" has to be, so a
// week of near-identical days does not crown one of them by a rounding error.
const BEST_DAY_MARGIN = 1.15;

// Typical production for this point in the year, from this household's own
// history. Same shape of gate as everywhere else: without enough comparable
// days there is no "normal" to be above or below.
const TYPICAL_WINDOW_DAYS = 21;
const MIN_TYPICAL_SAMPLES = 15;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const dayOf = (dateIso) => new Date(`${dateIso}T00:00:00`);
const addDays = (date, n) => {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + n);
  return d;
};
const dayOfYear = (dateIso) => {
  const d = dayOf(dateIso);
  return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
};
const seasonDistance = (a, b) => {
  const raw = Math.abs(a - b);
  return Math.min(raw, 365 - raw);
};

export function defaultNotifySettings() {
  return {
    enabled: false,
    types: { weekend: true, week: true, tomorrow: true },
    lastSent: {}, // type -> period key already delivered
    lastSyncAt: null,
    lastNotifiedAt: null
  };
}

// What this roof normally makes at this point in the year. Median, not mean:
// one cloudy fortnight should not move what "normal" means.
export function typicalForDate(dailySeries, dateIso) {
  const target = dayOfYear(dateIso);
  const values = [];
  for (const row of dailySeries ?? []) {
    if (row?.date == null || row.solarKwh == null) continue;
    if (seasonDistance(dayOfYear(row.date), target) > TYPICAL_WINDOW_DAYS) continue;
    values.push(row.solarKwh);
  }
  if (values.length < MIN_TYPICAL_SAMPLES) return null;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

const kwh = (n) => `${Math.round(n)} kWh`;

function withSpare(days, calibration, digests) {
  const houseLoad = typicalHouseLoadPerDay(digests);
  return days.map((d) => {
    const spare = spareForDay(calibration, d, houseLoad);
    return { ...d, spareKwh: spare?.kwh ?? null };
  });
}

// A notification body is read on a lock screen, so the car's units go in as
// the SHORTEST form (a percentage, or a distance where no battery size is
// set) and never as a second sentence. Nothing is said at all when the
// household has not entered the figures.
const spareTail = (day, vehicle) => {
  if (day.spareKwh == null || day.spareKwh < 1) return '';
  const short = vehicleShort(day.spareKwh, vehicle);
  return ` Roughly ${kwh(day.spareKwh)}${short ? ` (${short})` : ''} of it going spare for the car.`;
};

// --- The three candidates -------------------------------------------------
// Each returns null when it is out of its window, or a candidate carrying the
// PERIOD KEY it may only be sent once for. The key is what makes a repeated
// sync, or a sync on the following day, idempotent.

function weekendCandidate(days, now, vehicle) {
  // Thursday 06:00 through Friday, so it lands before the weekend is planned.
  const weekday = now.getDay();
  const hour = now.getHours();
  const inWindow = (weekday === 4 && hour >= 6) || weekday === 5;
  if (!inWindow) return null;

  const saturday = days.find((d) => dayOf(d.date).getDay() === 6 && d.kwh != null);
  const sunday = days.find((d) => dayOf(d.date).getDay() === 0 && d.kwh != null);
  if (!saturday || !sunday) return null;

  const better = sunday.kwh > saturday.kwh ? sunday : saturday;
  const other = better === saturday ? sunday : saturday;
  const betterName = DAY_NAMES[dayOf(better.date).getDay()];
  const otherName = DAY_NAMES[dayOf(other.date).getDay()];

  return {
    type: 'weekend',
    periodKey: saturday.date,
    title: `This weekend: ${betterName} is the better day`,
    body:
      `${betterName} about ${kwh(better.kwh)}, ${otherName} ${kwh(other.kwh)}.` +
      spareTail(better, vehicle)
  };
}

function weekCandidate(days, now, vehicle) {
  // Sunday afternoon through Monday: the week is being planned either way.
  const weekday = now.getDay();
  const hour = now.getHours();
  const inWindow = (weekday === 0 && hour >= 12) || weekday === 1;
  if (!inWindow) return null;

  const usable = days.filter((d) => d.kwh != null);
  if (usable.length < 3) return null;
  const best = usable.reduce((a, b) => (b.kwh > a.kwh ? b : a));
  const rest = usable.filter((d) => d.date !== best.date);
  const restAvg = rest.reduce((a, d) => a + d.kwh, 0) / rest.length;

  // Monday of the week being described, so Sunday evening and Monday morning
  // are the same period and only one of them goes out.
  const monday = dateKey(addDays(dayOf(days[0].date), weekday === 0 ? 1 : 0));
  const name = DAY_NAMES[dayOf(best.date).getDay()];
  const when = best.date === days[0]?.date ? 'Today' : best.date === days[1]?.date ? 'Tomorrow' : name;

  return {
    type: 'week',
    periodKey: monday,
    title: `${when} is this week's best solar day`,
    body: `About ${kwh(best.kwh)} against ${kwh(restAvg)} on the other days.` + spareTail(best, vehicle)
  };
}

function tomorrowCandidate(days, now, dailySeries, vehicle) {
  // Afternoon only: a verdict on tomorrow is worth having while there is still
  // an evening to act on it, and is noise at breakfast.
  if (now.getHours() < 12) return null;
  const tomorrow = days[1];
  if (!tomorrow || tomorrow.kwh == null) return null;

  const typical = typicalForDate(dailySeries, tomorrow.date);
  const usable = days.filter((d) => d.kwh != null);
  const others = usable.filter((d) => d.date !== tomorrow.date);
  const otherAvg = others.length ? others.reduce((a, d) => a + d.kwh, 0) / others.length : null;

  let title = null;
  let body = null;

  if (typical != null && tomorrow.kwh >= typical * STANDOUT_HIGH) {
    title = 'Tomorrow is a standout';
    body = `About ${kwh(tomorrow.kwh)}, well above the ${kwh(typical)} this time of year usually gives.` + spareTail(tomorrow, vehicle);
  } else if (typical != null && tomorrow.kwh <= typical * STANDOUT_LOW) {
    title = 'Tomorrow looks poor';
    body = `Only about ${kwh(tomorrow.kwh)}, against the ${kwh(typical)} normal for this time of year. Not a day to leave the car waiting on the sun.`;
  } else if (
    otherAvg != null &&
    others.length >= 2 &&
    tomorrow.kwh >= otherAvg * BEST_DAY_MARGIN &&
    tomorrow.kwh >= Math.max(...others.map((d) => d.kwh))
  ) {
    title = 'Tomorrow is the best day this week';
    body = `About ${kwh(tomorrow.kwh)} against ${kwh(otherAvg)} on the other days.` + spareTail(tomorrow, vehicle);
  }

  if (!title) return null;
  return { type: 'tomorrow', periodKey: tomorrow.date, title, body };
}

// --- The decision ---------------------------------------------------------
// One notification at most per sync, and the weekend outranks the week, which
// outranks the daily one: the further ahead the decision, the more use there is
// in hearing about it, and the daily one is the one that would otherwise turn
// into wallpaper.
export function decideNotification(forecast, settings, now = new Date(), { quiet = true } = {}) {
  const s = { ...defaultNotifySettings(), ...(settings ?? {}) };
  if (!s.enabled) return { candidate: null, reason: 'notifications are off' };

  // Quiet hours stop the PHONE buzzing at night. They are irrelevant to the
  // app's own catch-up, which only ever appears because someone opened it.
  const hour = now.getHours();
  if (quiet && (hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR)) {
    return { candidate: null, reason: 'quiet hours' };
  }

  const raw = forecast?.days ?? [];
  if (!raw.length) return { candidate: null, reason: 'no forecast' };
  if (!raw.some((d) => d.kwh != null)) {
    return { candidate: null, reason: 'no fitted kWh figure yet' };
  }

  const days = withSpare(raw, forecast.calibration, forecast.digests);
  const dailySeries = forecast.dailySeries ?? [];

  // The car's own units, when this household has entered them (config
  // travels with the state the caller already reads, so the service worker
  // needs nothing new). null leaves every body exactly as it was.
  const vehicle = vehicleConfig(forecast.config);

  const candidates = [
    weekendCandidate(days, now, vehicle),
    weekCandidate(days, now, vehicle),
    tomorrowCandidate(days, now, dailySeries, vehicle)
  ];

  for (const c of candidates) {
    if (!c) continue;
    if (s.types?.[c.type] === false) continue;
    if (s.lastSent?.[c.type] === c.periodKey) continue;
    return { candidate: c, reason: null };
  }
  return { candidate: null, reason: 'nothing worth saying right now' };
}

// Mark a candidate delivered. Kept here rather than in the caller so the
// service worker and the app's catch-up banner record it identically - a
// notification shown in the app must stop the phone repeating it later.
export function markSent(settings, candidate, now = new Date()) {
  const s = { ...defaultNotifySettings(), ...(settings ?? {}) };
  return {
    ...s,
    lastSent: { ...(s.lastSent ?? {}), [candidate.type]: candidate.periodKey },
    lastNotifiedAt: now.toISOString()
  };
}

export const NOTIFY_GATES = { QUIET_FROM_HOUR, QUIET_UNTIL_HOUR, STANDOUT_HIGH, STANDOUT_LOW };
