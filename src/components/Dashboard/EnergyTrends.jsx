// EnergyTrends - monthly time series: production, self-sufficiency %, savings.
// Months with null render as GAPS, not zeros (spanGaps:false + null passthrough).

import React from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

export default function EnergyTrends({ state }) {
  const digests = state.monthlyDigests;
  const labels = digests.map((d) => d.month);

  const data = {
    labels,
    datasets: [
      {
        label: 'Solar production (kWh)',
        data: digests.map((d) => d.solarProductionKwh),
        borderColor: '#facc15', backgroundColor: '#facc15', yAxisID: 'y', spanGaps: false, tension: 0.25
      },
      {
        label: 'Self-sufficiency (%)',
        data: digests.map((d) => d.selfSufficiencyPct),
        borderColor: '#34d399', backgroundColor: '#34d399', yAxisID: 'y1', spanGaps: false, tension: 0.25
      },
      {
        label: 'Combined saving (AUD)',
        data: digests.map((d) => d.combinedSavingAud),
        borderColor: '#60a5fa', backgroundColor: '#60a5fa', yAxisID: 'y', spanGaps: false, tension: 0.25
      }
    ]
  };

  const options = {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { labels: { color: '#e2e8f0' } } },
    scales: {
      x: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
      y: { position: 'left', ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
      y1: { position: 'right', min: 0, max: 100, ticks: { color: '#34d399' }, grid: { drawOnChartArea: false } }
    }
  };

  return (
    <div className="panel">
      <h2>Energy Trends</h2>
      <div className="chart-wrap"><Line data={data} options={options} /></div>
      <p className="small">Gaps indicate pending / null values (never plotted as zero).</p>
    </div>
  );
}
