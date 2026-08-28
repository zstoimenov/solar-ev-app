// CloudBackup - the Backup tab's optional off-device copy: sign in with an
// emailed link, push an encrypted snapshot to Supabase, pull one back on a
// new phone. See data/cloud.js for what the server can and cannot see; the
// short version is that it only ever holds ciphertext this app encrypted
// before upload, and the passphrase never leaves the browser.
//
// Everything here is user-driven. There is no autosave and no background
// sync: the local store stays the source of truth, and an unattended upload
// of a half-restored store is precisely the failure mode the export guards
// elsewhere in this tab exist to prevent.

import React, { useState, useEffect, useCallback } from 'react';
import {
  getUser, onAuthChange, sendSignInLink, completeSignInFromLink, signOut,
  listSnapshots, uploadSnapshot, fetchSnapshot, deleteSnapshot, pruneSnapshots,
  SNAPSHOTS_KEPT
} from '../data/cloud.js';
import { cloudEnabled } from '../data/supabaseConfig.js';
import { encryptJson, decryptJson } from '../data/crypto.js';
import { getState, importState, recordExport, SchemaError } from '../data/db.js';
import { APP_VERSION } from '../version.js';
import InfoPopover from './InfoPopover.jsx';

// Postgres hands back UTC; rendering the raw string would show a Perth user a
// timestamp eight hours out and make a backup they just took look stale.
function formatWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

