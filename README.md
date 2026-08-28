# Solar, Battery & EV ROI PWA

A **local-first** Progressive Web App that consolidates a Perth household's solar,
battery, and EV return-on-investment data and renders dashboards. It replaces
Notion as the data store — all data lives on-device in **IndexedDB**. Backup is
by exporting JSON, or by pushing an encrypted copy to the optional cloud
backup slot (see below).

**Live app:** https://zstoimenov.github.io/solar-ev-app/

## Hard constraints

- The deployed bundle is public and contains zero personal data beyond the
  shipped seed file, and carries no secret. The Supabase publishable key it does
  carry grants nothing on its own — every row is gated by row-level security on
  the signed-in user (see **Cloud backup** below).
- No live data sources. Ingest is entirely client-side file parsing; the only
  fetches are the local `seed-data_v1.json` on first run and, when you press the
  button, the optional encrypted backup upload/download.
- Nothing leaves the device unencrypted, and nothing leaves it automatically —
  there is no autosave, no background sync and no telemetry.
- IndexedDB only for persistence — no localStorage/sessionStorage, including for
  the cloud sign-in session.
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
- **Dashboards:** ROI Layers (1 solar+battery, 2 EV vs Cerato, 3 lease vs loan),
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

## Cloud backup (optional)

The Backup tab can push an **encrypted** snapshot to Supabase and pull it back
on a new device. Persistent storage stops the browser evicting your data, but it
does not survive clearing site data, uninstalling, or changing phone — this
covers that gap.

- The snapshot is encrypted in the browser with your passphrase (AES-GCM via
  `src/data/crypto.js`) *before* upload. The server stores a blob it cannot
  read; the passphrase never leaves the device and cannot be reset.
- Alongside it the row stores only a month count, month range and app version,
  so the restore list can be shown before anything is decrypted.
- Sign-in is a Supabase emailed magic link. The most recent 10 snapshots are
  kept; older ones are pruned after each upload.
- Schema and policies: [`supabase/migrations/`](./supabase/migrations).

**One-time Supabase setup** (already done for the project this repo points at —
needed only for a fork, or if the app URL changes). In the Supabase dashboard:

1. **Authentication → URL Configuration → Site URL:**
   `https://zstoimenov.github.io/solar-ev-app/`
2. **Additional Redirect URLs:** add `http://localhost:5173/solar-ev-app/` for
   local development.
3. Apply the SQL in `supabase/migrations/` in filename order.
4. Point the app at the project by editing `src/data/supabaseConfig.js`, or by
   setting `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` at build time.

If the emailed link opens in a different browser than the installed PWA (common
on Android), copy the link out of the email and paste it into the box the app
shows after sending — that completes the sign-in from any context.

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` builds on every push to `main` and publishes
`dist/` to GitHub Pages. **One-time setup:** in the repo, go to
**Settings → Pages → Build and deployment → Source** and select **GitHub Actions**.

Vite `base` is `/solar-ev-app/` (the repo name) so asset paths and the PWA
`start_url`/`scope` resolve correctly on Pages.
