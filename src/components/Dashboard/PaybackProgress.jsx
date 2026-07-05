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

// Component names come from the household's own config (brand/model), but
// the tile is about the payback of the *thing* (solar panels, charger,
// battery), not the brand - strip brand/model qualifiers for display.
const BRAND_STRIP = /\s*[(]?\b(wattpilot|byd\s*hvm)\b[)]?\s*/gi;
function simplifyName(name) {
  if (!name) return name;
  return name.replace(BRAND_STRIP, ' ').replace(/\s{2,}/g, ' ').trim();
}

export default function PaybackProgress({ state }) {
  const payback = state.cumulativeTotals.payback ?? [];
  const totals = state.cumulativeTotals.paybackTotals;

  const labels = payback.map((p) => simplifyName(p.component));
  const data = {
    labels,
    datasets: [
      {
        label: 'Recovered',
        data: payback.map((p) => p.recoveredAud ?? 0),
        backgroundColor: '#34d399'
      },
      {
        label: 'Remaining',
        data: payback.map((p) => p.remainingAud ?? 0),
        backgroundColor: '#475569'
      }
    ]
  };

  const options = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#e2e8f0', boxWidth: 12, font: { size: 11 } } } },
    scales: {
      x: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
      y: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: '#334155' } }
    }
  };

  return (
    <>
      <div className="chart-wrap"><Bar data={data} options={options} /></div>
      <div className="table-scroll" style={{ marginTop: '.75rem' }}>
        <table className="digest payback-table">
          <thead>
            <tr><th>Component</th><th>Remaining</th><th>Recovered</th><th>OOP</th><th>Est. payback</th></tr>
          </thead>
          <tbody>
            {payback.map((p) => (
              <tr key={p.component}>
                <td>{simplifyName(p.component)}</td>
                <td>{money(p.remainingAud)}</td>
                <td>{money(p.recoveredAud)}</td>
                <td>{money(p.oopAud)}</td>
                <td>{p.estPaybackYear ?? '—'}</td>
              </tr>
            ))}
            {totals && (
              <tr>
                <td><strong>Total</strong></td>
                <td><strong>{money(totals.remainingAud)}</strong></td>
                <td><strong>{money(totals.recoveredAud)}</strong></td>
                <td><strong>{money(totals.oopAud)}</strong></td>
                <td className="small">{totals.allocationOrder}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
