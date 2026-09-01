// Data - add a month, edit rates, back up.
//
// One home for everything administrative. Previously this was two top-level
// tabs (Ingest, Backup) plus a storage banner that rode above every screen;
// all of it is touched about once a month, so none of it belongs in the
// app's permanent chrome.
//
// It is also ONE panel, not two stacked ones: backup is a page in the same
// pill row as the ingest pages. The page in view is owned here so the
// stale-backup banner's "Back up now" can actually open the backup page
// instead of leaving the user to find it.

import React, { useState } from 'react';
import IngestWizard from '../IngestWizard.jsx';
import StorageHealth from '../StorageHealth.jsx';

export default function DataScreen({ state, appMeta, onChange, onIngested }) {
  const [category, setCategory] = useState('upload');

  return (
    <div className="screen">
      <StorageHealth
        state={state}
        appMeta={appMeta}
        onBackup={() => {
          setCategory('backup');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
      <IngestWizard
        state={state}
        appMeta={appMeta}
        category={category}
        onCategoryChange={setCategory}
        onChange={onChange}
        onIngested={onIngested}
      />
    </div>
  );
}
