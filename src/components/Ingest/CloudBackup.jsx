// CloudBackup - the Data screen's page for the optional encrypted cloud
// backup. Off until switched on; once on, it does two things and says
// honestly what each one costs.
//
// The page is deliberately blunt about three facts, none of them behind the
// InfoPopover, because getting them wrong is what loses data:
//   1. The passphrase cannot be recovered. Lose it and the cloud copy is
//      unreadable, by anyone, including whoever runs the database.
//   2. This is a SECOND backup, not a replacement for the file export. A free
//      Supabase project pauses after a week idle and is deleted after 90 days
//      paused, so it must never be the only copy.
//   3. Restoring replaces the whole local store, exactly as a file restore
//      does.

import React, { useCallback, useEffect, useState } from 'react';
import {
  cloudConfig, saveCloudEnabled,
  signInWithPassword, signOut, currentUser,
  pushPreflight, pushSnapshot, listSnapshots, pullSnapshot, deleteSnapshot
} from '../../data/cloud.js';
import InfoPopover from '../InfoPopover.jsx';

function formatWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-AU', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

export default function CloudBackup({ state, cloudMeta, onChange }) {
  const enabled = Boolean(cloudConfig(state?.config));

  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [snapshots, setSnapshots] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const refreshSnapshots = useCallback(async () => {
    try {
      setSnapshots(await listSnapshots());
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    }
  }, []);

  // Only ever runs once the feature is on, so a household that never enables
  // it makes no request to Supabase at all.
  useEffect(() => {
    let live = true;
    if (!enabled) { setChecking(false); setUser(null); return undefined; }
    (async () => {
      const u = await currentUser();
      if (!live) return;
      setUser(u);
      setChecking(false);
      if (u) refreshSnapshots();
    })();
    return () => { live = false; };
  }, [enabled, refreshSnapshots]);

  async function run(fn) {
    setBusy(true);
    setMsg(null);
    try { await fn(); } catch (e) { setMsg({ type: 'err', text: e.message }); } finally { setBusy(false); }
  }

  async function handleEnable() {
    await run(async () => {
      await saveCloudEnabled(true);
      onChange?.();
    });
  }

  async function handleDisable() {
    const ok = window.confirm(
      'Turn cloud backup off? Snapshots already uploaded stay in your Supabase ' +
      'project - this only stops this device using it.'
    );
    if (!ok) return;
    await run(async () => {
      await signOut();
      await saveCloudEnabled(false);
      setUser(null);
      setSnapshots([]);
      setPassword('');
      onChange?.();
    });
  }

  async function handleSignIn() {
    await run(async () => {
      const u = await signInWithPassword(email, password);
      setUser(u);
      // Held only long enough to sign in. The session that follows is what
      // persists; there is no reason to keep the password in component state.
      setPassword('');
      await refreshSnapshots();
      setMsg({ type: 'ok', text: 'Signed in.' });
    });
  }

  async function handleSignOut() {
    await run(async () => {
      await signOut();
      setUser(null);
      setSnapshots([]);
      setPassword('');
      setMsg({ type: 'ok', text: 'Signed out on this device.' });
    });
  }

  async function handlePush() {
    // The truncation guard, the same one the file export has: a backup with
    // fewer months than the last one is the one path to real data loss, so it
    // needs an explicit yes rather than a silent overwrite of the record.
    const pre = await pushPreflight();
    let force = false;
    if (pre.wouldTruncate) {
      force = window.confirm(
        `WARNING: this snapshot has ${pre.count} months but your last cloud ` +
        `backup had ${pre.lastPushedCount}. Upload anyway?`
      );
      if (!force) { setMsg({ type: 'warn', text: 'Cloud backup cancelled (truncation guard).' }); return; }
    }
    await run(async () => {
      const res = await pushSnapshot({ passphrase, force });
      await refreshSnapshots();
      onChange?.();
      setMsg({
        type: 'ok',
        text: `Backed up ${res.count} months, encrypted. Keep the passphrase safe - ` +
          'it cannot be recovered.'
      });
    });
  }

  async function handleRestore(row) {
    const ok = window.confirm(
      `Replace the entire local store with this backup (${row.month_count ?? '?'} months, ` +
      `saved ${formatWhen(row.created_at)})? Current data ` +
      `(${state.monthlyDigests.length} months) will be overwritten.`
    );
    if (!ok) return;
    await run(async () => {
      await pullSnapshot(row.id, passphrase);
      onChange?.();
      setMsg({ type: 'ok', text: 'Restored from the cloud backup.' });
    });
  }

  async function handleDelete(row) {
    const ok = window.confirm(`Permanently delete the backup saved ${formatWhen(row.created_at)}?`);
    if (!ok) return;
    await run(async () => {
      await deleteSnapshot(row.id);
      await refreshSnapshots();
      setMsg({ type: 'ok', text: 'Backup deleted.' });
    });
  }

  const info = (
    <InfoPopover label="How this works" className="section-info">
      Your whole store is encrypted on this device with AES-GCM, using a key derived
      from the passphrase you type, and only the resulting ciphertext is uploaded.
      Supabase holds bytes it cannot read, and the passphrase is never stored or sent.
      Access is gated by a Supabase account sign-in, and row-level security means the
      project&apos;s public key on its own can read nothing.
      Four small details are stored readable so this list is usable without decrypting
      everything: how many months a snapshot holds, its first and last month, and the
      app version. No energy or dollar figure, and no location.
      Snapshots are append-only - a new backup never overwrites an old one.
    </InfoPopover>
  );

  if (!enabled) {
    return (
      <div className="field-section">
        <h3>Cloud backup{info}</h3>
        <p className="small">
          Off. Turning it on lets you keep an encrypted copy of your data outside this
          phone, so an evicted or lost browser store is recoverable.
        </p>
        <p className="small">
          <strong>What leaves the device:</strong> your data, encrypted with a passphrase
          only you know, plus the month count and date range in readable form. Nothing is
          sent until you sign in and press Back up.
        </p>
        <div className="row" style={{ marginTop: '.5rem' }}>
          <button className="primary" onClick={handleEnable} disabled={busy}>
            Turn on cloud backup
          </button>
        </div>
        {msg && <div className={`banner ${msg.type}`} style={{ marginTop: '.5rem' }}>{msg.text}</div>}
      </div>
    );
  }

  return (
    <div className="field-section">
      <h3>Cloud backup{info}</h3>
      <p className="small">
        An encrypted second copy of your data, kept off this device. It does not replace
        the file backup: a free Supabase project pauses after a week unused and is
        deleted after 90 days paused, so keep exporting files as well.
      </p>

      {checking && <p className="small">Checking sign-in…</p>}

      {!checking && !user && (
        <>
          <p className="small">
            The account is created once in the Supabase dashboard, not from here -
            this app deliberately cannot register new accounts. Signing in is
            needed once per device; after that the session persists.
          </p>
          <label className="field">
            <span>Account email</span>
            <input
              type="email" value={email} autoComplete="username"
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label className="field">
            <span>Account password</span>
            <input
              type="password" value={password} autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && email.trim() && password) handleSignIn(); }}
            />
          </label>
          <p className="small">
            This is the Supabase account password, and it is <strong>not</strong> the
            passphrase that encrypts your backup. They are two different secrets on
            purpose: this one only proves who you are, and can be reset from the
            dashboard; the passphrase is what makes the data unreadable, and cannot.
          </p>
          <div className="row" style={{ marginTop: '.5rem' }}>
            <button
              className="primary" onClick={handleSignIn}
              disabled={busy || !email.trim() || !password}
            >Sign in</button>
            <button className="ghost" onClick={handleDisable} disabled={busy}>Turn off</button>
          </div>
        </>
      )}

      {!checking && user && (
        <>
          <p className="small">
            Signed in as <strong>{user.email}</strong>.{' '}
            <button className="ghost" onClick={handleSignOut} disabled={busy}>Sign out</button>
          </p>

          <label className="field">
            <span>Passphrase</span>
            <input
              type="password" value={passphrase} autoComplete="off"
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Used to encrypt and to restore"
            />
          </label>
          <p className="small">
            <strong>This cannot be recovered.</strong> Lose it and the cloud copy is
            unreadable. Use the same passphrase every time, or you will need to remember
            which one goes with which snapshot.
          </p>

          <div className="row" style={{ marginTop: '.5rem' }}>
            <button className="primary" onClick={handlePush} disabled={busy || !passphrase.trim()}>
              Back up now
            </button>
            <button className="ghost" onClick={refreshSnapshots} disabled={busy}>Refresh list</button>
            <button className="ghost" onClick={handleDisable} disabled={busy}>Turn off</button>
          </div>

          <p className="small" style={{ marginTop: '.5rem' }}>
            Last cloud backup: <strong>{formatWhen(cloudMeta?.lastPushedAt)}</strong>
            {cloudMeta?.lastPushedCount != null && ` (${cloudMeta.lastPushedCount} months)`}
          </p>

          <h4>Snapshots</h4>
          {snapshots.length === 0 && <p className="small">Nothing backed up yet.</p>}
          {snapshots.length > 0 && (
            <div className="table-scroll">
              <table className="digest table-nowrap">
                <thead>
                  <tr>
                    <th>Saved</th><th>Months</th><th>Range</th><th>App</th><th />
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((row) => (
                    <tr key={row.id}>
                      <td>{formatWhen(row.created_at)}</td>
                      <td>{row.month_count ?? '—'}</td>
                      <td>{row.first_month ?? '—'} – {row.last_month ?? '—'}</td>
                      <td>{row.app_version ?? '—'}</td>
                      <td>
                        <button
                          className="ghost" disabled={busy || !passphrase.trim()}
                          onClick={() => handleRestore(row)}
                        >Restore</button>{' '}
                        <button className="ghost" disabled={busy} onClick={() => handleDelete(row)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {msg && <div className={`banner ${msg.type}`} style={{ marginTop: '.5rem' }}>{msg.text}</div>}
    </div>
  );
}
