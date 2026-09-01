// intervals.js - helpers over the optional `intervalProfile` a digest gets
// when its Synergy download carried 30-minute rows (see
// ingest/parseSynergy.js for how 1,440 rows become 96 numbers).
//
// Two rules, both inherited from daily.js:
//
//   1. The profile is OPTIONAL. Months ingested from a daily-granularity
//      file, or before this existed, simply have none - every function here
//      returns null or an empty result rather than throwing, and the UI
//      degrades to the monthly totals.
//   2. ENERGY ONLY. Nothing here produces a dollar figure. Pricing a profile
//      against a tariff plan is a financial computation and belongs in
//      buildDigest.js, which remains the only place a money figure is made.
//
// Buckets are half-hourly and labelled by their START: index 0 is
// 00:00-00:30, index 47 is 23:30-24:00.

const BUCKETS = 48;

export const bucketToTime = (i) =>
  `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;

// Windows that wrap past midnight (23:00-06:00) are normal in tariff bands,
// so containment is not a plain range test.
const inWindow = (time, from, to) =>
  from < to ? time >= from && time < to : time >= from || time < to;

// Generic day parts, used when the household has no time-of-use plan on file
// to borrow band boundaries from. These are ordinary daily rhythm, not a
// rate card - the labels deliberately say nothing about price.
export const DEFAULT_DAY_PARTS = [
  { label: 'Overnight', from: '23:00', to: '06:00' },
  { label: 'Early morning', from: '06:00', to: '09:00' },
  { label: 'Middle of the day', from: '09:00', to: '15:00' },
  { label: 'Afternoon and evening', from: '15:00', to: '21:00' },
  { label: 'Late evening', from: '21:00', to: '23:00' }
];

// Prefer the household's own time-of-use plan bands: the split that matters
// is the one their rate card actually charges on. Falls back to day parts
// when every plan on file is flat (a flat plan has no `from`/`to`).
export function bandsFromPlans(config, financialYear) {
  const plans = config?.tariffPlans ?? [];
  const byPlan = new Map();
  for (const p of plans) {
    if (!p.from || !p.to) continue; // flat rate - no bands to borrow
    if (financialYear && p.financialYear && p.financialYear !== financialYear) continue;
    if (!byPlan.has(p.planName)) byPlan.set(p.planName, []);
    byPlan.get(p.planName).push({ label: p.bandLabel ?? 'Band', from: p.from, to: p.to });
  }
  let best = null;
  for (const [planName, bands] of byPlan) {
    if (!best || bands.length > best.bands.length) best = { planName, bands };
  }
  if (!best) return { planName: null, bands: DEFAULT_DAY_PARTS };
  // A rate card lists one row per band, and two rows can share a label
  // ("Off Peak" morning and evening). Keep them as separate windows so the
  // reader can see which one their usage is actually in.
  const sorted = [...best.bands].sort((a, b) => a.from.localeCompare(b.from));
  return { planName: best.planName, bands: sorted };
}

// Add several months' profiles together. The arrays are plain sums, so a
// range or all-time view is just as valid as one month - what changes is
// how many months went in, which the caller shows.
export function mergeProfiles(digests) {
  const withProfile = (digests ?? []).filter((d) => d.intervalProfile?.importKwh);
  if (!withProfile.length) return null;
  const importKwh = new Array(BUCKETS).fill(0);
  const exportKwh = new Array(BUCKETS).fill(0);
  let anyExport = false;
  let days = 0;
  let includesUnbilled = false;
  for (const d of withProfile) {
    const p = d.intervalProfile;
    for (let i = 0; i < BUCKETS; i++) {
      importKwh[i] += p.importKwh[i] ?? 0;
      if (p.exportKwh) exportKwh[i] += p.exportKwh[i] ?? 0;
    }
    if (p.exportKwh) anyExport = true;
    days += p.days ?? 0;
    if (p.includesUnbilled) includesUnbilled = true;
  }
  return {
    months: withProfile.map((d) => d.month),
    days,
    includesUnbilled,
    importKwh,
    exportKwh: anyExport ? exportKwh : null
  };
}

export function profileTotals(profile) {
  if (!profile?.importKwh) return null;
  const sum = (a) => (a ? a.reduce((x, y) => x + y, 0) : null);
  return { importKwh: sum(profile.importKwh), exportKwh: sum(profile.exportKwh) };
}

// Fold the 48 buckets into the given windows. Percentages are of the whole
// month's flow in that direction, so they answer "when do I buy / sell?".
export function bandTotals(profile, bands) {
  if (!profile?.importKwh || !bands?.length) return [];
  const totals = profileTotals(profile);
  return bands.map((b) => {
    let imp = 0;
    let exp = 0;
    for (let i = 0; i < BUCKETS; i++) {
      if (!inWindow(bucketToTime(i), b.from, b.to)) continue;
      imp += profile.importKwh[i] ?? 0;
      if (profile.exportKwh) exp += profile.exportKwh[i] ?? 0;
    }
    return {
      ...b,
      importKwh: imp,
      exportKwh: profile.exportKwh ? exp : null,
      importPct: totals.importKwh > 0 ? (imp / totals.importKwh) * 100 : null,
      exportPct: totals.exportKwh > 0 ? (exp / totals.exportKwh) * 100 : null
    };
  });
}

// The share of exported energy that landed inside one window - the figure a
// two-rate feed-in tariff needs and that a monthly export total cannot
// supply. Returned as a measured share, never assumed.
export function exportShareInWindow(profile, from, to) {
  if (!profile?.exportKwh) return null;
  const totals = profileTotals(profile);
  if (!(totals.exportKwh > 0)) return null;
  let inside = 0;
  for (let i = 0; i < BUCKETS; i++) {
    if (inWindow(bucketToTime(i), from, to)) inside += profile.exportKwh[i] ?? 0;
  }
  return {
    insideKwh: inside,
    outsideKwh: totals.exportKwh - inside,
    insidePct: (inside / totals.exportKwh) * 100
  };
}
