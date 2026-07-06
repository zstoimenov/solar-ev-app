// EvChargingSplit - EV charge source split (PV / battery / home-grid / work /
// public) for the dashboard's ACTIVE DATE RANGE (the state prop arrives
// pre-filtered from App.jsx): range totals (doughnut) + per-month (stacked bar).

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
// at the top of the tile covers both instead of repeating per chart. Split
// across two rows: the first three are home energy sources, the last two are
// away/public charging - a different kind of thing, so they get their own line.
const LEGEND_ROWS = [
  [
    { label: 'PV', color: COLORS.pv },
    { label: 'Battery', color: COLORS.battery },
    { label: 'The grid', color: COLORS.homeGrid }
  ],
  [
    { label: 'Free public', color: COLORS.work },
    { label: 'Paid public', color: COLORS.trip }
  ]
];

// Draws the stacked total on top of each bar, in a font sized to the actual
// pixel width available per bar - so it shrinks gracefully instead of
// overlapping as more months are shown (mobile width, longer date ranges).
const totalLabelPlugin = {
  id: 'evMonthlyTotalLabel',
  afterDatasetsDraw(chart) {
    const { ctx, chartArea, data } = chart;
    if (!chartArea) return;
    const barCount = data.labels.length || 1;
    const barPixelWidth = (chartArea.right - chartArea.left) / barCount;
    const fontSize = Math.max(8, Math.min(12, barPixelWidth * 0.34));

    ctx.save();
    ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    data.labels.forEach((_, i) => {
      let total = 0;
      let topY = null;
      chart.data.datasets.forEach((ds, dsIndex) => {
        const v = ds.data[i];
        if (v == null) return;
        total += v;
        const meta = chart.getDatasetMeta(dsIndex);
        const el = meta.data[i];
        if (el && !meta.hidden && (topY == null || el.y < topY)) topY = el.y;
      });
      if (topY == null) return;
      const x = chart.getDatasetMeta(0).data[i]?.x;
      if (x == null) return;
      ctx.fillText(Math.round(total).toLocaleString(), x, topY - 4);
    });
    ctx.restore();
  }
};

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
    layout: { padding: { top: 20 } },
    plugins: { legend: { display: false } },
    scales: {
      x: {
        stacked: true,
        ticks: { color: '#94a3b8', autoSkip: true, maxRotation: 0, minRotation: 0, font: { size: 11 } },
        grid: { color: '#334155' }
      },
      y: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: '#334155' } }
    }
  };
  const dOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } }
  };

  // The three home-source percentages, recolored to match their chart
  // segment and reordered largest-first every render (so it tracks the
  // active date range instead of staying in a fixed PV/Battery/Grid order).
  const pctBreakdown = [
    { label: 'PV', value: ev.fromPvKwh ?? 0, pct: ev.fromPvPct, color: COLORS.pv },
    { label: 'Battery', value: ev.fromBatteryKwh ?? 0, pct: ev.fromBatteryPct, color: COLORS.battery },
    { label: 'The grid', value: ev.fromHomeGridKwh ?? 0, pct: ev.fromHomeGridPct, color: COLORS.homeGrid }
  ].sort((a, b) => b.value - a.value);

  // Average monthly charging across every month in the active date range
  // (pending/null months are skipped, not treated as zero - same convention
  // as the avg helpers in data/compute.js).
  const chargedVals = digests.map((d) => d.evTotalChargedKwh).filter((v) => v != null);
  const avgMonthlyKwh = chargedVals.length
    ? Math.round(chargedVals.reduce((a, b) => a + b, 0) / chargedVals.length)
    : null;

  return (
    <>
      <div className="ev-legend">
        {LEGEND_ROWS.map((row, i) => (
          <div className="ev-legend-row" key={i}>
            {row.map((item) => (
              <span className="ev-legend-item" key={item.label}>
                <span className="ev-legend-swatch" style={{ background: item.color }} />
                {item.label}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="grid cols-2">
        <div>
          <h3>Source mix (selected range)</h3>
          <div className="chart-wrap"><Doughnut data={allTime} options={dOpts} /></div>
          <p className="small">
            {pctBreakdown.map((item, i) => (
              <span key={item.label} className="nowrap" style={{ color: item.color }}>
                {item.label} {item.pct ?? '—'}%{i < pctBreakdown.length - 1 ? ' · ' : ''}
              </span>
            ))}
          </p>
        </div>
        <div>
          <h3>Per month (kWh) <span className="tile-sub-note nowrap">avg {avgMonthlyKwh ?? '—'} kWh/mo</span></h3>
          <div className="chart-wrap"><Bar data={monthly} options={barOpts} plugins={[totalLabelPlugin]} /></div>
        </div>
      </div>
    </>
  );
}
