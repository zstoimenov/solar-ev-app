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
