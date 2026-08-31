import React, { useEffect, useState, useCallback } from 'react';
import { loadOrSeed } from './data/seed.js';
import { getState, getAppMeta } from './data/db.js';
import { recomputeCumulative } from './data/compute.js';
import { APP_VERSION } from './version.js';
import HealthBanner from './components/HealthBanner.jsx';
import StorageHealth from './components/StorageHealth.jsx';
import DataNotes from './components/DataNotes.jsx';
import Modal from './components/Modal.jsx';
import DateRangeFilter from './components/Dashboard/DateRangeFilter.jsx';
import Today from './components/Screens/Today.jsx';
import Energy from './components/Screens/Energy.jsx';
import Car from './components/Screens/Car.jsx';
import Money from './components/Screens/Money.jsx';
import DataScreen from './components/Screens/DataScreen.jsx';
import {
  SunIcon, TrendIcon, CarIcon, LayersIcon, UploadIcon
} from './components/Dashboard/icons.jsx';
import { filterSessionsByMonthRange } from './data/evTimeOfUseSplit.js';
import ExportRestore from './components/ExportRestore.jsx';

// Five screens on a bottom bar, replacing the old Dashboard / Ingest /
// Backup hamburger. Bottom rather than top because this is a phone app -
// the top-right corner is the hardest place to reach one-handed.
const SCREENS = [
  { key: 'Today', icon: SunIcon },
  { key: 'Energy', icon: TrendIcon },
  { key: 'Car', icon: CarIcon },
  { key: 'Money', icon: LayersIcon },
  { key: 'Data', icon: UploadIcon }
];

// Screens whose numbers are scoped by the date range. Money is deliberately
// absent: payback and accrued savings are all-time concepts. Energy is also
// absent here: it owns its own range control (chips), and rendering a second
// one in the header alongside them just asks the same question twice.
const RANGE_SCOPED = new Set(['Car']);

// Once there's more than this many months of data, the range-scoped screens
// default to the most recent window (still overridable via the filter) -
// both because a running household ROI story is about "lately", and because
// cramming years of bars into one chart on a phone stops being readable.
const DEFAULT_MONTH_WINDOW = 12;

export default function App() {
  const [state, setState] = useState(null);
  const [appMeta, setAppMeta] = useState({ lastExportedCount: null, lastExportedAt: null });
  const [loadError, setLoadError] = useState(null);
  const [screen, setScreen] = useState('Today');
  const [notesOpen, setNotesOpen] = useState(false);
  const [fromMonth, setFromMonth] = useState(null);
  const [toMonth, setToMonth] = useState(null);

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

  // Moving between screens should start at the top - otherwise you land
  // mid-panel wherever the previous screen happened to be scrolled to.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [screen]);

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
  // anything else, and do not attempt to render screens against no data.
  if (isEmpty) {
    return (
      <div className="app">
        <header className="top">
          <h1>Solar, Battery &amp; EV</h1>
        </header>
        <div className="banner warn">
          <strong>No data yet.</strong> This public build ships empty and contains no
          personal data. Paste your private JSON backup below to load your dataset —
          it is then stored only in this browser (IndexedDB) and never uploaded.
        </div>
        <StorageHealth state={state} appMeta={appMeta} onBackup={() => {}} />
        <ExportRestore state={state} appMeta={appMeta} onChange={refresh} />
        <div className="bottom-bar"><span className="sub">{APP_VERSION}</span></div>
      </div>
    );
  }

  const allMonths = state.monthlyDigests.map((d) => d.month);
  const effectiveTo = toMonth && allMonths.includes(toMonth) ? toMonth : allMonths[allMonths.length - 1];
  const defaultFromIndex = Math.max(0, allMonths.indexOf(effectiveTo) - (DEFAULT_MONTH_WINDOW - 1));
  const effectiveFrom = fromMonth && allMonths.includes(fromMonth) ? fromMonth : allMonths[defaultFromIndex];
  const filteredDigests = state.monthlyDigests.filter(
    (d) => d.month >= effectiveFrom && d.month <= effectiveTo
  );
  // Range-scoped screens read this view; HealthBanner still reads the
  // unfiltered `state` so it always reflects the real data integrity.
  // Payback is the exception: it's an all-time concept, so it comes from a
  // full-history recompute (also keeps it live for backups exported by app
  // versions that stored stale payback figures), not the filtered window.
  const fullCumulative = recomputeCumulative(state.monthlyDigests, state.cumulativeTotals, state.config);
  const filteredCumulative = recomputeCumulative(filteredDigests, state.cumulativeTotals, state.config);
  const filteredState = {
    ...state,
    monthlyDigests: filteredDigests,
    cumulativeTotals: {
      ...filteredCumulative,
      payback: fullCumulative.payback,
      paybackTotals: fullCumulative.paybackTotals,
      paybackPreTracking: fullCumulative.paybackPreTracking
    },
    evChargingSessions: filterSessionsByMonthRange(state.evChargingSessions, effectiveFrom, effectiveTo)
  };
  // Today and Money are all-time: they read the full history, not the window.
  const allTimeState = { ...state, cumulativeTotals: fullCumulative };

  return (
    <div className="app has-nav">
      <header className="top">
        <h1>{screen === 'Today' ? 'Solar, Battery & EV' : screen}</h1>
        {screen === 'Today' && (
          <button className="ghost notes-trigger" onClick={() => setNotesOpen(true)}>
            ⓘ Notes
          </button>
        )}
        {RANGE_SCOPED.has(screen) && (
          <DateRangeFilter
            months={allMonths}
            from={effectiveFrom}
            to={effectiveTo}
            onFromChange={setFromMonth}
            onToChange={setToMonth}
          />
        )}
      </header>

      <HealthBanner
        state={state}
        lastExportedCount={appMeta.lastExportedCount}
        onRestore={() => setScreen('Data')}
      />

      {screen === 'Today' && (
        <Today state={allTimeState} appMeta={appMeta} onGoTo={setScreen} />
      )}
      {screen === 'Energy' && (
        <Energy
          state={filteredState}
          fullState={state}
          rangeFilter={
            <DateRangeFilter
              months={allMonths}
              from={effectiveFrom}
              to={effectiveTo}
              onFromChange={setFromMonth}
              onToChange={setToMonth}
            />
          }
        />
      )}
      {screen === 'Car' && <Car state={filteredState} />}
      {screen === 'Money' && <Money state={allTimeState} />}
      {screen === 'Data' && (
        <DataScreen
          state={state}
          appMeta={appMeta}
          onChange={refresh}
          onIngested={() => setScreen('Today')}
        />
      )}

      {notesOpen && (
        <Modal title="Data Notes" onClose={() => setNotesOpen(false)}>
          <DataNotes state={state} />
        </Modal>
      )}

      <nav className="bottom-nav" aria-label="Main">
        {SCREENS.map(({ key, icon: Icon }) => (
          <button
            key={key}
            className={key === screen ? 'active' : ''}
            onClick={() => setScreen(key)}
            aria-current={key === screen ? 'page' : undefined}
          >
            <Icon width={22} height={22} />
            <span>{key}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
