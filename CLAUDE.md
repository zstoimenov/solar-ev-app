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
              persist()/estimate() + THREE staleness checks: the file backup,
              the cloud copy, and (since v2.15) the ingest itself, see below),
              seed.js
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
              vehicle.js (PURE: turns a spare-kWh figure into a share of the
              car's battery and a distance, from the two optional numbers in
              config.vehicle; see "Spare solar in the car's own units" below),
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
              TariffPlanEditor,EvSessionsUploader,VehicleSettingsEditor} - a
              2-level nav of nested
              sub-tabs, not top-level tabs: see "Ingest tab navigation" below),
              Screens/parts.jsx (Lede/BigStat/SplitBar/CompareBar/ProgressRow/
              RangeChips/Deltas - the ONLY presentational primitives the screens
              use; see "Presenting information" below),
              Dashboard/{MonthlyProduction,MonthlyComparison,PlanComparison,
              DailyCalendar,SolarForecast,BestChargeDay,SunCurve,WeekVerdict,
              useForecast}
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

Cloud **sync** was explicitly considered and declined (2026-08) in favour of
local hardening, and remains declined. Cloud **backup** was built in 2026-09
against the three conditions that decision set out - see the next section.
The distinction is the whole point: nothing merges, nothing writes in the
background, and IndexedDB is still the only source of truth.

## Encrypted cloud backup (since v2.13)

`data/cloud.js` + `components/Ingest/CloudBackup.jsx`, backed by one Supabase
table (`supabase/migrations/0001_backups.sql`). This is the second networked
feature in the app, and it exists only because it answers, one by one, the
three conditions the 2026-08 cloud-sync refusal set:

- **"The bundle can never carry an API token."** It doesn't. `cloudKeys.js`
  holds a Supabase *publishable* key, which names the project and authorises
  nothing: every row sits behind RLS keyed on `auth.uid()`, so without a
  signed-in session the key reads nothing and writes nothing. Do not confuse
  this with a weather API key, where the key *is* the authorisation - that
  kind is still forbidden.
- **"Encrypt client-side so the backend only holds ciphertext."** `encryptJson()`
  from the existing `data/crypto.js` runs before the row is built, and there is
  **no plaintext upload path to pick by accident**. `pullSnapshot()` refuses any
  row that is not an encrypted envelope rather than importing it - plaintext in
  that table would mean the encryption path was bypassed, which is a bug to fail
  loudly on. Don't add a "skip encryption" option.
- **"Gate access with a real identity login."** Supabase Auth, email +
  password (`signInWithPassword`). **"Allow new users to sign up" must stay
  OFF**, and the app has no registration path at all - with signups on, the
  public key would let a stranger open an account on the project. They still
  could not read the household's rows, but they could burn the free tier.

**The account is created by hand, once, in the dashboard** (Authentication ->
Users -> Add user, with a password and "Auto Confirm User" ticked). Nothing in
the app can create it, and nothing in the app should be changed so it can.
Note the ordering trap this creates: turning signups off *before* the account
exists locks you out of your own project, and the dashboard is the only way
back in. That exact sequence cost an afternoon on 2026-09-02.

**Why password and not the emailed one-time code this shipped with.** The OTP
version was written first and could not work on a free project. Three
independent blockers, all discovered only against the live project:

- Supabase's built-in mail server **only delivers to addresses on the
  organisation's team**. Every other address fails with "Email address not
  authorized" and no message is sent. A custom SMTP provider is the only fix,
  and that is a whole external dependency for one household's login.
- `signInWithOtp` sends a **magic link, not a code**, unless the Magic Link
  template is edited to include `{{ .Token }}` - and template customisation was
  not available on this project. The app's UI asked for six digits that the
  email never contained.
- A PKCE magic link only completes **in the browser that requested it**. Tapping
  a link from a phone's mail app routinely opens a different one.

A password sends no message, so none of the three can occur. The old objection
("no password field on a public page") does not hold up: the password is checked
by Supabase and never by the bundle, the bundle carries no secret either way,
RLS still scopes every row, and the backup is encrypted with a **separate**
passphrase - so a stolen password buys ciphertext. Keep the two secrets
distinct and say so in the UI: the password is resettable, the passphrase is
not.

Rules that must not be broken:

