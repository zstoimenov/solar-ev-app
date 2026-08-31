# Redesign v2 — screens and data

Status: **implemented in v2.0.0.** This document is kept as the rationale
behind the change — what was wrong, what was decided, and what was
deliberately left alone. For how to maintain the result, see `CLAUDE.md`
("Daily series", "Screens" under UI conventions) and `app-schema_v1.md`
(`dailySeries[]`).

Companion design canvas: three artboards (the new UI as a clickable prototype,
the app as it stood at v1.15, and the data change behind it).

Read `CLAUDE.md` first. Every constraint in it still holds — this proposal
does not relax the local-only rule, the empty-public-bundle rule, the null
convention, forward-only tariff resolution, or the separation of Layers 1/2/3.

---

## 1. Diagnosis: why it is not useful

The app is an accurate monthly ledger. It is not useful because a ledger is
not what a household opens an app for.

1. **It opens with no answer.** Every dashboard panel is collapsed by default,
   so the first screen is six headings and a date filter. The app has no
   opinion about how you are doing until you tap something.
2. **Internal vocabulary is the navigation.** "ROI Layers", "Layer 1/2/3" is
   audit language. It is correct, and it is the right internal model, but it
   is not what the question sounds like in a kitchen.
3. **Nothing changes between uploads.** Data arrives once a month as three
   files. Between the 1st and the next ingest there is nothing new to see, so
   there is no reason to open it. An app you open twelve times a year gets
   forgotten eleven times.
4. **Everything is a cumulative total.** Totals answer "what has happened".
   They do not answer "is this normal", "is something wrong", or "should I
   change anything".
5. **Admin outweighs insight.** Seven ingest pages plus Backup, against six
   read-only tiles — for a surface touched once a month.
6. **Only one tile supports a decision** (Plan Comparison), and it is honestly
   scoped to EV charging only, priced gross.

Point 3 is the root cause. Points 1, 2 and 5 are presentation. Point 4 is the
data model.

## 2. The data change

### 2.1 The app already reads day-level data and throws it away

`ingest/parseFronius.js` reads the Fronius "Energy balance total" export, which
is **one row per day** — production, consumption, energy to grid, energy from
grid. It sums the columns, derives `zeroProductionDays`, and discards every
row. `ingest/parseWattpilot.js` does the same to daily EV charging, which it
reads **split by source** (PV / battery / grid), keeping only the month's
totals and `evGridChargingDays`.

That is roughly 300 numbers per month parsed and dropped; on the order of
9,000 across the tracked period. No new file, no new upload step, no new
manual entry is needed to keep them.

### 2.2 Add `dailySeries[]`

New optional top-level array, one entry per day:

```
{ date: "2026-08-15",      // YYYY-MM-DD
  solarKwh, consumptionKwh, gridImportKwh, gridExportKwh,
  evPvKwh, evBatteryKwh, evGridKwh }
```

Properties that keep it safe:

- **Additive and optional.** Not in `schema.js:DIGEST_FIELDS`; absent on
  pre-v2 backups, which continue to validate. Months without it simply have
  no day-level view — same treatment as `evHomeChargingCostAud` in v1.10.
- **Energy only, never money.** `monthlyDigests[]` stays the single source of
  truth for every dollar figure. No financial number moves as a result of
  this change, so no re-audit is triggered.
- **Null convention preserved.** A day the file does not cover is absent, not
  a row of zeros. A zero-production day is a real `0`.
- **Keeps the source split.** The EV columns are per-source in the file, so
  they stay per-source here — flattening them to one `evChargedKwh` would
  throw away the very thing that makes the daily rows worth keeping.
- **Cheap.** ~365 rows/year, ~11,000 over a decade. Trivial for IndexedDB and
  it round-trips through the existing export/restore untouched.
- **Backfillable.** Re-uploading an old month's original XLSX fills that
  month's daily rows without disturbing its stored digest.

### 2.3 Derive, do not store

None of these become schema fields; all are computed like `compute.js` does
today:

| Derived | Answers |
| --- | --- |
| Specific yield (kWh per kW per day) | Is the array underperforming? |
| Seasonal expectation band per day-of-year | Is *this week* normal? |
| Month-to-date pace vs a typical same-month | Is this month on track? |
| Cost per day, cost per 100 km | The units a household actually argues about |
| Milestone distances | A reason to come back |

