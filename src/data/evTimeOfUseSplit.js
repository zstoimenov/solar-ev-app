// evTimeOfUseSplit.js - allocates EV charging session energy across
// time-of-day bands (e.g. Peak/Off Peak/Overnight), proportional to how much
// of each session's wall-clock duration overlaps each band. This is an
// approximation: the mobile app gives us session start/end + total energy,
// not a sub-session power curve, so a session that straddles two bands is
// assumed to have charged at a roughly constant rate throughout.
//
// This only tells us WHEN EV charging energy was delivered, not whether it
// came from solar, battery, or the grid for a given session - that split is
// only known as a daily total elsewhere. Callers should treat results as a
// "gross" figure (see Dashboard/PlanComparison.jsx), not a real grid cost.

import { parseWattpilotDateTime } from '../ingest/parseWattpilotSessions.js';

function minutesOfDay(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// One band's [from,to) window anchored to a specific calendar day (in the
// same monotonic wall-clock space as parseWattpilotDateTime), handling
// overnight wrap (to <= from means the window ends the following day).
function bandWindowForDay(dayStartMs, band) {
  const fromMin = minutesOfDay(band.from ?? '00:00');
  const toRaw = minutesOfDay(band.to ?? '00:00');
  const toMin = toRaw <= fromMin ? toRaw + 1440 : toRaw;
  return [dayStartMs + fromMin * 60000, dayStartMs + toMin * 60000];
}

function overlapMs(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

// `sessions` = [{ start, end, energyKwh }] (Wattpilot date-time strings, see
// parseWattpilotSessions.js). `bands` = [{ label, from (HH:MM|null),
// to (HH:MM|null) }] - null/null means "all day" (a flat-rate plan).
// Multiple bands may share a label (e.g. EV Add On's split "Off Peak"
// window) - their kWh accumulates into one total for that label.
// Returns { [label]: kWh }.
export function splitSessionsByBand(sessions, bands) {
  const totals = Object.fromEntries(bands.map((b) => [b.label, 0]));
  const DAY_MS = 86400000;

  for (const s of sessions) {
    const startMs = parseWattpilotDateTime(s.start);
    const endMs = parseWattpilotDateTime(s.end);
    if (startMs == null || endMs == null || endMs <= startMs) continue;
    const durationMs = endMs - startMs;

    // Anchor days: the session's own span, padded a day either side so an
    // overnight band's window (which can start the day before/after) is
    // never missed.
    const firstDay = Math.floor(startMs / DAY_MS) * DAY_MS - DAY_MS;
    const lastDay = Math.ceil(endMs / DAY_MS) * DAY_MS + DAY_MS;

    for (const band of bands) {
      let bandOverlapMs = 0;
      for (let day = firstDay; day <= lastDay; day += DAY_MS) {
        const [bStart, bEnd] = bandWindowForDay(day, band);
        bandOverlapMs += overlapMs(startMs, endMs, bStart, bEnd);
      }
      totals[band.label] += s.energyKwh * (bandOverlapMs / durationMs);
    }
  }
  return totals;
}

// Filters sessions to those starting within [fromMonth, toMonth] (YYYY-MM,
// inclusive) - used to scope the session log to the dashboard's active date
// range the same way monthlyDigests already is.
export function filterSessionsByMonthRange(sessions, fromMonth, toMonth) {
  return (sessions ?? []).filter((s) => {
    const m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(s.start ?? '');
    if (!m) return false;
    const month = `${m[3]}-${m[2]}`;
    return month >= fromMonth && month <= toMonth;
  });
}
