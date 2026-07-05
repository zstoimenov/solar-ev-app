// HealthBanner - the primary "is my data intact" signal shown on load.
// Month count, date range (first-last), last ingested month. Also raises the
// restore prompt when the store looks empty or shorter than the last export.
// The "all good" state auto-dismisses after a few seconds (and can be closed
// early) so it doesn't sit around taking up space; warnings/errors persist
// since they need the user's attention. Dismissal collapses smoothly (see
// the .closing CSS transition) rather than unmounting outright, so content
// below doesn't jump.

import React, { useEffect, useState } from 'react';

const AUTO_DISMISS_MS = 6000;
const CLOSE_TRANSITION_MS = 350;

export default function HealthBanner({ state, lastExportedCount, onRestore }) {
  const [closing, setClosing] = useState(false);
  const [removed, setRemoved] = useState(false);

  const count = state?.monthlyDigests.length ?? 0;
  const shorterThanExport = lastExportedCount != null && count < lastExportedCount;
  const isOk = count > 0 && !shorterThanExport;

  useEffect(() => {
    if (!isOk) return;
    const t = setTimeout(() => setClosing(true), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [isOk, count]);

  // Collapse smoothly (CSS transition below) instead of unmounting outright,
  // so the content below doesn't jump the instant the banner auto-dismisses.
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => setRemoved(true), CLOSE_TRANSITION_MS);
    return () => clearTimeout(t);
  }, [closing]);

  if (!state || removed) return null;
  const { meta } = state;
  const first = meta?.dateRange?.first ?? '?';
  const last = meta?.dateRange?.last ?? '?';

  if (count === 0) {
    return (
      <div className="banner err compact">
        <span>
          <strong>No months loaded.</strong> Paste a JSON backup to restore.{' '}
          <button className="ghost" onClick={onRestore}>Restore now</button>
        </span>
      </div>
    );
  }

  return (
    <div className={`banner compact ${shorterThanExport ? 'warn' : 'ok'} ${closing ? 'closing' : ''}`}>
      <span>
        <span className="nowrap"><strong>{count}</strong> month{count === 1 ? '' : 's'}</span>
        {' · '}
        <span className="nowrap">{first} → {last}</span>
        {shorterThanExport && (
          <>
            {' — '}<strong className="nowrap">fewer months than last export ({lastExportedCount})</strong>.{' '}
            <button className="ghost" onClick={onRestore}>Restore</button>
          </>
        )}
      </span>
      <button className="banner-close" onClick={() => setClosing(true)} aria-label="Dismiss">✕</button>
    </div>
  );
}
