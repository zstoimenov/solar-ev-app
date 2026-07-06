// PaybackProgress - per-component bars (solar / charger / battery): recovered
// vs remaining + est. payback year, straight from cumulativeTotals.payback.

import React from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend
} from 'chart.js';
import InfoPopover from '../InfoPopover.jsx';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

function money(n) {
  return n == null ? '—' : `$${Number(n).toLocaleString('en-AU')}`;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatMonth(m) {
  if (!m) return '—';
  const [y, mo] = m.split('-').map(Number);
  return `${MONTH_NAMES[mo - 1]} ${y}`;
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
  const preTracking = state.cumulativeTotals.paybackPreTracking;
  const hasPreTracking = payback.some((p) => p.recoveredPreTrackingAud);

  const labels = payback.map((p) => simplifyName(p.component));
  // When a pre-tracking estimate is in play, split "Recovered" into its two
  // sources (estimated vs from real tracked data) as separate stacked
  // segments, so the estimate is visible rather than blended silently into
  // one green bar - see data/compute.js "Pre-tracking estimate".
  const data = {
    labels,
    datasets: [
      ...(hasPreTracking
        ? [{
            label: 'Recovered (pre-tracking est.)',
            data: payback.map((p) => p.recoveredPreTrackingAud ?? 0),
            backgroundColor: '#a3854e'
          }]
        : []),
      {
        label: hasPreTracking ? 'Recovered (tracked data)' : 'Recovered',
        data: payback.map((p) => (p.recoveredAud ?? 0) - (p.recoveredPreTrackingAud ?? 0)),
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
        <table className="digest table-nowrap">
          <thead>
            <tr><th>Component</th><th>Recovered</th><th>Remaining</th><th>OOP</th><th>Est. payback</th></tr>
          </thead>
          <tbody>
            {payback.map((p) => (
              <tr key={p.component}>
                <td>{simplifyName(p.component)}</td>
                <td>{money(p.recoveredAud)}{p.recoveredPreTrackingAud ? '*' : ''}</td>
                <td>{money(p.remainingAud)}</td>
                <td>{money(p.oopAud)}</td>
                <td>{p.estPaybackYear ?? '—'}</td>
              </tr>
            ))}
            {totals && (
              <tr>
                <td><strong>Total</strong></td>
                <td><strong>{money(totals.recoveredAud)}{totals.recoveredPreTrackingAud ? '*' : ''}</strong></td>
                <td><strong>{money(totals.remainingAud)}</strong></td>
                <td><strong>{money(totals.oopAud)}</strong></td>
                <td className="small">{totals.allocationOrder}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {preTracking && (
        <p className="small" style={{ marginTop: '.5rem' }}>
          * Includes ~{money(preTracking.estimatedAud)} estimated for{' '}
          {formatMonth(preTracking.fromMonth)} – {formatMonth(preTracking.toMonth)}, before
          smart-meter tracking began.
          <InfoPopover label="How the pre-tracking estimate works" className="section-info">
            This system was installed on {preTracking.installDate}, {preTracking.gapMonths} months
            before your earliest tracked data ({formatMonth(preTracking.toMonth)} was the last
            month without a digest). There's no Fronius/Wattpilot data for that gap - it was never
            captured, not just un-ingested - so it's filled with an estimate: your tracked period's
            average Layer 1 saving (${preTracking.avgMonthlyRateUsedAud}/month) × the gap in months.
            This is rougher than every other figure in this app: if the gap predates your battery
            or EV, their savings are baked into that average and this will overstate what
            solar-only was actually saving back then. It only affects Payback Progress - the ROI
            Layers tile's Layer 1 total stays exactly what your tracked data shows, no estimate
            included.
          </InfoPopover>
        </p>
      )}
    </>
  );
}
