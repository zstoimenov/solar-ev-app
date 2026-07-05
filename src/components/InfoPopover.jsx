// InfoPopover - a small "i" trigger that reveals secondary explanatory text
// on demand instead of it always taking up space in the layout. Closes on
// outside click or Escape.

import React, { useEffect, useRef, useState } from 'react';

export default function InfoPopover({ label = 'More info', className = '', children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className={`info-popover ${className}`} ref={ref}>
      <button
        type="button"
        className="info-popover-trigger"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        i
      </button>
      {open && <div className="info-popover-content" role="note">{children}</div>}
    </span>
  );
}
