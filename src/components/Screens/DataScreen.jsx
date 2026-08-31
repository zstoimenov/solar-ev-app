// Data - add a month, edit rates, back up.
//
// One home for everything administrative. Previously this was two top-level
// tabs (Ingest, Backup) plus a storage banner that rode above every screen;
// all of it is touched about once a month, so none of it belongs in the
// app's permanent chrome.

import React from 'react';
import IngestWizard from '../IngestWizard.jsx';
import ExportRestore from '../ExportRestore.jsx';
import StorageHealth from '../StorageHealth.jsx';

export default function DataScreen({ state, appMeta, onChange, onIngested }) {
  return (
    <div className="screen">
      <StorageHealth state={state} appMeta={appMeta} onBackup={() => {}} />
      <IngestWizard state={state} onChange={onChange} onIngested={onIngested} />
      <ExportRestore state={state} appMeta={appMeta} onChange={onChange} />
    </div>
  );
}
