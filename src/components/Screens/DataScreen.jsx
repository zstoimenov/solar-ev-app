// Data - add a month, edit rates, back up.
//
// One home for everything administrative. Previously this was two top-level
// tabs (Ingest, Backup) plus a storage banner that rode above every screen;
// all of it is touched about once a month, so none of it belongs in the
// app's permanent chrome.
//
// It is also ONE panel, not two stacked ones: backup is a page in the same
// index as the ingest pages. The page in view is owned here so the
// stale-backup banner's "Back up now" can actually open the backup page
// instead of leaving the user to find it.
//
// `null` is the index of every page; anything else is one page in view. It
// opens on the index rather than on the monthly upload, because "which of
// these did I come here to do" is the question this screen is actually asked.

import React, { useState } from 'react';
import IngestWizard from '../IngestWizard.jsx';
import StorageHealth from '../StorageHealth.jsx';

export default function DataScreen({ state, appMeta, onChange, onIngested }) {
  const [page, setPage] = useState(null);

  return (
    <div className="screen">
      <StorageHealth
        state={state}
        appMeta={appMeta}
        onBackup={() => {
          setPage('backup');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
      <IngestWizard
        state={state}
        appMeta={appMeta}
        page={page}
        onPageChange={(next) => {
          setPage(next);
          // Coming back to the index, or into a page, should start at the top:
          // a long page left half-scrolled makes the next one look empty.
          window.scrollTo({ top: 0 });
        }}
        onChange={onChange}
        onIngested={onIngested}
      />
    </div>
  );
}
