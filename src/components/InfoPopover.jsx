// InfoPopover - a small "i" trigger that reveals secondary explanatory text
// on demand instead of it always taking up space in the layout. Closes on
// outside click or Escape.

import React, { useEffect, useRef, useState } from 'react';

export default function InfoPopover({ label = 'More info', className = '', children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const contentRef = useRef(null);

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

  // The popup is centered under its trigger by default (app.css), which
  // still clips off-screen when the trigger sits near a narrow viewport's
  // edge (e.g. a phone width) - there's no room to center into. Once open,
  // measure it and nudge it back on-screen via a CSS var rather than a
  // fixed side, so it stays anchored to the trigger from any position.
  useEffect(() => {
    if (!open || !contentRef.current) return;
    const margin = 8; // px keep-out from the viewport edge
    const rect = contentRef.current.getBoundingClientRect();
    let shift = 0;
    if (rect.left < margin) shift = margin - rect.left;
    else if (rect.right > window.innerWidth - margin) shift = (window.innerWidth - margin) - rect.right;
    contentRef.current.style.setProperty('--info-popover-shift', `${shift}px`);
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
      {open && <div className="info-popover-content" role="note" ref={contentRef}>{children}</div>}
    </span>
  );
}
