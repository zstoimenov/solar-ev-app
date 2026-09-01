// ExportRestore - the Data screen's "Backup" page: download the whole store
// as one JSON file, restore one back, see whether this browser is allowed to
// delete the data on its own, and (behind a collapsed section) the
// destructive month-delete / reset actions.
//
// A backup is a FILE, not a clipboard copy. The export used to also write
// the JSON to the clipboard, which quietly truncated a real store on
// Android - the paste arrived short, and a short backup is worse than no
// backup because it looks like one. For the same reason there is no
// paste-a-backup restore box any more: both directions are files, so
// nothing can be silently cut in half on the way through.

import React, { useState, useEffect } from 'react';
import { getState, importState, parseBackup, recordExport, resetState, putState, SchemaError } from '../data/db.js';
import { encryptJson, decryptJson, isEncryptedEnvelope } from '../data/crypto.js';
import { recomputeCumulative, recomputeMeta } from '../data/compute.js';
import { getStorageStatus, ensurePersisted, formatBytes, daysSince } from '../data/storage.js';
import Collapsible from './Collapsible.jsx';
import InfoPopover from './InfoPopover.jsx';

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
  const [encryptOn, setEncryptOn] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [pendingEnvelope, setPendingEnvelope] = useState(null);
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [monthToDelete, setMonthToDelete] = useState('');
  const [manageOpen, setManageOpen] = useState(false);

  // First run (App.jsx's empty-store view renders this component on its own):
  // there is nothing to back up or delete yet, so Restore is the only thing
  // on the page rather than the third thing down it.
  const isEmpty = state.monthlyDigests.length === 0;

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
      setMsg({ type: 'err', text: 'Enter a passphrase, or untick "Encrypt this backup".' });
      return;
    }
    const current = await getState();
    const count = current.monthlyDigests.length;

    // Anti-truncation guard: this export would record fewer months than the
    // last one. This is the one path to real data loss - require explicit OK.
    if (lastExportedCount != null && count < lastExportedCount) {
      const ok = window.confirm(
        `WARNING: this backup has ${count} months but your last one had ` +
        `${lastExportedCount}. Saving it could overwrite a fuller backup ` +
        `with a shorter one. Download anyway?`
      );
      if (!ok) { setMsg({ type: 'warn', text: 'Backup cancelled (truncation guard).' }); return; }
    }

    const stamped = {
      ...current,
      meta: { ...current.meta, exportedAt: new Date().toISOString(), monthCount: count }
    };

    const payload = encryptOn ? await encryptJson(stamped, passphrase) : stamped;
    const json = JSON.stringify(payload, null, 2);
    const suffix = encryptOn ? '.encrypted' : '';
    // The export date is in the filename so successive backups sit side by
    // side in Notion instead of overwriting each other.
    const today = new Date().toISOString().slice(0, 10);
    const through = current.meta?.dateRange?.last ?? 'export';
    download(`roi-backup_${through}_saved-${today}${suffix}.json`, json);
    await recordExport(count);
    onChange?.();
    setMsg({
      type: 'ok',
      text: encryptOn
        ? `Downloaded a backup file with ${count} months, encrypted. Keep the passphrase safe - it cannot be recovered.`
        : `Downloaded a backup file with ${count} months. Save it to Notion (or wherever you keep it).`
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
    const text = await file.text();
    e.target.value = ''; // let the same file be chosen again after a failed try
    handleRestore(text);
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
    lastBackupText = 'never';
  }

  return (
    <>
      {msg && <div className={`banner ${msg.type}`}>{msg.text}</div>}

      {!isEmpty && (
      <div className="field-section">
        <h3>
          Back up
          <InfoPopover label="What the backup file contains">
            <p>
              Everything: every month you have ingested, your rates, your charging log
              and your payback settings — the whole store as one JSON file. It is
              produced in this browser and downloaded straight to your device; nothing
              is uploaded anywhere.
            </p>
            <p>
              Tick <em>Encrypt</em> if the file is going somewhere you would rather it
              was unreadable. The passphrase is never stored, so if you lose it the
              file is gone for good.
            </p>
          </InfoPopover>
        </h3>
        <p className="small">
          Your data lives only in this browser. Download the file and keep it somewhere
          else — Notion, Drive, anywhere off this device.
        </p>
        <div className="row">
          <button className="primary" onClick={handleExport}>Download backup file</button>
          <span className="small">Last backup: {lastBackupText}</span>
        </div>
        <label className="field row" style={{ marginTop: '.6rem' }}>
          <input type="checkbox" checked={encryptOn} onChange={(e) => setEncryptOn(e.target.checked)} />
          <span style={{ margin: 0 }}>Encrypt this backup with a passphrase</span>
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
      </div>
      )}

      <div className="field-section">
        <h3>Restore</h3>
        <p className="small">
          Choose a backup file. It replaces everything currently in this browser, after
          a confirmation.
        </p>
        <input type="file" accept="application/json,.json" onChange={onFile} />

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
        <h3>
          This browser&apos;s storage
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
          {storage == null && 'Checking…'}
          {storage?.mode === 'persistent' && 'Protected — this browser will not clear your data to reclaim space.'}
          {storage?.mode === 'best-effort' && (
            <>
              <strong>At risk</strong> — this browser may clear your data when the device
              runs low on space.{' '}
              <button className="ghost" onClick={handleRequestPersist}>Request protection</button>
            </>
          )}
          {storage?.mode === 'unsupported' && 'Unknown — this browser does not report storage persistence.'}
        </p>
        {storage?.usageBytes != null && (
          <p className="small">
            Using {formatBytes(storage.usageBytes)}
            {storage.quotaBytes != null && ` of about ${formatBytes(storage.quotaBytes)}`}.
          </p>
        )}
      </div>

      {/* Destructive and rare: kept out of sight so the two things this page
          is actually for - back up, restore - are the only things on it. */}
      {!isEmpty && (
      <Collapsible
        title="Remove data"
        open={manageOpen}
        onToggle={() => setManageOpen((v) => !v)}
      >
        <p className="small">
          Deleting is permanent — there is no undo beyond a backup file you have
          already downloaded.
        </p>
        {state.monthlyDigests.length > 0 && (
          <div className="field-section">
            <h3>Delete one month</h3>
            <p className="small">
              For a month imported from the wrong files. The running totals are
              recomputed from what is left.
            </p>
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
          </div>
        )}

        <div className="field-section">
          <h3>Delete everything</h3>
          <p className="small">
            Clears all data from this browser, leaving the app as an empty shell — the
            same as a fresh install.
          </p>
          <button className="danger" onClick={handleDelete}>Delete all data</button>
        </div>
      </Collapsible>
      )}
    </>
  );
}
