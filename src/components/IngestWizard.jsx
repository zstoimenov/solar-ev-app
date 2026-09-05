// IngestWizard - the whole Data screen in one panel: the monthly ingest
// (three uploaded files + one manual away-charging step -> compute ->
// PREVIEW (propose-before-write) -> confirm -> append exactly one month and
// recompute cumulative totals; a duplicate-month guard blocks re-ingesting
// an existing month unless overwrite is chosen), the rate/log/payback
// editors, and Backup.
//
// Backup is a page in the SAME index rather than a second panel stacked
// underneath. The screen used to be two unrelated panels with two different
// navigation idioms, which read as two half-screens rather than one; now
// everything administrative is reached the same way, and only one page is on
// screen at a time.
//
// NAVIGATION IS AN INDEX AND A DRILL-IN, not tabs. It used to be two rows of
// pills, and on a 412px phone the top row alone wrapped to three lines: a
// category with sub-pages spent 278px - most of a third of the screen - on
// navigation before any content appeared, and the intro paragraph sat BETWEEN
// the two rows so the levels did not even read as levels. Six pills wrapped
// across three lines is not a menu, it is a wall.
//
// So the screen opens as a list of every page, grouped, one tap to any of
// them, and each row carries the one-line description that used to be a
// paragraph competing with the pills. Choosing one gives it the whole screen
// with a single back link. This is the ordinary phone-settings pattern, and it
// suits a screen touched about once a month: an extra tap costs nothing here,
// and nothing is hidden behind a horizontal scroll (see the note in CLAUDE.md
// about the 12-month table, where a scroll hides the rightmost column).

import React, { Suspense, lazy, useState } from 'react';
import { parseFronius } from '../ingest/parseFronius.js';
import { parseWattpilot } from '../ingest/parseWattpilot.js';
import { parseSynergy } from '../ingest/parseSynergy.js';
import { buildDigest, buildDailySeries } from '../ingest/buildDigest.js';
import { mergeDailySeries } from '../data/daily.js';
import { recomputeCumulative, recomputeMeta } from '../data/compute.js';
import { putState } from '../data/db.js';
import TariffScheduleEditor from './Ingest/TariffScheduleEditor.jsx';
import ChargingLogEditor from './Ingest/ChargingLogEditor.jsx';
import TariffPlanEditor from './Ingest/TariffPlanEditor.jsx';
import EvSessionsUploader from './Ingest/EvSessionsUploader.jsx';
import PaybackSettingsEditor from './Ingest/PaybackSettingsEditor.jsx';
import VehicleSettingsEditor from './Ingest/VehicleSettingsEditor.jsx';
import NotificationSettings from './Ingest/NotificationSettings.jsx';
import ExportRestore from './ExportRestore.jsx';
// Lazily loaded: it is the only importer of the Supabase client, which is
// ~62 kB gzipped. A household that never turns cloud backup on should not pay
// for it on first paint, and one that does pays once, on opening this page.
const CloudBackup = lazy(() => import('./Ingest/CloudBackup.jsx'));

const APP_VERSION = 'app_v1';
const empty = { fronius: null, wattpilot: null, synergy: null };

// Every page, flat, with the group it sits under. There is no second level any
// more: a grouped list of eight rows is not overwhelming the way a flat row of
// eight PILLS was, because a list has a shape and a wrapped pill row does not.
// The blurb is the row's own subtitle, which is what finally gives that text
// somewhere to live.
const PAGES = [
  {
    key: 'upload', group: 'Monthly', label: 'Add a Month',
    blurb: 'Upload the Fronius, Wattpilot and Synergy files for a finished month.'
  },
  {
    key: 'importTariff', group: 'Tariffs & rates', label: 'Import Tariff',
    blurb: 'What you pay per kWh drawn from the grid, plus the daily supply charge.'
  },
  {
    key: 'exportTariff', group: 'Tariffs & rates', label: 'Feed-in Tariff',
    blurb: "What you're paid for the energy you export."
  },
  {
    key: 'tariffPlans', group: 'Tariffs & rates', label: 'Tariff Plans',
    blurb: 'Reference rate cards, for comparing plans you are not on.'
  },
  {
    key: 'chargingLog', group: 'EV charging data', label: 'Public Charging Log',
    blurb: 'What you paid to charge the car away from home.'
  },
  {
    key: 'evSessions', group: 'EV charging data', label: 'EV Sessions',
    blurb: "Charging-session timestamps, for the plan comparison's time-of-day split."
  },
  {
    key: 'vehicle', group: 'EV charging data', label: 'Your Car',
    blurb: 'Battery size and average consumption, so spare solar reads as % and km.'
  },
  {
    key: 'payback', group: 'Setup', label: 'Payback',
    blurb: 'What the hardware cost, and when it was installed.'
  },
  {
    key: 'alerts', group: 'Setup', label: 'Alerts',
    blurb: 'Forecast alerts from your phone, and whether they are getting through.'
  },
  {
    key: 'backup', group: 'Setup', label: 'Backup',
    blurb: 'Export a copy, restore one, or clear what is stored in this browser.'
  },
  {
    key: 'cloud', group: 'Setup', label: 'Cloud Backup',
    blurb: 'Keep an encrypted second copy off this device, in case the browser loses it.'
  }
];

