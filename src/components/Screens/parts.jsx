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

// --- The three-scope range control -------------------------------------
//
// Energy, Car and Money all answer their question over a period, and the
// period is the same three choices everywhere: the latest month, the range
// picked in the From/To selectors, or everything loaded. One component so
// the three screens cannot drift into three slightly different controls,
// and so a chip row is never rendered when there is only one month loaded
// (all three scopes would be the same data).
export const RANGES = ['month', 'window', 'all'];

// Short enough to sit in one segmented control at 412px without ellipsis.
// "Range" rather than "Selected range": picking it reveals the From/To row
// directly underneath, which says what is being ranged far better than the
// extra word did.
const RANGE_LABELS = {
  month: 'This month',
  window: 'Range',
  all: 'All time'
};

export function RangeChips({ value, onChange, options = RANGES }) {
  if (options.length < 2) return null;
  return (
    <div className="range-chips" role="group" aria-label="Period">
      {options.map((key) => (
        <button
          key={key}
          className={key === value ? 'active' : ''}
          aria-pressed={key === value}
          onClick={() => onChange(key)}
        >
          {RANGE_LABELS[key]}
        </button>
      ))}
    </div>
  );
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthLabel(m) {
  if (!m) return '—';
  const [y, mo] = m.split('-').map(Number);
  return `${SHORT_MONTHS[mo - 1]} ${y}`;
}

// The period a figure actually covers, spelled out. A scoped number with no
// period next to it is the same failure as a bare "151 kWh": the reader
// cannot tell what they are looking at.
export function rangeLabel(range, digests) {
  if (!digests.length) return '—';
  const first = digests[0].month;
  const last = digests[digests.length - 1].month;
  if (range === 'all') return `All time · ${monthLabel(first)} – ${monthLabel(last)}`;
  return first === last ? monthLabel(first) : `${monthLabel(first)} – ${monthLabel(last)}`;
}

// Two comparisons for a single month: the month before, and the same month a
// year earlier. Deliberately NOT a chart - two rows of "reference figure,
// then the change" is the whole fact, and a chart of two points would be the
// duplicate rendering this file exists to prevent.
//
// Direction is never carried by colour alone: every row states the arrow and
// the signed size, so the good/bad tint is confirmation, not the message.
export function Deltas({
  comparison,
  format = (n) => Math.round(n).toLocaleString('en-AU'),
  higherIsBetter = true,
  unit = ''
}) {
  if (!comparison) return null;
  const rows = [
    ['the month before', comparison.prev],
    ['a year earlier', comparison.lastYear]
  ].filter(([, r]) => r);
  if (!rows.length) return null;

  return (
    <div className="deltas">
      {rows.map(([caption, r]) => {
        const flat = r.deltaAbs === 0 || (r.deltaPct != null && Math.abs(r.deltaPct) < 0.5);
        const up = r.deltaAbs > 0;
        const tone = flat ? '' : up === higherIsBetter ? 'good' : 'bad';
        const change = r.deltaPct == null
          ? `${up ? '+' : '−'}${format(Math.abs(r.deltaAbs))}${unit}`
          : `${Math.abs(Math.round(r.deltaPct))}%`;
        return (
          <div className="delta-row" key={r.month}>
            <span className="delta-label">
              {monthLabel(r.month)}
              <span className="delta-caption">{caption}</span>
            </span>
            <span className="delta-ref">{format(r.value)}{unit}</span>
            <span className={`delta-change ${tone}`}>
              {flat ? 'level' : <>{up ? '▲' : '▼'} {change}</>}
            </span>
          </div>
        );
      })}
      {comparison.partial && (
        <p className="delta-note">
          {monthLabel(comparison.month)} is only
          {comparison.daysInPeriod ? ` ${comparison.daysInPeriod} days` : ' part of a month'} in, so it
          sits below a whole month by definition — read the change as progress so far,
          not as a drop.
        </p>
      )}
      {!comparison.lastYear && (
        <p className="delta-note">
          A year of history will add the same month last year here — the comparison that
          takes the season out of it.
        </p>
      )}
    </div>
  );
}
