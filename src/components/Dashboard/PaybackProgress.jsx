// PaybackProgress - per-component bars (solar / charger / battery): recovered
// vs remaining + est. payback year, straight from cumulativeTotals.payback.

import React from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

function money(n) {
  return n == null ? '—' : `$${Number(n).toLocaleString('en-AU')}`;
}

export default function PaybackProgress({ state }) {
  const payback = state.cumulativeTotals.payback ?? [];
  const totals = state.cumulativeTotals.paybackTotals;

  const labels = payback.map((p) => p.component);
  const data = {
    labels,
    datasets: [
      {
        label: 'Recovered (AUD)',
        data: payback.map((p) => p.recoveredAud ?? 0),
        backgroundColor: '#34d399'
      },
      {
        label: 'Remaining (AUD)',
        data: payback.map((p) => p.remainingAud ?? 0),
        backgroundColor: '#475569'
      }
    ]
  };

  const options = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#e2e8f0' } } },
    scales: {
      x: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
      y: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: '#334155' } }
    }
  };

  return (
    <div className="panel">
      <h2>Payback Progress</h2>
      <div className="chart-wrap"><Bar data={data} options={options} /></div>
      <table className="digest" style={{ marginTop: '.75rem' }}>
        <thead>
          <tr><th>Component</th><th>OOP</th><th>Recovered</th><th>Remaining</th><th>Est. payback</th></tr>
        </thead>
        <tbody>
          {payback.map((p) => (
            <tr key={p.component}>
              <td>{p.component}</td>
              <td>{money(p.oopAud)}</td>
              <td>{money(p.recoveredAud)}</td>
              <td>{money(p.remainingAud)}</td>
              <td>{p.estPaybackYear ?? '—'}</td>
            </tr>
          ))}
          {totals && (
            <tr>
              <td><strong>Total</strong></td>
              <td><strong>{money(totals.oopAud)}</strong></td>
              <td><strong>{money(totals.recoveredAud)}</strong></td>
              <td><strong>{money(totals.remainingAud)}</strong></td>
              <td className="small">{totals.allocationOrder}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
