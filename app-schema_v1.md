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
- **`lease`** - provider, term, rate, residual, FBT status, `fortnightlyPreTaxAud` breakdown, net salary impact, `annualAud` figures. `vehicleReturnOption: false` (residual must be paid to own).
- **`counterfactual`** - petrol baseline vehicle. Holds **both** service costs (`serviceToJun2026`, `serviceFromJul2026`) for the Jul-2026 step-change. `layer2ScopeTotalAudPerYr` = fuel + service scope used in the model.
- **`baselines`** - confirmed pre/post solar + battery consumption/import/export. Do not re-derive without new data.
- **`tariffSchedule`** *(optional; absent = no history yet, static `tariffs.*` values apply)* -
  `{ import: [], export: [] }`, dated rate-change entries edited via the Ingest
  tab's Import Tariff / Feed-in Tariff sub-tabs (see `src/data/tariffSchedule.js`).
  - `import[]`: `{ effectiveFrom (YYYY-MM-DD), priceCentsPerKwh }` - what Synergy
    charges per kWh imported. Step function over time: an entry's price applies
    from its date until the next entry's date.
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

**Financial (AUD numbers)**
`actualGridCostAud` · `baselineGridCostAud` · `gridCostAvoidedAud` · `exportCreditAud` ·
`ceratoCounterfactualAud` · `layer1SavingAud` · `layer2SavingAud` · `combinedSavingAud`

**Validation / text**
`crossValImport` (Pass/Fail str) · `crossValExport` (str) · `flags` (str|null) · `notes` (str|null)

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
| `payback[]` | per-component OOP / recovered / remaining / est. payback year. |
| `paybackTotals` | rolled-up OOP / recovered / remaining + allocation order. |
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
