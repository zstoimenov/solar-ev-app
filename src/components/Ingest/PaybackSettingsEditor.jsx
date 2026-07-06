// PaybackSettingsEditor - sets config.paybackPreTracking.installDate, the
// hardware install date used to backdate Payback Progress to before any
// smart-meter data existed (see CLAUDE.md "Pre-tracking payback estimate").
// Writing this merges ONE config field onto the already-stored state via
// putState - it never touches your ingested months. paybackPreTracking is
// read live by compute.js on every dashboard render, so saving here is
// enough for the Payback Progress tile to update immediately; we also
// recompute the stored cumulativeTotals so an export stays consistent.

import React, { useState } from 'react';
import { putState } from '../../data/db.js';
import { recomputeCumulative } from '../../data/compute.js';
import InfoPopover from '../InfoPopover.jsx';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatMonth(m) {
  if (!m) return '—';
  const [y, mo] = m.split('-').map(Number);
  return `${MONTH_NAMES[mo - 1]} ${y}`;
}
function money(n) {
  return n == null ? '—' : `$${Number(n).toLocaleString('en-AU')}`;
}

export default function PaybackSettingsEditor({ state, onChange }) {
  const stored = state.config?.paybackPreTracking?.installDate ?? '';
  const [installDate, setInstallDate] = useState(stored);
  const [msg, setMsg] = useState(null);

  const firstTracked = state.monthlyDigests?.[0]?.month ?? null;
  const pre = state.cumulativeTotals?.paybackPreTracking; // live result of the last save

  async function save() {
    setMsg(null);
    const nextConfig = { ...state.config };
    if (installDate) {
      nextConfig.paybackPreTracking = { ...state.config?.paybackPreTracking, installDate };
    } else {
      delete nextConfig.paybackPreTracking;
    }
    // Recompute cumulative so the persisted (and exportable) state matches
    // what the dashboard derives live from this config.
    const nextCumulative = recomputeCumulative(state.monthlyDigests, state.cumulativeTotals, nextConfig);
    await putState({ ...state, config: nextConfig, cumulativeTotals: nextCumulative });
    onChange?.();
    const applied = nextCumulative.paybackPreTracking;
    if (!installDate) {
      setMsg({ type: 'ok', text: 'Cleared. Payback Progress now uses tracked data only.' });
    } else if (applied) {
      setMsg({
        type: 'ok',
        text: `Saved. Backdated ${applied.gapMonths} month(s) ` +
          `(${formatMonth(applied.fromMonth)} – ${formatMonth(applied.toMonth)}), ` +
          `an estimated ${money(applied.estimatedAud)} credited to Payback Progress.`
      });
    } else {
      setMsg({
        type: 'warn',
        text: `Saved, but that date is not before your earliest tracked month ` +
          `(${formatMonth(firstTracked)}), so there's no gap to estimate - nothing was backdated.`
      });
    }
  }

  return (
    <div className="field-section">
      <h3>
        Pre-tracking install date
        <InfoPopover label="What this does" className="section-info">
          If a component (e.g. the solar system) was installed before you had any
          smart-meter data at all, there's no Fronius/Wattpilot history to ingest for
          that period. Setting the install date here fills that gap on the Payback
          Progress tile with an estimate: your tracked period's average monthly Layer 1
          saving × the number of months in the gap. It's a rough figure and clearly
          labelled as such - it will overstate the gap if the install date predates your
          battery or EV (their savings get baked into the average). It only affects
          Payback Progress; the ROI Layers tile stays exactly what your real data shows.
        </InfoPopover>
      </h3>
      <p className="small">
        Backdates Payback Progress to a hardware install date that predates your
        smart-meter data. Leave blank for none.
      </p>

      <label className="field">
        <span>Solar / earliest hardware install date</span>
        <input type="date" value={installDate} onChange={(e) => setInstallDate(e.target.value)} />
      </label>

      {stored && (
        <p className="small">
          Currently stored: <strong>{stored}</strong>
          {pre
            ? ` — crediting ${money(pre.estimatedAud)} across ${formatMonth(pre.fromMonth)} – ${formatMonth(pre.toMonth)} (${pre.gapMonths} months).`
            : ' — no gap to estimate (within your tracked range).'}
        </p>
      )}

      <div className="row" style={{ marginTop: '.5rem' }}>
        <button className="primary" onClick={save} disabled={installDate === stored}>Save</button>
        {stored && (
          <button className="ghost" onClick={() => { setInstallDate(''); }}>Clear field</button>
        )}
      </div>
      {msg && <div className={`banner ${msg.type}`} style={{ marginTop: '.5rem' }}>{msg.text}</div>}
    </div>
  );
}