- **It is a SECOND backup, never the only one.** A free Supabase project pauses
  after ~7 days idle and is deleted after 90 days paused, and this household
  ingests monthly. `.github/workflows/supabase-keepalive.yml` pings it daily to
  prevent that, but the file export in `ExportRestore.jsx` stays the primary
  durability story and its stale-backup nag is untouched. `cloudStaleness()` in
  `data/storage.js` is a **sibling** of `backupStaleness()`, deliberately not a
  merge of it - two backups, two failure modes, two different fixes.
- **The passphrase is never stored.** Every push and every pull asks for it.
  That is the cost of ciphertext-only and it is the accepted trade, the same one
  the encrypted file export already makes.
- **What leaks, by choice:** `month_count`, `first_month`, `last_month` and
  `app_version` are plaintext columns so the snapshot list is readable without
  decrypting everything. That reveals "N months, dated X to Y" and nothing else -
  no energy figure, no dollar figure, no location. If that is ever unwanted,
  write them `null`; don't encrypt them separately, which would just move the
  problem.
- **The table is append-only.** There is deliberately no UPDATE policy, so a bad
  push can never overwrite a good snapshot. The truncation guard
  (`pushPreflight()`) is the same one the file export has had since v1.14.
- **A restore goes through `importState()`**, so it hits exactly the same
  validation and forward-migration choke point as a file restore. Never bypass
  it.
- **`authSession` and `cloudMeta` live outside `state`**, like `weatherCache` /
  `forecastLog` / `notifyState`, and both are deleted by `resetState()`. The
  session is a credential and must never travel inside a backup file. It is in
  IndexedDB rather than localStorage - supabase-js is given a custom storage
  adapter - so `db.js`'s "no localStorage for app data" rule survives having a
  third-party client in the tree.
- **`weatherCache`, `forecastLog`, `notifyState` and `uiPrefs` are NOT uploaded.**
  They are device-local by design; restoring them onto a new phone would report a
  phantom history, start it notifying on someone else's schedule, or answer a
  question that phone was never asked (see "Per-device UI preferences" below).
- **No background push and no service-worker involvement.** A background push
  would need the passphrase, which is never stored. `src/sw.js` is untouched, and
  nothing auto-syncs on `putState` - nine call sites each rewrite the whole
  document, so auto-pushing would send ~300 KB when one tariff row is edited.
- **The page is lazily loaded.** It is the only importer of the Supabase client
  (~62 kB gzipped); a household that never turns the feature on should not pay
  for it on first paint. Keep the `lazy()`/`Suspense` boundary in
  `IngestWizard.jsx` if you touch that file.

Still rejected on unchanged grounds: two-way sync, Web Push (still needs a
server holding a VAPID private key), and proxying Open-Meteo through an Edge
Function (it is keyless, so there is nothing to hide).

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
the design canvas in `design/forecast/`; re-cut to a week strip in v2.14). It
leads with a one-line verdict naming the best day, then draws the whole week
once, then says everything about one day at a time:

- **The week is ONE strip of seven columns** (v2.14), on one shared scale.
  This replaced two full day rows + a "Rest of the week" sparkline toggle —
  three renderings of the same seven days, four to five lines of prose each,
  735px closed and 1172px open on a 915px phone. Do not reintroduce per-day
  rows: the strip is the "one fact, one rendering" rule applied to the panel
  that broke it worst. Every day is permanently visible, so a **rotating
  weekday off** no longer costs a tap to look up (and still needs no roster
  configuration — a shift-scheduling feature was considered and rejected).
- **ONE bar per day, and the fill means magnitude.** Two cuts tried to draw
  the 20th-80th range onto the column as well — first as stacked tones of the
  accent (read as a bar wearing a cap), then as an I-beam whisker (a second
  shape competing with the bar). The household rejected both, and for the same
  reason: seven columns should not need decoding. **The range is words on the
  selected day's card** ("likely 14-17"), not a mark on the chart. Don't put
  it back.
- **Colour is the sequential solar ramp**, scaled to the week's own best day —
  the same four buckets (`solarLevel` in `Screens/parts.jsx`) Energy's daily
  calendar uses for a month of history, so dim-to-bright means "bigger solar
  day" looking forward or back. Redundant with height on purpose: the two
  agree, so a tall bright column is unmistakably the good day.
- **Nothing repaints for being best or selected.** The best day is the week's
  maximum, so the ramp already lands it on the brightest step; a second
  meaning on the fill is exactly what made the earlier cuts unreadable.
  Selection rides on the ring and the label, best-ness on the dot. The weekend
  card's bars follow the same rule — they used to brighten for being the
  better of the two, which made two equal days look unequal.
