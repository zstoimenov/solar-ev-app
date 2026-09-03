// WeekVerdict - the one line on Home that is different from yesterday.
//
// Home leads with what changes. Almost everything else on the screen moves
// once a month, at ingest; this moves every time the forecast is refreshed,
// which is what makes opening the app on a Tuesday worth anything.
//
// It is deliberately ONE LINE and not a panel. The full week lives on Energy
// (the seven-column strip) and the charging decision lives on Car
// (BestChargeDay, which says "charge the car on Friday" and explains what
// "spare" means). This says only which day is the good one, so a household
// that opens Home and closes it again has still been told the useful thing.
// If it ever grows a second sentence, a chart, or an InfoPopover, it has
// become a third copy of the same panel and should be deleted instead.
//
// It shares Energy's and Car's cached fetch through useForecast, so it costs
// no extra network request, and it renders nothing at all until the household
// has turned the forecast on and set a location.

import React from 'react';
import { SunIcon } from './icons.jsx';
import useForecast from './useForecast.js';
import { bestChargeDay, typicalHouseLoadPerDay } from '../../data/forecast.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function whenLabel(dateStr, index) {
  if (index === 0) return 'today';
  if (index === 1) return 'tomorrow';
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(d.getTime()) ? dateStr : DAY_NAMES[d.getDay()];
}

const kwh = (n) => `${Math.round(n)} kWh`;

export default function WeekVerdict({ state }) {
  const { data, hasLocation } = useForecast(state);
  if (!hasLocation) return null;

  const days = data?.days ?? [];
  if (!days.length) return null;

  const ranked = bestChargeDay(days, typicalHouseLoadPerDay(state?.monthlyDigests), data?.calibration);

  // No fitted yield yet: the forecast's own radiation still ranks the days,
  // which is the whole answer to "which day" - just without a kWh on it.
  if (!ranked) {
    const withSun = days.filter((d) => d.radiationMj != null);
    if (!withSun.length) return null;
    const sunniest = withSun.reduce((a, b) => (b.radiationMj > a.radiationMj ? b : a));
    const idx = days.findIndex((d) => d.date === sunniest.date);
    return (
      <div className="verdict">
        <span className="verdict-icon"><SunIcon /></span>
        <span className="verdict-text">
          The sunniest day this week is <strong>{whenLabel(sunniest.date, idx)}</strong>.
        </span>
      </div>
    );
  }

  const { best } = ranked;
  const idx = days.findIndex((d) => d.date === best.date);

  return (
    <div className="verdict">
      <span className="verdict-icon"><SunIcon /></span>
      <span className="verdict-text">
        Best solar day this week is <strong>{whenLabel(best.date, idx)}</strong>, about{' '}
        <strong>{kwh(best.kwh)}</strong>
        {best.spareKwh != null && <>, with around <strong>{kwh(best.spareKwh)}</strong> spare for the car</>}.
      </span>
    </div>
  );
}
