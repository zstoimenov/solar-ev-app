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
              (resolve a dated rate schedule for a month + sum the charging log)
  ingest/     parseFronius.js, parseWattpilot.js, parseSynergy.js (client-side
              XLSX/CSV parsing), buildDigest.js (merges parsed + manual input
              into one monthlyDigests entry + computes the financial layers)
  components/ HealthBanner, DataNotes, Collapsible, Modal, ExportRestore,
              IngestWizard (+ Ingest/{TariffScheduleEditor,ChargingLogEditor} -
              nested sub-tabs, not top-level tabs), Dashboard/{RoiLayers,
              PaybackProgress,EnergyTrends,EvChargingSplit}
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
`app-schema_v1.md`) are **forward-only**: `buildDigest.js` resolves them at
ingest time for the month being built, but adding/editing an entry never
recomputes already-stored historical digests — only new/re-ingested months
see the change. This was an explicit product decision (not a shortcut), so
don't "fix" it into a retroactive recompute without checking first. The
export (feed-in) schedule is stored but **not** applied to `exportCreditAud`
yet — Fronius only reports a monthly export total, not an hourly split, so
blending two time-of-day rates would need an assumed peak-share % that
doesn't exist yet. If that assumption gets added later, wire it in
`buildDigest.js` next to the `debsPeak` calculation.

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
  one row (e.g. Payback Progress' 5 numeric columns), wrap it in
  `.table-scroll` (already `overflow-x: auto`) and add the `payback-table`
  class (or a similarly-scoped one) to opt out of fixed layout — see
  `app.css` for why plain `nowrap` + `table-layout: fixed` causes visual
  overlap instead of a scrollbar.
- Test any layout change against a **412px-wide viewport** (OnePlus 12 /
  typical Android flagship) — the project's acceptance bar for "no
  horizontal scroll" is that width, not just desktop.
- The Data Notes panel is intentionally a dismissible `<Modal>`, not a
  permanent dashboard panel — it's caveats/context, not something that needs
  to be visible at a glance.

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
