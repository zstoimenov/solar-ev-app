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

// A car in side profile: a low body with a raised cabin over it, and the
// wheels straddling the sill. The previous one drew a single tall box with a
// slightly sloped top, which at 24px read as a van or a shed - the two tiers
// are what make it read as a car at a glance.
export function CarIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M4.4 16.2H3.5c-.5 0-.9-.4-.9-.9v-2.1c0-.8.6-1.5 1.4-1.7l2.8-.8 1.8-2.4c.3-.4.7-.6 1.2-.6h4.4c.5 0 .9.2 1.2.6l1.8 2.4 2.8.8c.8.2 1.4.9 1.4 1.7v2.1c0 .5-.4.9-.9.9h-.9" />
      <path d="M6.8 10.7h10.4" />
      <path d="M12 7.7v3" />
      <path d="M9.9 16.2h4.2" />
      <circle cx="7.2" cy="16.2" r="1.8" />
      <circle cx="16.8" cy="16.2" r="1.8" />
    </svg>
  );
}

// Money: a banknote. The Money screen was using LayersIcon, which is the ROI
// layers glyph - meaningful inside that tile, and meaningless as a nav label
// for "what have I saved". A note is read as money instantly and shares
// nothing with the other four icons in the bar, which is what a nav icon has
// to do at 24px.
export function BanknoteIcon(props) {
  return (
    <svg {...common} {...props}>
      <rect x="2.5" y="6.5" width="19" height="11" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 10.2v3.6M18 10.2v3.6" />
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

// --- Sky icons (the 7-day forecast strip) --------------------------------
// Four states, picked from cloud cover and rainfall in
// Dashboard/SolarForecast.jsx:skyFor(). Same 24px grid and 1.6 stroke as
// everything above, drawn in currentColor so a column can dim its own glyph
// without a second colour entering the palette. They carry a word in the
// day's detail card, never a glyph alone.

export function ClearIcon(props) {
  return (
    <svg {...common} {...props}>
      <circle cx="12" cy="12" r="4.4" />
      <path d="M12 2.4v2.2M12 19.4v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.4 12h2.2M19.4 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
    </svg>
  );
}

export function PartlyCloudyIcon(props) {
  return (
    <svg {...common} {...props}>
      <circle cx="8.6" cy="8.6" r="3.1" />
      <path d="M8.6 2.6v1.6M3.4 8.6H1.8M4.9 4.9 3.8 3.8M12.3 4.9l1.1-1.1" />
      <path d="M9.4 19.4h8.4a3.3 3.3 0 0 0 .5-6.6 4.6 4.6 0 0 0-8.7-1.2 3.4 3.4 0 0 0-.2 7.8Z" />
    </svg>
  );
}

export function CloudyIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M7.4 19.4h9.4a4 4 0 0 0 .6-8 5.4 5.4 0 0 0-10.2-1.4 3.7 3.7 0 0 0 .2 9.4Z" />
    </svg>
  );
}

export function RainIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M7.6 15.6h9a3.7 3.7 0 0 0 .6-7.4 5.1 5.1 0 0 0-9.7-1.3 3.5 3.5 0 0 0 .1 8.7Z" />
      <path d="M9 18.4l-.8 2.4M12.4 18.4l-.8 2.4M15.8 18.4l-.8 2.4" />
    </svg>
  );
}