export default function CloudBackup({ state, onChange }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState('');
  const [linkSent, setLinkSent] = useState(false);
  const [pastedLink, setPastedLink] = useState('');

  const [passphrase, setPassphrase] = useState('');
  const [snapshots, setSnapshots] = useState([]);

  const refreshSnapshots = useCallback(async () => {
    try {
      setSnapshots(await listSnapshots());
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    }
  }, []);

  useEffect(() => {
    if (!cloudEnabled) { setReady(true); return undefined; }
    let live = true;
    (async () => {
      const u = await getUser();
      if (live) { setUser(u); setReady(true); }
    })();
    // Also fires when the emailed link lands back on the app and supabase-js
    // picks the session out of the URL, which is the normal desktop path.
    const off = onAuthChange((u) => { if (live) setUser(u); });
    return () => { live = false; off(); };
  }, []);

  useEffect(() => {
    if (user) refreshSnapshots(); else setSnapshots([]);
  }, [user, refreshSnapshots]);

  async function run(fn) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  const handleSendLink = () => run(async () => {
    if (!email.trim()) throw new Error('Enter the email address to send the sign-in link to.');
    await sendSignInLink(email);
    setLinkSent(true);
    setMsg({
      type: 'ok',
      text: `Sign-in link sent to ${email.trim()}. Open it on this device and come back to this tab, ` +
            `or paste the link below.`
    });
  });

  const handlePastedLink = () => run(async () => {
    await completeSignInFromLink(pastedLink);
    setPastedLink('');
    setLinkSent(false);
    setMsg({ type: 'ok', text: 'Signed in.' });
  });

  const handleSignOut = () => run(async () => {
    await signOut();
    setPassphrase('');
    setMsg({ type: 'ok', text: 'Signed out. Your local data is untouched.' });
  });

  const handleUpload = () => run(async () => {
    if (!passphrase.trim()) throw new Error('Enter a passphrase - cloud backups are always encrypted.');
    const current = await getState();
    const count = current.monthlyDigests.length;
    if (count === 0) throw new Error('There is nothing to back up yet.');

    // Same anti-truncation reasoning as the local export: uploading fewer
    // months than the newest cloud copy is the one path to losing history,
    // so it takes an explicit confirmation. Snapshots are append-only, so
    // this is a warning rather than a destructive overwrite.
    const newest = snapshots[0];
    if (newest?.month_count != null && count < newest.month_count) {
      const ok = window.confirm(
        `WARNING: this backup has ${count} months but your newest cloud backup has ` +
        `${newest.month_count}. Upload anyway?`
      );
      if (!ok) { setMsg({ type: 'warn', text: 'Upload cancelled (truncation guard).' }); return; }
    }

    const stamped = {
      ...current,
      meta: { ...current.meta, exportedAt: new Date().toISOString(), monthCount: count }
    };
    const envelope = await encryptJson(stamped, passphrase);
    await uploadSnapshot(envelope, {
      monthCount: count,
      firstMonth: current.meta?.dateRange?.first ?? null,
      lastMonth: current.meta?.dateRange?.last ?? null,
      appVersion: APP_VERSION
    });
    // A completed upload is a completed backup, so it counts for the
    // stale-backup warning exactly as a downloaded export does.
    await recordExport(count);
    try { await pruneSnapshots(); } catch { /* clutter, not a failed backup */ }
    await refreshSnapshots();
    onChange?.();
    setMsg({
      type: 'ok',
      text: `Backed up ${count} months to the cloud, encrypted. Keep the passphrase safe - it cannot be recovered.`
    });
  });

  const handleRestore = (row) => run(async () => {
    if (!passphrase.trim()) throw new Error('Enter the passphrase this backup was encrypted with.');
    const envelope = await fetchSnapshot(row.id);
    const decrypted = await decryptJson(envelope, passphrase);
    const incoming = Array.isArray(decrypted.monthlyDigests) ? decrypted.monthlyDigests.length : 0;
    const ok = window.confirm(
      `Replace the entire local store with this cloud backup (${incoming} months)? ` +
      `Current data (${state.monthlyDigests.length} months) will be overwritten.`
    );
    if (!ok) { setMsg({ type: 'warn', text: 'Restore cancelled.' }); return; }
    try {
      await importState(decrypted);
    } catch (e) {
      throw e instanceof SchemaError ? e : new Error(`Restore failed: ${e.message}`);
    }
    onChange?.();
    setMsg({ type: 'ok', text: `Restored ${incoming} months from the cloud backup of ${formatWhen(row.created_at)}.` });
  });

  const handleDelete = (row) => run(async () => {
    const ok = window.confirm(`Permanently delete the cloud backup from ${formatWhen(row.created_at)}?`);
    if (!ok) return;
    await deleteSnapshot(row.id);
    await refreshSnapshots();
    setMsg({ type: 'warn', text: 'Cloud backup deleted.' });
  });

  if (!cloudEnabled) {
    return (
      <div className="field-section">
        <h3>Cloud backup</h3>
        <p className="small">Not configured in this build — use the export and restore below instead.</p>
      </div>
    );
  }

  return (
    <div className="field-section">
      <h3>
        Cloud backup
        <InfoPopover label="About cloud backup">
          <p>
            An off-device copy, for the case the local export cannot cover: a lost, wiped
            or replaced phone. Requesting persistent storage stops the browser evicting
            your data on its own, but it does not survive clearing site data,
            uninstalling, or moving to a new phone.
          </p>
          <p>
            The backup is encrypted <em>in this browser</em> before it is uploaded
            (AES-GCM, the same encryption the export checkbox offers). The server stores
            a blob it cannot read — your passphrase never leaves this device, and there
            is no reset if you lose it. The only unencrypted things stored alongside it
            are the month count, the month range and the app version, so the list below
            can be shown before anything is decrypted.
          </p>
          <p>
            Signing in is by emailed link — no password. If the link opens in a different
            browser than the installed app, copy the link out of the email and paste it
            into the box here instead.
          </p>
          <p>
            The most recent {SNAPSHOTS_KEPT} backups are kept; older ones are removed
            automatically after each upload. Nothing uploads on its own — only when you
            press the button.
          </p>
        </InfoPopover>
      </h3>
      <p className="small">
        An encrypted off-device copy, so a lost or replaced phone is recoverable.
      </p>

      {msg && <div className={`banner ${msg.type}`}>{msg.text}</div>}

      {!ready && <p className="small">Checking…</p>}

      {ready && !user && (
        <>
          <label className="field">
            <span>Email address</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
            <span className="hint">We email you a sign-in link — there is no password to set.</span>
          </label>
          <div className="row">
            <button className="primary" disabled={busy || !email.trim()} onClick={handleSendLink}>
              Email me a sign-in link
            </button>
          </div>

          {linkSent && (
            <div style={{ marginTop: '.75rem' }}>
              <label className="field">
                <span>…or paste the link from the email</span>
                <textarea
                  rows={3}
                  value={pastedLink}
                  onChange={(e) => setPastedLink(e.target.value)}
                  placeholder="https://…"
                />
                <span className="hint">
                  Use this if the link opens in a different browser than this app — long-press
                  the "Log In" link in the email and copy it.
                </span>
              </label>
              <button className="ghost" disabled={busy || !pastedLink.trim()} onClick={handlePastedLink}>
                Finish sign-in
              </button>
            </div>
          )}
        </>
      )}

      {ready && user && (
        <>
          <div className="row">
            <span className="small">Signed in as <strong>{user.email}</strong></span>
            <button className="ghost" disabled={busy} onClick={handleSignOut}>Sign out</button>
          </div>

          <label className="field" style={{ marginTop: '.5rem' }}>
            <span>Backup passphrase</span>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Passphrase for encrypting / decrypting"
              autoComplete="off"
            />
            <span className="hint">
              Used to encrypt an upload and to decrypt a restore. Not your account login —
              if it is lost, the cloud backups are unrecoverable.
            </span>
          </label>

          <div className="row">
            <button className="primary" disabled={busy || !passphrase.trim()} onClick={handleUpload}>
              Back up to cloud
            </button>
            <span className="small">
              Uploads all {state.monthlyDigests.length} month
              {state.monthlyDigests.length === 1 ? '' : 's'}, encrypted.
            </span>
          </div>

          <h4 style={{ marginTop: '1rem' }}>Backups in the cloud</h4>
          {snapshots.length === 0 ? (
            <p className="small">None yet.</p>
          ) : (
            <div className="table-scroll">
              <table className="digest table-nowrap">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Months</th>
                    <th>Range</th>
                    <th>App</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((row) => (
                    <tr key={row.id}>
                      <td>{formatWhen(row.created_at)}</td>
                      <td>{row.month_count ?? '—'}</td>
                      <td>{row.first_month ?? '—'} → {row.last_month ?? '—'}</td>
                      <td>{row.app_version ?? '—'}</td>
                      <td>
                        <button className="ghost" disabled={busy} onClick={() => handleRestore(row)}>Restore</button>{' '}
                        <button className="danger" disabled={busy} onClick={() => handleDelete(row)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
