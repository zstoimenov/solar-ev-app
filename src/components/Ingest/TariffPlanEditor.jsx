// TariffPlanEditor - a catalog of tariff PLAN OPTIONS (e.g. Synergy's A1,
// Midday Saver, EV Add On) to compare against what you're actually billed on
// (see the Import Tariff tab for that). Not yet wired into any comparison -
// see CLAUDE.md "Tariff plan comparison" for why (needs a time-of-day usage
// split the app doesn't have a source for yet).
//
// A flat plan (e.g. A1) is one row with no time window. A time-of-day plan
// (Midday Saver, EV Add On) is one row per band (Peak, Off Peak, ...) - rows
// sharing the same plan name + year form that plan's full rate card. This
// mirrors the simple flat add/remove list used by the other Ingest tabs
// rather than a nested plan->bands editor, since re-entering this table is a
// rare, one-off task.

import React, { useState } from 'react';
import { putState } from '../../data/db.js';

const emptyForm = {
  planName: '', year: '', supplyChargeCPerDay: '', bandLabel: '', from: '', to: '', priceCentsPerKwh: ''
};

export default function TariffPlanEditor({ state, onChange }) {
  const plans = state.config.tariffPlans ?? [];
  const sorted = [...plans].sort((a, b) =>
    a.planName.localeCompare(b.planName) || a.year - b.year || (a.from ?? '').localeCompare(b.from ?? '')
  );

  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState(null);
  const setF = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function persist(nextPlans) {
    await putState({ ...state, config: { ...state.config, tariffPlans: nextPlans } });
    onChange?.();
  }

  async function addEntry() {
    setError(null);
    if (!form.planName.trim()) { setError('Enter a plan name (e.g. A1, Midday Saver, EV Add On).'); return; }
    const year = Number(form.year);
    const supplyCharge = Number(form.supplyChargeCPerDay);
    const price = Number(form.priceCentsPerKwh);
    if (!Number.isFinite(year)) { setError('Enter the year these prices apply from.'); return; }
    if (!Number.isFinite(supplyCharge)) { setError('Enter the supply charge (c/day).'); return; }
    if (!Number.isFinite(price)) { setError('Enter the price (c/kWh) for this band.'); return; }
    const entry = {
      planName: form.planName.trim(),
      year,
      supplyChargeCPerDay: supplyCharge,
      bandLabel: form.bandLabel.trim() || 'Flat',
      from: form.from || null,
      to: form.to || null,
      priceCentsPerKwh: price
    };
    await persist([...plans, entry]);
    // Keep plan/year/supply charge for the next row - a time-of-day plan
    // needs several bands added in a row, all sharing those three values.
    setForm((f) => ({ ...f, bandLabel: '', from: '', to: '', priceCentsPerKwh: '' }));
  }

  async function removeEntry(target) {
    await persist(plans.filter((p) => p !== target));
  }

  return (
    <div className="field-section">
      <h3>Tariff plan catalog</h3>
      <p className="small">
        Rate-card options to compare against what you're actually billed on (Import
        Tariff tab) - e.g. Synergy's A1 (flat), Midday Saver, or EV Add On plans. A
        flat plan is one row (leave the band fields blank); a time-of-day plan is one
        row per band, all sharing the same plan name, year, and supply charge.
      </p>
      <p className="small">
        Not yet used for an automatic comparison - that needs a time-of-day split of
        your usage, which neither the Fronius nor Wattpilot exports currently provide
        (see Data Notes). This just records the rate cards for when that's available.
      </p>

      {sorted.length > 0 ? (
        <div className="table-scroll">
          <table className="digest table-nowrap">
            <thead>
              <tr>
                <th>Plan</th><th>Year</th><th>Supply (c/day)</th><th>Band</th>
                <th>From</th><th>To</th><th>Price (c/kWh)</th><th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => (
                <tr key={i}>
                  <td>{p.planName}</td>
                  <td>{p.year}</td>
                  <td>{p.supplyChargeCPerDay}</td>
                  <td>{p.bandLabel}</td>
                  <td>{p.from ?? 'All day'}</td>
                  <td>{p.to ?? '—'}</td>
                  <td>{p.priceCentsPerKwh}</td>
                  <td><button className="ghost" onClick={() => removeEntry(p)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="small">No plans logged yet.</p>
      )}

      <div className="grid cols-3" style={{ marginTop: '.75rem' }}>
        <label className="field"><span>Plan name</span>
          <input type="text" list="plan-names" placeholder="A1" value={form.planName} onChange={setF('planName')} />
          <datalist id="plan-names">
            <option value="A1" /><option value="Midday Saver" /><option value="EV Add On" />
          </datalist>
        </label>
        <label className="field"><span>Year</span>
          <input type="number" placeholder="2025" value={form.year} onChange={setF('year')} />
        </label>
        <label className="field"><span>Supply charge (c/day)</span>
          <input type="number" step="0.0001" value={form.supplyChargeCPerDay} onChange={setF('supplyChargeCPerDay')} />
        </label>
      </div>
      <div className="grid cols-3">
        <label className="field"><span>Band label</span>
          <input type="text" placeholder="Flat / Peak / Off Peak…" value={form.bandLabel} onChange={setF('bandLabel')} />
        </label>
        <label className="field"><span>From (blank = all day)</span>
          <input type="time" value={form.from} onChange={setF('from')} />
        </label>
        <label className="field"><span>To</span>
          <input type="time" value={form.to} onChange={setF('to')} />
        </label>
      </div>
      <label className="field"><span>Price (c/kWh)</span>
        <input type="number" step="0.0001" value={form.priceCentsPerKwh} onChange={setF('priceCentsPerKwh')} />
      </label>
      {error && <div className="banner err">{error}</div>}
      <button className="primary" onClick={addEntry} style={{ marginTop: '.5rem' }}>Add band</button>
    </div>
  );
}
