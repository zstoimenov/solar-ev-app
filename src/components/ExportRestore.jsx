// ExportRestore - one-click full-store export (download + copy) with the
// anti-truncation guard, paste/file restore with validation + confirm,
// optional passphrase encryption (AES-GCM via data/crypto.js), a device
// storage-durability readout, the optional encrypted cloud backup
// (CloudBackup.jsx), and a destructive "delete all data" reset.

import React, { useState, useEffect, Suspense, lazy } from 'react';
import { getState, importState, parseBackup, recordExport, resetState, putState, SchemaError } from '../data/db.js';
import { encryptJson, decryptJson, isEncryptedEnvelope } from '../data/crypto.js';
import { recomputeCumulative, recomputeMeta } from '../data/compute.js';
import { getStorageStatus, ensurePersisted, formatBytes, daysSince } from '../data/storage.js';
import InfoPopover from './InfoPopover.jsx';

// Lazily loaded: CloudBackup pulls in the Supabase client, which is ~230 KB
// of the bundle on its own. Statically imported it would be paid on every
// cold start of the app, including the offline dashboard-only visits that
// are the common case, for a feature reached only by opening this tab.
const CloudBackup = lazy(() => import('./CloudBackup.jsx'));

function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export default function ExportRestore({ state, appMeta, onChange }) {
  const lastExportedCount = appMeta?.lastExportedCount ?? null;
  const lastExportedAt = appMeta?.lastExportedAt ?? null;
  const [storage, setStorage] = useState(null);
  const [msg, setMsg] = useState(null);
  const [restoreText, setRestoreText] = useState('');
  const [encryptOn, setEncryptOn] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [pendingEnvelope, setPendingEnvelope] = useState(null);
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [monthToDelete, setMonthToDelete] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      const s = await getStorageStatus();
      if (live) setStorage(s);
    })();
    return () => { live = false; };
  }, []);

  // Re-asks for the persistent bucket on an explicit user gesture. Chrome
  // decides from its own heuristics either way, so this can legitimately be
  // refused twice - the message says what actually shifts the heuristic
  // rather than inviting the user to keep clicking.
  async function handleRequestPersist() {
    const mode = await ensurePersisted();
    setStorage(await getStorageStatus());
    setMsg(mode === 'persistent'
      ? { type: 'ok', text: 'Storage is now persistent — the browser will not clear this data to reclaim space.' }
      : { type: 'warn', text: 'The browser declined persistent storage. Install the app to your home screen (browser menu → "Install app"), then try again.' });
  }

  async function handleExport() {
    if (encryptOn && !passphrase.trim()) {
      setMsg({ type: 'err', text: 'Enter a passphrase, or untick "Encrypt this export".' });
      return;
    }
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

    const payload = encryptOn ? await encryptJson(stamped, passphrase) : stamped;
    const json = JSON.stringify(payload, null, 2);
    const suffix = encryptOn ? '.encrypted' : '';
    download(`roi-backup_${current.meta?.dateRange?.last ?? 'export'}${suffix}.json`, json);
    try { await navigator.clipboard.writeText(json); } catch { /* clipboard optional */ }
    await recordExport(count);
    onChange?.();
    setMsg({
      type: 'ok',
      text: encryptOn
        ? `Exported ${count} months, encrypted (downloaded + copied to clipboard). Keep the passphrase safe - it cannot be recovered.`
        : `Exported ${count} months (downloaded + copied to clipboard).`
    });
  }

  async function commitImport(parsed) {
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
      setPendingEnvelope(null);
      setRestorePassphrase('');
    } catch (e) {
      const text = e instanceof SchemaError ? e.message : `Import failed: ${e.message}`;
      setMsg({ type: 'err', text });
    }
  }

  async function handleRestore(text) {
    setMsg(null);
    setPendingEnvelope(null);
    let parsed;
    try {
      parsed = parseBackup(text);
    } catch (e) {
      setMsg({ type: 'err', text: e.message }); return;
    }
    if (isEncryptedEnvelope(parsed)) {
      setPendingEnvelope(parsed);
      setMsg({ type: 'warn', text: 'This backup is passphrase-encrypted. Enter the passphrase below, then click "Decrypt & restore".' });
      return;
    }
    await commitImport(parsed);
  }

  async function handleDecryptAndRestore() {
    if (!pendingEnvelope) return;
    try {
      const decrypted = await decryptJson(pendingEnvelope, restorePassphrase);
      await commitImport(decrypted);
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    }
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    handleRestore(await file.text());
  }

  async function handleDelete() {
    const count = state.monthlyDigests.length;
    const ok = window.confirm(
      `This will PERMANENTLY DELETE all ${count} month${count === 1 ? '' : 's'} from this ` +
      `browser's local storage. This cannot be undone unless you have a separate backup. ` +
      `Continue?`
    );
    if (!ok) return;
    await resetState();
    onChange?.();
    setMsg({ type: 'warn', text: 'All local data has been deleted. The app is now empty.' });
  }

  // Removes one previously-ingested month and recomputes cumulative totals +
  // meta from what remains - any month can be removed, not just the latest,
  // since coverage/energy/financial totals are all re-derived from the
  // digest array rather than assuming adjacency. cumulativeTotals.payback is
  // config-driven (not digest-derived), so it's untouched by this.
  async function handleDeleteMonth() {
    if (!monthToDelete) return;
    const ok = window.confirm(
      `Permanently delete the imported data for ${monthToDelete}? This cannot be undone ` +
      `unless you have a separate backup.`
    );
    if (!ok) return;
    const nextDigests = state.monthlyDigests.filter((d) => d.month !== monthToDelete);
    const nextCumulative = recomputeCumulative(nextDigests, state.cumulativeTotals, state.config);
    const nextMeta = recomputeMeta(state.meta, nextDigests);
    await putState({ ...state, meta: nextMeta, monthlyDigests: nextDigests, cumulativeTotals: nextCumulative });
    onChange?.();
    setMsg({
      type: 'warn',
      text: `Deleted ${monthToDelete}. ${nextDigests.length} month${nextDigests.length === 1 ? '' : 's'} remain.`
    });
    setMonthToDelete('');
  }

  // A store written before `lastExportedAt` was tracked still has a count, so
  // the two are reported independently rather than treating a missing date as
  // "never backed up".
  const backupAgeDays = daysSince(lastExportedAt);
  let lastBackupText;
  if (lastExportedAt) {
    const ago = backupAgeDays === 0 ? 'today' : `${backupAgeDays} day${backupAgeDays === 1 ? '' : 's'} ago`;
    lastBackupText = `${lastExportedAt.slice(0, 10)} (${ago}) · ${lastExportedCount} month${lastExportedCount === 1 ? '' : 's'}`;
  } else if (lastExportedCount != null) {
    lastBackupText = `${lastExportedCount} month${lastExportedCount === 1 ? '' : 's'} (date not recorded)`;
  } else {
    lastBackupText = 'Never exported from this browser';
  }

  return (
    <div className="panel">
      <h2>Export / Restore</h2>
      {msg && <div className={`banner ${msg.type}`}>{msg.text}</div>}

      <div className="field-section">
        <h3>
          Device storage
          <InfoPopover label="About device storage">
            <p>
              This app stores everything in this browser's IndexedDB. By default that
              sits in the browser's <em>best-effort</em> bucket, which Android may clear
              when the device runs low on space — silently, with no warning and no error.
              That is the most common way a populated app comes back empty.
            </p>
            <p>
              Requesting <em>persistent</em> storage moves the data out of that automatic
              eviction path. Chrome grants it from engagement heuristics, and the
              strongest signal by far is the app being installed to the home screen.
            </p>
            <p>
              Persistent storage still does not survive you clearing the browser's site
              data, uninstalling the app, or switching to a different phone or browser —
              so it reduces how often you need a backup, it never replaces one.
            </p>
          </InfoPopover>
        </h3>
        <p className="small">
          Whether this browser is allowed to clear your data on its own.
        </p>
        <table className="digest">
            <tbody>
              <tr>
                <th>Eviction protection</th>
                <td>
                  {storage == null && 'Checking…'}
                  {storage?.mode === 'persistent' && 'Protected — will not be cleared automatically'}
                  {storage?.mode === 'best-effort' && (
                    <>
                      <strong>At risk</strong> — may be cleared when storage runs low{' '}
                      <button className="ghost" onClick={handleRequestPersist}>Request protection</button>
                    </>
                  )}
                  {storage?.mode === 'unsupported' && 'Unknown — this browser does not report storage persistence'}
                </td>
              </tr>
              <tr>
                <th>Data stored</th>
                <td>
                  {formatBytes(storage?.usageBytes)}
                  {storage?.quotaBytes != null && ` of ~${formatBytes(storage.quotaBytes)} available`}
                </td>
              </tr>
              <tr>
                <th>Last backup</th>
                <td>{lastBackupText}</td>
              </tr>
            </tbody>
        </table>
      </div>

      <div className="field-section">
        <h3>Export (backup to Notion)</h3>
        <label className="field row">
          <input type="checkbox" checked={encryptOn} onChange={(e) => setEncryptOn(e.target.checked)} />
          <span style={{ margin: 0 }}>Encrypt this export with a passphrase (AES-GCM)</span>
        </label>
        {encryptOn && (
          <label className="field">
            <span>Passphrase</span>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Choose a passphrase"
            />
            <span className="hint">
              If this is lost, the encrypted backup is unrecoverable - there is no reset.
            </span>
          </label>
        )}
        <div className="row" style={{ marginTop: '.5rem' }}>
          <button className="primary" onClick={handleExport}>Export JSON</button>
          <span className="small">
            Downloads a pretty JSON file and copies it to the clipboard. Last exported count:{' '}
            {lastExportedCount ?? '—'}.
          </span>
        </div>
      </div>

      <Suspense fallback={<div className="field-section"><h3>Cloud backup</h3><p className="small">Loading…</p></div>}>
        <CloudBackup state={state} onChange={onChange} />
      </Suspense>

      <div className="field-section">
        <h3>Restore (paste or file)</h3>
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

        {pendingEnvelope && (
          <div className="row" style={{ marginTop: '.5rem' }}>
            <input
              type="password"
              value={restorePassphrase}
              onChange={(e) => setRestorePassphrase(e.target.value)}
              placeholder="Passphrase for this backup"
            />
            <button className="primary" disabled={!restorePassphrase} onClick={handleDecryptAndRestore}>
              Decrypt &amp; restore
            </button>
          </div>
        )}
      </div>

      <div className="field-section">
        <h3>Delete a specific month</h3>
        <p className="small">
          Removes just one previously-imported month (e.g. you re-ingested June under the
          wrong data) and recomputes the running totals from what's left. Export a backup
          first if you're not sure.
        </p>
        {state.monthlyDigests.length > 0 ? (
          <div className="row">
            <select value={monthToDelete} onChange={(e) => setMonthToDelete(e.target.value)}>
              <option value="">Choose a month…</option>
              {[...state.monthlyDigests].reverse().map((d) => (
                <option key={d.month} value={d.month}>{d.month}</option>
              ))}
            </select>
            <button className="danger" disabled={!monthToDelete} onClick={handleDeleteMonth}>
              Delete month
            </button>
          </div>
        ) : (
          <p className="small">No months loaded yet.</p>
        )}
      </div>

      <div className="field-section">
        <h3>Danger zone</h3>
        <p className="small">
          Permanently clears all data from this browser, leaving the app as an empty shell
          (same as a fresh install). Export a backup first if you want to keep it.
        </p>
        <button className="danger" onClick={handleDelete}>Delete all data</button>
      </div>
    </div>
  );
}
