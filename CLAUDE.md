# CLAUDE.md — maintaining this app

Instructions for a future Claude Code session (or human) picking this project
back up. Read this before making changes.

## What this is

A **local-only** PWA that tracks a Perth household's solar/battery/EV ROI.
Vite + React (JS, no TypeScript). Deployed to GitHub Pages via GitHub Actions.
No backend, no auth, no server — all data lives in the browser's IndexedDB.

Full data contract: [`app-schema_v1.md`](./app-schema_v1.md). Read it before
touching anything under `src/data/` or `src/ingest/`.

## The one rule that must never be broken

**The public bundle (`dist/`, and therefore anything under `public/`) must
contain zero personal data.** `public/seed-data_v1.json` is an intentionally
empty starter (`monthlyDigests: []`). Never replace it with real household
data, even temporarily for testing — GitHub Pages serves `public/` verbatim
and it becomes permanently reachable in git history the moment it's committed.

To test with real data locally: keep a private copy of a real backup **outside
the repo** (e.g. a sibling `../private-data/` directory, which is not tracked),
run the dev server, and paste it into the Backup tab's restore box. It then
lives only in that browser's IndexedDB — it never touches a file the build
picks up.

If real personal data is ever accidentally committed, a `git revert` /
`--force-with-lease` push is **not sufficient** — GitHub keeps old commits
reachable by SHA even after a force-push. The only real fix is deleting and
recreating the repository (see git history around 2026-07 for the precedent).

## Architecture

```
src/
  data/       schema.js (contract + validate()), db.js (IndexedDB, the ONLY
              persistence layer), storage.js (browser storage DURABILITY -
              persist()/estimate() + backup staleness, see below), seed.js
              (first-run loader), daily.js (helpers over the optional
              dailySeries[] - month-to-date, pace, typical-for-month,
              seasonal check; see "Daily series" below), compare.js (one month
              against the month before + the same month a year earlier; see
              "Month comparisons" below), compute.js
              (recompute cumulativeTotals from the digest array), tariffSchedule.js
              (resolve a dated rate schedule for a month + sum the charging log),
              evTimeOfUseSplit.js (bucket EV charging sessions into time-of-day
              bands for Dashboard/PlanComparison.jsx), forecast.js (the ONLY
              networked module - 7-day weather + a yield estimate calibrated
              from this household's own history; see "Weather forecast" below),
              forecastAccuracy.js (the forecast scoring itself against what the
              roof actually produced - the log, the bias, the per-lead-day
              error bands; see "Forecast accuracy" below),
              notify.js (PURE: decides whether the forecast is worth an alert
              and what it says - shared by the service worker and the app),
              notifyClient.js (the page half: permission, periodic-sync
              registration, and the status report; see "Notifications" below)
  sw.js       the HAND-WRITTEN service worker: the offline app shell, plus the
              `periodicsync` handler that fires the forecast alerts. Built by
              vite-plugin-pwa in `injectManifest` mode - a generated worker
              cannot carry that handler.
  ingest/     parseFronius.js, parseWattpilot.js, parseSynergy.js (client-side
              XLSX/CSV parsing; the Synergy one ALSO folds a 30-minute file
              into a 48-bucket profile - see "Synergy interval data" below), parseWattpilotSessions.js (the Wattpilot MOBILE
              APP's charging-session JSON - different file, different granularity,
              see "EV time-of-day data" below), buildDigest.js (merges parsed +
              manual input into one monthlyDigests entry + computes the financial
              layers)
  components/ HealthBanner, StorageHealth, DataNotes, Collapsible, Modal,
              ExportRestore (the Data screen's Backup page - file-only export
              and restore; see "Backups are files" below),
              Screens/{Home,Energy,Car,Money,DataScreen} - the five bottom-nav
              screens (see "Screens" below); the Dashboard/* tiles below are
              now composed BY these rather than listed flat in App.jsx,
              IngestWizard - the WHOLE Data screen in one panel, Backup
              included (+ Ingest/{TariffScheduleEditor,ChargingLogEditor,
              TariffPlanEditor,EvSessionsUploader} - a 2-level nav of nested
              sub-tabs, not top-level tabs: see "Ingest tab navigation" below),
              Screens/parts.jsx (Lede/BigStat/SplitBar/CompareBar/ProgressRow/
              RangeChips/Deltas - the ONLY presentational primitives the screens
              use; see "Presenting information" below),
              Dashboard/{MonthlyProduction,MonthlyComparison,PlanComparison,
              DailyCalendar,SolarForecast,BestChargeDay,useForecast}
  version.js  APP_VERSION shown in the header - bump on every change (see below)
```

State shape: one JS object per `app-schema_v1.md`, validated by
`schema.js:validate()` before every write to IndexedDB (`db.js:putState`).
`DIGEST_FIELDS` in `schema.js` must be kept in sync with whatever
`buildDigest.js` actually returns — if you add/remove a monthlyDigests field,
update both, plus the field list in `app-schema_v1.md`.

## Ingest parsing — hard-won lessons

Fronius/Wattpilot XLSX exports are **not consistent between months**:

- **Units vary.** Row 2 (index 1) of the sheet states the unit per column
  (`[Wh]` or `[kWh]`) — always read it, never assume. `parseFronius.js`
  scales by 0.001 when a column says Wh. A missed unit conversion is a ×1000
  bug that's easy to miss if you only eyeball a total (a bad month still
  "looks plausible" until you compare to the cross-validation CSV).
- **Column names vary.** Don't hardcode column positions — scan the header
  row for keywords (`findCol()` in both parsers). When a real export renamed
  the export/feed-in column to "Energy to grid" (not "feed-in"), the keyword
  list had to be updated. If a future file introduces `null`s in energy
  fields that used to be populated, suspect a renamed/reworded column header
  before suspecting anything else.
- Prefer **deriving fields from the data over asking the user to type them**.
  `zeroProductionDays` and (in earlier versions) peak/lowest/std-dev
  production stats are computed straight from the Fronius daily rows — there
  is no reason to make the user transcribe numbers that are already in the
  file they just uploaded.
- Whenever you touch a parser, verify against a **real exported file**, not
  just the seed data — the seed's numbers are already correct and won't
  surface a units/column bug. Use `node` with the project's own `xlsx`
  package to inspect a real file's header/units/data rows directly if the
  user reports wrong-looking output.

## Tariff schedule + public charging log

