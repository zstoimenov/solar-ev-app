# App Data Schema - Solar, Battery & EV ROI PWA
# Version: v1 | Generated: 2026-07-05

This document is the **contract** between the PWA and its data. Any import, export,
or monthly ingest MUST conform to `schemaVersion: 1`. The companion file
`seed-data_v1.json` is a valid instance of this schema and serves as the app's
starting data before the first live monthly upload.

---

## Design Principles

- **Local-only.** All data lives on-device (IndexedDB). No backend, no server copy.
- **Backup via export.** The full store exports as one JSON blob, pasted to Notion as a dated backup.
- **Anti-truncation guard.** `meta.monthCount` and `meta.dateRange` let the app warn before an export that is shorter than the last known state.
- **Currency is plain AUD.** Notion exported currency as `US$` (a display artifact). All monetary fields here are numbers in AUD - no symbols, no prefixes.
- **Digests carry the full property set** so historical months render as richly as future ingested months.

---

## Top-Level Structure

| Key | Type | Purpose |
| --- | --- | --- |
| `schemaVersion` | integer | Contract version. Currently `1`. Import must check this. |
| `meta` | object | Export metadata + health-banner / guard inputs. |
| `config` | object | Static reference data (hardware, tariffs, EV, lease, counterfactual, baselines). |
| `monthlyDigests` | array | One object per month, chronological. 33 fields each. |
| `cumulativeTotals` | object | All-time aggregates, payback progress, cross-validation flags. |
| `chargingLog` | array | *Optional* (absent in pre-v1.5 backups; treat as `[]`). Paid public-charging sessions - see below. |

---

## `meta`

| Field | Type | Notes |
| --- | --- | --- |
| `exportedAt` | ISO 8601 string | UTC timestamp of export. |
| `appVersion` | string | App build that produced the file. |
| `monthCount` | integer | Count of `monthlyDigests`. Drives on-load health banner + export guard. |
| `dateRange` | object | `{ first, last }` as `YYYY-MM`. |
| `sourceNote` | string | Provenance. |

---

## `config`

Static. Edited only when tariffs change, lease events occur, or hardware is modified.
Six blocks:

