// ChargingLogEditor - the paid-public-charging log: one row per charging
// event (date, kWh, total cost, optional notes). buildDigest.js sums this
// log per month for evPublicTripKwh + the EV electricity cost subtracted in
// Layer 2 - replacing the old single "paid public kWh" monthly manual field.

import React, { useState } from 'react';
import { putState } from '../../data/db.js';
import RecomputeFinancialsButton from './RecomputeFinancialsButton.jsx';

const emptyForm = { date: '', energyKwh: '', totalCostAud: '', notes: '' };

// c/kWh, derived from cost/energy rather than asked for separately - matches
// the app's other rate fields (all c/kWh) so it's directly comparable.
function pricePerKwh(entry) {
  if (!entry.energyKwh) return null;
  return Math.round((entry.totalCostAud / entry.energyKwh) * 100 * 100) / 100;
}

export default function ChargingLogEditor({ state, onChange }) {
  const log = state.chargingLog ?? [];
  const sorted = [...log].sort((a, b) => b.date.localeCompare(a.date));

  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState(null);
  const setF = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function persist(nextLog) {
    await putState({ ...state, chargingLog: nextLog });
    onChange?.();
  }

  async function addEntry() {
    setError(null);
    if (!form.date) { setError('Enter the charging date.'); return; }
    const energyKwh = Number(form.energyKwh);
    const totalCostAud = Number(form.totalCostAud);
    if (!Number.isFinite(energyKwh) || !Number.isFinite(totalCostAud)) {
      setError('Enter both energy (kWh) and total cost (AUD).'); return;
    }
    await persist([...log, { date: form.date, energyKwh, totalCostAud, notes: form.notes || null }]);
    setForm(emptyForm);
  }

  // Removal is by object identity from the sorted (display) array, mapped
  // back into the source array - the two orders differ so a plain display
  // index can't be used directly against `log`.
  async function removeEntry(entry) {
    await persist(log.filter((e) => e !== entry));
  }

  return (
    <div className="field-section">
      <h3>Paid public charging log</h3>
      <p className="small">
        Each paid public / road-trip charging session - date, energy, and total
        cost. This replaces the old monthly "paid public kWh" field; free
        workplace charging stays on the Monthly Upload tab since it has no cost.
      </p>

      {sorted.length > 0 ? (
        <div className="table-scroll">
          <table className="digest table-nowrap">
            <thead><tr><th>Date</th><th>kWh</th><th>Cost (AUD)</th><th>c/kWh</th><th>Notes</th><th></th></tr></thead>
            <tbody>
              {sorted.map((e) => (
                <tr key={`${e.date}-${e.energyKwh}-${e.totalCostAud}`}>
                  <td>{e.date}</td>
                  <td>{e.energyKwh}</td>
                  <td>${Number(e.totalCostAud).toLocaleString('en-AU')}</td>
                  <td>{pricePerKwh(e) ?? '—'}</td>
                  <td className="small">{e.notes ?? '—'}</td>
                  <td><button className="ghost" onClick={() => removeEntry(e)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="small">No charging sessions logged yet.</p>
      )}

      <div className="grid cols-3" style={{ marginTop: '.75rem' }}>
        <label className="field"><span>Date</span>
          <input type="date" value={form.date} onChange={setF('date')} />
        </label>
        <label className="field"><span>Energy (kWh)</span>
          <input type="number" step="0.01" value={form.energyKwh} onChange={setF('energyKwh')} />
        </label>
        <label className="field"><span>Total cost (AUD)</span>
          <input type="number" step="0.01" value={form.totalCostAud} onChange={setF('totalCostAud')} />
        </label>
      </div>
      <label className="field"><span>Notes (optional)</span>
        <input type="text" value={form.notes} onChange={setF('notes')} />
      </label>
      {error && <div className="banner err">{error}</div>}
      <button className="primary" onClick={addEntry} style={{ marginTop: '.5rem' }}>Add entry</button>

      <RecomputeFinancialsButton state={state} onChange={onChange} />
    </div>
  );
}