// Order matters: the thing done monthly first, the things done once a year
// after it, and the two that are set up once at the bottom.
const GROUPS = ['Monthly', 'Tariffs & rates', 'EV charging data', 'Setup'];

// Fronius/Wattpilot report filenames end in "..._2026_06.xlsx" - pull the
// month straight from the filename so the user doesn't have to type it. The
// month each file names is also KEPT (see `detected` below) rather than only
// used to prefill: uploading June's Fronius file beside May's Wattpilot file
// builds a month out of two different months, and every figure downstream
// would be wrong in a way no preview row makes obvious.
const MONTH_FROM_FILENAME = /(\d{4})[_-](\d{2})(?!\d)/;

function monthFromFilename(name) {
  const m = String(name ?? '').match(MONTH_FROM_FILENAME);
  if (!m) return null;
  const mm = Number(m[2]);
  return mm >= 1 && mm <= 12 ? `${m[1]}-${m[2]}` : null;
}

const fileSize = (bytes) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// One upload slot. The native control renders as a white "Choose File / No
// file chosen" button that ignores the dark theme entirely, and once a file
// IS chosen it truncates the name from the left - so on a phone the three
// slots all looked identical whether they were filled or not. The input is
// still the real thing, just visually replaced by the row that reports what
// was picked: name, size, and the month read out of the filename.
function FileSlot({ index, label, hint, accept, file, detected, onChange }) {
  return (
    <label className={`file-slot${file ? ' filled' : ''}`}>
      <input type="file" accept={accept} onChange={onChange} />
      <span className="file-slot-badge" aria-hidden="true">{file ? '✓' : index}</span>
      <span className="file-slot-text">
        <span className="file-slot-label">{label}</span>
        {/* The month leads, because it is the thing worth reading and the
            filename is the thing that gets truncated: these exports are named
            "Energy_balance_total_Monthly_report_2026_06.xlsx", so the month is
            the last thing on the line and the first thing an ellipsis eats. */}
        <span className="file-slot-meta">
          {file ? [detected, fileSize(file.size), file.name].filter(Boolean).join(' · ') : hint}
        </span>
      </span>
      <span className="file-slot-action">{file ? 'Change' : 'Choose'}</span>
    </label>
  );
}

// Red/yellow/green severity per preview field, so a genuine problem
// (cross-val breach) stands out from a merely-pending value (Synergy not
// billed yet) instead of both looking like "just another number".
function rowStatus(key, value) {
  if (typeof value === 'number' && Number.isNaN(value)) return 'err'; // e.g. a missing config/tariff field
  if ((key === 'crossValImport' || key === 'crossValExport') && value === 'Fail') return 'err';
  if (key === 'flags' && typeof value === 'string' && /breach/i.test(value)) return 'err';
  if (value == null) return 'warn';
  if ((key === 'crossValImport' || key === 'crossValExport') && value === 'Pending') return 'warn';
  if (key === 'partialMonth' && value === true) return 'warn';
  return 'ok';
}

const SEVERITY_RANK = { err: 2, warn: 1, ok: 0 };

