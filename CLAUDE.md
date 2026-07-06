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
              persistence layer), seed.js (first-run loader), compute.js
              (recompute cumulativeTotals from the digest array), tariffSchedule.js
              (resolve a dated rate schedule for a month + sum the charging log),
              evTimeOfUseSplit.js (bucket EV charging sessions into time-of-day
              bands for Dashboard/PlanComparison.jsx)
  ingest/     parseFronius.js, parseWattpilot.js, parseSynergy.js (client-side
              XLSX/CSV parsing), parseWattpilotSessions.js (the Wattpilot MOBILE
              APP's charging-session JSON - different file, different granularity,
              see "EV time-of-day data" below), buildDigest.js (merges parsed +
              manual input into one monthlyDigests entry + computes the financial
              layers)
  components/ HealthBanner, DataNotes, Collapsible, Modal, ExportRestore,
              IngestWizard (+ Ingest/{TariffScheduleEditor,ChargingLogEditor,
              TariffPlanEditor,EvSessionsUploader} - a 2-level nav of nested
              sub-tabs, not top-level tabs: see "Ingest tab navigation" below),
              Dashboard/{RoiLayers,PaybackProgress,EnergyTrends,EvChargingSplit,
              PlanComparison}
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
export (feed-in) schedule is stored but **not** applied to `exportCreditAud`
yet — Fronius only reports a monthly export total, not an hourly split, so
blending two time-of-day rates would need an assumed peak-share % that
doesn't exist yet. If that assumption gets added later, wire it in
`buildDigest.js` next to the `debsPeak` calculation. `tariffSchedule.import[]`
entries also carry `supplyChargeCPerDay` now — applied equally to
`actualGridCostAud`/`baselineGridCostAud`, so it does NOT move
`layer1SavingAud` (same connection fee with or without solar), only the two
absolute cost figures.

## Tariff plan comparison — EV charging only, not the whole bill

`config.tariffPlans[]` is a catalog of rate-card **options** (Synergy's
A1/Midday Saver/EV Add On, etc.), entered via Ingest → Tariffs & Rates →
Tariff Plans, feeding the Dashboard's **Plan Comparison** tile
(`components/Dashboard/PlanComparison.jsx`). Read that file's header comment
before touching it — the scope limitation is load-bearing, not a footnote:

- As of 2026-07, **no data source in this app has a time-of-day split of
  general household usage.** Fronius "Energy balance total" and Wattpilot
  "Energy balance" are both one row per **day** (confirmed against a real
  2026-06 Wattpilot file — its `Date and time` column, despite the name, only
  contains a date). The user's Synergy `MA_IntervalDataHistory.csv` was also
  confirmed by the user not to carry usable time-of-day info despite the
  filename. **Do not build a whole-household A1-vs-plan-X comparison** until
  one of these actually has hour-level data, or the user explicitly opts into
  manual monthly time-band entry — simulating a bill without real time-split
  usage would just be a guess dressed up as a number.
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

## UI conventions

- Dashboard panels are wrapped in `<Collapsible>` (`src/components/
  Collapsible.jsx`) and collapsed by default — the Dashboard tab should read
  as a scannable list of headings, not a wall of charts. New dashboard
  panels should follow the same pattern: the panel component itself renders
  only its *content* (no outer `.panel`/`<h2>` — `Collapsible` supplies
  both), and `App.jsx` wraps it with a title.
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
- The Data Notes panel is intentionally a dismissible `<Modal>`, not a
  permanent dashboard panel — it's caveats/context, not something that needs
  to be visible at a glance.
- **Long explanatory text is a summary sentence + `<InfoPopover>`, not a
  paragraph.** (`src/components/InfoPopover.jsx`.) Every Ingest sub-page and
  several Dashboard tiles follow this: one short always-visible sentence
  saying *what* the page/field is, with the *why/how/caveats* tucked behind
  the "i" icon. When adding a new field or page, resist writing a 3-sentence
  blurb up front — write one sentence, and put the rest behind an
  `InfoPopover` from the start.
- **Ingest tab navigation is two levels**, not one flat row of pills
  (`IngestWizard.jsx`'s `CATEGORIES` array): a few broad categories (Monthly
  Upload / Tariffs & Rates / EV Charging Data), each either a single page
  (no `subsections`) or a second pill row + a one-line category `intro`. If
  you add a new Ingest page, put it under an existing category's
  `subsections` (or add a new category) rather than growing a flat list back
  out — the whole point of the 2-level nav was that a flat list of 6+ pills
  reads as overwhelming.

## Testing changes

There's no automated test suite. Verify by hand:
1. `npm run build` must succeed.
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
