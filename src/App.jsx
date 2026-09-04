import React, { useEffect, useState, useCallback, useRef } from 'react';
import { loadOrSeed } from './data/seed.js';
import { getState, getAppMeta, getCloudMeta } from './data/db.js';
import { recomputeCumulative } from './data/compute.js';
import { APP_VERSION } from './version.js';
import HealthBanner from './components/HealthBanner.jsx';
import StorageHealth from './components/StorageHealth.jsx';
import WhatsNew from './components/WhatsNew.jsx';
import Modal from './components/Modal.jsx';
import DateRangeFilter from './components/Dashboard/DateRangeFilter.jsx';
import Home from './components/Screens/Home.jsx';
import Energy from './components/Screens/Energy.jsx';
import Car from './components/Screens/Car.jsx';
import Money from './components/Screens/Money.jsx';
import DataScreen from './components/Screens/DataScreen.jsx';
import {
  SunIcon, TrendIcon, CarIcon, BanknoteIcon, UploadIcon
} from './components/Dashboard/icons.jsx';
import { filterSessionsByMonthRange } from './data/evTimeOfUseSplit.js';
import ExportRestore from './components/ExportRestore.jsx';

// Five screens on a bottom bar, replacing the old Dashboard / Ingest /
// Backup hamburger. Bottom rather than top because this is a phone app -
// the top-right corner is the hardest place to reach one-handed.
const SCREENS = [
  { key: 'Home', icon: SunIcon },
  { key: 'Energy', icon: TrendIcon },
  { key: 'Car', icon: CarIcon },
  { key: 'Money', icon: BanknoteIcon },
  { key: 'Data', icon: UploadIcon }
];

// Swiping sideways moves between those five screens, in the same order the
// nav bar shows them. The nav is the map; the swipe is the shortcut, and it
// stays a shortcut on purpose:
//
//   - It does NOT wrap. Swiping left on Data does nothing, rather than
//     landing on Home - an over-swipe that teleports across the whole app
//     reads as a bug, and the nav is one tap away for a real jump.
//   - It is a HORIZONTAL gesture or it is nothing. A swipe only counts once
//     it has travelled SWIPE_MIN_PX sideways AND more than SWIPE_RATIO times
//     as far sideways as vertically, so scrolling a long screen at a slight
//     angle never changes screen underneath the thumb.
//   - It yields to anything that scrolls sideways itself. A gesture starting
//     inside a `.table-scroll` (the 12-month table, the tariff tables) is
//     that element's, not the nav's.
//   - Two fingers are a browser gesture (pinch/zoom), never a screen change.
const SWIPE_MIN_PX = 60;
const SWIPE_RATIO = 1.5;
const SWIPE_MAX_MS = 800;

// Energy, Car and Money each own their range control inline (the three
// chips + the From/To selectors), rather than a filter in the header. The
// header version asked the same question twice on Energy and asked it in
// the hardest-to-reach corner of the screen everywhere else. Home stays
// all-time: most of what it shows (the total saved, payback, the milestones)
// is an all-time figure, so there is nothing there to scope.

// Once there's more than this many months of data, the range-scoped screens
// default to the most recent window (still overridable via the filter) -
// both because a running household ROI story is about "lately", and because
// cramming years of bars into one chart on a phone stops being readable.
const DEFAULT_MONTH_WINDOW = 12;

