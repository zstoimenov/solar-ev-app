// Collapsible - controlled expand/collapse panel wrapper. Open state is
// owned by the parent (App.jsx) so an "expand/collapse all" control can
// drive every panel at once alongside each panel's own toggle.
//
// The body is unmounted while closed and freshly mounted on every open (not
// just the first time) - this is what makes each chart replay its Chart.js
// entrance animation on every expand, plus a matching CSS fade/rise for
// non-chart content, so every tile feels the same as the others when opened.
// Height is measured from the real content (scrollHeight) rather than a
// fixed cap, so the collapse/expand transition never snaps or clips.

import React, { useEffect, useRef, useState } from 'react';

export default function Collapsible({ title, icon, open, onToggle, children }) {
  const [mounted, setMounted] = useState(open);
  const wrapRef = useRef(null);
  const headerRef = useRef(null);
  const scrollOnOpenRef = useRef(false);

  // Opening: mount fresh content, then measure it and transition into place.
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (open && mounted) {
      wrap.style.maxHeight = '0px';
      const h = wrap.scrollHeight;
      requestAnimationFrame(() => { wrap.style.maxHeight = `${h}px`; });
    } else if (!open && mounted) {
      const h = wrap.scrollHeight;
      wrap.style.maxHeight = `${h}px`;
      // Force reflow so the browser registers the start height before the
      // change below, otherwise the transition is skipped.
      void wrap.offsetHeight;
      wrap.style.maxHeight = '0px';
    }
  }, [open, mounted]);

  const onTransitionEnd = (e) => {
    if (e.target !== wrapRef.current || e.propertyName !== 'max-height') return;
    if (!open) {
      setMounted(false);
      wrapRef.current.style.maxHeight = '';
    } else {
      wrapRef.current.style.maxHeight = 'none'; // let content resize freely (charts, filter changes) once open
      // Only now does the page actually have room to scroll into - doing this
      // on click (before the tile has grown) computes against a page that's
      // still its old, shorter height, so the browser sees nowhere to go and
      // silently no-ops.
      if (scrollOnOpenRef.current) {
        scrollOnOpenRef.current = false;
        headerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  // Opening a specific tile by clicking its own header brings that tile's
  // title to the top of the screen - a deliberate "focus on this" moment.
  // Bulk "Expand all" doesn't go through this handler (it drives `open` via
  // props directly), so it doesn't fight over scroll position for 4 panels.
  const handleHeaderClick = () => {
    if (!open) scrollOnOpenRef.current = true;
    onToggle();
  };

  return (
    <div className="panel collapsible">
      <button
        className="collapsible-header"
        ref={headerRef}
        onClick={handleHeaderClick}
        aria-expanded={open}
      >
        <h2>
          {icon && <span className="collapsible-icon" aria-hidden="true">{icon}</span>}
          {title}
        </h2>
        <span className={`chevron ${open ? 'open' : ''}`} aria-hidden="true">▸</span>
      </button>
      <div className="collapsible-body-wrap" ref={wrapRef} onTransitionEnd={onTransitionEnd}>
        {mounted && <div className="collapsible-body">{children}</div>}
      </div>
    </div>
  );
}