- **The two surfaces share the buckets, NOT the stops.** A calendar cell
  carries its day number ON the fill, so its steps run dark enough to hold
  light ink; a strip bar carries no text and sits alone on the panel, so its
  steps are lifted (the calendar's bottom step is 1.1:1 against `--panel` —
  fine under a number, invisible as a 22px bar; the strip's floor is 3.05:1).
  Forcing one set of hexes was tried and made both worse. Both are one hue and
  both rise strictly in lightness, which is what a sequential ramp is judged
  on — not the adjacent-pair ΔE the palette validator applies to categorical
  sets.
- **A ramp legend names both ends** (`StripLegend`), matching the calendar's.
- **The foot is ONE line: when it was last checked** (v2.16). It used to also
  print how the factor was fitted ("Fitted from 272 of your own days...") and
  the saved area spelled out with its coordinates - four to five wrapped lines
  of answers to questions asked once, under a panel opened daily. The fitted-
  from sentence is the InfoPopover's opening line now (it was already the
  popover's first subject, so this made it one statement instead of two at two
  lengths); the location line is gone, and **Change area moved into the panel
  head beside Refresh**, with the area and coordinates stated inside the view
  it opens. What stays on screen is the timestamp, because this panel serves a
  cached forecast when a fetch fails and a stale one is otherwise
  indistinguishable from a fresh one. Don't put prose back under the strip.
- **The selected day's card is TWO ROWS, not three** (v2.17.1). It was a head
  row that pushed the kWh figure to the right and left **76px of nothing** in
  between, then a stats row, then a whole line of prose reading "The best day
  this week". Now: the day and date on the left of row one with the figure and
  its likely range STACKED into that empty width on the right, and one
  full-width stats row under it (sky, temperatures, radiation, spare). 91px ->
  63px, or 79px when a range is present. Do not narrow the stats row to sit
  beside the figure - that was tried first and it forces "spare" onto a line
  of its own, giving the whole saving back.
- **Best/quietest is a CHIP beside the date, never a sentence** (v2.17.1). The
  verdict at the top of the panel already names the best day in larger type,
  so a line saying it again three inches lower was the panel's own duplicate
  rendering. As a chip it costs no height and still confirms which day you
  landed on.
- **The day's radiation figure sits beside the date on the detail card**
  (v2.16; in the stats row since v2.17.1) - the forecast's own `radiationMj`,
  in MJ/m2, deliberately
  unconverted so it can be read straight across against another forecast
  quoting the same quantity. It is the INPUT to the kWh figure, not a second
  version of it, which is why it is not on the columns: the strip stays one
  number per bar.
- **The per-day prose lives in ONE card that follows the selection**, not on
  every row. It opens on today and carries the figure, the likely range, the
  sky in a word, the temperatures, the spare-for-the-car figure and the
  best/quietest note. Selection is held as a **date** and falls back to
  `days[0]` when that date leaves the window — which is what happens the first
  time the app is opened the next day.
- **There is NO separate weekend card** (removed v2.14.1, ending the v2.7
  decision). It survived the v2.14 cut on the grounds that the strip answers
  "which day of the week" while a card answers "which of the two" — but
  Saturday and Sunday are ADJACENT columns on that strip, on the same scale
  and the same ramp, so the card was drawing the same comparison a second time
  three inches lower. It was the last duplicate rendering left in the panel.
  Sat/Sun stay findable via a faint wash and full-strength labels in the
  strip, and tapping either gives that day in full. The combined weekend total
  is the one thing that went with it; if it is ever wanted back it belongs on
  the strip as one line, never as a card that redraws two days.
- **The sky glyph is cloud cover + rainfall** (v2.14) — four states
  (clear / some cloud / overcast / showers-or-rain) from `cloudPct` and
  `rainMm`, which the API already returned and the UI threw away. It is a
  DAILY MEAN, so it can disagree with a bright kWh figure; the InfoPopover
  says so. Every glyph carries a word in the detail card — never a picture
  alone.
- **Sunrise/sunset are NOT here** (v2.14). They were printed identically on
  both featured rows and said nothing a household acts on twice; Home's
  `SunCurve` shows them against the shape of the day, which is where they
  mean something. Don't add them back to this panel.
- **Colour is never the only encoding.** One hue throughout (the accent),
  because this is a magnitude. The best day carries a dot AND is named in the
  verdict; the selected day carries a ring AND is the card below.