export default function App() {
  const [state, setState] = useState(null);
  const [appMeta, setAppMeta] = useState({ lastExportedCount: null, lastExportedAt: null });
  // Cloud push bookkeeping, loaded alongside appMeta so the stale-backup
  // banner can speak for both backups from one refresh.
  const [cloudMeta, setCloudMeta] = useState({ lastPushedAt: null, lastPushedCount: null, lastPushedId: null });
  const [loadError, setLoadError] = useState(null);
  const [screen, setScreen] = useState('Home');
  const [notesOpen, setNotesOpen] = useState(false);
  const [fromMonth, setFromMonth] = useState(null);
  const [toMonth, setToMonth] = useState(null);

  const refresh = useCallback(async () => {
    const [s, m, c] = await Promise.all([getState(), getAppMeta(), getCloudMeta()]);
    setState(s);
    setAppMeta(m);
    setCloudMeta(c);
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

  // The swipe itself. Held in a ref rather than state: a gesture in progress
  // must not re-render the screen it is being made on.
  const swipe = useRef(null);

  const onTouchStart = (e) => {
    // Two fingers is the browser's gesture (pinch, zoom), never ours. A
    // gesture starting inside something that scrolls sideways belongs to
    // that element - the 12-month table is read by swiping it.
    if (e.touches.length !== 1 || notesOpen || e.target.closest?.('.table-scroll')) {
      swipe.current = null;
      return;
    }
    const t = e.touches[0];
    swipe.current = { x: t.clientX, y: t.clientY, at: Date.now() };
  };

  const onTouchEnd = (e) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start || notesOpen) return;
    const t = e.changedTouches?.[0];
    if (!t) return;

    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // A slow drag is a scroll that wandered, not a swipe.
    if (Date.now() - start.at > SWIPE_MAX_MS) return;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;

    const i = SCREENS.findIndex((sc) => sc.key === screen);
    // Swipe left (dx negative) moves forward through the nav order, the way
    // the content itself would slide. Clamped at both ends - see above.
    const next = i + (dx < 0 ? 1 : -1);
    if (i < 0 || next < 0 || next >= SCREENS.length) return;
    setScreen(SCREENS[next].key);
  };

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
          personal data. Load your private JSON backup file below to restore your
          dataset — it is then stored only in this browser (IndexedDB) and never uploaded.
        </div>
        <StorageHealth state={state} appMeta={appMeta} cloudMeta={cloudMeta} onBackup={() => {}} />
        <div className="panel">
          <h2>Restore your data</h2>
          <ExportRestore state={state} appMeta={appMeta} onChange={refresh} />
        </div>
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
  // HealthBanner always reads the unfiltered `state`, whatever period a
  // screen is showing, so it reflects the real data integrity. The
  // full-history recompute below also keeps payback live for backups
  // exported by app versions that stored stale payback figures.
  const fullCumulative = recomputeCumulative(state.monthlyDigests, state.cumulativeTotals, state.config);

  // One view of the store per selected period. Payback is deliberately NOT
  // rescoped - it is an all-time concept - so every scope carries the
  // full-history recompute of payback/paybackTotals/paybackPreTracking.
  const scopedState = (digests) => ({
    ...state,
    monthlyDigests: digests,
    cumulativeTotals: {
      ...recomputeCumulative(digests, state.cumulativeTotals, state.config),
      payback: fullCumulative.payback,
      paybackTotals: fullCumulative.paybackTotals,
      paybackPreTracking: fullCumulative.paybackPreTracking
    },
    evChargingSessions: filterSessionsByMonthRange(
      state.evChargingSessions,
      digests[0]?.month ?? null,
      digests[digests.length - 1]?.month ?? null
    )
  });

  const latestMonth = allMonths[allMonths.length - 1];
  const allTimeState = { ...state, cumulativeTotals: fullCumulative };
  // The three periods every scoped screen offers, built once here so the
  // screens only choose between them.
  const scopes = {
    month: scopedState(state.monthlyDigests.filter((d) => d.month === latestMonth)),
    window: scopedState(filteredDigests),
    all: allTimeState
  };
  const rangeFilter = (
    <DateRangeFilter
      months={allMonths}
      from={effectiveFrom}
      to={effectiveTo}
      onFromChange={setFromMonth}
      onToChange={setToMonth}
    />
  );

  return (
    <div
      className="app has-nav"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => { swipe.current = null; }}
    >
      <header className="top">
        <h1>{screen === 'Home' ? 'Solar, Battery & EV' : screen}</h1>
        {screen === 'Home' && (
          <button className="ghost notes-trigger" onClick={() => setNotesOpen(true)}>
            ⓘ What's new
          </button>
        )}
      </header>

      <HealthBanner
        state={state}
        lastExportedCount={appMeta.lastExportedCount}
        onRestore={() => setScreen('Data')}
      />

      {screen === 'Home' && (
        <Home state={allTimeState} appMeta={appMeta} onGoTo={setScreen} />
      )}
      {screen === 'Energy' && (
        <Energy
          state={scopes.window}
          fullState={state}
          rangeFilter={rangeFilter}
          onConfigChange={refresh}
        />
      )}
      {screen === 'Car' && (
        <Car
          scopes={scopes}
          months={allMonths}
          rangeFilter={rangeFilter}
          allDigests={state.monthlyDigests}
          fullState={state}
        />
      )}
      {screen === 'Money' && (
        <Money
          scopes={scopes}
          months={allMonths}
          rangeFilter={rangeFilter}
          allDigests={state.monthlyDigests}
        />
      )}
      {screen === 'Data' && (
        <DataScreen
          state={state}
          appMeta={appMeta}
          cloudMeta={cloudMeta}
          onChange={refresh}
          onIngested={() => setScreen('Home')}
        />
      )}

      {notesOpen && (
        <Modal title="What's new" onClose={() => setNotesOpen(false)}>
          <WhatsNew />
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
