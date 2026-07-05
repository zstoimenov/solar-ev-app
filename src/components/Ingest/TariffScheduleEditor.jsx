// TariffScheduleEditor - add/remove dated rate-change entries for either the
// import (buy) tariff or the export (feed-in) tariff. Entries apply as a step
// function over time (see data/tariffSchedule.js): whichever entry has the
// latest effectiveFrom on/before a given month's 1st is the rate used for
// that whole month - no mid-month blending.

import React, { useState } from 'react';
import { putState } from '../../data/db.js';

const MODES = {
  import: {
    title: 'Import (buy) tariff history',
    blurb: 'What you pay Synergy per kWh drawn from the grid, plus the daily supply ' +
      '(connection) charge. Add an entry whenever either changes - it applies from ' +
      'that date until the next entry. Used for newly-ingested months; existing ' +
      'months keep their stored numbers. The supply charge is added equally to both ' +
      "the actual and baseline grid cost, so it doesn't change Layer 1's accrued " +
      'savings - only the two absolute cost figures.'
  },
  export: {
    title: 'Feed-in (export) tariff history',
    blurb: "What you're paid per kWh exported to the grid, split into two " +
      'time-of-day bands (e.g. DEBS peak/off-peak). Stored here for reference - ' +
      'not yet auto-applied to Layer 1, since Fronius only reports a monthly ' +
      "export total, not an hour-by-hour split, so there's no reliable way to " +
      'apply two time-of-day rates without guessing a peak-share split.'
  }
};

const emptyForm = {
  effectiveFrom: '', priceCentsPerKwh: '', supplyChargeCPerDay: '', peakFrom: '15:00', peakTo: '21:00',
  peakPriceCentsPerKwh: '', offPeakPriceCentsPerKwh: ''
};

export default function TariffScheduleEditor({ state, onChange, kind }) {
  const mode = MODES[kind];
  const entries = state.config.tariffSchedule?.[kind] ?? [];
  const sorted = [...entries].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));

  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState(null);
  const setF = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function persist(nextEntries) {
    const nextState = {
      ...state,
      config: {
        ...state.config,
        tariffSchedule: { ...(state.config.tariffSchedule ?? {}), [kind]: nextEntries }
      }
    };
    await putState(nextState);
    onChange?.();
  }

  async function addEntry() {
    setError(null);
    if (!form.effectiveFrom) { setError('Enter the effective-from date.'); return; }
    let entry;
    if (kind === 'import') {
      const price = Number(form.priceCentsPerKwh);
      const supplyCharge = Number(form.supplyChargeCPerDay);
      if (!Number.isFinite(price)) { setError('Enter a price (c/kWh).'); return; }
      if (!Number.isFinite(supplyCharge)) { setError('Enter the supply charge (c/day).'); return; }
      entry = { effectiveFrom: form.effectiveFrom, priceCentsPerKwh: price, supplyChargeCPerDay: supplyCharge };
    } else {
      const peak = Number(form.peakPriceCentsPerKwh);
      const offPeak = Number(form.offPeakPriceCentsPerKwh);
      if (!form.peakFrom || !form.peakTo) { setError('Enter the peak time window.'); return; }
      if (!Number.isFinite(peak) || !Number.isFinite(offPeak)) {
        setError('Enter both peak and off-peak prices (c/kWh).'); return;
      }
      entry = {
        effectiveFrom: form.effectiveFrom, peakFrom: form.peakFrom, peakTo: form.peakTo,
        peakPriceCentsPerKwh: peak, offPeakPriceCentsPerKwh: offPeak
      };
    }
    await persist([...entries, entry]);
    setForm(emptyForm);
  }

  async function removeEntry(effectiveFrom) {
    await persist(entries.filter((e) => e.effectiveFrom !== effectiveFrom));
  }

  return (
    <div className="field-section">
      <h3>{mode.title}</h3>
      <p className="small">{mode.blurb}</p>

      {sorted.length > 0 ? (
        <div className="table-scroll">
          <table className="digest table-nowrap">
            <thead>
              <tr>
                <th>Effective from</th>
                {kind === 'import'
                  ? (<><th>Price (c/kWh)</th><th>Supply (c/day)</th></>)
                  : (<><th>Peak window</th><th>Peak (c/kWh)</th><th>Off-peak (c/kWh)</th></>)}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <tr key={e.effectiveFrom}>
                  <td>{e.effectiveFrom}</td>
                  {kind === 'import'
                    ? (<><td>{e.priceCentsPerKwh}</td><td>{e.supplyChargeCPerDay ?? 0}</td></>)
                    : (<>
                        <td className="nowrap">{e.peakFrom}–{e.peakTo}</td>
                        <td>{e.peakPriceCentsPerKwh}</td>
                        <td>{e.offPeakPriceCentsPerKwh}</td>
                      </>)}
                  <td><button className="ghost" onClick={() => removeEntry(e.effectiveFrom)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="small">No entries yet - the static config rate is used until you add one.</p>
      )}

      <div className="grid cols-3" style={{ marginTop: '.75rem' }}>
        <label className="field"><span>Effective from</span>
          <input type="date" value={form.effectiveFrom} onChange={setF('effectiveFrom')} />
        </label>
        {kind === 'import' ? (
          <>
            <label className="field"><span>Price (c/kWh)</span>
              <input type="number" step="0.0001" value={form.priceCentsPerKwh} onChange={setF('priceCentsPerKwh')} />
            </label>
            <label className="field"><span>Supply charge (c/day)</span>
              <input type="number" step="0.0001" value={form.supplyChargeCPerDay} onChange={setF('supplyChargeCPerDay')} />
            </label>
          </>
        ) : (
          <>
            <label className="field"><span>Peak from</span>
              <input type="time" value={form.peakFrom} onChange={setF('peakFrom')} />
            </label>
            <label className="field"><span>Peak to</span>
              <input type="time" value={form.peakTo} onChange={setF('peakTo')} />
            </label>
            <label className="field"><span>Peak price (c/kWh)</span>
              <input type="number" step="0.01" value={form.peakPriceCentsPerKwh} onChange={setF('peakPriceCentsPerKwh')} />
            </label>
            <label className="field"><span>Off-peak price (c/kWh)</span>
              <input type="number" step="0.01" value={form.offPeakPriceCentsPerKwh} onChange={setF('offPeakPriceCentsPerKwh')} />
            </label>
          </>
        )}
      </div>
      {error && <div className="banner err">{error}</div>}
      <button className="primary" onClick={addEntry} style={{ marginTop: '.5rem' }}>Add entry</button>
    </div>
  );
}
