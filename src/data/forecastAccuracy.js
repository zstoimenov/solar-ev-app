// forecastAccuracy.js - the forecast checking its own homework.
//
// Until this existed, nothing in the app compared a projected kWh figure to
// what the roof actually produced that day, so neither the household nor the
// panel could say whether "34 kWh on Thursday" was a real-world number. The
// fitted factor in forecast.js answers "how many kWh does this roof make per
// unit of sunlight"; it says nothing about how wrong the SUNLIGHT FORECAST
// itself was, which is the larger error for a day six out.
//
// The log records one entry per (target day, lead time) - what the weather
// service said that day would get, and how far ahead it said it. Later, when
// a monthly upload brings the real dailySeries rows in, each entry is scored.
// Three things fall out, and all three are MEASURED rather than assumed:
//
//   * a bias factor - if this roof consistently delivers 94% of what the fit
//     projects, the panel should print 94%, not keep being wrong by 6%. This
//     tracks soiling, degradation and any residual mismatch between the
//     forecast model and the archive the factor was fitted on.
//   * an error band PER LEAD DAY - tomorrow is a much firmer number than
//     Sunday, and the bars can finally show that instead of drawing every day
//     with the same confidence.
//   * a plain-language accuracy line, so the figure carries its own track
//     record instead of asserting precision it has not earned.
//
// Two design decisions worth not undoing:
//
// 1. THE LOG STORES FORECAST RADIATION, NOT THE PROJECTED kWh. The fitted
//    factor changes as history grows, so a kWh figure recorded in March was
//    made by a different fit than today's. Scoring re-derives the projection
//    from the stored radiation using the CURRENT factor, which keeps every
//    measurement relative to the fit actually in use. Storing the kWh would
//    slowly poison the bias with the errors of fits long since replaced.
//
// 2. THE BIAS IS MEASURED AGAINST THE RAW FIT, and applied on top of it each
//    time. It is never measured against an already-corrected figure - that
//    is a feedback loop, and it converges on nothing useful.
//
// Same gate philosophy as the rest of the app: below the sample thresholds
// there is no correction and no measured band, and the panel says so rather
// than inventing one.

// One entry per day per lead time is 7 a day, so this is roughly seven months
// of history. The log is disposable and outside the backup, so the cap exists
// to bound the record's size, not to protect anything in it.
const MAX_ENTRIES = 1500;

// Lead times the panel actually shows.
const MAX_LEAD_DAYS = 6;

// Evidence gates. A band drawn from eight days is a guess with error bars
// painted on it, which is exactly what this module exists to replace.
const MIN_LEAD_PAIRS = 15; // before a lead day gets its own measured band
const MIN_POOLED_PAIRS = 20; // before the pooled band or the bias apply

// A bias only worth applying if it is bigger than the noise, and only ever a
// nudge: anything outside this range means the fit itself is wrong, and
// papering over that with a multiplier would hide the real problem.
const MIN_BIAS_SHIFT = 0.05;
const BIAS_CLAMP = { low: 0.7, high: 1.4 };

// A day with real sunlight but essentially no production is an inverter or
// comms outage, not weather. Perth does not hand out zero-kWh days.
const OUTAGE_KWH = 0.5;
const OUTAGE_RADIATION_MJ = 2;

export const dateKey = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const parseDay = (s) => (typeof s === 'string' ? new Date(`${s}T00:00:00`) : null);

