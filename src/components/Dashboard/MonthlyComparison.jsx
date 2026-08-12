// MonthlyComparison - a side-by-side table of the last 12 months on the four
// headline energy flows: solar production, solar export, grid import, and the
// EV's solar-sourced charging. Deliberately a TABLE, not another chart: this
// tile answers "what was the actual number in March?" - the shape-over-time
// question is already covered by Energy Trends.
//
// The `state` prop arrives pre-filtered from App.jsx (dashboard date range),
// and this tile then shows the most recent 12 months of that range - so the
// default view is a true rolling year, and narrowing the filter narrows the
// table rather than the tile silently ignoring the filter.
//
// Null months render as "-" and are skipped by the Total/Avg rows rather than
// counted as zero (see CLAUDE.md "Null convention").

import React from 'react';
import InfoPopover from '../InfoPopover.jsx';

const MONTHS_SHOWN = 12;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatMonth(m) {
  if (!m) return '—';
  const [y, mo] = m.split('-').map(Number);
  return `${MONTH_NAMES[mo - 1]} ${y}`;
}

// "2025-07" -> "Jul '25". The row labels use the short form so all four
// metric columns fit inside a 412px viewport without needing a sideways
// swipe - the whole point of this tile is comparing the columns at a glance.
function shortMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  return `${MONTH_NAMES[mo - 1]} '${String(y).slice(-2)}`;
}

function kwh(n) {
  return n == null ? '—' : Math.round(n).toLocaleString('en-AU');
}

// Sum that preserves the null convention: a set of all-null values is "no
// data" (null), not 0. Present values are summed and nulls ignored.
function sumOrNull(values) {
  const present = values.filter((v) => v != null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

function avgOrNull(values) {
  const present = values.filter((v) => v != null);
  return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
}

// EV energy that came from the household's own solar: direct PV plus what the
// battery discharged into the car. Grouped exactly the way buildDigest.js
// costs self-supplied EV energy (both priced at the displaced export credit,
// not the import rate), so this column matches the financial layers.
function evFromSolar(d) {
  return sumOrNull([d.evFromPvKwh, d.evFromBatteryKwh]);
}

// Headers are kept terse (and the long form lives in the InfoPopover) so the
// table clears a 412px viewport - "Grid import" / "EV from solar" as headers
// pushed the last column off-screen behind a horizontal swipe.
const COLUMNS = [
  { key: 'solar', label: 'Solar', get: (d) => d.solarProductionKwh },
  { key: 'export', label: 'Export', get: (d) => d.gridExportKwh },
  { key: 'gridImport', label: 'Import', get: (d) => d.gridImportFroniusKwh },
  { key: 'evSolar', label: 'EV solar', get: evFromSolar }
];

export default function MonthlyComparison({ state }) {
  const months = state.monthlyDigests.slice(-MONTHS_SHOWN);

  if (months.length === 0) {
    return <p className="small">No months in the selected range.</p>;
  }

  const columnValues = Object.fromEntries(
    COLUMNS.map((c) => [c.key, months.map((d) => c.get(d))])
  );
  const partials = months.filter((d) => d.partialMonth);

  return (
    <>
      <p className="small">
        The last {months.length} month{months.length === 1 ? '' : 's'} of the selected range
        ({formatMonth(months[0].month)} – {formatMonth(months[months.length - 1].month)}), in kWh.
        <InfoPopover label="About these columns" className="section-info">
          <strong>Solar</strong> is total production off the panels.{' '}
          <strong>Export</strong> is what went out to the grid (feed-in).{' '}
          <strong>Grid import</strong> is what came in from the grid, as measured by the
          Fronius meter — the Synergy billed figure is a cross-check and can lag by a
          billing cycle, so it isn't used here.{' '}
          <strong>EV solar</strong> is EV charging drawn from your own PV plus the
          battery, i.e. the car's energy that cost no grid import — it excludes
          home charging from the grid, and all work/public charging.
          <br /><br />
          A “—” means no data for that month (pending, not zero). Total and Avg skip
          those months instead of counting them as zero, so an Avg can be over fewer
          months than the table shows. A month marked * covers only part of the
          month, so its figures aren't comparable with a full one.
        </InfoPopover>
      </p>
      <div className="table-scroll">
        <table className="digest table-nowrap">
          <thead>
            <tr>
              <th>Month</th>
              {COLUMNS.map((c) => <th key={c.key}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {months.map((d) => (
              <tr key={d.month}>
                <td>{shortMonth(d.month)}{d.partialMonth ? '*' : ''}</td>
                {COLUMNS.map((c) => <td key={c.key}>{kwh(c.get(d))}</td>)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              {COLUMNS.map((c) => <td key={c.key}>{kwh(sumOrNull(columnValues[c.key]))}</td>)}
            </tr>
            <tr>
              <td>Avg/mo</td>
              {COLUMNS.map((c) => <td key={c.key}>{kwh(avgOrNull(columnValues[c.key]))}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>
      {partials.length > 0 && (
        <p className="small" style={{ marginTop: '.5rem' }}>
          * Partial month{partials.length === 1 ? '' : 's'}:{' '}
          {partials.map((d) => `${shortMonth(d.month)} (${d.daysInPeriod ?? '?'} days)`).join(', ')}
          {' '}— counted in Total and Avg as-is, so both run slightly low.
        </p>
      )}
    </>
  );
}