- **`hardware`** - array kW, inverter, install dates (`YYYY-MM-DD`), OOP costs (AUD), total OOP.
- **`tariffs`** - usage rate (c/kWh), supply charge, escalation %, DEBS peak/off-peak FiT, blended FiT (post/pre battery), rate at install. Includes `blendedFiTConfirmed: false` - the blended FiT is still **estimated** (open item #4), so the app should surface it as provisional.
- **`ev`** - model, dates, prices, consumption, distance, `chargingMix` (home/work/trip with rate, seasonal %, annual kWh + cost), annual electricity cost.
- **`lease`** - provider, term, rate, residual, FBT status, `fortnightlyPreTaxAud` breakdown, net salary impact, `annualAud` figures. `vehicleReturnOption: false` (residual must be paid to own). Optional `taxSavingAudPerYr` - the fixed Layer 3 annual figure shown on the Dashboard; when absent the app falls back to its built-in constant ($5,378/yr, `data/compute.js:layer3AnnualAud`).
- **`counterfactual`** - petrol baseline vehicle. Holds **both** service costs (`serviceToJun2026`, `serviceFromJul2026`) for the Jul-2026 step-change. `layer2ScopeTotalAudPerYr` = fuel + service scope used in the model.
- **`baselines`** - confirmed pre/post solar + battery consumption/import/export. Do not re-derive without new data.
- **`tariffSchedule`** *(optional; absent = no history yet, static `tariffs.*` values apply)* -
  `{ import: [], export: [] }`, dated rate-change entries edited via the Ingest
  tab's Import Tariff / Feed-in Tariff sub-tabs (see `src/data/tariffSchedule.js`).
  - `import[]`: `{ effectiveFrom (YYYY-MM-DD), priceCentsPerKwh, supplyChargeCPerDay }` -
    what Synergy charges per kWh imported, plus the daily supply (connection) charge.
    Step function over time: an entry's values apply from its date until the next
    entry's date. `supplyChargeCPerDay` is added equally to `actualGridCostAud` and
    `baselineGridCostAud` in `buildDigest.js`, so it does **not** change
    `gridCostAvoidedAud`/`layer1SavingAud` (you'd pay the connection fee regardless of
    solar) - it only makes the two absolute cost figures match a real bill.
  - `export[]`: `{ effectiveFrom (YYYY-MM-DD), peakFrom (HH:MM), peakTo (HH:MM),
    peakPriceCentsPerKwh, offPeakPriceCentsPerKwh }` - the feed-in (export)
    credit, split into two time-of-day bands (e.g. DEBS peak/off-peak).
    **Stored for reference only** - `buildDigest.js` does not yet apply this to
    `exportCreditAud`, because Fronius only reports a monthly export total (no
    hour-by-hour split), so there's no reliable way to blend two time-banded
    rates into one number without assuming a peak-share percentage. The
    existing single blended `tariffs.debsPeakCPerKwh` keeps being used.
  - Resolution is **forward-only**: adding/editing entries never recomputes
    already-ingested historical months, only months ingested from then on.
- **`tariffPlans`** *(optional; absent = `[]`)* - a catalog of rate-card **options**
  (e.g. Synergy's A1, EV Add On) to compare against `tariffSchedule.import` (what
  you're actually billed on), edited via Ingest -> Tariffs & Rates -> Tariff Plans.
  Pre-populated in `public/seed-data_v1.json` with Synergy's published A1/EV Add On
  rates (`data/defaultTariffPlans.js`, also loadable on demand via that page's "Load
  Synergy's published rates" button) - this is public rate-card info, not
  household-specific, so it's fine to ship. One row per rate band: `{ planName,
  financialYear, supplyChargeCPerDay, bandLabel, from (HH:MM|null), to (HH:MM|null),
  priceCentsPerKwh }`. `financialYear` is the Australian FY the price took effect
  (`"FY2025-26"` etc, via `data/tariffSchedule.js:financialYearLabel`) - **not** a
  calendar year, since Synergy (like most WA retailers) reprices on 1 July. (Entries
  saved before this fix used a bare `year` number; `financialYearOf()` reads those as
  the FY start year for backward compatibility - don't remove that fallback without
  migrating existing data first.) A flat plan (A1) is one row with `from`/`to` null
  (all day); a time-of-day plan is several rows sharing the same
  `planName`+`financialYear`+`supplyChargeCPerDay`. Used by the Dashboard's Plan
  Comparison tile (`data/evTimeOfUseSplit.js`) - **EV charging only**, not a
  whole-household bill comparison (see `evChargingSessions` below for why).

---

## `chargingLog[]`

One entry per **paid** public/road-trip charging session (free workplace
charging stays a manual per-month field in Monthly Ingest - it has no cost to
track). Edited via the Ingest tab's Public Charging Log sub-tab.

`{ date (YYYY-MM-DD), energyKwh (number), totalCostAud (number), notes (str|null) }`

`buildDigest.js` sums the entries whose `date` falls in the target month
(`data/tariffSchedule.js:sumChargingLogForMonth`) to derive that month's
`evPublicTripKwh` and `evElectricityCostAud` (which feeds Layer 2). This
replaces the old single manual "paid public kWh" ingest field. Forward-only,
same as the tariff schedules above - historical digests are untouched.

---

## `evChargingSessions[]`

*(optional; absent = `[]`)* One entry per EV charging **session**, sourced from the
Wattpilot **mobile app's** charging-session JSON export (distinct from the "Energy
balance" monthly XLSX used elsewhere) - edited via Ingest -> EV Charging Data -> EV
Sessions. Unlike every other energy source in this app, this one carries real
wall-clock **timestamps**, not just a daily/monthly total.

`{ sessionId (str), start (str, "dd.MM.yyyy HH:mm:ss"), end (same format), energyKwh (number) }`

- `sessionId` is the Wattpilot `session_identifier` (or a `session_N` fallback) - used
  to de-duplicate on re-upload, so re-exporting a longer history is always safe.
- `start`/`end` are kept in their original Wattpilot string format (not converted to a
  real Date/ISO timestamp) - see `ingest/parseWattpilotSessions.js`'s
  `parseWattpilotDateTime`, which turns them into a monotonic ms value via `Date.UTC`
  purely as a wall-clock arithmetic trick (the strings are already local time; this is
  never converted back to a real UTC instant, so it's safe regardless of the browser's
  timezone).
- `data/evTimeOfUseSplit.js:splitSessionsByBand` allocates a session's `energyKwh`
  across time-of-day bands proportional to how much of its `[start,end)` duration
  overlaps each band (handles overnight-wrapping bands and multi-day sessions).
  **This is an approximation** - it assumes a constant charge rate across the session,
  since the export doesn't include a sub-session power curve.
- Feeds the Dashboard's Plan Comparison tile, which is **EV-charging-only**: it does
  NOT cover the rest of household usage (fridge, lights, aircon, ...), which still has
  no time-of-day source. It's also a **gross** figure - it assumes every kWh shown was
  billed at grid rates; the actual PV/battery/grid split for a given session isn't
  known (only as a daily total, from the Energy Balance XLSX, with no per-session
  attribution). Treat it as "the most EV charging could have cost under each plan," not
  a real bill.

---

## `monthlyDigests[]`

Chronological. Each object has these 33 fields (types normalized from the Notion CSV):

**Identity / period**
`month` (YYYY-MM) · `financialYear` (str) · `daysInPeriod` (int) · `partialMonth` (bool)

**Energy**
`solarProductionKwh` · `totalConsumptionKwh` · `ownConsumptionKwh` · `gridExportKwh` ·
`gridImportFroniusKwh` · `gridImportSynergyKwh` · `selfSufficiencyPct` ·
`selfConsumptionRatePct` · `zeroProductionDays` (auto-derived from the Fronius
daily production rows - count of days with ~0 kWh production)

**EV charging**
`evTotalChargedKwh` · `evFromPvKwh` · `evFromBatteryKwh` · `evFromHomeGridKwh` ·
`evWorkChargingKwh` · `evPublicTripKwh` · `evGridChargingDays` · `evElectricityCostAud`

> Optional extra (NOT one of the 33 required fields, so pre-v1.10 backups still
> validate): `evHomeChargingCostAud` - what the EV's home charging cost that month
> (grid-sourced share × import rate + PV/battery share × blended FiT, the export
> credit that energy displaced). Subtracted in `layer2SavingAud` alongside
> `evElectricityCostAud` from v1.10 on; older stored digests keep their original
> Layer 2 math until the user runs the opt-in "Recompute financials" action.

**Financial (AUD numbers)**
`actualGridCostAud` · `baselineGridCostAud` · `gridCostAvoidedAud` · `exportCreditAud` ·
`ceratoCounterfactualAud` · `layer1SavingAud` · `layer2SavingAud` · `combinedSavingAud`

**Validation / text**
`crossValImport` (Pass/Fail/Pending str) · `crossValExport` (str - `"n/a"` from v1.10 on:
there is no export cross-check source, Synergy's file only covers billed import;
older digests may carry `"Pass"`/`"Pending"` from when this was hardcoded) ·
`flags` (str|null) · `notes` (str|null)

> Null convention: any absent numeric or text value is `null`, never `0` or `""`,
> so "pending" (e.g. Synergy import for Apr/May) is distinguishable from a real zero.

---

## `cumulativeTotals`

| Block | Contents |
| --- | --- |
| `coverage` | first/last month, total months, partial-month note. |
| `energy` | all-time solar/consumption/export/import totals. |
| `quality` | avg self-sufficiency %, avg self-consumption %, zero-production days, `batteryShortfallDays: null` (retired metric). |
| `ev` | all-time charged kWh + source split, away-charging cost, total EV cost, grid-charging days. |
| `financial` | Layer 1, Layer 2, combined. Layer 3 is time-based (note only). |
| `payback[]` | per-component OOP / recovered / remaining / est. payback year. From v1.10, recovered/remaining/est-year are **derived**: cumulative Layer 1 is allocated across components in array order (solar → charger → battery), clamped at each `oopAud`; only `component`/`oopAud` (and the array order) are authored data. |
| `paybackTotals` | rolled-up OOP / recovered / remaining + allocation order (rolled up from `payback[]` from v1.10). |
| `crossValFlags[]` | months breaching the dual threshold (>5% AND >2 kWh). Empty to date. |

---

## Known Data Notes (surface in UI, do not treat as errors)

1. **Blended FiT is estimated** (`blendedFiTConfirmed: false`) - validate at next Synergy bill.
2. **Layer 2 figures differ by scope**, not error: config annual scope, ROI headline, and cumulative accrued are three different contexts. Label each clearly.
3. **Servicing step-change** Jul 2026 (service rate rises) - both values held in `config.counterfactual`; model switch is a future-ingest concern.
4. **Synergy import pending** for Apr + May 2026 (`gridImportSynergyKwh` present but flagged pending in notes).

---

## Migration Rule

Future schema versions bump `schemaVersion`. The importer must read the incoming
version and migrate forward (never assume the current shape). An import whose
`schemaVersion` is newer than the app supports must be rejected with a clear message,
not silently partially-loaded.
