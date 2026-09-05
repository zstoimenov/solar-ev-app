// VehicleSettingsEditor - sets config.vehicle, the two car figures that let
// the app say what a day's spare solar is worth in the units the car itself
// shows: a percentage of its battery and a distance.
//
// Deliberately GENERIC: no make, no model, no preset list. The app stores two
// numbers the household reads off their own car, so it never has to be right
// about which car that is, and never ships a figure it did not measure.
//
// Both fields are optional and independent. Blank means the app says nothing -
// filling in only the battery size gives a percentage and no kilometres.
//
// Writing this merges ONE config key onto the already-stored state via
// putState; it touches no digest and no stored figure. Nothing here is
// financial - the conversion is a division, done live at render time by
// data/vehicle.js, and never stored.

import React, { useState } from 'react';
import { getState, putState } from '../../data/db.js';
import InfoPopover from '../InfoPopover.jsx';
import { vehicleConfig, formatKm, formatPct, spareAsVehicle } from '../../data/vehicle.js';

// '' is the empty field, which must clear the stored value rather than write
// a 0 - a 0 kWh battery is not "unset", it is a division by zero waiting to
// happen. Anything unparseable is rejected before it reaches the store.
function parseField(text) {
  const s = String(text).trim();
  if (s === '') return { ok: true, value: null };
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, value: null };
  return { ok: true, value: n };
}

const show = (n) => (n == null ? '' : String(n));

export default function VehicleSettingsEditor({ state, onChange }) {
  const stored = state.config?.vehicle ?? null;
  const [battery, setBattery] = useState(show(stored?.batteryKwh));
  const [consumption, setConsumption] = useState(show(stored?.consumptionKwhPer100km));
  const [msg, setMsg] = useState(null);

  const b = parseField(battery);
  const c = parseField(consumption);
  const valid = b.ok && c.ok;
  const dirty = battery !== show(stored?.batteryKwh) || consumption !== show(stored?.consumptionKwhPer100km);

  // A worked example on the numbers being typed, so the effect is visible
  // before saving rather than only on another screen.
  const preview = valid
    ? spareAsVehicle(20, vehicleConfig({
      vehicle: { batteryKwh: b.value, consumptionKwhPer100km: c.value }
    }))
    : null;

  async function save() {
    setMsg(null);
    if (!valid) {
      setMsg({ type: 'warn', text: 'Both figures must be numbers greater than zero, or left blank.' });
      return;
    }
    // Read the real store rather than writing back whatever scoped view this
    // screen was handed - the same discipline as saveForecastLocation().
    const current = await getState();
    const nextConfig = { ...current.config };
    if (b.value == null && c.value == null) {
      delete nextConfig.vehicle;
    } else {
      nextConfig.vehicle = { batteryKwh: b.value, consumptionKwhPer100km: c.value };
    }
    await putState({ ...current, config: nextConfig });
    onChange?.();
    if (b.value == null && c.value == null) {
      setMsg({ type: 'ok', text: 'Cleared. Spare solar is shown in kWh only.' });
    } else {
      setMsg({
        type: 'ok',
        text: 'Saved. Spare solar now also reads as ' +
          [b.value != null && 'a share of the battery', c.value != null && 'a distance']
            .filter(Boolean).join(' and ') + '.'
      });
    }
  }

  return (
    <div className="field-section">
      <h3>
        Your car
        <InfoPopover label="What this does" className="section-info">
          <p>
            The forecast tells you how many kilowatt-hours should go spare for the car on a
            given day. Your car shows a percentage and a range in kilometres, so these two
            figures let the app say the same thing in both languages instead of leaving you
            to do the sum.
          </p>
          <p>
            Nothing here changes a single stored number. It is a division done as the screen
            is drawn: spare kWh divided by your battery size, and by your consumption. Leave
            a field blank and that unit simply is not shown.
          </p>
          <p>
            <strong>Read both as a ceiling.</strong> Spare kWh is measured at the meter, and
            a little of it is lost as heat in the cable, the charger and the pack before it
            becomes charge. The app does not guess how much - that would be inventing a
            number - so the real percentage and range will be slightly under what is shown.
          </p>
        </InfoPopover>
      </h3>
      <p className="small">
        Two figures off your own car, so spare solar can be shown as a share of the battery
        and as kilometres. Leave either blank to leave it out.
      </p>

      <label className="field">
        <span>Battery size (kWh)</span>
        <input
          type="number" inputMode="decimal" step="0.01" min="0"
          placeholder="e.g. 60"
          value={battery}
          onChange={(e) => setBattery(e.target.value)}
        />
      </label>
      {!b.ok && <p className="small warn-text">Battery size must be a number greater than zero, or blank.</p>}

      <label className="field">
        <span>Average consumption (kWh/100 km)</span>
        <input
          type="number" inputMode="decimal" step="0.1" min="0"
          placeholder="e.g. 17.5"
          value={consumption}
          onChange={(e) => setConsumption(e.target.value)}
        />
      </label>
      {!c.ok && <p className="small warn-text">Consumption must be a number greater than zero, or blank.</p>}
      <p className="small">
        Your car&apos;s trip computer usually shows this as kWh/100 km. If it reports Wh/km
        instead, divide by 10 — 175 Wh/km is 17.5 kWh/100 km.
      </p>

      {preview && (
        <p className="small">
          With these, a day with 20 kWh going spare would read as{' '}
          <strong>
            {[preview.pct != null && formatPct(preview.pct), preview.km != null && formatKm(preview.km)]
              .filter(Boolean).join(' · ')}
          </strong>.
        </p>
      )}

      <div className="row" style={{ marginTop: '.5rem' }}>
        <button className="primary" onClick={save} disabled={!dirty}>Save</button>
        {(battery !== '' || consumption !== '') && (
          <button className="ghost" onClick={() => { setBattery(''); setConsumption(''); }}>
            Clear fields
          </button>
        )}
      </div>
      {msg && <div className={`banner ${msg.type}`} style={{ marginTop: '.5rem' }}>{msg.text}</div>}
    </div>
  );
}
