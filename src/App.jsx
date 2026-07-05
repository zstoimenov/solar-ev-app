import React, { useEffect, useState, useCallback } from 'react';
import { loadOrSeed } from './data/seed.js';
import { getState, getAppMeta } from './data/db.js';
import HealthBanner from './components/HealthBanner.jsx';
import DataNotes from './components/DataNotes.jsx';
import RoiLayers from './components/Dashboard/RoiLayers.jsx';
import PaybackProgress from './components/Dashboard/PaybackProgress.jsx';
import EnergyTrends from './components/Dashboard/EnergyTrends.jsx';
import EvChargingSplit from './components/Dashboard/EvChargingSplit.jsx';
import IngestWizard from './components/IngestWizard.jsx';
import ExportRestore from './components/ExportRestore.jsx';

const TABS = ['Dashboard', 'Ingest', 'Backup'];

export default function App() {
  const [state, setState] = useState(null);
  const [appMeta, setAppMeta] = useState({ lastExportedCount: null });
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState('Dashboard');

  const refresh = useCallback(async () => {
    const [s, m] = await Promise.all([getState(), getAppMeta()]);
    setState(s);
    setAppMeta(m);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await loadOrSeed();
        await refresh();
      } catch (e) {
        setLoadError(e.message);
      }
    })();
  }, [refresh]);

  if (loadError) {
    return (
      <div className="app">
        <div className="banner err"><strong>Load failed:</strong> {loadError}</div>
      </div>
    );
  }
  if (!state) return <div className="app"><p>Loading…</p></div>;

  const isEmpty = state.monthlyDigests.length === 0;

  // First-run / empty store: the public bundle ships an EMPTY starter (no
  // personal data). Prompt the user to restore their private backup before
  // anything else, and do not attempt to render dashboards against no data.
  if (isEmpty) {
    return (
      <div className="app">
        <header className="top">
          <h1>☀️ Solar, Battery &amp; EV ROI</h1>
          <span className="sub">Local-only · IndexedDB · schemaVersion {state.schemaVersion}</span>
        </header>
        <div className="banner warn">
          <strong>No data yet.</strong> This public build ships empty and contains no
          personal data. Paste your private JSON backup below to load your dataset —
          it is then stored only in this browser (IndexedDB) and never uploaded.
        </div>
        <ExportRestore state={state} lastExportedCount={appMeta.lastExportedCount} onChange={refresh} />
        <footer className="small" style={{ marginTop: '2rem' }}>
          No backend · no network data calls · backup by exporting JSON to Notion.
        </footer>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="top">
        <h1>☀️ Solar, Battery &amp; EV ROI</h1>
        <span className="sub">Local-only · IndexedDB · schemaVersion {state.schemaVersion}</span>
      </header>

      <HealthBanner
        state={state}
        lastExportedCount={appMeta.lastExportedCount}
        onRestore={() => setTab('Backup')}
      />

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>

      {tab === 'Dashboard' && (
        <>
          <RoiLayers state={state} />
          <PaybackProgress state={state} />
          <EnergyTrends state={state} />
          <EvChargingSplit state={state} />
          <DataNotes state={state} />
        </>
      )}

      {tab === 'Ingest' && <IngestWizard state={state} onChange={refresh} />}

      {tab === 'Backup' && (
        <ExportRestore state={state} lastExportedCount={appMeta.lastExportedCount} onChange={refresh} />
      )}

      <footer className="small" style={{ marginTop: '2rem' }}>
        No backend · no network data calls · backup by exporting JSON to Notion.
      </footer>
    </div>
  );
}
