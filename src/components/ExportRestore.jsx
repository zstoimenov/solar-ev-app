// ExportRestore - one-click full-store export (download + copy) with the
// anti-truncation guard, and paste/file restore with validation + confirm.
// Optional passphrase encryption (brief §8) is deferred - a clearly-labelled,
// disabled placeholder is shown so the slot is visible but unwired.

import React, { useState } from 'react';
import { getState, importState, parseBackup, setLastExportedCount, SchemaError } from '../data/db.js';

function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export default function ExportRestore({ state, lastExportedCount, onChange }) {
  const [msg, setMsg] = useState(null);
  const [restoreText, setRestoreText] = useState('');

  async function handleExport() {
    const current = await getState();
    const count = current.monthlyDigests.length;

    // Anti-truncation guard: this export would record fewer months than the
    // last one. This is the one path to real data loss - require explicit OK.
    if (lastExportedCount != null && count < lastExportedCount) {
      const ok = window.confirm(
        `WARNING: this export has ${count} months but your last export had ` +
        `${lastExportedCount}. Exporting now could overwrite a fuller backup ` +
        `with a shorter one. Export anyway?`
      );
      if (!ok) { setMsg({ type: 'warn', text: 'Export cancelled (truncation guard).' }); return; }
    }

    const stamped = {
      ...current,
      meta: { ...current.meta, exportedAt: new Date().toISOString(), monthCount: count }
    };
    const json = JSON.stringify(stamped, null, 2);
    download(`roi-backup_${current.meta?.dateRange?.last ?? 'export'}.json`, json);
    try { await navigator.clipboard.writeText(json); } catch { /* clipboard optional */ }
    await setLastExportedCount(count);
    onChange?.();
    setMsg({ type: 'ok', text: `Exported ${count} months (downloaded + copied to clipboard).` });
  }

  async function handleRestore(text) {
    setMsg(null);
    let parsed;
    try {
      parsed = parseBackup(text);
    } catch (e) {
      setMsg({ type: 'err', text: e.message }); return;
    }
    const incomingCount = Array.isArray(parsed.monthlyDigests) ? parsed.monthlyDigests.length : 0;
    const ok = window.confirm(
      `Replace the entire local store with this backup (${incomingCount} months)? ` +
      `Current data (${state.monthlyDigests.length} months) will be overwritten.`
    );
    if (!ok) return;
    try {
      await importState(parsed);
      onChange?.();
      setMsg({ type: 'ok', text: `Restored ${incomingCount} months.` });
      setRestoreText('');
    } catch (e) {
      const text = e instanceof SchemaError ? e.message : `Import failed: ${e.message}`;
      setMsg({ type: 'err', text });
    }
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    handleRestore(await file.text());
  }

  return (
    <div className="panel">
      <h2>Export / Restore</h2>
      {msg && <div className={`banner ${msg.type}`}>{msg.text}</div>}

      <h3>Export (backup to Notion)</h3>
      <div className="row">
        <button className="primary" onClick={handleExport}>Export JSON</button>
        <span className="small">
          Downloads a pretty JSON file and copies it to the clipboard. Last exported count:{' '}
          {lastExportedCount ?? '—'}.
        </span>
      </div>

      <h3 style={{ marginTop: '1rem' }}>Restore (paste or file)</h3>
      <textarea
        placeholder="Paste a JSON backup here…"
        value={restoreText}
        onChange={(e) => setRestoreText(e.target.value)}
      />
      <div className="row" style={{ marginTop: '.5rem' }}>
        <button className="ghost" disabled={!restoreText.trim()} onClick={() => handleRestore(restoreText)}>
          Restore from pasted JSON
        </button>
        <input type="file" accept="application/json,.json" onChange={onFile} />
      </div>

      <h3 style={{ marginTop: '1rem' }}>Passphrase encryption</h3>
      <label className="field row" style={{ opacity: .6 }}>
        <input type="checkbox" disabled />
        <span style={{ margin: 0 }}>
          Encrypt local store with a passphrase (AES-GCM) — <em>coming soon, deferred</em>.
          If enabled and the passphrase is lost, data is unrecoverable except from a Notion backup.
        </span>
      </label>
    </div>
  );
}