- "Spare for the car" is the measured surplus on comparable past days, with
  `typicalHouseLoadPerDay()` subtraction as the fallback (see above) — energy
  only, a whole-day figure, and labelled with whichever basis produced it.

## The day's sun curve (since v2.12)

`data/forecast.js:dayShape()` + `Dashboard/SunCurve.jsx` (a panel on Home,
today with a one-tap toggle to tomorrow). Sunrise, sunset and daylight length
come from the same daily request and also appear on the Energy panel's two
full rows.

- **It produces no new number.** The total is the day's existing projection -
  fitted, bias-corrected, capped - and `dayShape()` only says how it is
  distributed. If the curve and the Energy row ever disagree about a day,
  something is wrong with one of them.
- **The shape is the forecast's own hourly radiation** (`hourly=
  shortwave_radiation`), not a bell drawn between sunrise and sunset. That
  distinction is the whole reason the panel is allowed to exist: a modelled
  arc would be a guess dressed up as a picture, and a cloudy morning has to
  be able to show as a dented morning. Do not "smooth" it with a spline
  either - a curve fitted through the hourly points overshoots between them
  and draws radiation nobody forecast.
- **The hourly figures are a division, not measurements, and the panel says
  so.** `dailySeries[]` is one row per day, so there is nothing to score an
  hourly claim against the way `forecastAccuracy.js` scores the daily one.
  Nothing hourly is logged, and the accuracy log stays a daily measurement.
- **Energy only, like the rest of the forecast.** Pricing an hour needs a
  time-of-day usage split for the whole household (see Plan Comparison's
  scope note); the curve is kWh and daylight, never dollars.
- **Every point is clamped into the drawn window** (v2.14). The hour marks sit
  at the MIDDLE of their hour, so the first and last of them fall half an hour
  outside `[start, end]`; unclamped — and the SVG was `overflow: visible` —
  the curve painted itself ~13px outside its own box at both ends, over the
  panel's padding and almost to the card's edge. The SVG is now
  `overflow: hidden` as well, so a future off-window point clips instead of
  escaping. If you widen the drawn window, widen the clamp with it.
- **Clock strings are never parsed into a `Date`.** `sunrise`/`sunset` arrive
  as local strings ("2026-09-02T06:23") because the request asks for
  `timezone=auto`, and they are formatted by splitting the string - the same
  discipline as the v2.8 local-dates fix.
- **No fit, no kWh** - the curve and the daylight window still draw, with a
  line saying a yield figure needs more history. Same degraded state as the
  rest of the panel.
- A cached forecast written before v2.12 carries no hourly block:
  `loadForecast` treats that as stale and refetches rather than leaving the
  curve missing for up to a TTL, and `dayShape()` returns `null` in the
  meantime so nothing is drawn from an assumption.

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
- **The app's catch-up counts as delivery.** `ForecastAlert` on Home re-runs
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

## Insights: the app explaining its own numbers (since v2.17)

`data/insights.js` (pure, like `notify.js`) + `Dashboard/MonthStory.jsx` on
Home. Two things: the month just gone in plain sentences, and a decomposition
of why its saving differs from a reference month.

**The one property that licenses the money breakdown to exist.** The combined
saving is EXACTLY the sum of five figures already stored on every digest:

```
combined = gridCostAvoided + exportCredit + counterfactual
           - evElectricityCost - evHomeChargingCost
