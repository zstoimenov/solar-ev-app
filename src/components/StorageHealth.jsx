// StorageHealth - warns when the browser is in a state where it could delete
// the local store, and when the store has drifted from the last backup.
// Renders nothing when both are fine, so the normal case stays silent.
//
// The persistence request fires automatically on mount: Chrome grants or
// refuses it silently from engagement heuristics with no prompt, so there is
// nothing to ask the user first. Only the REFUSAL is surfaced, together with
// the one action that reliably flips it - installing the PWA.

import React, { useEffect, useState } from 'react';
import { ensurePersisted, backupStaleness, cloudStaleness } from '../data/storage.js';

export default function StorageHealth({ state, appMeta, cloudMeta, onBackup, onCloudBackup }) {
  const [mode, setMode] = useState(null); // null while the check is in flight
  const [installEvent, setInstallEvent] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const result = await ensurePersisted();
      if (live) setMode(result);
    })();
    return () => { live = false; };
  }, []);

  // Chrome fires beforeinstallprompt only when the PWA is installable and not
  // already installed, so capturing it doubles as "an install is still
  // available to offer". Preventing the default defers Chrome's own mini
  // infobar so the prompt is shown from our button instead.
  useEffect(() => {
    const onBeforeInstall = (e) => { e.preventDefault(); setInstallEvent(e); };
    const onInstalled = () => setInstallEvent(null);
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function handleInstall() {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
    // An install usually satisfies Chrome's heuristic, so re-ask immediately
    // rather than waiting for the next load.
    setMode(await ensurePersisted());
  }

  async function handleRetry() {
    setMode(await ensurePersisted());
  }

  const stale = backupStaleness({
    monthCount: state?.monthlyDigests.length ?? 0,
    lastExportedCount: appMeta?.lastExportedCount,
    lastExportedAt: appMeta?.lastExportedAt
  });

  // Only ever shown once cloud backup is switched on: an unused feature is
  // not something to nag about. Separate from `stale` above because the two
  // are different backups with different fixes.
  const cloudStale = onCloudBackup
    ? cloudStaleness({
        enabled: Boolean(state?.config?.cloud?.enabled),
        monthCount: state?.monthlyDigests.length ?? 0,
        lastPushedCount: cloudMeta?.lastPushedCount,
        lastPushedAt: cloudMeta?.lastPushedAt
      })
    : null;

  const atRisk = mode === 'best-effort' && !dismissed;
  if (!atRisk && !stale && !cloudStale) return null;

  return (
    <>
      {atRisk && (
        <div className="banner warn compact">
          <span>
            <strong>This browser can delete your data.</strong> Storage is in best-effort
            mode, so Android can clear it when the device runs low on space.{' '}
            {installEvent
              ? 'Installing the app to your home screen usually fixes this.'
              : 'Installing the app to your home screen (browser menu → “Install app”) usually fixes this.'}
            {' '}
            {installEvent && (
              <button className="ghost" onClick={handleInstall}>Install app</button>
            )}
            {' '}
            <button className="ghost" onClick={handleRetry}>Re-check</button>
          </span>
          <button className="banner-close" onClick={() => setDismissed(true)} aria-label="Dismiss">✕</button>
        </div>
      )}

      {stale && (
        <div className={`banner ${stale.level} compact`}>
          <span>
            <strong>Backup out of date.</strong> {stale.text}{' '}
            <button className="ghost" onClick={onBackup}>Back up now</button>
          </span>
        </div>
      )}

      {cloudStale && (
        <div className={`banner ${cloudStale.level} compact`}>
          <span>
            <strong>Cloud backup out of date.</strong> {cloudStale.text}{' '}
            <button className="ghost" onClick={onCloudBackup}>Open cloud backup</button>
          </span>
        </div>
      )}
    </>
  );
}
