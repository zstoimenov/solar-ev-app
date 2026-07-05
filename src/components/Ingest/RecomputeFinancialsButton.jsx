// RecomputeFinancialsButton - explicit, opt-in re-derivation of the tariff/
// charging-log-dependent fields (grid cost, EV charging cost, Layer 1/2
// savings) for EVERY already-stored month, using the CURRENT import tariff
// schedule and charging log. Ingest stays forward-only by default (see
// CLAUDE.md) - this button is how existing months catch up on demand after
// you edit a tariff entry or the charging log, without re-uploading the
// original Fronius/Wattpilot files (everything needed is already stored).

import React, { useState } from 'react';
import { putState } from '../../data/db.js';
import { recomputeCumulative } from '../../data/compute.js';
import { recomputeDigestFinancials } from '../../ingest/recomputeFinancials.js';

export default function RecomputeFinancialsButton({ state, onChange }) {
  const [msg, setMsg] = useState(null);
  const count = state.monthlyDigests.length;

  async function run() {
    if (count === 0) return;
    const ok = window.confirm(
      `Recompute grid cost, EV charging cost, and Layer 1/2 savings for all ${count} ` +
      'stored month(s) using the CURRENT import tariff and charging log? Fronius/' +
      "Wattpilot-sourced fields (energy totals, etc.) aren't touched."
    );
    if (!ok) return;
    const nextDigests = state.monthlyDigests.map((d) => recomputeDigestFinancials(d, state.config, state.chargingLog ?? []));
    const nextCumulative = recomputeCumulative(nextDigests, state.cumulativeTotals, state.config);
    await putState({ ...state, monthlyDigests: nextDigests, cumulativeTotals: nextCumulative });
    onChange?.();
    setMsg({ type: 'ok', text: `Recomputed ${count} month${count === 1 ? '' : 's'} from the current tariff + charging log.` });
  }

  return (
    <div className="field-section">
      <p className="small">
        Ingesting a new month never changes months already stored (see the tariff/log
        pages above) - use this to bring existing months up to date on demand instead.
      </p>
      <button className="ghost" onClick={run} disabled={count === 0}>
        Recompute all {count} existing month{count === 1 ? '' : 's'}
      </button>
      {msg && <div className={`banner ${msg.type}`} style={{ marginTop: '.5rem' }}>{msg.text}</div>}
    </div>
  );
}
