// HealthBanner - the primary "is my data intact" signal shown on load.
// Month count, date range (first-last), last ingested month. Also raises the
// restore prompt when the store looks empty or shorter than the last export.

import React from 'react';

export default function HealthBanner({ state, lastExportedCount, onRestore }) {
  if (!state) return null;
  const { meta } = state;
  const count = state.monthlyDigests.length;
  const first = meta?.dateRange?.first ?? '?';
  const last = meta?.dateRange?.last ?? '?';

  const shorterThanExport =
    lastExportedCount != null && count < lastExportedCount;

  if (count === 0) {
    return (
      <div className="banner err">
        <strong>No months loaded.</strong> Your store looks empty. Paste a JSON
        backup to restore before doing anything else.{' '}
        <button className="ghost" onClick={onRestore}>Restore now</button>
      </div>
    );
  }

  return (
    <div className={`banner ${shorterThanExport ? 'warn' : 'ok'}`}>
      <strong>{count}</strong> month{count === 1 ? '' : 's'} loaded
      {' · '}range <strong>{first} → {last}</strong>
      {' · '}last ingested <strong>{last}</strong>
      {shorterThanExport && (
        <>
          {' — '}<strong>fewer months than your last export ({lastExportedCount})</strong>.
          Consider restoring from a backup.{' '}
          <button className="ghost" onClick={onRestore}>Restore</button>
        </>
      )}
    </div>
  );
}
