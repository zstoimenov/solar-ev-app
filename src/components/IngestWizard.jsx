// IngestWizard - client-side monthly ingest. Three uploaded files + one manual
// away-charging step -> compute -> PREVIEW (propose-before-write) -> confirm ->
// append exactly one month and recompute cumulative totals. Duplicate-month
// guard blocks re-ingesting an existing month unless overwrite is chosen.

import React, { useState } from 'react';
import { parseFronius } from '../ingest/parseFronius.js';
import { parseWattpilot } from '../ingest/parseWattpilot.js';
import { parseSynergy } from '../ingest/parseSynergy.js';
import { buildDigest } from '../ingest/buildDigest.js';
import { recomputeCumulative, recomputeMeta } from '../data/compute.js';
import { putState } from '../data/db.js';
import TariffScheduleEditor from './Ingest/TariffScheduleEditor.jsx';
import ChargingLogEditor from './Ingest/ChargingLogEditor.jsx';
import TariffPlanEditor from './Ingest/TariffPlanEditor.jsx';
import EvSessionsUploader from './Ingest/EvSessionsUploader.jsx';
import PaybackSettingsEditor from './Ingest/PaybackSettingsEditor.jsx';

const APP_VERSION = 'app_v1';
const empty = { fronius: null, wattpilot: null, synergy: null };

// Two levels: a few broad categories (kept to 3 top-level pills instead of
// piling every page into one row), each with its own short intro - and,
// where a category groups more than one page, a second row of pills for the
// specific page. Monthly Upload has no group intro since it's a single page.
const CATEGORIES = [
  { key: 'upload', label: 'Monthly Upload' },
  {
    key: 'tariffs', label: 'Tariffs & Rates',
    intro: "Three related pages for electricity pricing: what you actually pay to " +
      "import, what you're paid to export, and reference rate cards to compare " +
      'plans against.',
    subsections: [
      { key: 'importTariff', label: 'Import Tariff' },
      { key: 'exportTariff', label: 'Feed-in Tariff' },
      { key: 'tariffPlans', label: 'Tariff Plans' }
    ]
  },
  {
    key: 'evData', label: 'EV Charging Data',
    intro: 'Two related pages for your EV: paid public-charging costs, and ' +
      "charging-session timestamps used by the Dashboard's Plan Comparison tile.",
    subsections: [
      { key: 'chargingLog', label: 'Public Charging Log' },
      { key: 'evSessions', label: 'EV Sessions' }
    ]
  },
  { key: 'payback', label: 'Payback' }
];

// Fronius/Wattpilot report filenames end in "..._2026_06.xlsx" - pull the
// month straight from the filename so the user doesn't have to type it.
const MONTH_FROM_FILENAME = /(\d{4})[_-](\d{2})(?!\d)/;

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

export default function IngestWizard({ state, onChange, onIngested }) {
  const [category, setCategory] = useState('upload');
  const [subsection, setSubsection] = useState(null);
  const [files, setFiles] = useState(empty);
  const [manual, setManual] = useState({
    month: '', evWorkChargingKwh: 0, notes: ''
  });
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [overwrite, setOverwrite] = useState(false);

  const setFile = (k) => (e) => {
    const file = e.target.files?.[0] ?? null;
    setFiles((f) => ({ ...f, [k]: file }));
    if (file && (k === 'fronius' || k === 'wattpilot')) {
      const m = file.name.match(MONTH_FROM_FILENAME);
      if (m) setManual((cur) => (cur.month ? cur : { ...cur, month: `${m[1]}-${m[2]}` }));
    }
  };
  const setM = (k) => (e) => setManual((m) => ({ ...m, [k]: e.target.value }));

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
        : { gridImportSynergyKwh: null, pending: true, billedRows: 0, unbilledRows: 0, outOfMonthRows: 0 };

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

      setPreview({
        digest,
        next: { ...state, meta: nextMeta, monthlyDigests: nextDigests, cumulativeTotals: nextCumulative },
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
    setManual((m) => ({ ...m, month: '', notes: '' }));
    onIngested?.();
  }

  const activeCategory = CATEGORIES.find((c) => c.key === category);

  function selectCategory(key) {
    setCategory(key);
    const cat = CATEGORIES.find((c) => c.key === key);
    setSubsection(cat.subsections?.[0]?.key ?? null);
  }

  return (
    <div className="panel">
      <h2>Monthly Ingest</h2>

      <div className="subtabs">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            className={c.key === category ? 'active' : ''}
            onClick={() => selectCategory(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {activeCategory.subsections && (
        <>
          <p className="small">{activeCategory.intro}</p>
          <div className="subtabs subtabs-nested">
            {activeCategory.subsections.map((s) => (
              <button
                key={s.key}
                className={s.key === subsection ? 'active' : ''}
                onClick={() => setSubsection(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </>
      )}

      {category === 'upload' && (
      <>
      <p className="small">
        Upload the three monthly files + enter away-charging. Nothing is written
        until you confirm the preview.
      </p>

      <div className="field-section">
        <label className="field"><span>Month (YYYY-MM)</span>
          <input type="text" placeholder="2026-06" value={manual.month} onChange={setM('month')} />
        </label>
      </div>

      <div className="field-section">
        <h3>Files</h3>
        <div className="grid cols-2">
          <label className="field"><span>1 · Fronius total XLSX (Energy_balance_total_…)</span>
            <input type="file" accept=".xlsx" onChange={setFile('fronius')} />
          </label>
          <label className="field"><span>2 · Wattpilot XLSX (Energy_balance_Wattpilot_…)</span>
            <input type="file" accept=".xlsx" onChange={setFile('wattpilot')} />
          </label>
          <label className="field"><span>3 · Synergy CSV (MA_IntervalDataHistory.csv) — optional if pending</span>
            <input type="file" accept=".csv" onChange={setFile('synergy')} />
          </label>
        </div>
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

      {subsection === 'importTariff' && <TariffScheduleEditor state={state} onChange={onChange} kind="import" />}
      {subsection === 'exportTariff' && <TariffScheduleEditor state={state} onChange={onChange} kind="export" />}
      {subsection === 'chargingLog' && <ChargingLogEditor state={state} onChange={onChange} />}
      {subsection === 'tariffPlans' && <TariffPlanEditor state={state} onChange={onChange} />}
      {subsection === 'evSessions' && <EvSessionsUploader state={state} onChange={onChange} />}
      {category === 'payback' && <PaybackSettingsEditor state={state} onChange={onChange} />}

      {category === 'upload' && preview && (() => {
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
                    <tr key={k}><td>{k}</td><td className={`digest-${status}`}>{v == null ? 'null' : String(v)}</td></tr>
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