`config.tariffSchedule.{import,export}` and top-level `chargingLog[]` (see
`app-schema_v1.md`) are **forward-only by default**: `buildDigest.js`
resolves them at ingest time for the month being built, but adding/editing an
entry never automatically recomputes already-stored historical digests —
only new/re-ingested months see the change. This was an explicit product
decision (not a shortcut). An explicit, opt-in escape hatch exists for when
the user wants existing months brought up to date without re-uploading the
original Fronius/Wattpilot files:
`ingest/recomputeFinancials.js:recomputeDigestFinancials()` re-derives just
the tariff/charging-log-DEPENDENT fields (grid cost, EV charging cost incl.
the home-charging cost, Layer 1/2 savings) from fields **already stored on
the digest** (`gridImportFroniusKwh`, `totalConsumptionKwh`, `gridExportKwh`,
`daysInPeriod`, `evFromPvKwh`/`evFromBatteryKwh`/`evFromHomeGridKwh`) — it
never needs the raw parsed inputs. It's wired up via
`components/Ingest/RecomputeFinancialsButton.jsx`, shown on the Import
Tariff and Public Charging Log pages, and must stay an explicit user action
(confirm dialog, not automatic) — don't wire it to fire on every
tariff/log edit, that would silently rewrite historical numbers.
**Important subtlety already hit once:** a month with no charging-log
entries is NOT "zero paid public charging" — it may predate the log
feature entirely (a real manually-entered figure from the old ingest flow).
`recomputeDigestFinancials()` falls back to the digest's *existing*
`evPublicTripKwh`/`evElectricityCostAud` when the log has nothing for that
month, rather than zeroing them — don't change that `?? digest.field`
fallback to `?? 0`, that's the exact bug that shipped and got caught by
testing (May's value got erased when only June had a log entry). The
export (feed-in) schedule **is** applied to `exportCreditAud` since v2.5, via
`ingest/exportCredit.js` — see "Export credit" below. `tariffSchedule.import[]`
entries also carry `supplyChargeCPerDay` now — applied equally to
`actualGridCostAud`/`baselineGridCostAud`, so it does NOT move
`layer1SavingAud` (same connection fee with or without solar), only the two
absolute cost figures.

## Tariff plan comparison — two of them, EV and whole-bill

`config.tariffPlans[]` is a catalog of rate-card **options** (Synergy's
A1/Midday Saver/EV Add On, etc.), entered via Ingest → Tariffs & Rates →
Tariff Plans, feeding the Dashboard's **Plan Comparison** tile
(`components/Dashboard/PlanComparison.jsx`). Read that file's header comment
before touching it — the scope limitation is load-bearing, not a footnote:

- **This scope note applied until v2.5.** For two years no data source here
  had a time-of-day split of general household usage — Fronius "Energy
  balance total" and Wattpilot "Energy balance" are both one row per **day**
  — so a whole-of-bill comparison was refused outright rather than built on
  an assumed band share. Synergy's interval download now supplies that split
  (see "Synergy interval data"), so `Dashboard/WholeBillComparison.jsx` on
  Money prices the WHOLE bill from measured half-hourly usage. It is
  **in addition to**, never instead of, the EV-only comparison below: they
  answer "which plan suits the house" and "which plan suits the car", and the
  EV one still knows something the other cannot — which kWh were the car's.
  A month with no interval profile still gets no whole-bill estimate; the
  refusal to guess a band share is unchanged, it simply no longer has to.
- What *does* exist: the Wattpilot **mobile app's** charging-session JSON
  export (`ingest/parseWattpilotSessions.js`, stored as top-level
  `evChargingSessions[]`, uploaded via Ingest → EV Charging Data → EV
  Sessions) has a real start/end timestamp per charging session. That's
  enough to bucket **EV charging only** by time-of-day band
  (`data/evTimeOfUseSplit.js:splitSessionsByBand`) and compare plans on that
  slice — which is what `PlanComparison.jsx` actually does.
- That comparison is still a **gross** estimate: it prices 100% of a
  session's `energyKwh` at grid rates, because the PV/battery/grid split for
  a given session isn't known (only as a daily total, with no per-session
  attribution). It also excludes the plans' `supplyChargeCPerDay` — that's a
  whole-account fixed cost, not attributable to the EV-charging decision.
- If a genuine whole-household time-of-day usage source ever turns up, wire
  the general-usage split in alongside the EV-session split rather than
  replacing it — they answer related but different questions.

## Layer 3 is the lease-vs-loan advantage (since v1.13)