The seasonal band is the first genuinely actionable thing the app can produce:
a sustained run below your own historical range for the time of year is how
soiling, new shading and a dead string announce themselves. It is derived from
the household's own history, so it carries no imported assumptions.

**Honesty constraint.** A band computed from under a year of data is not a
band. Until there is a full seasonal cycle, show the metric without the alert
rather than inventing a range — the same discipline `PlanComparison.jsx`
applies to whole-household time-of-day data, and the opposite of the
deliberately-accepted looseness in `paybackPreTracking`.

### 2.4 Retire

- `crossValExport` — permanently `"n/a"`; there is no export cross-check
  source. Move into a `validation` sub-object rather than sitting among live
  metrics.
- `batteryShortfallDays` — always null, already marked retired in
  `compute.js`.

Both are cosmetic moves; neither changes a computed value.

## 3. The screens

Five screens on a bottom tab bar, replacing the hamburger and the six
collapsed panels. A bottom bar because this is a phone app — the current
hamburger puts navigation in the hardest corner to reach one-handed.

| Screen | Answers | Absorbs |
| --- | --- | --- |
| **Today** | How am I doing, and is anything wrong? | (new) + HealthBanner, StorageHealth |
| **Energy** | Is the system performing as it should? | EnergyTrends, MonthlyComparison |
| **Car** | Is driving electric paying, and when should I charge? | EvChargingSplit, PlanComparison |
| **Money** | What has it saved, and when does it pay back? | RoiLayers, PaybackProgress |
| **Data** | Add a month; edit rates; back up. | IngestWizard (all 7 pages), ExportRestore |

Principles:

- **Today shows content, not headings.** Nothing is collapsed. The screen
  leads with an attention item when there is one, then the headline saving,
  payback, month-to-date, and what is coming up.
- **Layers keep their model, lose their jargon.** Layer 1 → "Solar and
  battery", Layer 2 → "Driving electric", Layer 3 → "Lease over a loan".
  Field names, the audit trail and the no-double-counting rule are unchanged;
  only the words on screen change. Layer 3 stays visually separate and is
  still never summed into the accrued total.
- **The date filter moves into the screens that use it.** Energy owns a
  This month / 12 months / All time control; Money is all-time by nature;
  Payback stays all-time as it must.
- **The 12-Month Comparison table becomes a view toggle on Energy**, not its
  own tile. It is the same question at a different fidelity.
- **Caveats stay.** Every scope limitation currently living in an
  `InfoPopover` survives — the Plan Comparison gross/EV-only note, the
  pre-tracking estimate warning, the "not a backup" note on persistent
  storage. They are load-bearing, and the redesign keeps them as plain
  sentences rather than hiding more behind icons.
- **412px remains the acceptance width.** The prototype was checked at
  412×915 with zero horizontal overflow on all five screens.

## 4. What this does not do

- No cloud sync. Declined in 2026-08; that decision stands.
- No change to any financial calculation, tariff resolution rule, or the
  Layer 1/2/3 separation.
- No whole-household time-of-day comparison. There is still no data source
  for it, and `PlanComparison.jsx`'s scope note still governs.
- No `schemaVersion` bump. `dailySeries[]` is additive and optional, so v1
  backups keep validating. Bump only if a required digest field changes.

## 5. What shipped in v2.0.0

All five steps of the original plan, in one change:

1. `dailySeries[]` persisted from the existing parsers (`parseFronius.js`
   and `parseWattpilot.js` now return `daily`; `buildDailySeries()` joins
   them; `mergeDailySeries()` handles re-ingest).
2. Navigation rebuilt as the five-screen bottom bar, layers renamed in the
   UI only.
3. Today built from the day-level data — attention item, headline, payback
   ring, month-to-date with sparkline, milestones.
4. The seasonal check, gated on a full year of daily history.
5. Ingest and Backup folded into Data.

### Known limitation

Months ingested before v2.0.0 have no daily rows, because the data was
discarded at the time. Energy and Today say so plainly rather than hiding
the gap, and re-uploading an old month's original XLSX backfills it. Until
a household has a full year of daily history the seasonal alert stays
silent by design.

Specific yield (kWh per kW per day) was in the proposal and is **not**
implemented: it needs the array's kW rating from `config.hardware`, whose
key names no code in this repo has ever read. Rather than guess a key and
render a wrong number, it was left out. Wire it up once the real
`config.hardware` shape is confirmed against a live backup.
