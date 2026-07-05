// TariffPlanEditor - a catalog of tariff PLAN OPTIONS (e.g. Synergy's A1,
// EV Add On) to compare against what you're actually billed on (see the
// Import Tariff tab for that). Feeds the Dashboard's Plan Comparison tile -
// EV charging only, see Dashboard/PlanComparison.jsx for why it can't (yet)
// cover the whole household bill.
//
// A flat plan (e.g. A1) is one row with no time window. A time-of-day plan
// (EV Add On) is one row per band (Peak, Off Peak, ...) - rows sharing the
// same plan name + financial year form that plan's full rate card. This
// mirrors the simple flat add/remove list used by the other Ingest tabs
// rather than a nested plan->bands editor, since re-entering this table is a
// rare, one-off task.
//
// Prices are keyed by Australian FINANCIAL year (Jul-Jun), not calendar
// year - Synergy (like most WA retailers) reprices on 1 July every year, so
// "2025" and "2026" on their rate card mean FY2025-26 and FY2026-27.

import React, { useState } from 'react';
import { putState } from '../../data/db.js';
import { financialYearLabel, financialYearOf } from '../../data/tariffSchedule.js';
import { DEFAULT_TARIFF_PLANS } from '../../data/defaultTariffPlans.js';
import InfoPopover from '../InfoPopover.jsx';

const emptyForm = {
  planName: '', fyStartYear: '', supplyChargeCPerDay: '', bandLabel: '', from: '', to: '', priceCentsPerKwh: ''
};

function dedupeKey(p) {
  return `${p.planName}__${financialYearOf(p)}__${p.bandLabel}__${p.from}__${p.to}`;
}

export default function TariffPlanEditor({ state, onChange }) {
  const plans = state.config.tariffPlans ?? [];
  const sorted = [...plans].sort((a, b) =>
    a.planName.localeCompare(b.planName) || financialYearOf(a).localeCompare(financialYearOf(b)) || (a.from ?? '').localeCompare(b.from ?? '')
  );

  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const setF = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function persist(nextPlans) {
    await putState({ ...state, config: { ...state.config, tariffPlans: nextPlans } });
    onChange?.();
  }

  async function addEntry() {
    setError(null); setMsg(null);
    if (!form.planName.trim()) { setError('Enter a plan name (e.g. A1, EV Add On).'); return; }
    const fyStartYear = Number(form.fyStartYear);
    const supplyCharge = Number(form.supplyChargeCPerDay);
    const price = Number(form.priceCentsPerKwh);
    if (!Number.isFinite(fyStartYear)) { setError('Enter the financial year these prices start from (e.g. 2025 for FY2025-26).'); return; }
    if (!Number.isFinite(supplyCharge)) { setError('Enter the supply charge (c/day).'); return; }
    if (!Number.isFinite(price)) { setError('Enter the price (c/kWh) for this band.'); return; }
    const entry = {
      planName: form.planName.trim(),
      financialYear: financialYearLabel(`${fyStartYear}-07`),
      supplyChargeCPerDay: supplyCharge,
      bandLabel: form.bandLabel.trim() || 'Flat',
      from: form.from || null,
      to: form.to || null,
      priceCentsPerKwh: price
    };
    await persist([...plans, entry]);
    // Keep plan/FY/supply charge for the next row - a time-of-day plan needs
    // several bands added in a row, all sharing those three values.
    setForm((f) => ({ ...f, bandLabel: '', from: '', to: '', priceCentsPerKwh: '' }));
  }

  async function removeEntry(target) {
    await persist(plans.filter((p) => p !== target));
  }

  async function loadDefaults() {
    setError(null);
    const existingKeys = new Set(plans.map(dedupeKey));
    const toAdd = DEFAULT_TARIFF_PLANS.filter((p) => !existingKeys.has(dedupeKey(p)));
    if (toAdd.length === 0) {
      setMsg({ type: 'ok', text: "Already up to date - Synergy's published A1 and EV Add On rates are all present." });
      return;
    }
    await persist([...plans, ...toAdd]);
    setMsg({
      type: 'ok',
      text: `${toAdd.length} rate band${toAdd.length === 1 ? '' : 's'} added ` +
        `(${DEFAULT_TARIFF_PLANS.length - toAdd.length} already present).`
    });
  }

  return (
    <div className="field-section">
      <h3>Tariff plan catalog</h3>
      <p className="small">
        Rate-card options (e.g. Synergy's A1, EV Add On) feeding the Dashboard's{' '}
        <strong>Plan Comparison</strong> tile.{' '}
        <InfoPopover label="How to enter a plan">
          A flat plan (A1) is one row with the band fields left blank. A time-of-day
          plan (EV Add On) is one row per band (Peak, Off Peak, ...), all sharing the
          same plan name, financial year, and supply charge. Prices are keyed by
          Australian financial year (starts 1 July) since that's when retailers like
          Synergy reprice, not calendar year. The comparison currently covers EV
          charging only, not your whole bill - see the Plan Comparison tile for why.
        </InfoPopover>
      </p>
      <div className="row">
        <button className="ghost" onClick={loadDefaults}>Load Synergy's published A1 + EV Add On rates</button>
      </div>

      {sorted.length > 0 ? (
        <div className="table-scroll" style={{ marginTop: '.75rem' }}>
          <table className="digest table-nowrap">
            <thead>
              <tr>
                <th>Plan</th><th>FY</th><th>Supply (c/day)</th><th>Band</th>
                <th>From</th><th>To</th><th>Price (c/kWh)</th><th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => (
                <tr key={i}>
                  <td>{p.planName}</td>
                  <td>{financialYearOf(p)}</td>
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

      {error && <div className="banner err">{error}</div>}
      {msg && <div className={`banner ${msg.type}`}>{msg.text}</div>}

      <div className="grid cols-3" style={{ marginTop: '.75rem' }}>
        <label className="field"><span>Plan name</span>
          <input type="text" list="plan-names" placeholder="A1" value={form.planName} onChange={setF('planName')} />
          <datalist id="plan-names">
            <option value="A1" /><option value="EV Add On" />
          </datalist>
        </label>
        <label className="field"><span>Financial year (starts July)</span>
          <input type="number" placeholder="2025 → FY2025-26" value={form.fyStartYear} onChange={setF('fyStartYear')} />
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
      <button className="primary" onClick={addEntry} style={{ marginTop: '.5rem' }}>Add band</button>
    </div>
  );
}
