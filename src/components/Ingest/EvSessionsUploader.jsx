// EvSessionsUploader - upload the Wattpilot mobile app's charging-session
// JSON export (distinct from the monthly "Energy balance" XLSX used
// elsewhere). Sessions are merged into the stored log by session ID, so the
// same export (or a newer one covering more history) can be re-uploaded
// without duplicating entries. See data/evTimeOfUseSplit.js for how this
// feeds the Dashboard's Plan Comparison tile.

import React, { useState } from 'react';
import { parseWattpilotSessions } from '../../ingest/parseWattpilotSessions.js';
import { putState } from '../../data/db.js';
import InfoPopover from '../InfoPopover.jsx';

export default function EvSessionsUploader({ state, onChange }) {
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [pasteText, setPasteText] = useState('');

  const sessions = state.evChargingSessions ?? [];
  const sorted = [...sessions].sort((a, b) => b.start.localeCompare(a.start));

  async function mergeIncoming(json) {
    const incoming = parseWattpilotSessions(json);
    if (incoming.length === 0) {
      setError('No usable sessions found there (expected the Wattpilot app\'s charging-session JSON export).');
      return;
    }
    const existingIds = new Set(sessions.map((s) => s.sessionId));
    const merged = [...sessions];
    let added = 0;
    for (const s of incoming) {
      if (!existingIds.has(s.sessionId)) {
        merged.push(s);
        existingIds.add(s.sessionId);
        added += 1;
      }
    }
    await putState({ ...state, evChargingSessions: merged });
    onChange?.();
    setMsg({
      type: 'ok',
      text: `${added} new session${added === 1 ? '' : 's'} added (${incoming.length - added} already stored). ` +
        `${merged.length} total.`
    });
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    setError(null); setMsg(null);
    try {
      await mergeIncoming(JSON.parse(await file.text()));
    } catch (e) {
      setError(`Couldn't read that file: ${e.message}`);
    }
  }

  async function onPaste() {
    setError(null); setMsg(null);
    try {
      await mergeIncoming(JSON.parse(pasteText));
      setPasteText('');
    } catch (e) {
      setError(e instanceof SyntaxError ? 'That doesn\'t look like valid JSON.' : `Couldn't read that: ${e.message}`);
    }
  }

  async function clearAll() {
    const ok = window.confirm(`Permanently delete all ${sessions.length} stored charging sessions? This cannot be undone.`);
    if (!ok) return;
    await putState({ ...state, evChargingSessions: [] });
    onChange?.();
    setMsg({ type: 'warn', text: 'All charging sessions cleared.' });
  }

  return (
    <div className="field-section">
      <h3>EV charging sessions (time-of-day)</h3>
      <p className="small">
        The Wattpilot <strong>mobile app's</strong> charging-session export (JSON) - has
        real timestamps per session, feeding the Dashboard's Plan Comparison tile.{' '}
        <InfoPopover label="Why this is different from the Energy Balance file">
          Unlike the monthly Energy Balance XLSX (one row per day), this export has a
          start/end time per charging session, so it can tell us <em>when</em> your EV
          charged, not just how much. Re-uploading is safe - sessions are matched by ID,
          so only new ones are added.
        </InfoPopover>
      </p>
      <div className="row">
        <input type="file" accept="application/json,.json" onChange={onFile} />
        {sessions.length > 0 && (
          <button className="danger" onClick={clearAll}>Clear all ({sessions.length})</button>
        )}
      </div>

      <label className="field" style={{ marginTop: '.75rem' }}>
        <span>…or paste the JSON directly</span>
        <textarea
          placeholder="Paste the Wattpilot app's charging-session JSON export here…"
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
        />
      </label>
      <button className="ghost" disabled={!pasteText.trim()} onClick={onPaste}>Add from pasted JSON</button>

      {error && <div className="banner err">{error}</div>}
      {msg && <div className={`banner ${msg.type}`}>{msg.text}</div>}

      {sorted.length > 0 ? (
        <div className="table-scroll" style={{ marginTop: '.75rem' }}>
          <table className="digest table-nowrap">
            <thead><tr><th>Start</th><th>End</th><th>Energy (kWh)</th></tr></thead>
            <tbody>
              {sorted.slice(0, 20).map((s) => (
                <tr key={s.sessionId}>
                  <td className="nowrap">{s.start}</td>
                  <td className="nowrap">{s.end}</td>
                  <td>{s.energyKwh}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sorted.length > 20 && <p className="small">…and {sorted.length - 20} more (showing the most recent 20).</p>}
        </div>
      ) : (
        <p className="small">No sessions uploaded yet.</p>
      )}
    </div>
  );
}