The Jul-2026 Layer 3 re-audit rebased the figure: it is now the **after-tax
advantage of the novated lease over a 7% private car loan** ($3,275/yr,
$16,374 over the 5-year term — pre-tax packaging at the 32% marginal rate +
GST credits outweigh the lease's 12.82% effective finance rate), not the old
"novated lease tax saving" ($5,378/yr, May-2026 basis, superseded).
`data/compute.js:layer3AnnualAud` reads the override from
`config.lease.leaseVsLoanAdvantageAudPerYr` and **deliberately ignores** the
legacy `config.lease.taxSavingAudPerYr` key — a pre-re-audit backup carrying
$5,378 must not pin the dashboard to a figure the canonical audit replaced.
Don't "fix" that by falling back to the legacy key. Layer 3 remains a fixed
$/yr constant, never derived from energy data, and never summed into the
accrued Layer 1+2 totals.

## Layer 2 charges the EV for home energy (since v1.10)

`layer2SavingAud` = petrol counterfactual − paid public charging − **home
charging cost** (`evHomeChargingCostAud`: grid-sourced share × import rate +
PV/battery share × blended FiT, i.e. the export credit that energy
displaced). Without the home-charging term, Layer 1 (whose baseline includes
the EV's consumption) plus Layer 2 double-counted the EV's home energy and
overstated the combined saving by roughly home-charged kWh × import rate.
Keep `buildDigest.js` and `recomputeFinancials.js` in lockstep on this
formula. `evHomeChargingCostAud` is an **optional** digest field —
deliberately NOT in `schema.js:DIGEST_FIELDS`, so pre-v1.10 backups still
validate; old months pick it up via the opt-in Recompute Financials action.

## Payback accrues from Layer 1 (since v1.10)

`compute.js:recomputeCumulative` re-rolls
`payback[].recoveredAud/remainingAud/estPaybackYear` from cumulative Layer 1,
allocated across components in array order (solar → charger → battery) and
clamped at each `oopAud` — only `component`/`oopAud` and the array order are
authored data now. Payback is an **all-time** concept: `App.jsx` overrides
the date-filtered cumulative's `payback`/`paybackTotals` with a full-history
recompute — keep that override if you touch the dashboard filtering.

## Pre-tracking payback estimate (since v1.11)

Some hardware (e.g. the solar system) can predate ALL smart-meter data, not
just the earliest ingested month — there's no Fronius/Wattpilot history to
backfill because none was ever captured. `config.paybackPreTracking.
installDate` lets a household flag this; `compute.js:recomputeCumulative`
fills the `installDate` → earliest-tracked-month gap with an **extrapolated
estimate** (tracked-period average Layer 1/month × gap months) and credits
it toward Payback Progress only, via `payback[].recoveredPreTrackingAud` and
`cumulativeTotals.paybackPreTracking` — same chronological cascade order as
the tracked pool (solar → charger → battery), consumed first since it's the
earliest money. **This was an explicit, deliberately-accepted trade-off**:
extrapolating from later data is exactly the kind of "guess dressed up as a
number" this app avoids everywhere else (see Plan Comparison's scope notes),
but here the alternative — a real multi-year gap with a hard `null`/zero —
was judged less useful than a clearly-labeled rough estimate. It WILL
overstate the gap if `installDate` predates the battery or EV (their
savings get baked into the average), which is why it's surfaced with an
explicit caveat in `PaybackProgress.jsx`'s InfoPopover and never blended
into Layer 1 or ROI Layers' data-derived totals — those stay real-data-only.
Self-corrects to a no-op (`paybackPreTracking: null`) once ingested data
actually reaches back to `installDate`, since the gap is recomputed live
from the current earliest digest every time, never stored as a fixed
snapshot.

## Storage durability (since v1.14)

A populated store came back **empty** on the user's phone with no user action
— the browser had evicted it. IndexedDB defaults to the *best-effort* bucket,
which Android Chrome may clear under storage pressure (and which OEM storage
cleaners wipe outright), silently and without an error. `data/storage.js`
addresses that:

- `ensurePersisted()` requests the *persistent* bucket via
  `navigator.storage.persist()`. It is fired **automatically** on mount by
  `components/StorageHealth.jsx` — Chrome grants or refuses it silently from
  engagement heuristics with **no prompt**, so there is nothing to ask the
  user first (Firefox does prompt). Only the refusal is surfaced. The
  strongest heuristic by far is the PWA being installed, which is why
  StorageHealth captures `beforeinstallprompt` and offers an Install button
  next to the warning, then re-asks immediately after an install.
- `backupStaleness()` is the **mirror image** of `HealthBanner`'s existing
  guard. HealthBanner catches the store having *fewer* months than the last
  export (data lost); this catches it having *more* (new months never backed
  up). Don't merge the two — they're different failures with different fixes.
- `db.js:recordExport()` (renamed from `setLastExportedCount`) stamps
  `lastExportedAt` alongside the count. Call it **only on a completed
  export** — calling it on restore would falsely mark the store as backed up.
  `getAppMeta()` spreads over `{lastExportedCount: null, lastExportedAt:
  null}` so pre-v1.14 records read back as `null`, not `undefined`.

Persistent storage is **not** a backup. It does not survive clearing site
data, uninstalling, or moving to another phone/browser — it only removes the
*automatic* eviction path. The export flow remains the real durability story,
which is why the stale-backup nag exists at all.

**Related, not yet fixed:** `vite.config.js`'s `BASE` puts the app on
`zstoimenov.github.io/solar-ev-app/`. Storage quota and eviction are
per-**origin**, so every project on that github.io host shares one quota
bucket and one "clear site data" action. A custom domain (the user has
Cloudflare Pages available) would give the app its own origin. Deliberately
not done yet — it needs a domain decision and a data migration, since moving
origin leaves the old IndexedDB behind (export first, restore after).

Cloud sync was explicitly **considered and declined** (2026-08) in favour of
local hardening. If it's ever revisited: the bundle is public, so it can
never carry an API token; encrypt client-side with the existing
`data/crypto.js` so the backend only ever holds ciphertext, and gate access
with a real identity login rather than a bundled secret.

## Daily series (since v2.0)

`dailySeries[]` is an **optional** top-level array, one row per day:
`{ date, solarKwh, consumptionKwh, gridImportKwh, gridExportKwh,
evPvKwh, evBatteryKwh, evGridKwh }`.

Both monthly XLSX exports were **always** one row per day - `parseFronius.js`
and `parseWattpilot.js` summed the columns, kept the totals plus one derived
day count each (`zeroProductionDays`, `evGridChargingDays`), and discarded
every row. v2 keeps them. Both parsers now also return `daily`, and
`buildDigest.js:buildDailySeries()` joins the two on date.

Rules that must not be broken:

- **Energy only.** Nothing in `data/daily.js` computes a dollar figure.
  `monthlyDigests[]` remains the single source of truth for every financial
  number, which is why adding this could not move any stored figure and did
  not need a `schemaVersion` bump.
- **Optional forever.** It is NOT in `DIGEST_FIELDS`; `schema.js` only checks
  it is an array of dated rows *if present*. Pre-v2 backups validate
  unchanged, and months ingested before v2 simply have no day view - the UI
  must degrade to the monthly figures, never throw. Re-uploading an old
  month's original XLSX backfills it.
- **Null convention applies per field.** A blank cell is `null` (no reading),
  not `0`. The parsers' `cellKwh()` deliberately differs from `colSum()`'s
  `|| 0`, which is correct only for a total.
- **Re-ingest replaces a month wholesale.** `mergeDailySeries()` drops every
  existing row for that month before appending, so a re-run can't leave half
  the old month behind.

`seasonalCheck()` is the one genuinely actionable output: it flags production
running below what that time of year normally gives. It **returns null unless
there is at least a full year of daily history** plus enough same-time-of-year
samples. Do not relax that gate to make the alert appear sooner - a "seasonal
band" from six months of data is exactly the guess-dressed-up-as-a-number this
app refuses everywhere else (see Plan Comparison's scope note). Showing the
raw numbers with no verdict is the correct degraded state.

## Month comparisons (since v2.2)

`data/compare.js:monthComparison(digests, month, key)` returns one month's
stored value for a field alongside the **month before** and the **same month
a year earlier**, each with the absolute and percentage difference. Rendered
by `Screens/parts.jsx:Deltas` on Energy (production), Car (Layer 2 saving +
kWh charged) and Money (combined saving + the bill), and only when the
selected period is a **single month** — a range has no counterpart month, so
the block simply doesn't render.

- It **derives nothing**. It reads two values already on `monthlyDigests[]`
  and subtracts. It works for money fields for exactly that reason; it must
  never grow a computation of its own (`buildDigest.js` stays the only place
  a financial figure is produced).
- **Same month last year is the point.** Month-on-month movement in Perth is
  mostly the seasons — August beating July says nothing about the system —
  so the year-earlier row is what removes the season. If only one of the two
  reference months exists, the other row is dropped and a line says a year of
  history will fill it in.
- A percentage change from a zero reference is `null`, not infinity; `Deltas`
  falls back to the absolute difference.
- **Direction is never colour-only.** Every row prints an arrow and the
  signed size; the green/red tint only confirms it. Pass
  `higherIsBetter={false}` for figures where down is good (the bill).
- A **partial month** is flagged: it sits below a whole month by definition,
  and the note says to read the change as progress so far, not a drop. Do not
  silently hide the comparison for a partial month, and do not silently show
  it without that note.

## Backups are files, not clipboard text (since v2.2)

The export used to also write the JSON to the clipboard and the restore box
used to accept pasted text. On a real store the clipboard copy **truncated**,
and a short backup is worse than no backup because it looks like one. Both
directions are now files only:

- Export downloads `roi-backup_<lastMonth>_saved-<YYYY-MM-DD>.json` — the
  save date is in the filename so successive backups sit side by side in
  Notion instead of overwriting each other.
- Restore is a file picker. There is no textarea. `parseBackup()`'s error
  message says "file", not "pasted text".
- The anti-truncation guard (fewer months than the last export → confirm) and
  the passphrase-encryption path are unchanged; the passphrase prompt now
  appears after choosing an encrypted *file*.
- The EV-sessions uploader (Ingest → EV Charging Data) still accepts pasted
  JSON. That is a different, much smaller payload and was not the failure.

## Weather forecast (since v2.3)

`data/forecast.js` + `Dashboard/SolarForecast.jsx` (a panel at the top of
Energy) and `Dashboard/BestChargeDay.jsx` (a small panel on Car). This is the
**only** networked code in the app, and the rules that let it exist at all
are the same ones that killed cloud sync:

- **No API key, ever.** Open-Meteo requires none, which is the entire reason
  this is possible — the bundle is public, so it can never carry a token. If
  a future change needs a keyed weather provider, the answer is no.
- **Opt-in, and off until a location is set.** The app makes no outbound
  request on its own. `SolarForecast` states plainly what leaves the device
  before anything is sent.
- **Coordinates are rounded to 0.1° (~11 km)** by `roundCoord()` before being
  stored or sent, and **no household coordinate is ever committed** —
  `LOCATION_PRESETS` is coarse public geography (metro areas) and none of the
  entries is a default. The household picks, or uses `navigator.geolocation`.
  The chosen location lives in `config.forecast` (private: their IndexedDB
  and their backup file), never in `public/seed-data_v1.json`.
- **The kWh figure is FITTED, not modelled.** The forecast supplies daily
  shortwave radiation (MJ/m²); `calibrate()` fits kWh-per-MJ from this roof's
  own history — daily rows against archived radiation when there are ≥30
  matched days, otherwise complete-month totals when there are ≥6. A ratio
  estimator through the origin, never a line with an intercept (zero
  radiation must mean zero output). Do **not** replace this with a
  specs-based model (kWp × tilt × efficiency): the fit already contains the
  array, tilt, shading, soiling and clipping, and re-fits as they drift.
- **Calibrate on the same model you predict with** (v2.8). History comes from
  the **Historical Forecast API** (`historical-forecast-api.open-meteo.com`),
  the archived output of the models behind the live forecast, NOT the ERA5
  reanalysis (`archive-api`) it used until v2.8. Those are different products
  with different radiation biases, and fitting on one to predict with the
  other baked a silent scale error into every projection that more data could
  never remove — it only made the app more confident about it. The
  reanalysis stays as a fallback for when that endpoint is down,
  `history.source` records which one produced the fit, and a cache from one
  source is DISCARDED rather than merged when the other is in use. Don't
  "simplify" the two back into one.
- **A daily fit must have seen the year before it outranks a monthly one**
  (v2.8, `MIN_SEASON_MONTHS`). Thirty consecutive daily pairs is thirty days
  of ONE season, and kWh per MJ is not constant across the year (heat
  derating, inverter clipping, a lower winter sun through the same trees).
  Until the daily pairs span 6 distinct calendar months a qualifying monthly
  fit wins; with no monthly fit available the narrow daily one still runs
  (some evidence beats none) and is flagged `narrowSeason` so the panel says
  so.
- **Zero-production days are excluded from the fit** (v2.8). A day with real
  sunlight and essentially no output is an inverter or comms outage, not
  weather — Perth does not hand out zero-kWh days. Left in, each one drags
  the factor down permanently. On a two-year synthetic set, filtering them
  moved the recovered factor from 1.2% low to 0.06% low.
- **The fit's band comes only from days above a radiation floor** (v2.8). The
  band is a ratio, so a 3 MJ overcast day divides by almost nothing and
  returns a wild answer; those tails, not the weather, were setting the 20th
  and 80th percentiles for every other day.
- **Below those thresholds there is no kWh at all** — temperature and
  sunshine only, plus a line saying what is missing. Same gate philosophy as
  `daily.js:seasonalCheck()`. Don't lower it to make numbers appear sooner.
- **Energy only, never dollars.** Pricing a forecast day needs the
  time-of-day usage split the app does not have (see Plan Comparison's scope
  note). The "spare for the car" figure is a whole-day energy figure either
  way, and is not an hour-by-hour simulation.
- **"Spare" is MEASURED where it can be** (v2.9, `measuredSpare()`). It used
  to be projected production minus the household's typical non-EV daily draw,
  which knowingly modelled neither the timing within the day nor the battery.
  It is now the median surplus on past days when this roof produced about as
  much (±20%), narrowed to a ±60-day window of the year when there are ≥15 such
  days, because 30 kWh in February is not 30 kWh in July once the air
  conditioning is running. The old subtraction remains the fallback below those
  gates, and `spareBasis` says which produced the figure.
  Surplus is `gridExportKwh + evPvKwh`: energy that demonstrably had nowhere
  else to go, plus what the car took straight off the panels (which would
  otherwise have been exported, so a day the car charged must not read as a day
  with no surplus). It deliberately EXCLUDES what the car drew from the
  battery - that was stored PV displacing the evening house draw, and whether
  it is there tomorrow depends on a state of charge nothing here knows. The
  figure therefore errs low, which is the safe direction for "how much can the
  car have". A day whose `evPvKwh` was never recorded counts only its export,
  for the same reason.
- **The fit carries a seasonal shape** (v2.9, `seasonalFactors()`). One global
  kWh/MJ is wrong at both ends of the year: a 40°C day derates the panels and
  clips the inverter, and the same MJ through a low winter sun meets more
  shade. There are now 24 half-month multiplicative adjustments to the global
  ratio, each fitted from every pair within ±45 days of it so the windows
  overlap and the factor cannot step at a month boundary, gated at 30 samples
  per window and clamped to 0.75-1.25. On a two-year synthetic household with a
  12% summer derate, this cut the mean absolute error over the last year from
  4.78% to 1.74%. Only a DAILY fit can carry one - whole-month totals have one
  point per month, which is the very thing being adjusted for.
- **`rawKwhFor()` is the single definition of the unadjusted projection** and
  both the panel and the accuracy log's scoring go through it. If the seasonal
  shape were applied on screen but not in scoring, the measured bias would
  absorb the seasonal error the shape already handles and correct it twice.
- **The fit is weighted by recency** (v2.9, `RECENCY_HALF_LIFE_DAYS`, 365). A
  roof is not the roof it was two years ago: panels degrade, dirt builds up, a
  tree grows into the afternoon sun. Weighting the LEVEL by age tracks that
  without discarding the older days that give the seasonal shape its samples.
  The band is deliberately NOT weighted - a spread is not something that
  decays, and the accuracy log supersedes the fit's band anyway. On a synthetic
  household degrading 5%/yr the weighted fit sits 1.5% closer to what the roof
  is doing now.
- **Projections are capped at what the array has actually done** (v2.8):
  110% of the observed daily record, once there are ≥60 daily rows to know
  what that record is. A projection above everything the roof has ever
  produced is a fault in the factor, not a good day.
- **The weather cache is NOT part of the backup.** `db.js` keeps it under its
  own `weatherCache` key, outside `state`, so `validate()` never sees it and
  no backup file carries a copy of someone else's API response. Losing it
  costs one request.
- **Dates are LOCAL, never UTC** (v2.8). Perth is UTC+8, so `toISOString()`
  names yesterday for the whole local morning, which shifted the calibration
  window by a day and quietly cost a pair on every early-morning open.
  Open-Meteo is asked for `timezone=auto` and answers in local dates, and
  `dailySeries[]` stores local dates, so it all lines up only if this module
  does too.
- **History is fetched by gap, not wholesale** (v2.8). It used to refetch ~2
  years of daily rows every day despite a comment promising it extended the
  tail; on a warm cache it is now a one-day request, often none. The history
  refresh is also no longer gated on the forecast request having succeeded —
  two independent endpoints were failing together for no reason.
- The panels degrade rather than disappear: a failed fetch shows the last
  cached forecast with a warning, failures are rate-limited by a 60s
  cool-down, and `useForecast` de-duplicates the two panels' fetches.

**The panel is arranged around the decision, not the calendar** (v2.6, from
the design canvas in `design/forecast/`). It leads with a verdict block
naming the best day, then shows only the days this household acts on:

- **Today and tomorrow get a full row each** — the two days decided in the
  next 24 hours. On a **Friday** Sunday joins as a third row, so the whole
  weekend is on screen as rows and the card below drops out rather than
  showing Saturday twice.
- **The coming weekend is ONE card, not two more rows** (v2.7): the two days
  side by side, each with its own figure and bar so they are directly
  comparable, plus the combined total and spare-for-the-car. Saturday and
  Sunday are when the car normally goes on the charger, so the weekend earns
  a permanent place — but two more full rows made the panel too tall to take
  in at a glance, which was the whole point of the rework. Any 7-day window
  contains exactly one Saturday and one Sunday, so both are always available.
  The card shows **only while both weekend days are still ahead of the rows
  above**; from Friday onwards the rows are the weekend, so it drops out.
- The remaining days are behind a "Rest of the week" toggle — one tap away,
  never gone, and where a day off gets looked up.
- **A rotating weekday off needs no configuration.** The verdict block names
  the best day of the week whichever day it falls on, so the household sees
  it on whatever day they are home. A shift-scheduling feature was considered
  and rejected as more configuration than it is worth — don't add one.
- **The range IS the bar**: the dim extent is the fitted 20th-80th percentile
  band and the bright line is the middle of it, on one shared scale across
  every row, so uncertainty is never a footnote. A monthly-fitted calibration
  has no daily band, so those rows draw a plain fill instead and the
  InfoPopover says why.
- "Spare for the car" is the measured surplus on comparable past days, with
  `typicalHouseLoadPerDay()` subtraction as the fallback (see above) — energy
  only, a whole-day figure, and labelled with whichever basis produced it.

## Forecast accuracy (since v2.8)

`data/forecastAccuracy.js` is the forecast checking its own homework. Before
it, nothing compared a projected kWh figure to what the roof actually made
that day, so neither the household nor the panel could say whether "34 kWh on
Thursday" was a real-world number - and the fit could only ever get more
confident, never more correct.

Every projection is logged; when a monthly upload brings the matching
`dailySeries` rows in, each entry is scored. Three things fall out, all
measured rather than assumed: a **bias factor**, an **error band per lead
day**, and the plain-language accuracy line in the panel.

- **The log stores the forecast RADIATION, not the projected kWh.** The fitted
  factor changes as history grows, so a kWh figure recorded in March came from
  a different fit than today's. Scoring re-derives the projection from the
  stored radiation using the CURRENT factor, which keeps every measurement
  relative to the fit actually in use. Storing the kWh would slowly poison the
  bias with the errors of fits long since replaced. Don't "optimise" that by
  caching the kWh.
- **The bias is measured against the RAW fit and applied on top of it**, never
  measured against an already-corrected figure - that is a feedback loop, and
  it converges on nothing useful. The band ratios are the same: both are
  ratios against the raw fitted number, so they apply to it and never to each
  other.
- **It lives outside the backup**, under its own `forecastLog` IndexedDB key
  like `weatherCache`, and is deleted by `resetState()` (scoring a log against
  a wiped store would report a phantom history). A restore or a new phone
  starts the measured bands from zero and rebuilds them in a few weeks; that
  was the explicit trade-off, taken to keep backup files clean and small.
- **Entries are keyed on (target day, lead time), with the lead measured from
  when the forecast was FETCHED**, not from today. Re-reading the same cached
  forecast on another screen, or on the next day, must not write a second copy
  or relabel a three-day-out call as a two-day-out one.
- **Gates, as everywhere else**: 15 scored days before a lead day gets its own
  band, 20 pooled before the pooled band or the bias apply at all, and a bias
  only applies when it exceeds 5%, clamped to 0.7-1.4. Outside that range the
  fit itself is wrong and a multiplier would hide it. Below the gates there is
  no correction and no measured band - the panel falls back to the fit's own
  residual scatter and says the forecast's own error is not in it yet.
- **The accuracy figure legitimately lags by up to a month**, because real
  production only arrives with a monthly upload. `pendingEntries` counts what
  is logged but not yet scoreable, and the panel says so rather than looking
  broken.
- The displayed figure is clamped into its own band. The bias is pooled and
  the band is per lead day, so the mark could otherwise land just outside its
  own range, which reads as a bug whatever the arithmetic behind it.

Verified against a two-year synthetic household: `calibrate()` recovers a
known factor to 0.06%, a deliberately 8%-high forecast is detected as a 0.93
bias, and measured error widens from ~7% at lead 0 to ~14% at lead 6.

## Notifications (since v2.10)

Three forecast alerts - the weekend, the week's best day, and a standout
tomorrow - fired by the phone itself. `data/notify.js` decides, `src/sw.js`
delivers, `components/ForecastAlert.jsx` says whatever never got delivered the
next time the app is opened.

**There is no server and no push subscription, and there must not be one.** The
service worker wakes on `periodicsync`, reads this household's own IndexedDB,
makes the same keyless Open-Meteo request the panel already makes, and shows the
notification locally. Nothing new leaves the device. Web Push was considered and
rejected on the same grounds as cloud sync: it needs a server holding a VAPID
private key and the subscription endpoint, and the bundle is public.

What that costs is precision about WHEN, and the design absorbs that rather than
hiding it:

- **Nothing is scheduled to a time.** Chrome decides when a periodic sync runs;
  `minInterval` (4h) is a floor it is free to ignore, and an app that is rarely
  opened is fired rarely or never. So each alert has a WINDOW of hours it may
  fire in - weekend Thu 06:00 to end of Fri, week Sun 12:00 to end of Mon,
  tomorrow any afternoon - and goes out on the first sync that lands inside it.
- **A PERIOD KEY makes it idempotent**, not a timestamp. Each candidate carries
  the key it may only be sent once for (the coming Saturday's date, that week's
  Monday, tomorrow's date), so a second sync in the same window, or the next
  day's sync, sends nothing. Sunday evening and Monday morning share one key on
  purpose.
- **The app's catch-up counts as delivery.** `ForecastAlert` on Today re-runs
  the SAME decision on open and shows anything still unsent, then marks it sent
  so the phone does not buzz hours later with advice already read. This is why
  the decision lives in a pure module with no DOM and no IndexedDB - two
  deliverers, one decision. It ignores quiet hours (the household is already
  looking at the screen) and nothing else.
- **Restraint is the feature.** The daily alert fires only when tomorrow is 25%
  above or below what this time of year normally gives (from this household's
  own `dailySeries`, gated at 15 comparable days) or is clearly the best day
  left in the week. An ordinary Tuesday says nothing. At most one alert a day,
  and the weekend outranks the week, which outranks tomorrow.
- **The same evidence gate as everywhere else**: no alerts at all until there is
  a fitted kWh figure (see the forecast section above). "Tomorrow looks sunny" is
  not worth a permission prompt.
- **Quiet hours are fixed at 21:00-07:00, deliberately not configurable** - the
  same call as the rejected shift-scheduling feature. The only settings are the
  master switch and one toggle per alert type.
- **The Alerts page reports the whole chain, not a switch.** Installed,
  permission, background sync registered, last sync, last alert, last reason.
  Local notifications depend on four things a household cannot see, and when
  nothing arrives "broken" and "Chrome has not fired yet" look identical.
- **Android's own notification switch is separate from the browser permission**,
  so `showNotification()` can still be refused. That refusal is caught and
  reported in plain language, and the period is NOT marked sent - a refusal must
  not silently consume the one alert that period was allowed.
- `notifyState` lives outside the backup like `weatherCache` and `forecastLog`,
  and is deliberately not restored: permissions are per device, and a restore
  must not start a new phone notifying on someone else's schedule.

`src/sw.js` also owns the offline app shell now. It replaced a generated worker,
so `precacheAndRoute` + the navigation fallback there must keep doing what that
one did - test an offline reload after touching it. It is built as **iife**, not
an ES module: module service workers are Chrome-only and the shell has to keep
working everywhere it used to.

## Synergy interval data (since v2.4)

Synergy's `MA_IntervalDataHistory.csv` now comes with **one row per 30
minutes** and two channels (`ANYTIME (KWH)` import, `Solar export (Units)`).
It has previously been one row per day, and could be again, so
`parseSynergy.js` is ONE parser that detects the shape it was handed rather
than being told: it always produces the billed monthly import total, and
additionally a half-hourly profile when a Time column is present. If the
interval download ever disappears, the profile comes back `null` and
everything else keeps working.

- **The raw rows are never stored.** A month is 1,440 rows (~57 KB of CSV);
  they are folded at ingest into 48 half-hourly buckets per direction — 96
  numbers, well under a kilobyte — and discarded. Putting intervals in the
  store would bloat every backup, which is the failure the file-only backup
  change just fixed. Aggregate at ingest, keep the summary, discard the
  input — the same principle as the digest itself.
- **Buckets are labelled by their START**, confirmed with the household:
  a row stamped `07:30` covers 07:30–08:00. Reading it as interval-ending
  would shift every tariff band by half an hour and quietly misprice
  everything downstream.
- **The `time` column needs its own finder.** A keyword match on "time" also
  matches `ANYTIME (KWH)`, which is the *usage* column — that mix-up would
  bucket a whole month into 00:00. `findTimeField()` requires an exact match
  or a name carrying no unit; there is a regression case for it.
- **The `Billing Status` column is ignored** (household's decision, v2.5).
  It marks what Synergy has invoiced versus what falls in the next billing
  period — it says nothing about whether a reading is real. Filtering on it
  made a month's total depend on when the download happened (August read
  130.4 kWh billed-only against 144.9 kWh actual). Both the total and the
  profile are built from every in-month row, so they always reconcile. A
  month is `pending` only when the file had no rows for it at all.
- `intervalProfile` is an **optional** digest field, deliberately NOT in
  `DIGEST_FIELDS`, so pre-v2.4 backups still validate. Re-ingesting a month
  from a daily-granularity file falls back to `prevDigest.intervalProfile`
  rather than erasing a profile captured earlier — the same trap as the
  charging-log `?? digest.field` fallback.
- `data/intervals.js` is **energy only**, like `daily.js`. It folds buckets
  into arbitrary windows, borrowing the household's own rate-card bands via
  `bandsFromPlans()` when they have a time-of-use plan on file. It computes
  no dollar figure; pricing a profile against a plan is a financial
  computation and belongs in `buildDigest.js`.

**What this unblocked, both now done (v2.5):** a whole-of-household tariff
comparison (`Dashboard/WholeBillComparison.jsx` on Money) and a real
peak/off-peak split for `exportCreditAud` (see "Export credit" below). Both
move stored money figures, which is why they were kept out of the commit that
added the parser.

## Export credit (since v2.5)

`ingest/exportCredit.js` is the ONE implementation of what a month's exported
energy earned, imported by both ingest paths — `buildDigest.js` on a fresh
ingest and `recomputeFinancials.js` on the opt-in recompute. They must never
drift: the same month must produce the same credit whichever route computed
it. It records on the digest which of two bases produced the number, rather
than leaving a reader to infer it:

- `'measured-split'` — the household has a two-rate feed-in schedule
  (`config.tariffSchedule.export`) AND the month has an `intervalProfile`. The
  profile says what share of the exported energy actually left inside the peak
  window, so each share is paid at its own rate. On the real August file that
  share is 25.7%, and pricing it properly moved the month's credit from $21.47
  to $9.90 — the single-rate figure had been crediting every exported kWh at
  the peak rate.
- `'single-rate'` — no schedule or no profile: the previous behaviour exactly
  (whole export total at `config.tariffs.debsPeakCPerKwh`), so months without
  interval data keep the figure they already had.

Two deliberate choices inside it:

- **The share comes from the meter profile; the quantity credited stays
  `gridExportKwh` (Fronius).** The two export totals differ slightly, and
  swapping which one is credited would move Layer 1 for a reason unrelated to
  the time-of-day split. Only the rate applied is new.
- **Layer 2's foregone-export rate is still the single `debsPeak`.** What an
  EV's PV/battery kWh would have earned depends on the time of day it charged,
  which the Wattpilot data does not say. Blending it on the household's
  average export share would move Layer 2 on an assumption — exactly what this
  change removes from Layer 1. Leave it until per-session attribution exists.

`exportCreditBasis` and `exportPeakSharePct` are **optional** digest fields,
not in `DIGEST_FIELDS`, so pre-v2.5 backups still validate.

`data/planPricing.js` is the matching module for HYPOTHETICAL money — what a
month would have cost on a plan the household is not on. It lives outside
`buildDigest.js` because nothing it computes is ever stored, and it shares
`groupPlans()`/`bandCoverageMinutes()` with the EV-only `PlanComparison.jsx`
so the two comparisons can never disagree about a plan's bands.

## Null convention

Absent numeric/text values are always `null`, never `0` or `""` — this is
how the app tells "no data yet / pending" apart from "confirmed zero" (e.g.
a month where Synergy hasn't billed yet vs. a month with genuinely zero
grid import). Preserve this in any new field or computation.

## Versioning

`src/version.js` exports `APP_VERSION`, shown next to the title in the
header. **Bump it on every user-facing change** — UI, ingest behavior, or
schema. Use semver-ish increments: patch for small fixes/tweaks, minor for
new features or field changes, major only for a `schemaVersion` bump.

Since v2.10 there is only ONE place to do that: add an entry to the top of
`src/changelog.js` and `APP_VERSION` follows it (`version.js` reads
`LATEST.version`). That is deliberate — the header number and the number in
the "What's new" panel cannot drift apart if neither is typed twice. Write the
`changes` lines in the register the rest of the app uses: what it now does for
the household, not which module moved.

## Presenting information (since v2.1)

The v2.0 redesign fixed navigation but left the content as it was: the same
figures, relocated. v2.1 reworked what each screen actually says. These rules
are why, and undoing them re-creates the problem.

- **One fact, one rendering.** The retired tiles each showed the same numbers
  two or three ways: `RoiLayers` rendered three metric cards *and* a table
  repeating them; `PaybackProgress` rendered a stacked bar chart *and* a table
  repeating that; `EvChargingSplit` rendered a doughnut, a stacked bar chart
  and a legend for one split. Never add a table that restates a chart above it.
- **A bare number is not information.** "151 kWh" tells a household nothing.
  Every headline figure carries either a comparison (`CompareBar`, against
  that month's own historical typical) or a plain-language sentence
  (`Lede`) saying what it means. Prefer a sentence over another metric card.
- **Never a dual-axis chart.** The old `EnergyTrends` plotted kWh, percent,
  dollars and kWh again across two y-axes; with two scales any two lines can
  be made to cross, so it could not be read honestly. It is now
  `MonthlyProduction`: one series, one axis, no legend needed. Money lives on
  Money, EV charging on Car, self-sufficiency as a stat.
- **The source palette is validated, not chosen by eye.** `SOURCE_COLORS` in
  `Screens/parts.jsx` is checked against the `#1e293b` panel surface: normal
  vision dE 21, worst colour-blind pair (grid red vs battery green) dE 6.5.
  A 6-8 CVD score is legal ONLY with secondary encoding, which is why
  `SplitBar` always draws a labelled row per segment plus 2px gaps between
  fills - do not "tidy" those away. The pre-v2.1 five-colour set had `#a78bfa`
  next to `#60a5fa`: dE 0.3 under deuteranopia, i.e. two adjacent segments
  literally nobody could distinguish. Free and paid public charging are now
  one "Away from home" category; what separates them is cost, shown as dollars.
  Re-run the check (`dataviz` skill's `scripts/validate_palette.js`) before
  changing any series colour.
- **Sequential means one hue.** `DailyCalendar` shades dim -> bright in the
  accent yellow only. Never a rainbow for magnitude.
- **Charts are a last resort, not a default.** A stat with a sentence beats a
  chart for a single number; a `SplitBar` beats a doughnut for a share.

## UI conventions

- **Five screens on a fixed bottom nav** (`App.jsx`'s `SCREENS`): Home,
  Energy, Car, Money, Data. Bottom rather than top because this is a phone
  app and the top-right corner is the hardest place to reach one-handed.
  Content on a screen is **visible on arrival** — the pre-v2 dashboard
  collapsed all six panels by default, so opening the app showed six
  headings and no answer, which was the single biggest reason it felt
  useless. Don't reintroduce collapse-by-default on Home.
  `Collapsible.jsx` is still available for genuinely secondary content.
- **Home shows nothing it cannot derive.** (Called Today until v2.10 - it
  was renamed because the total saved, the payback ring and the milestones are
  all-time figures, and only the month-to-date block is about now.) Each block (attention item,
  payback ring, month-to-date, milestones) renders only when its inputs
  exist. Never fill a gap with an estimate to keep the layout even — the
  one sanctioned estimate in the app is `paybackPreTracking`, and it is
  labelled as one.
- **Screen scoping: three periods, one control** (since v2.2). Energy, Car
  and Money each carry the same `RangeChips` row at the top of the screen —
  *This month* / *Selected range* / *All time* — with the From/To
  `DateRangeFilter` shown inline underneath only while *Selected range* is
  picked. `App.jsx` builds one `scopes = { month, window, all }` object and
  the screen just chooses; there is no range control in the header any more
  (it asked the same question twice on Energy, and asked it in the
  hardest-to-reach corner of a phone everywhere else). Defaults preserve
  each screen's old behaviour: Energy *This month* when daily data exists,
  Car *Selected range*, Money *All time*. Home is all-time and has no
  chips. **Payback stays all-time in every scope** — `scopedState()` copies
  `payback`/`paybackTotals`/`paybackPreTracking` from the full-history
  recompute, and Money says so in the panel when a shorter period is
  selected. Don't "fix" that by rescoping it.
- **Layer names are plain language in the UI, unchanged in the model.**
  Layer 1 → "Solar and battery", Layer 2 → "Driving electric", Layer 3 →
  "Lease over a loan", with the layer number kept as a secondary label in
  the breakdown table. Field names, `compute.js`, and the no-double-counting
  rule are untouched.
- **The 12-Month Comparison tile** (`Dashboard/MonthlyComparison.jsx`) is the
  one deliberately *tabular* dashboard panel — exact per-month numbers for the
  four headline flows (solar production / export / grid import / EV-from-solar),
  where Energy Trends answers the shape-over-time question. It renders the last
  12 months of whatever range `App.jsx` passes it, so the date filter still
  applies. Its column headers are terse (`Import`, `EV solar`, `Avg/mo`, short
  `Jul '25` row labels) purely so all five columns clear 412px without a
  sideways swipe — the long-form wording lives in its `InfoPopover`. If you add
  a column, re-check that width before merging; the fallback is a horizontal
  scroll, which hides the rightmost metric by default.
- `table.digest` is a generic key/value or small tabular table style. It
  wraps by default (`table-layout: fixed`) so long labels don't force a
  scroll on narrow screens. If a table specifically benefits from staying on
  one row (e.g. Payback Progress' 5 numeric columns, or the Ingest tab's
  tariff-schedule/plan/log tables), wrap it in `.table-scroll` (already
  `overflow-x: auto`) and add the `table-nowrap` class to opt out of fixed
  layout — see `app.css` for why plain `nowrap` + `table-layout: fixed`
  causes visual overlap instead of a scrollbar.
- Test any layout change against a **412px-wide viewport** (OnePlus 12 /
  typical Android flagship) — the project's acceptance bar for "no
  horizontal scroll" is that width, not just desktop.
- **The header's ⓘ panel is "What's new", not Data Notes** (since v2.10). It
  shows the version being run and what changed in it, and nothing else. It was
  a list of data caveats (a provisional feed-in rate, months awaiting a Synergy
  bill, the servicing step-change); those were context about numbers rather
  than something to act on, and they made the one panel reachable from every
  screen a place nobody opened twice. A caveat belongs beside the number it
  qualifies — which is where the ones that still matter already are (see the
  InfoPopover convention below). Only the NEWEST release is listed: someone
  opening it wants to know what changed since they last looked, not to read a
  history. It stays a dismissible `<Modal>`, not a permanent panel.
- **Long explanatory text is a summary sentence + `<InfoPopover>`, not a
  paragraph.** (`src/components/InfoPopover.jsx`.) Every Ingest sub-page and
  several Dashboard tiles follow this: one short always-visible sentence
  saying *what* the page/field is, with the *why/how/caveats* tucked behind
  the "i" icon. When adding a new field or page, resist writing a 3-sentence
  blurb up front — write one sentence, and put the rest behind an
  `InfoPopover` from the start.
- **The Data screen is ONE panel** (since v2.2). Backup is a page in the same
  index as the ingest pages (`IngestWizard.jsx`'s `PAGES`), not
  a second panel stacked underneath — two panels with two different
  navigation idioms read as two half-screens. `DataScreen.jsx` owns the
  selected category so the stale-backup banner's "Back up now" can actually
  open the Backup page. Within Backup, the destructive month-delete/reset
  actions live in a **collapsed** `Collapsible` so the two things the page is
  for (back up, restore) are the only things on it.
- **The Data screen is an INDEX and a drill-in, not tabs** (since v2.10).
  `IngestWizard.jsx`'s `PAGES` array is flat, each entry carrying its `group`
  and a one-line `blurb`; `GROUPS` is the order those groups appear in.
  `DataScreen` holds the page in view, where `null` is the index. To add a
  page: one entry in `PAGES`, one render line, and give it a heading of its
  own (every page renders its own, which is why the drill-in view adds no
  title and nothing is titled twice).
  The two rows of pills this replaced wrapped to **three lines on a 412px
  phone**: a category with sub-pages spent 278px, most of a third of the
  screen, on navigation before any content appeared, and the category `intro`
  paragraph sat BETWEEN the two rows so the levels did not read as levels.
  The same page now sits 59px down. Do not go back to pills to save a tap:
  this screen is touched about once a month, a grouped list of eight rows is
  not the same thing as a wrapped row of eight pills (a list has a shape), and
  the blurb finally has somewhere to live. A horizontal scroll is not the
  answer either — see the 12-month table note above, where a scroll hides
  the rightmost column by default.

## Testing changes

There's no automated test suite. Verify by hand:
1. `npm run build` must succeed.
1b. If you touched `src/sw.js` or the PWA config, test the BUILT worker, not
   the dev server: `npm run build && npx vite preview`, then check the worker
   activates, that an offline reload still renders the app, and that posting
   `{type:'notify-check'}` to `registration.active` answers. Headless Chromium
   refuses the notification permission outright, so whether a notification
   actually appears can only be checked on a real phone.
2. Run `npm run dev`, use Playwright (Chromium is pre-installed at
   `/opt/pw-browsers/...`, module at
   `/opt/node22/lib/node_modules/playwright/index.mjs`) at a 412×915
   viewport to check for horizontal overflow
   (`document.documentElement.scrollWidth - clientWidth` should be `0`) and
   to screenshot key screens.
3. To test with real data without ever writing it to a tracked file, paste
   a private backup JSON into the Backup tab's restore textarea via
   Playwright's `page.fill('textarea', ...)`.
4. If touching ingest parsing, test against a real uploaded XLSX/CSV, not
   just the seed — see "Ingest parsing" above.

## Deploy

`.github/workflows/deploy.yml` builds and publishes `dist/` on every push to
`main`. **Pages must be set to Source: GitHub Actions** (Settings → Pages) —
not "Deploy from a branch", which would serve the raw unbuilt source and
produce a blank page (the dev `index.html` points at `/src/main.jsx`, which
doesn't exist in production).
