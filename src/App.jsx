import React, { useEffect, useState, useCallback, useRef } from 'react';
import { loadOrSeed } from './data/seed.js';
import { getState, getAppMeta } from './data/db.js';
import { APP_VERSION } from './version.js';
import HealthBanner from './components/HealthBanner.jsx';
import DataNotes from './components/DataNotes.jsx';
import Collapsible from './components/Collapsible.jsx';
import Modal from './components/Modal.jsx';
import RoiLayers from './components/Dashboard/RoiLayers.jsx';
import PaybackProgress from './components/Dashboard/PaybackProgress.jsx';
import EnergyTrends from './components/Dashboard/EnergyTrends.jsx';
import EvChargingSplit from './components/Dashboard/EvChargingSplit.jsx';
import IngestWizard from './components/IngestWizard.jsx';
import ExportRestore from './components/ExportRestore.jsx';

const TABS = ['Dashboard', 'Ingest', 'Backup'];
const PANEL_KEYS = ['roi', 'payback', 'energy', 'ev'];

function HamburgerMenu({ tab, setTab }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [open]);

  return (
    <div className="hamburger-wrap" ref={ref}>
      <button className="hamburger" onClick={() => setOpen((o) => !o)} aria-label="Menu">☰</button>
      {open && (
        <div className="hamburger-menu">
          {TABS.map((t) => (
            <button
              key={t}
              className={t === tab ? 'active' : ''}
              onClick={() => { setTab(t); setOpen(false); }}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [state, setState] = useState(null);
  const [appMeta, setAppMeta] = useState({ lastExportedCount: null });
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState('Dashboard');
  const [notesOpen, setNotesOpen] = useState(false);
  const [panelsOpen, setPanelsOpen] = useState({ roi: false, payback: false, energy: false, ev: false });

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
  const allPanelsOpen = PANEL_KEYS.every((k) => panelsOpen[k]);
  const toggleAllPanels = () => {
    const next = !allPanelsOpen;
    setPanelsOpen(Object.fromEntries(PANEL_KEYS.map((k) => [k, next])));
  };
  const togglePanel = (key) => setPanelsOpen((p) => ({ ...p, [key]: !p[key] }));

  // First-run / empty store: the public bundle ships an EMPTY starter (no
  // personal data). Prompt the user to restore their private backup before
  // anything else, and do not attempt to render dashboards against no data.
  if (isEmpty) {
    return (
      <div className="app">
        <header className="top">
          <h1>☀️ Solar, Battery &amp; EV ROI</h1>
        </header>
        <div className="banner warn">
          <strong>No data yet.</strong> This public build ships empty and contains no
          personal data. Paste your private JSON backup below to load your dataset —
          it is then stored only in this browser (IndexedDB) and never uploaded.
        </div>
        <ExportRestore state={state} lastExportedCount={appMeta.lastExportedCount} onChange={refresh} />
        <div className="bottom-bar"><span className="sub">{APP_VERSION}</span></div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="top">
        <h1>☀️ Solar, Battery &amp; EV ROI</h1>
        <HamburgerMenu tab={tab} setTab={setTab} />
      </header>

      <HealthBanner
        state={state}
        lastExportedCount={appMeta.lastExportedCount}
        onRestore={() => setTab('Backup')}
      />

      {tab === 'Dashboard' && (
        <>
          <button className="ghost expand-all" onClick={toggleAllPanels}>
            {allPanelsOpen ? '⊟ Collapse all' : '⊞ Expand all'}
          </button>
          <Collapsible title="ROI Layers" open={panelsOpen.roi} onToggle={() => togglePanel('roi')}>
            <RoiLayers state={state} />
          </Collapsible>
          <Collapsible title="Payback Progress" open={panelsOpen.payback} onToggle={() => togglePanel('payback')}>
            <PaybackProgress state={state} />
          </Collapsible>
          <Collapsible title="Energy Trends" open={panelsOpen.energy} onToggle={() => togglePanel('energy')}>
            <EnergyTrends state={state} />
          </Collapsible>
          <Collapsible title="EV Charging Split" open={panelsOpen.ev} onToggle={() => togglePanel('ev')}>
            <EvChargingSplit state={state} />
          </Collapsible>
          {notesOpen && (
            <Modal title="Data Notes" onClose={() => setNotesOpen(false)}>
              <DataNotes state={state} />
            </Modal>
          )}
        </>
      )}

      {tab === 'Ingest' && <IngestWizard state={state} onChange={refresh} />}

      {tab === 'Backup' && (
        <ExportRestore state={state} lastExportedCount={appMeta.lastExportedCount} onChange={refresh} />
      )}

      <div className="bottom-bar">
        <span className="sub">{APP_VERSION}</span>
        {tab === 'Dashboard' && (
          <button className="ghost notes-trigger" onClick={() => setNotesOpen(true)}>ⓘ Data notes</button>
        )}
      </div>
    </div>
  );
}
