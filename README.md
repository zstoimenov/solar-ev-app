# Solar, Battery & EV ROI PWA

A **local-only** Progressive Web App that consolidates a Perth household's solar,
battery, and EV return-on-investment data and renders dashboards. It replaces
Notion as the data store — all data lives on-device in **IndexedDB**. Backup is
by exporting JSON and pasting it into Notion.

**Live app:** https://zstoimenov.github.io/solar-ev-app/

## Hard constraints

- No backend, no server, no auth, no secrets. The deployed bundle is public and
  contains zero personal data beyond the shipped seed file.
- No live data sources or network calls for data. The only fetch is the local
  `seed-data_v1.json` on first run.
- IndexedDB only for persistence — no localStorage/sessionStorage for app data.
- Everything conforms to `schemaVersion: 1` (see [`app-schema_v1.md`](./app-schema_v1.md)).

## Stack

Vite + React (JS) · Chart.js (react-chartjs-2) · IndexedDB via `idb` ·
SheetJS (`xlsx`) + PapaParse for ingest · `vite-plugin-pwa` for the installable
offline app shell.

## Local development

```bash
npm install
npm run dev      # http://localhost:5173/solar-ev-app/
npm run build    # outputs dist/
npm run preview  # serve the production build locally
```

## What the app does

- **First run** seeds from `public/seed-data_v1.json`, validates, and persists.
- **Dashboards:** ROI Layers (1 solar+battery, 2 EV vs Cerato, 3 fixed lease tax),
  Payback Progress, Energy Trends, EV Charging Split, and a Data Notes panel.
- **Monthly ingest:** upload Fronius + Wattpilot XLSX + Synergy CSV, enter
  away-charging, preview the computed month + updated totals, then confirm to
  write (propose-before-write).
- **Guards:** health banner, anti-truncation export guard, restore prompt,
  duplicate-month guard.
- **Backup:** one-click JSON export (download + clipboard) and paste/file restore
  with schema validation.

Layer 2's dashboard headline is the **accrued cumulative** saving; the annual
scope figure is shown only as a labelled sub-metric. Layer 3 is a fixed annual
constant and is never recomputed from uploads.

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` builds on every push to `main` and publishes
`dist/` to GitHub Pages. **One-time setup:** in the repo, go to
**Settings → Pages → Build and deployment → Source** and select **GitHub Actions**.

Vite `base` is `/solar-ev-app/` (the repo name) so asset paths and the PWA
`start_url`/`scope` resolve correctly on Pages.
