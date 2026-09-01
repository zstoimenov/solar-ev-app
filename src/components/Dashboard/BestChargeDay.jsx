// BestChargeDay - the one thing the weather forecast changes about the car:
// which day this week to put it on the charger so the energy comes off the
// roof instead of off the bill.
//
// Deliberately small. The full 7-day picture lives on Energy; this panel
// answers one question and stops. It shares Energy's cached fetch through
// useForecast, so opening this screen does not hit the network again.
//
// Two honest limits, both stated in the panel rather than buried:
//   * "Spare" is a DAILY energy figure - production minus the house's own
//     typical daily draw. It does not model when in the day the sun and the
//     load actually line up, and it does not know the battery's state.
//   * With no fitted yield (see data/forecast.js), it falls back to naming
//     the sunniest day from the forecast's own radiation figures, which is
//     still the right answer to "when", just without a kWh attached.

import React from 'react';
import InfoPopover from '../InfoPopover.jsx';
import { Lede } from '../Screens/parts.jsx';
import useForecast from './useForecast.js';
import { bestChargeDay, typicalHouseLoadPerDay } from '../../data/forecast.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function whenLabel(dateStr, index) {
  if (index === 0) return 'today';
  if (index === 1) return 'tomorrow';
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(d.getTime()) ? dateStr : `on ${DAY_NAMES[d.getDay()]}`;
}

const kwh = (n) => `${Math.round(n)} kWh`;

export default function BestChargeDay({ state }) {
  const { data, hasLocation } = useForecast(state);

  if (!hasLocation) {
    return (
      <div className="panel">
        <h3 className="panel-title">Best day to charge</h3>
        <p className="small">
          Turn on the 7-day forecast at the top of the Energy screen and this will name
          the day this week with the most solar going spare for the car.
        </p>
      </div>
    );
  }

  const days = data?.days ?? [];
  if (!days.length) return null;

  const houseLoad = typicalHouseLoadPerDay(state?.monthlyDigests);
  const ranked = bestChargeDay(days, houseLoad);

  // No fitted yield: the forecast's own radiation still ranks the days.
  if (!ranked) {
    const withSun = days.filter((d) => d.radiationMj != null);
    if (!withSun.length) return null;
    const sunniest = withSun.reduce((a, b) => (b.radiationMj > a.radiationMj ? b : a));
    const idx = days.findIndex((d) => d.date === sunniest.date);
    return (
      <div className="panel">
        <h3 className="panel-title">Best day to charge</h3>
        <Lede>
          The sunniest day this week is <strong>{whenLabel(sunniest.date, idx)}</strong>.
        </Lede>
        <p className="panel-foot">
          How many kWh that is worth on your roof needs more of your own production
          history to work out — see the forecast panel on Energy.
        </p>
      </div>
    );
  }

  const { best, averageOther } = ranked;
  const idx = days.findIndex((d) => d.date === best.date);

  return (
    <div className="panel">
      <h3 className="panel-title">Best day to charge</h3>
      <Lede>
        Charge the car <strong>{whenLabel(best.date, idx)}</strong> — about{' '}
        <strong>{kwh(best.kwh)}</strong> expected
        {averageOther != null && ` against ${kwh(averageOther)} on the other days`}.
      </Lede>
      {best.spareKwh != null && (
        <p className="panel-foot">
          Roughly <strong>{kwh(best.spareKwh)}</strong> of that is beyond what the house
          itself usually draws in a day, so it is what is going spare for the car.
          <InfoPopover label="What 'spare' means here" className="section-info">
            <p>
              The day&apos;s expected production, less this household&apos;s own average
              daily use over the last few complete months with the car&apos;s charging
              taken out of it (otherwise the car would be counted on both sides).
            </p>
            <p>
              It is a whole-day energy figure, not a plan for the day: it does not know
              when the sun and your appliances actually coincide, or where the battery
              will be sitting. Treat it as which day is worth choosing, not as a
              guaranteed number of kilowatt-hours.
            </p>
          </InfoPopover>
        </p>
      )}
    </div>
  );
}
