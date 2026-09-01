// MonthlyProduction - solar generated per month, one series.
//
// Replaces the old EnergyTrends tile, which plotted four series (kWh,
// percent, dollars, kWh) across TWO y-axes. A dual-axis chart lets any two
// lines be made to "cross" by choosing the scales, so it cannot be read
// honestly - the four questions it tried to answer at once now live on the
// screens that own them: money on Money, EV charging on Car,
// self-sufficiency as a stat rather than a line.
//
// Single series, so no legend: the title names it. Null months are gaps,
// never zeros (see CLAUDE.md "Null convention").

import React from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} '${String(y).slice(-2)}`;
}

export default function MonthlyProduction({ state }) {
  const digests = state.monthlyDigests;
  if (!digests.length) return null;

  const data = {
    labels: digests.map((d) => shortMonth(d.month)),
    datasets: [{
      label: 'Generated (kWh)',
      data: digests.map((d) => d.solarProductionKwh),
      backgroundColor: '#facc15',
      borderRadius: 4,
      borderSkipped: 'bottom'
    }]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) =>
            ctx.parsed.y == null ? 'no data' : `${Math.round(ctx.parsed.y).toLocaleString('en-AU')} kWh`
        }
      }
    },
    scales: {
      x: {
        ticks: { color: '#94a3b8', maxRotation: 0, autoSkip: true, font: { size: 11 } },
        grid: { display: false }
      },
      y: {
        beginAtZero: true,
        ticks: { color: '#94a3b8', font: { size: 11 } },
        grid: { color: '#334155' },
        border: { display: false }
      }
    }
  };

  return <div className="chart-wrap"><Bar data={data} options={options} /></div>;
}