export function daysBetween(fromIso, toIso) {
  const a = parseDay(fromIso);
  const b = parseDay(toIso);
  if (!a || !b || Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export function emptyLog() {
  return { version: 1, entries: [] };
}

// Add anything the current forecast says that is not already on record.
// Keyed on (target day, lead time), so re-reading the same cached forecast on
// a later screen - or on a later day - never writes a second copy, and never
// re-labels a three-day-out prediction as a two-day-out one. The lead time is
// measured from when the forecast was FETCHED, not from today, for exactly
// that reason.
//
// Returns a new log when something was added, or null when nothing changed,
// so the caller can skip the write.
export function recordProjection(log, days, fetchedAt) {
  const base = log?.entries ? log : emptyLog();
  const madeOn = fetchedAt ? dateKey(new Date(fetchedAt)) : null;
  if (!madeOn || !Array.isArray(days) || !days.length) return null;

  const seen = new Set(base.entries.map((e) => `${e.targetDate}|${e.leadDays}`));
  const added = [];
  for (const day of days) {
    if (!day?.date || day.radiationMj == null) continue;
    const leadDays = daysBetween(madeOn, day.date);
    if (leadDays == null || leadDays < 0 || leadDays > MAX_LEAD_DAYS) continue;
    const key = `${day.date}|${leadDays}`;
    if (seen.has(key)) continue;
    seen.add(key);
    added.push({ targetDate: day.date, madeOn, leadDays, radiationMj: day.radiationMj });
  }
  if (!added.length) return null;

  const entries = [...base.entries, ...added]
    .sort((a, b) => (a.targetDate < b.targetDate ? -1 : a.targetDate > b.targetDate ? 1 : a.leadDays - b.leadDays))
    .slice(-MAX_ENTRIES);
  return { ...base, version: 1, entries };
}

function summarise(rows) {
  if (!rows.length) return null;
  const rels = rows.map((r) => r.rel).sort((a, b) => a - b);
  const absErr = rows.map((r) => Math.abs(r.actual - r.predicted));
  return {
    n: rows.length,
    medianRel: percentile(rels, 0.5),
    low: percentile(rels, 0.2),
    high: percentile(rels, 0.8),
    maeKwh: absErr.reduce((a, b) => a + b, 0) / absErr.length,
    // Typical miss as a share of the figure shown, which is how the panel
    // says it out loud ("usually within about 12%").
    mapePct:
      (rows.reduce((a, r) => a + Math.abs(r.actual - r.predicted) / Math.max(r.predicted, 0.001), 0) /
        rows.length) *
      100
  };
}

// Score every logged entry that now has a real production figure to compare
// against. `rawFor(radiationMj, targetDate)` must be the SAME derivation the
// panel uses for its unadjusted figure - today's fitted factor, today's
// seasonal shape - because the whole point is to measure how the projection in
// use right now has actually performed. Passing anything else (a stored kWh, a
// bias-corrected figure) measures a number nobody is being shown.
export function scoreForecastLog(log, dailySeries, rawFor) {
  if (!log?.entries?.length || typeof rawFor !== 'function') return null;

  const actualByDate = new Map();
  for (const row of dailySeries ?? []) {
    if (row?.date && row.solarKwh != null) actualByDate.set(row.date, row.solarKwh);
  }
  if (!actualByDate.size) return null;

  const scored = [];
  for (const e of log.entries) {
    const actual = actualByDate.get(e.targetDate);
    if (actual == null || e.radiationMj == null) continue;
    const predicted = rawFor(e.radiationMj, e.targetDate);
    if (predicted == null) continue;
    if (!(predicted > 0)) continue;
    // An outage day says nothing about the forecast, only about the inverter.
    if (actual < OUTAGE_KWH && e.radiationMj >= OUTAGE_RADIATION_MJ) continue;
    scored.push({ ...e, actual, predicted, rel: actual / predicted });
  }
  if (!scored.length) return null;

  const byLead = {};
  for (let lead = 0; lead <= MAX_LEAD_DAYS; lead += 1) {
    const rows = scored.filter((r) => r.leadDays === lead);
    const s = summarise(rows);
    if (s && s.n >= MIN_LEAD_PAIRS) byLead[lead] = s;
  }

  const pooled = summarise(scored);
  const usablePool = pooled && pooled.n >= MIN_POOLED_PAIRS ? pooled : null;

  let biasFactor = null;
  if (usablePool && Math.abs(usablePool.medianRel - 1) > MIN_BIAS_SHIFT) {
    biasFactor = Math.min(BIAS_CLAMP.high, Math.max(BIAS_CLAMP.low, usablePool.medianRel));
  }

  const dates = [...new Set(scored.map((r) => r.targetDate))].sort();
  return {
    scoredEntries: scored.length,
    scoredDays: dates.length,
    firstScoredDate: dates[0] ?? null,
    lastScoredDate: dates[dates.length - 1] ?? null,
    byLead,
    pooled: usablePool,
    biasFactor,
    // Days already logged but not yet scoreable, i.e. waiting on the next
    // monthly upload to bring their actual production in. Worth surfacing:
    // the accuracy figure legitimately lags the forecast by up to a month.
    pendingEntries: log.entries.length - scored.length
  };
}

// The band to draw for a given lead day: that lead's own measured spread when
// there is enough of it, the pooled spread when there is not, and null when
// there is neither - in which case forecast.js falls back to the fit's own
// residual band and the panel says the forecast's own error is not in it.
export function bandForLead(accuracy, leadDays) {
  if (!accuracy) return null;
  const own = accuracy.byLead?.[leadDays];
  if (own) return { low: own.low, high: own.high, source: 'lead', n: own.n };
  if (accuracy.pooled) {
    return { low: accuracy.pooled.low, high: accuracy.pooled.high, source: 'pooled', n: accuracy.pooled.n };
  }
  return null;
}

export const ACCURACY_GATES = { MIN_LEAD_PAIRS, MIN_POOLED_PAIRS, MAX_LEAD_DAYS };
