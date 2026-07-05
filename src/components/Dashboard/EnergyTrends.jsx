// EnergyTrends - monthly time series: production, self-sufficiency %, savings.
// Months with null render as GAPS, not zeros (spanGaps:false + null passthrough).

import React from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend
} from 'chart.js';
import InfoPopover from '../InfoPopover.jsx';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

// "2026-06" -> "Jun '26", so x-axis labels fit on one short line instead of
// wrapping across three.
function shortMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${MONTHS[m - 1]} '${String(y).slice(-2)}`;
}

export default function EnergyTrends({ state }) {
  const digests = state.monthlyDigests;
  const labels = digests.map((d) => shortMonth(d.month));

  const data = {
    labels,
    datasets: [
      {
        label: 'Solar (kWh)',
        data: digests.map((d) => d.solarProductionKwh),
        borderColor: '#facc15', backgroundColor: '#facc15', yAxisID: 'y', spanGaps: false, tension: 0.25
      },
      {
        label: 'Self-sufficiency (%)',
        data: digests.map((d) => d.selfSufficiencyPct),
        borderColor: '#34d399', backgroundColor: '#34d399', yAxisID: 'y1', spanGaps: false, tension: 0.25
      },
      {
        label: 'Savings (AUD)',
        data: digests.map((d) => d.combinedSavingAud),
        borderColor: '#60a5fa', backgroundColor: '#60a5fa', yAxisID: 'y', spanGaps: false, tension: 0.25
      },
      {
        label: 'EV charging (kWh)',
        data: digests.map((d) => d.evTotalChargedKwh),
        borderColor: '#a78bfa', backgroundColor: '#a78bfa', yAxisID: 'y', spanGaps: false, tension: 0.25
      }
    ]
  };

  const options = {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { labels: { color: '#e2e8f0', boxWidth: 12, font: { size: 11 } } } },
    scales: {
      x: {
        ticks: { color: '#94a3b8', maxRotation: 0, minRotation: 0, autoSkip: true, font: { size: 11 } },
        grid: { color: '#334155' }
      },
      y: { position: 'left', ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
      y1: { position: 'right', min: 0, max: 100, ticks: { color: '#34d399' }, grid: { drawOnChartArea: false } }
    }
  };

  return (
    <>
      <div className="chart-wrap"><Line data={data} options={options} /></div>
      <div className="tile-footnote">
        <InfoPopover label="About gaps in this chart">
          Gaps indicate pending / null values (never plotted as zero).
        </InfoPopover>
      </div>
    </>
  );
}