// Most digest fields are a number or a string. `intervalProfile` is an
// object of 96 bucket figures, which String()s to "[object Object]" - the
// preview shows what was captured instead, since what the reviewer needs to
// confirm is that the half-hourly data arrived, not its 96 values.
function previewValue(key, value) {
  if (value == null) return 'null';
  if (key === 'intervalProfile') {
    return `${value.intervals} intervals over ${value.days} days` +
      (value.exportKwh ? ', import + export' : ', import only');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// `page` is owned by DataScreen so other things on the screen (the
// stale-backup banner's "Back up now") can jump straight to a page here, and
// null means the index.
export default function IngestWizard({
  state, appMeta, cloudMeta, page, onPageChange, onChange, onIngested
}) {
  const [files, setFiles] = useState(empty);
  // What month each uploaded file NAMES, kept alongside the files themselves so
  // the two energy exports can be checked against each other and against the
  // month actually being built.
  const [detected, setDetected] = useState(empty);
  const [manual, setManual] = useState({
    month: '', evWorkChargingKwh: 0, notes: ''
  });
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [overwrite, setOverwrite] = useState(false);

  const setFile = (k) => (e) => {
    const file = e.target.files?.[0] ?? null;
    setFiles((f) => ({ ...f, [k]: file }));
    // The Synergy export is named for the download, not the month, so only the
    // two energy files can say anything here.
    const month = k === 'synergy' ? null : monthFromFilename(file?.name);
    setDetected((d) => ({ ...d, [k]: month }));
    if (month) setManual((cur) => (cur.month ? cur : { ...cur, month }));
  };
  const setM = (k) => (e) => setManual((m) => ({ ...m, [k]: e.target.value }));

  // What the filenames say versus what is about to be built. Two files from
  // two different months produce a digest whose every figure is wrong, and
  // nothing in the preview looks odd when it happens - the totals are simply
  // the wrong month's. This is the only place it can still be caught.
  const monthNotice = (() => {
    const { fronius, wattpilot } = detected;
    if (fronius && wattpilot && fronius !== wattpilot) {
      return {
        level: 'warn',
        text: `These two files are from different months — Fronius says ${fronius}, ` +
          `Wattpilot says ${wattpilot}. Check you picked both from the same month.`
      };
    }
    const named = fronius ?? wattpilot;
    if (!named) return null;
    if (/^\d{4}-\d{2}$/.test(manual.month) && manual.month !== named) {
      return {
        level: 'warn',
        text: `The month below says ${manual.month}, but the file names say ${named}.`
      };
    }
    return { level: 'info', text: `Read ${named} from the file names.` };
  })();

  async function buildPreview() {
    setError(null); setPreview(null);
    try {
      if (!manual.month.match(/^\d{4}-\d{2}$/)) throw new Error('Enter the month as YYYY-MM.');
      if (!files.fronius || !files.wattpilot) throw new Error('Fronius and Wattpilot files are required.');

      const exists = state.monthlyDigests.some((d) => d.month === manual.month);
      if (exists && !overwrite) {
        throw new Error(`Month ${manual.month} already exists. Tick "overwrite" to replace it.`);
      }

      const fronius = await parseFronius(files.fronius);
      const wattpilot = await parseWattpilot(files.wattpilot);
      const synergy = files.synergy
        ? parseSynergy(await files.synergy.text(), manual.month)
        : { gridImportSynergyKwh: null, pending: true, rows: 0, outOfMonthRows: 0, intervalProfile: null };

      const manualClean = {
        month: manual.month,
        evWorkChargingKwh: Number(manual.evWorkChargingKwh) || 0,
        notes: manual.notes || null
      };

      // When overwriting, hand the existing digest to buildDigest so a month
      // with no charging-log entries keeps its stored public-charging figures
      // (they may predate the log feature) instead of being zeroed.
      const prevDigest = state.monthlyDigests.find((d) => d.month === manual.month) ?? null;
      const digest = buildDigest(
        { fronius, wattpilot, synergy }, manualClean, state.config, state.chargingLog ?? [], prevDigest
      );

      // Build the proposed next-state (not yet written).
      const others = state.monthlyDigests.filter((d) => d.month !== manual.month);
      const nextDigests = [...others, digest].sort((a, b) => a.month.localeCompare(b.month));
      const nextCumulative = recomputeCumulative(nextDigests, state.cumulativeTotals, state.config);
      const nextMeta = recomputeMeta(state.meta, nextDigests, APP_VERSION);

      // Keep the per-day rows both files already contain, instead of
      // discarding them after summing (redesign_v2.md). Energy only - the
      // digest above remains the sole source of every dollar figure, so
      // this cannot move a financial number. Re-ingesting a month replaces
      // that month's rows wholesale rather than merging into stale ones.
      const monthDaily = buildDailySeries({ fronius, wattpilot }, manual.month);
      const nextDaily = mergeDailySeries(state.dailySeries, monthDaily, manual.month);

      setPreview({
        digest,
        dailyRows: monthDaily.length,
        next: {
          ...state,
          meta: nextMeta,
          monthlyDigests: nextDigests,
          cumulativeTotals: nextCumulative,
          dailySeries: nextDaily
        },
        replaced: exists
      });
    } catch (e) {
      setError(e.message);
    }
  }

  async function commit() {
    await putState(preview.next);
    onChange?.();
    setPreview(null);
    setFiles(empty);
    setDetected(empty);
    setManual((m) => ({ ...m, month: '', notes: '' }));
    onIngested?.();
  }

  const activePage = PAGES.find((p) => p.key === page) ?? null;

  // The index: every page, grouped, one tap away. No pills, no second level,
  // and the blurb that used to be a paragraph above the content is the row.
  if (!activePage) {
    return (
      <div className="panel">
        <h2>Data</h2>
        <p className="small">
          Everything administrative lives here, and none of it needs looking at more
          than about once a month.
        </p>
        {GROUPS.map((group) => (
          <div className="data-group" key={group}>
            <h3 className="data-group-label">{group}</h3>
            {PAGES.filter((p) => p.group === group).map((p) => (
              <button className="data-row" key={p.key} onClick={() => onPageChange(p.key)}>
                <span className="data-row-text">
                  <span className="data-row-label">{p.label}</span>
                  <span className="data-row-blurb">{p.blurb}</span>
                </span>
                <span className="data-row-chevron" aria-hidden="true">&rsaquo;</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="panel">
      {/* One back link, and then the page has the whole screen. Each page
          renders its own heading, so nothing is titled twice. */}
      <button className="back-link" onClick={() => onPageChange(null)}>
        <span aria-hidden="true">&lsaquo;</span> Data
      </button>

      {page === 'upload' && (
      <>
      <h3>Add a Month</h3>
      <p className="small">
        Upload the three monthly files + enter away-charging. Nothing is written
        until you confirm the preview.
      </p>

      {/* Files first, month second: the filenames answer the month question,
          so asking it before anything has been picked asks for something the
          household would have to go and look up. */}
      <div className="field-section">
        <h3>Files</h3>
        <FileSlot
          index={1} label="Fronius total XLSX" hint="Energy_balance_total_…xlsx"
          accept=".xlsx" file={files.fronius} detected={detected.fronius}
          onChange={setFile('fronius')}
        />
        <FileSlot
          index={2} label="Wattpilot XLSX" hint="Energy_balance_Wattpilot_…xlsx"
          accept=".xlsx" file={files.wattpilot} detected={detected.wattpilot}
          onChange={setFile('wattpilot')}
        />
        <FileSlot
          index={3} label="Synergy CSV — optional if not billed yet"
          hint="MA_IntervalDataHistory.csv"
          accept=".csv" file={files.synergy} detected={null}
          onChange={setFile('synergy')}
        />
      </div>

      <div className="field-section">
        <label className="field"><span>Month (YYYY-MM)</span>
          <input
            type="text" inputMode="numeric" placeholder="2026-06"
            value={manual.month} onChange={setM('month')}
          />
          <span className="hint">
            {monthNotice?.level === 'info'
              ? monthNotice.text
              : 'Read from the file names when you pick them — change it only if they disagree.'}
          </span>
        </label>
        {/* A warning, not a block: the household can still be right and the
            filename wrong, and the preview shows the month before anything is
            written. What it must not do is stay silent. */}
        {monthNotice?.level === 'warn' && (
          <div className="banner warn compact"><span>{monthNotice.text}</span></div>
        )}
      </div>

      <div className="field-section">
        <h3>Manual entry</h3>
        <div className="grid cols-3">
          <label className="field">
            <span>Free public charging (kWh)</span>
            <input type="number" value={manual.evWorkChargingKwh} onChange={setM('evWorkChargingKwh')} />
            <span className="hint">No cost to you — e.g. a free workplace charger.</span>
          </label>
        </div>
        <p className="small">
          Paid public charging now comes from <strong>EV Charging Data → Public Charging Log</strong> instead of a monthly total here.
        </p>
        <label className="field"><span>Notes (optional)</span>
          <input type="text" value={manual.notes} onChange={setM('notes')} /></label>
      </div>

      <div className="field-section">
        <label className="field row">
          <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
          <span style={{ margin: 0 }}>Overwrite if the month already exists (duplicate-month guard)</span>
        </label>

        {error && <div className="banner err">{error}</div>}
        <button className="primary" onClick={buildPreview}>Build preview</button>
      </div>
      </>
      )}

      {page === 'importTariff' && <TariffScheduleEditor state={state} onChange={onChange} kind="import" />}
      {page === 'exportTariff' && <TariffScheduleEditor state={state} onChange={onChange} kind="export" />}
      {page === 'chargingLog' && <ChargingLogEditor state={state} onChange={onChange} />}
      {page === 'tariffPlans' && <TariffPlanEditor state={state} onChange={onChange} />}
      {page === 'evSessions' && <EvSessionsUploader state={state} onChange={onChange} />}
      {page === 'vehicle' && <VehicleSettingsEditor state={state} onChange={onChange} />}
      {page === 'payback' && <PaybackSettingsEditor state={state} onChange={onChange} />}
      {page === 'alerts' && <NotificationSettings state={state} />}
      {page === 'backup' && <ExportRestore state={state} appMeta={appMeta} onChange={onChange} />}
      {page === 'cloud' && (
        <Suspense fallback={<p className="small">Loading cloud backup…</p>}>
          <CloudBackup state={state} cloudMeta={cloudMeta} onChange={onChange} />
        </Suspense>
      )}

      {page === 'upload' && preview && (() => {
        const rows = Object.entries(preview.digest).map(([k, v]) => [k, v, rowStatus(k, v)]);
        const overall = rows.reduce((worst, [, , s]) => (SEVERITY_RANK[s] > SEVERITY_RANK[worst] ? s : worst), 'ok');
        const overallText = {
          err: 'Cross-validation issue found - review the red field(s) before committing.',
          warn: 'Looks OK, with some pending/partial field(s) below (yellow) - review before committing.',
          ok: 'All checks passed - nothing flagged.'
        }[overall];
        return (
        <div className="field-section">
          <div className={`banner ${preview.replaced ? 'warn' : 'ok'}`}>
            {preview.replaced ? 'Will REPLACE existing month' : 'Will APPEND new month'}{' '}
            <strong>{preview.digest.month}</strong>. Review before committing.
          </div>
          <div className={`banner ${overall}`}>{overallText}</div>
          <div className="grid cols-2">
            <div>
              <h3>New month</h3>
              <div className="table-scroll">
                <table className="digest"><tbody>
                  {rows.map(([k, v, status]) => (
                    <tr key={k}><td>{k}</td><td className={`digest-${status}`}>{previewValue(k, v)}</td></tr>
                  ))}
                </tbody></table>
              </div>
            </div>
            <div>
              <h3>Updated totals</h3>
              <div className="table-scroll">
                <table className="digest"><tbody>
                  <tr><td>Total months</td><td>{preview.next.cumulativeTotals.coverage.totalMonths}</td></tr>
                  <tr><td>Range</td><td>{preview.next.meta.dateRange.first} → {preview.next.meta.dateRange.last}</td></tr>
                  <tr><td>Solar production (kWh)</td><td>{preview.next.cumulativeTotals.energy.solarProductionKwh}</td></tr>
                  <tr><td>Layer 1 saving</td><td>{preview.next.cumulativeTotals.financial.layer1SavingAud}</td></tr>
                  <tr><td>Layer 2 saving</td><td>{preview.next.cumulativeTotals.financial.layer2SavingAud}</td></tr>
                  <tr><td>Combined 1+2</td><td>{preview.next.cumulativeTotals.financial.combinedLayer12SavingAud}</td></tr>
                  <tr>
                    <td>Cross-val flags</td>
                    <td className={preview.next.cumulativeTotals.crossValFlags.length ? 'digest-err' : 'digest-ok'}>
                      {preview.next.cumulativeTotals.crossValFlags.join(', ') || 'none'}
                    </td>
                  </tr>
                </tbody></table>
              </div>
            </div>
          </div>
          <div className="row" style={{ marginTop: '.5rem' }}>
            <button className="primary" onClick={commit}>Confirm &amp; write to store</button>
            <button className="ghost" onClick={() => setPreview(null)}>Discard preview</button>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
