// Modal - minimal centered overlay dialog, closed by the backdrop, the ✕
// button, or Escape. Used for Data Notes (kept out of the main scroll flow).
// Closing plays a brief fade/scale-out (see .closing in app.css) before
// telling the parent to unmount it, instead of vanishing instantly.

import React, { useEffect, useState } from 'react';

const CLOSE_TRANSITION_MS = 160;

export default function Modal({ title, onClose, children }) {
  const [closing, setClosing] = useState(false);

  const requestClose = () => {
    setClosing(true);
    setTimeout(onClose, CLOSE_TRANSITION_MS);
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`modal-backdrop ${closing ? 'closing' : ''}`} onClick={requestClose}>
      <div className={`modal ${closing ? 'closing' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="ghost modal-close" onClick={requestClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