```

So the change between two months is five subtractions. Nothing is
apportioned, weighted, estimated or modelled - which is the only reason a
"why did it move" feature belongs in an app that refuses guesses everywhere
else. `buildDigest.js` remains the only place a financial figure is PRODUCED;
this module reads stored ones and subtracts them, and stores nothing.

- **The sum is checked on every call, and the check is shown.** If the parts
  do not reconcile with the total to within a cent or two, the panel prints an
  explicit "not accounted for" row and points at Recompute Financials. The
  usual cause is a pre-v1.10 month with no `evHomeChargingCostAud` (an
  optional field). **Never widen `RECONCILE_TOLERANCE_AUD` until awkward
  months pass, and never spread the residual across the other rows** - a
  breakdown that swallows its own residual is a story, not an explanation.
- **The volume/price split uses the SYMMETRIC (Bennet) form**,
  `dq*(p0+p1)/2 + dp*(q0+q1)/2`, which sums to `d(q*p)` exactly with no cross
  term. The naive `dq*p0 + dp*q0` leaves a residual that has to be explained
  or hidden. Both rates are recovered exactly from stored fields: the import
  rate is `gridCostAvoided / (consumption - import)` (the supply charge is in
  both the baseline and the actual, so it cancels), the feed-in rate is
  `exportCredit / export`.
- **Only ONE split is shown**, and it prefers a row where both halves moved -
  that is the case the split exists to reveal (you exported more AND the rate
  was cut). A half worth under 10% of the row gets no clause of its own:
  "the rate went from 8.00 to 8.00" is a sentence about nothing.
- **Home charging deliberately has no split.** That figure blends two rates
  (import on the grid share, feed-in on the solar share), so there is no
  single price to recover and inventing one would be the exact guess this
  module avoids.
- **The month-in-progress panel renders only for THIS calendar month.** It
  used to render for whatever month the daily rows ended in, which for a
  household that ingests monthly is a FINISHED month for most of the year -
  producing "August 2026 so far - day 31 of 31" and then MonthStory telling
  the same August's story directly underneath, the same sentence twice. A
  month is in progress only if it is the current one; once it has ended,
  MonthStory owns it alone. The month is derived from a LOCAL date, never
  `toISOString()` (Perth is UTC+8 - same discipline as the v2.8 forecast fix).
  `MonthStory` also takes `excludeMonth` as a belt-and-braces guard, since a
  digest ingested on the last day of a month can be stored complete.
- **MonthStory reads the last COMPLETE month, not the latest digest.** A
  partial month is four days against thirty and every comparison it makes is
  dominated by that - the biggest mover comes out as "the length of the
  month", which is true, useless, and buries everything worth knowing. Same
  line `daily.js:typicalForMonth()` already takes, and the month in progress
  is what the panel ABOVE it is for.
- **Rows that round to zero are dropped**, not folded; below-threshold rows
  are folded into "Everything else" only when there are two or more of them.
- **The sentences are ENERGY, the rows are MONEY.** Saying the same thing in
  both is the duplicate-rendering trap. When this shipped, the
  month-in-progress panel's footnote ("$414 saved this month - your own power
  covered 72%") was REMOVED: MonthStory says both properly, with something to
  compare against, so it is said once instead of twice at two lengths.
- The narrative returns **segments** (`{text, em}`), not strings or markup, so
  a pure module can emphasise figures without importing React.

## Spare solar in the car's own units (since v2.19)

`data/vehicle.js` (pure, like `notify.js` and `insights.js`) +
`components/Ingest/VehicleSettingsEditor.jsx`, storing `config.vehicle`
(`{ batteryKwh, consumptionKwhPer100km }`). The forecast reports spare energy
in kWh; the car reports a percentage and a range in kilometres. This says the
same figure in all three, so the household is not doing the division in their
head.

- **It produces no new figure.** It divides an already-computed spare-kWh
  number by two constants the household typed in. Nothing is fitted, nothing
  is stored, no financial or energy figure moves. That is the only reason it
  belongs in an app that refuses guesses - and it is why it needed no
  `schemaVersion` bump: `config.vehicle` is optional and unvalidated, so every
  pre-v2.19 backup restores unchanged.
- **Generic on purpose - no make, no model, no preset list, no default.** A
  shipped battery size would be a number the app made up, rendered in the same
  type as one it measured, and it would be wrong the moment the household
  changes car. Both fields start blank and stay blank until someone types
  theirs in.
- **The two fields are independent.** Battery size alone gives a percentage
  and no distance; consumption alone gives a distance and no percentage;
  neither gives exactly the pre-v2.19 display. Don't couple them, and don't
  make one imply the other.
- **Charging losses are deliberately NOT modelled.** Spare kWh is measured at
  the meter and some of it becomes heat rather than charge. An assumed
  efficiency would be the guess this module otherwise avoids, so the figures
  are stated in every InfoPopover as a **ceiling**. If a real per-session
  measurement ever exists (it would need charger-side and pack-side energy for
  the same session), that is when a loss factor may be applied - not before.
- **The percentage is clamped at 100.** More spare energy than the battery
  holds still only fills the battery, and "140% of the battery" reads as an
  arithmetic slip rather than as good news.
- **One module, four render sites, three registers.** `vehicleParts()` for the
  forecast card's stats row, `vehicleClause()` for Car's sentence,
  `vehicleShort()` for Home's one-line verdict and the notification bodies.
  They differ in length, never in value - the conversion happens once so the
  four can't disagree.
- **The conversions ride INSIDE the spare stat, never beside it as stats of
  their own** (`.fc-detail-sub`). They are one fact in another language, not
  two more facts, and nesting them also stops flex-wrap splitting "85 km" onto
  a line away from the figure it belongs to. On a 412px phone the detail card
  goes 63px -> 84px with both fields set, and stays at 63px with one.
- **Home's verdict stays one line** by taking only the shortest form in
  brackets; the full "30% of the battery, or 100 km" clause is Car's. Measured
  at 412px, the verdict's rendered height is unchanged.
- `notify.js` gets the figures from `forecast.config`, which the two callers
  (`sw.js` and `ForecastAlert.jsx`) pass from the state they already read - the
  service worker needs no new data source, and `notify.js` stays pure.

## Per-device UI preferences (since v2.18)

`db.js`'s `uiPrefs` key, read through `components/useUiPref.js`. One more
record OUTSIDE `state`, for the same reason as `weatherCache` / `forecastLog` /
`notifyState`: `state` travels inside every backup file, so a preference kept
there would follow a restore onto a new phone and answer a question that phone
was never asked. It is deleted by `resetState()` and never validated.

- **It holds choices, never data.** Nothing here may affect a figure, and
  nothing that a household would be sorry to lose belongs in it. Today it holds
  one key: `forecastDeclined`.
- **The hook returns `ready`.** The read is asynchronous, so a component that
  renders one thing when a pref is set and another when it is not must wait
  rather than render the wrong one and swap it under the reader.
- `putUiPrefs()` MERGES. Each caller owns one key and must not clear another's.

**What `forecastDeclined` is for.** With no location set, Energy showed a
full-height opt-in card and Car showed a second panel pointing at it - two
advertisements for one feature, on every open, for a household that had already
decided. "Not now" collapses Energy's to a single line carrying the way back and
removes Car's entirely. It is a decline, not a dismissal: the line is permanent
and the choice reverses in one tap, so nothing is hidden.

## The app icon is maskable (since v2.19.1)

`design/icon/icon.svg` is the master; `design/icon/render-png.mjs` draws it
into `public/icons/icon-{512,192}.png`, natively at each size rather than
downscaling one raster. Never hand-edit the PNGs — re-render them.

`vite.config.js` declares both sizes `purpose: 'any maskable'`, which entitles
Android to crop the icon to a **circle covering the inner 80%** — radius 204.8
on the 512 canvas. The icon this replaced ran sixteen rays to the edge of the
square, so an installed copy lost every ray tip and showed a yellow disc. That
failure is invisible everywhere except an installed phone: the file looks
fine, the build says nothing, and the dev server shows the uncropped square.
So the rule is arithmetic, not judgement — **measure every mark's distance
from (256, 256) and keep it under 204.8**, round stroke caps included. The
current furthest are the top ray tip (193) and the outer bar corners (184);
`icon.svg` carries the same note beside the artwork. To look at the crop,
render the PNG and view it in a container with `border-radius: 50%` — that
is the mask, and it is the only cheap way to see what an install does.

Only the shipped drawing lives here. The three directions that were not
taken were working files, deleted once the choice was made; the record of
them is the design canvas, which is not part of the repository.

## Null convention

Absent numeric/text values are always `null`, never `0` or `""` — this is
how the app tells "no data yet / pending" apart from "confirmed zero" (e.g.
a month where Synergy hasn't billed yet vs. a month with genuinely zero
grid import). Preserve this in any new field or computation.

## Versioning

`src/version.js` exports `APP_VERSION`, shown in the header's "What's new"
panel (and on the first-run screen; it is not in the header bar itself). **Bump it on every user-facing change** — UI, ingest behavior, or
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
- **Home is ordered by RATE OF CHANGE, not by importance** (since v2.15).
  Four blocks: anything wrong or owed, what is happening now (the week's
  verdict + today's sun curve), this month so far, then what it has all added
  up to. Everything above the fold differs between one open and the next;
  everything below it steps once a month at ingest. It used to be the other
  way round — it opened on "$12,480 saved so far", a figure that had not moved
  since the last upload, so a household opening the app on a Tuesday was shown
  last month's news. (The screen was called Today until v2.10 and renamed for
  exactly this mismatch; renaming it was treating the label rather than the
  content.) Don't promote an all-time figure back to the top to make the
  screen feel weightier.
- **The total, the payback ring and the milestones are ONE panel** (since
  v2.15). They were three, and two of them said the same thing: the ring read
  "$8,400 to go, on track for 2031" and the Milestones panel then read
  "Battery — $8,400 to go, about 2031". That is the app's own "one fact, one
  rendering" rule broken on its own landing screen. The milestone list now
  carries only what the ring cannot — which components are already paid off —
  and falls back to naming the one being paid off first when none are, so the
  section is never empty and never a second copy of the ring.
- **`WeekVerdict` is one line and must stay one line.** The full seven-day
  picture is Energy's strip and the charging decision is Car's
  `BestChargeDay`; Home's version says only which day is the good one, so a
  household that opens Home and closes it again has still been told the useful
  thing. If it grows a second sentence, a chart or an InfoPopover it has
  become a third copy of the same panel and should be deleted instead. It
  shares the cached fetch through `useForecast`, so it costs no extra request.
- **Home shows nothing it cannot derive.** Each block renders only when its
  inputs exist. Never fill a gap with an estimate to keep the layout even —
  the one sanctioned estimate in the app is `paybackPreTracking`, and it is
  labelled as one.
- **The two chores are quietly styled but sit HIGH** (since v2.15).
  `ingestStaleness()` (a month has not been uploaded) and `backupStaleness()`
  (what is here has no copy off the phone) both render as `.chore` rows above
  the content, not in the footer, because "your data stops two months ago"
  changes how every figure below it should be read. `ingestStaleness()` is a
  SIBLING of the other two staleness helpers, deliberately not a merge of
  them: three different failures with three different fixes (upload the files,
  export a file, push to the cloud). It fires at two or more calendar months
  behind, because a month can only be uploaded once it has ended — being one
  month behind is simply the month in progress, and nagging about that would
  train the household to ignore the row.
- **The upload slots report what was picked** (since v2.18). The native
  `<input type="file">` renders as a white system button that ignores the theme
  and truncates a chosen filename from the LEFT, so three slots read identically
  whether they held a file or not. The input is still the real control, moved
  out of sight behind a row that names the file, its size, and the month read
  out of its name. **The month leads that line**, because the filename is what
  gets ellipsised and these exports are named
  `Energy_balance_total_Monthly_report_2026_06.xlsx` - the month is the last
  thing on the name and the first thing an ellipsis eats.
- **Two energy files from two different months are caught before the build**
  (since v2.18). `monthFromFilename()` keeps what each file names, not just the
  first one's, and a disagreement is stated above the Build preview button.
  It WARNS rather than blocks: the filename can be the wrong one, the preview
  still shows the month before anything is written, and the household can be
  right. What it must not do is stay silent - a digest built from June's Fronius
  and May's Wattpilot has every figure wrong and no preview row looks odd.
- **A `.banner.compact` must not cap its own height.** The `max-height` +
  `overflow: hidden` that makes the status strip collapse smoothly rode on every
  compact banner until v2.18, and the storage warning runs to five lines on a
  412px phone: it lost its first and last line, and its buttons sat over the
  text. The cap now travels with the animation (`.collapsible`), on the one
  banner short enough for it to be safe. A banner whose text wraps puts its
  buttons in `.banner-actions` on their own row - inline, they wrap into the
  middle of a sentence and read as part of it.
- **Swiping sideways moves between the five screens** (since v2.16), in the
  nav's own order. It is a shortcut on top of the nav, never a replacement:
  it does **not wrap** (an over-swipe on Data that teleports to Home reads as
  a bug), it requires a genuinely horizontal gesture (>=60px sideways and
  >1.5x the vertical travel, within 800ms) so an angled scroll never changes
  screen under the thumb, it ignores multi-touch (that is the browser's
  pinch/zoom), and a gesture starting inside a `.table-scroll` belongs to that
  element - the 12-month table is read by swiping it. The in-progress gesture
  is held in a ref, not state: a swipe must not re-render the screen it is
  being made on.
- **Screen scoping: three periods, one control** (since v2.2). Energy, Car
  and Money each carry the same `RangeChips` row at the top of the screen —
  *This month* / *Range* / *All time*, one **segmented control** since v2.14
  (three separate 44px blocks with gaps spent ~60px of a 915px phone on
  mutually exclusive options that read as one control; it is 38px now, and
  each segment is still ~127px wide so the target stays comfortable) — with
  the From/To
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
