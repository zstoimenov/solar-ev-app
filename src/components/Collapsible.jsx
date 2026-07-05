// Collapsible - controlled expand/collapse panel wrapper. Open state is
// owned by the parent (App.jsx) so an "expand/collapse all" control can
// drive every panel at once alongside each panel's own toggle.

import React from 'react';

export default function Collapsible({ title, open, onToggle, children }) {
  return (
    <div className="panel collapsible">
      <button
        className="collapsible-header"
        onClick={onToggle}
        aria-expanded={open}
      >
        <h2>{title}</h2>
        <span className={`chevron ${open ? 'open' : ''}`} aria-hidden="true">▸</span>
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}
