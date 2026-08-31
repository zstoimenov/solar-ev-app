// icons.jsx - small single-color (currentColor) line icons shown before each
// dashboard tile's title. Deliberately plain/geometric line art, no brand
// colors or emoji, so they read as UI chrome rather than decoration.

import React from 'react';

const common = {
  width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round'
};

export function LayersIcon(props) {
  return (
    <svg {...common} {...props}>
      <polygon points="12 4 20 9 12 14 4 9 12 4" />
      <polyline points="4 14 12 19 20 14" />
    </svg>
  );
}

export function TargetIcon(props) {
  return (
    <svg {...common} {...props}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function TrendIcon(props) {
  return (
    <svg {...common} {...props}>
      <polyline points="3 17 9 11 13 15 21 6" />
      <polyline points="15 6 21 6 21 12" />
    </svg>
  );
}

export function PlugIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M9 7V3M15 7V3" />
      <path d="M7 7h10v4a5 5 0 0 1-5 5 5 5 0 0 1-5-5V7Z" />
      <path d="M12 16v5" />
    </svg>
  );
}

export function TableIcon(props) {
  return (
    <svg {...common} {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M9 9v11M15 9v11" />
    </svg>
  );
}

export function ScaleIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M12 3v18M8 21h8" />
      <path d="M4 7h6M14 7h6" />
      <path d="M4 7l-2.5 5a2.5 2.5 0 0 0 5 0L4 7ZM20 7l-2.5 5a2.5 2.5 0 0 0 5 0L20 7Z" />
    </svg>
  );
}

// --- Bottom-nav icons (v2). Same 24px grid / 1.6 stroke as the tile icons
// above, so the two sets read as one family. ---

export function SunIcon(props) {
  return (
    <svg {...common} {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function CarIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M5 16h14" />
      <path d="M6.5 16V9.5l1.8-3.6a1.5 1.5 0 0 1 1.3-.9h4.8a1.5 1.5 0 0 1 1.3.9L17.5 9.5V16" />
      <path d="M6.5 9.5h11" />
      <circle cx="8.5" cy="16.5" r="1.6" />
      <circle cx="15.5" cy="16.5" r="1.6" />
    </svg>
  );
}

export function UploadIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M12 15V3" />
      <polyline points="8 7 12 3 16 7" />
      <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </svg>
  );
}

export function AlertIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}

export function CheckCircleIcon(props) {
  return (
    <svg {...common} {...props}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="8 12 11 15 16 9" />
    </svg>
  );
}

export function ClockIcon(props) {
  return (
    <svg {...common} {...props}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  );
}
