// DateRangeFilter - "From" / "To" month selectors that scope the whole
// Dashboard tab to a sub-range of the loaded months. Options are constrained
// so From can never be pushed past To (and vice versa) - no clamping logic
// needed elsewhere.

import React from 'react';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function label(month) {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

export default function DateRangeFilter({ months, from, to, onFromChange, onToChange }) {
  if (months.length <= 1) return null;

  return (
    <div className="date-range-filter">
      <label>
        <span>From</span>
        <select value={from} onChange={(e) => onFromChange(e.target.value)}>
          {months.filter((m) => m <= to).map((m) => (
            <option key={m} value={m}>{label(m)}</option>
          ))}
        </select>
      </label>
      <label>
        <span>To</span>
        <select value={to} onChange={(e) => onToChange(e.target.value)}>
          {months.filter((m) => m >= from).map((m) => (
            <option key={m} value={m}>{label(m)}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
