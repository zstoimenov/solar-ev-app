// EvChargingSplit - EV charge source split (PV / battery / home-grid / work /
// public), all-time (doughnut) and per-month (stacked bar).

import React from 'react';
import { Doughnut, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, ArcElement, CategoryScale, LinearScale, BarElement, Tooltip, Legend
} from 'chart.js';

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const COLORS = {
  pv: '#facc15', battery: '#34d399', homeGrid: '#f87171', work: '#60a5fa', trip: '#a78bfa'
};

// Both charts below share this exact category/color mapping, so one legend
// at the top of the tile covers both instead of repeating per chart.
const LEGEND_ITEMS = [
  { label: 'PV', color: COLORS.pv },
  { label: 'Battery', color: COLORS.battery },
  { label: 'The grid', color: COLORS.homeGrid },
  { label: 'Free public', color: COLORS.work },
  { label: 'Paid public', color: COLORS.trip }
];

export default function EvChargingSplit({ state }) {
  const ev = state.cumulativeTotals.ev;
  const digests = state.monthlyDigests;

  const allTime = {
    labels: ['PV', 'Battery', 'The grid', 'Free public', 'Paid public'],
    datasets: [{
      data: [ev.fromPvKwh, ev.fromBatteryKwh, ev.fromHomeGridKwh, ev.workChargingKwh, ev.publicTripKwh],
      backgroundColor: [COLORS.pv, COLORS.battery, COLORS.homeGrid, COLORS.work, COLORS.trip]
    }]
  };

  const monthly = {
    labels: digests.map((d) => d.month),
    datasets: [
      { label: 'PV', data: digests.map((d) => d.evFromPvKwh), backgroundColor: COLORS.pv, stack: 's' },
      { label: 'Battery', data: digests.map((d) => d.evFromBatteryKwh), backgroundColor: COLORS.battery, stack: 's' },
      { label: 'The grid', data: digests.map((d) => d.evFromHomeGridKwh), backgroundColor: COLORS.homeGrid, stack: 's' },
      { label: 'Free public', data: digests.map((d) => d.evWorkChargingKwh), backgroundColor: COLORS.work, stack: 's' },
      { label: 'Paid public', data: digests.map((d) => d.evPublicTripKwh), backgroundColor: COLORS.trip, stack: 's' }
    ]
  };

  const barOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
      y: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: '#334155' } }
    }
  };
  const dOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } }
  };

  return (
    <>
      <div className="ev-legend">
        {LEGEND_ITEMS.map((item) => (
          <span className="ev-legend-item" key={item.label}>
            <span className="ev-legend-swatch" style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
      <div className="grid cols-2">
        <div>
          <h3>All-time source mix</h3>
          <div className="chart-wrap"><Doughnut data={allTime} options={dOpts} /></div>
          <p className="small">
            PV {ev.fromPvPct ?? '—'}% · Battery {ev.fromBatteryPct ?? '—'}% · The grid {ev.fromHomeGridPct ?? '—'}%
          </p>
        </div>
        <div>
          <h3>Per month (kWh)</h3>
          <div className="chart-wrap"><Bar data={monthly} options={barOpts} /></div>
        </div>
      </div>
    </>
  );
}
