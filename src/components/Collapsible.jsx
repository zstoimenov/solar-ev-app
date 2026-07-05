// Collapsible - generic expand/collapse panel wrapper. Dashboard panels are
// collapsed by default so the page reads as a scannable list of headings.

import React, { useState } from 'react';

export default function Collapsible({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="panel collapsible">
      <button
        className="collapsible-header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <h2>{title}</h2>
        <span className={`chevron ${open ? 'open' : ''}`} aria-hidden="true">▸</span>
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}
