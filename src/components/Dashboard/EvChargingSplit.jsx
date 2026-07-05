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

export default function EvChargingSplit({ state }) {
  const ev = state.cumulativeTotals.ev;
  const digests = state.monthlyDigests;

  const allTime = {
    labels: ['PV', 'Battery', 'Home grid', 'Work', 'Public/trip'],
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
      { label: 'Home grid', data: digests.map((d) => d.evFromHomeGridKwh), backgroundColor: COLORS.homeGrid, stack: 's' },
      { label: 'Work', data: digests.map((d) => d.evWorkChargingKwh), backgroundColor: COLORS.work, stack: 's' },
      { label: 'Public/trip', data: digests.map((d) => d.evPublicTripKwh), backgroundColor: COLORS.trip, stack: 's' }
    ]
  };

  const barOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#e2e8f0' } } },
    scales: {
      x: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
      y: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: '#334155' } }
    }
  };
  const dOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { color: '#e2e8f0' } } }
  };

  return (
    <div className="grid cols-2">
      <div>
        <h3>All-time source mix</h3>
        <div className="chart-wrap"><Doughnut data={allTime} options={dOpts} /></div>
        <p className="small">
          PV {ev.fromPvPct ?? '—'}% · Battery {ev.fromBatteryPct ?? '—'}% · Home grid {ev.fromHomeGridPct ?? '—'}%
        </p>
      </div>
      <div>
        <h3>Per month (kWh)</h3>
        <div className="chart-wrap"><Bar data={monthly} options={barOpts} /></div>
      </div>
    </div>
  );
}
