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

const APP_VERSION = 'app_v1';
const empty = { fronius: null, wattpilot: null, synergy: null };

// Fronius/Wattpilot report filenames end in "..._2026_06.xlsx" - pull the
// month straight from the filename so the user doesn't have to type it.
const MONTH_FROM_FILENAME = /(\d{4})[_-](\d{2})(?!\d)/;

export default function IngestWizard({ state, onChange }) {
  const [files, setFiles] = useState(empty);
  const [manual, setManual] = useState({
    month: '', evWorkChargingKwh: 0, evPublicTripKwh: 0, notes: ''
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
        ? parseSynergy(await files.synergy.text())
        : { gridImportSynergyKwh: null, pending: true, billedRows: 0, unbilledRows: 0 };

      const manualClean = {
        month: manual.month,
        evWorkChargingKwh: Number(manual.evWorkChargingKwh) || 0,
        evPublicTripKwh: Number(manual.evPublicTripKwh) || 0,
        notes: manual.notes || null
      };

      const digest = buildDigest({ fronius, wattpilot, synergy }, manualClean, state.config);

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
  }

  return (
    <div className="panel">
      <h2>Monthly Ingest</h2>
      <p className="small">
        Upload the three monthly files + enter away-charging. Nothing is written
        until you confirm the preview.
      </p>

      <label className="field"><span>Month (YYYY-MM)</span>
        <input type="text" placeholder="2026-06" value={manual.month} onChange={setM('month')} />
      </label>

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

      <h3>Manual entry</h3>
      <div className="grid cols-3">
        <label className="field">
          <span>Free public charging (kWh)</span>
          <input type="number" value={manual.evWorkChargingKwh} onChange={setM('evWorkChargingKwh')} />
          <span className="hint">No cost to you — e.g. a free workplace charger.</span>
        </label>
        <label className="field">
          <span>Paid public charging (kWh)</span>
          <input type="number" value={manual.evPublicTripKwh} onChange={setM('evPublicTripKwh')} />
          <span className="hint">You paid for this — public fast chargers, road trips, etc.</span>
        </label>
      </div>
      <label className="field"><span>Notes (optional)</span>
        <input type="text" value={manual.notes} onChange={setM('notes')} /></label>

      <label className="field row">
        <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
        <span style={{ margin: 0 }}>Overwrite if the month already exists (duplicate-month guard)</span>
      </label>

      {error && <div className="banner err">{error}</div>}
      <button className="primary" onClick={buildPreview}>Build preview</button>

      {preview && (
        <div style={{ marginTop: '1rem' }}>
          <div className={`banner ${preview.replaced ? 'warn' : 'ok'}`}>
            {preview.replaced ? 'Will REPLACE existing month' : 'Will APPEND new month'}{' '}
            <strong>{preview.digest.month}</strong>. Review before committing.
          </div>
          <div className="grid cols-2">
            <div>
              <h3>New month</h3>
              <div className="table-scroll">
                <table className="digest"><tbody>
                  {Object.entries(preview.digest).map(([k, v]) => (
                    <tr key={k}><td>{k}</td><td className={v == null ? 'pending' : ''}>{v == null ? 'null' : String(v)}</td></tr>
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
                  <tr><td>Cross-val flags</td><td>{preview.next.cumulativeTotals.crossValFlags.join(', ') || 'none'}</td></tr>
                </tbody></table>
              </div>
            </div>
          </div>
          <div className="row" style={{ marginTop: '.5rem' }}>
            <button className="primary" onClick={commit}>Confirm &amp; write to store</button>
            <button className="ghost" onClick={() => setPreview(null)}>Discard preview</button>
          </div>
        </div>
      )}
    </div>
  );
}
