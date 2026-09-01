// parts.jsx - the small set of presentational pieces every screen is built
// from. Having exactly these keeps the screens consistent and, more
// importantly, keeps them HONEST about their job:
//
//   Lede      one plain sentence answering the screen's question
//   BigStat   the single number that sentence is about
//   SplitBar  a whole broken into parts, always with direct labels
//   CompareBar  this period against a reference, because a bare number
//               ("151 kWh") tells a household nothing on its own
//
// Rule that must not be broken: NEVER render the same figure twice in two
// forms on one screen. The pre-v2.1 tiles showed a metric card, then a
// chart, then a table of the same numbers, which is most of why the screens
// felt like work to read.

import React from 'react';

// The four EV/energy source colours. This exact set was validated for
// colour-vision safety against the #1e293b panel surface: normal-vision
// separation dE 21, worst CVD pair (grid red vs battery green) dE 6.5.
// A 6-8 CVD score is only legal WITH secondary encoding, which is why
// SplitBar always draws a labelled row per segment and never a bare bar -
// do not "simplify" those labels away.
//
// The old five-colour set had #a78bfa beside #60a5fa: dE 0.3 under
// deuteranopia and 10.2 even with normal colour vision, i.e. two adjacent
// segments nobody could tell apart. Free and paid public charging are now
// one "Away from home" category instead; the cost difference between them
// is money, and money is shown as dollars elsewhere.
export const SOURCE_COLORS = {
  solar: '#facc15',
  battery: '#34d399',
  grid: '#f87171',
  away: '#60a5fa'
};

export function Lede({ children }) {
  return <p className="lede">{children}</p>;
}

export function BigStat({ value, unit, label, sub, tone = '', children }) {
  return (
    <div className="panel headline-panel">
      {label && <div className="label">{label}</div>}
      <div className={`headline-value ${tone}`}>
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {sub && <div className="sub">{sub}</div>}
      {children}
    </div>
  );
}

// A whole broken into parts. `segments` = [{ label, value, pct, color, note }].
// Zero/absent segments are dropped rather than drawn as invisible slivers.
export function SplitBar({ segments, unit = 'kWh' }) {
  const rows = segments.filter((s) => s.value != null && s.value > 0);
  const total = rows.reduce((a, s) => a + s.value, 0);
  if (!total) return null;

  return (
    <div className="split">
      <div className="split-bar">
        {rows.map((s) => (
          <div
            key={s.label}
            className="split-seg"
            style={{ flexGrow: s.value, background: s.color }}
            title={`${s.label}: ${Math.round(s.value)} ${unit}`}
          />
        ))}
      </div>
      <div className="split-rows">
        {rows.map((s) => (
          <div className="split-row" key={s.label}>
            <span className="split-swatch" style={{ background: s.color }} />
            <span className="split-label">{s.label}</span>
            <span className="split-value">
              {Math.round((s.value / total) * 100)}%
              <span className="split-abs">{Math.round(s.value).toLocaleString('en-AU')} {unit}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Two thin bars on ONE scale: what happened, against what normally happens.
// Deliberately not a dual-axis chart and not a sparkline - the question is
// "more or less than usual?", which is a length comparison.
export function CompareBar({ actual, reference, actualLabel, referenceLabel, unit = 'kWh', tone, format }) {
  if (actual == null || reference == null || reference <= 0) return null;
  const max = Math.max(actual, reference);
  const pct = Math.round(((actual - reference) / reference) * 100);
  const show = format ?? ((n) => `${Math.round(n).toLocaleString('en-AU')}${unit ? ` ${unit}` : ''}`);
  const toneClass = tone ?? (pct >= 0 ? 'good' : pct <= -10 ? 'bad' : '');

  return (
    <div className="compare">
      <div className="compare-line">
        <span className="compare-label">{actualLabel}</span>
        <span className="compare-value">{show(actual)}</span>
      </div>
      <div className="compare-track">
        <div className={`compare-fill ${toneClass}`} style={{ width: `${(actual / max) * 100}%` }} />
      </div>
      <div className="compare-line">
        <span className="compare-label muted">{referenceLabel}</span>
        <span className="compare-value muted">{show(reference)}</span>
      </div>
      <div className="compare-track">
        <div className="compare-fill reference" style={{ width: `${(reference / max) * 100}%` }} />
      </div>
    </div>
  );
}

// A labelled progress bar, used for payback. `parts` lets one bar carry two
// differently-sourced fills (tracked data vs the pre-tracking estimate)
// without needing a separate chart and table saying the same thing.
export function ProgressRow({ name, status, statusTone = '', parts, caption }) {
  return (
    <div className="progress-row">
      <div className="progress-head">
        <span className="progress-name">{name}</span>
        <span className={`progress-status ${statusTone}`}>{status}</span>
      </div>
      <div className="progress-track">
        {parts.map((p, i) => (
          <div key={i} className="progress-fill" style={{ width: `${p.pct}%`, background: p.color }} />
        ))}
      </div>
      {caption && <div className="progress-caption">{caption}</div>}
    </div>
  );
}
