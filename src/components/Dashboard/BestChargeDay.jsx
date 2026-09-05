// BestChargeDay - the one thing the weather forecast changes about the car:
// which day this week to put it on the charger so the energy comes off the
// roof instead of off the bill.
//
// Deliberately small. The full 7-day picture lives on Energy; this panel
// answers one question and stops. It shares Energy's cached fetch through
// useForecast, so opening this screen does not hit the network again.
//
// Two honest limits, both stated in the panel rather than buried:
//   * "Spare" is a DAILY energy figure. Where this household has enough
//     comparable days on record it is MEASURED - how much actually went spare
//     on past days of similar production - and where it does not, it falls
//     back to production minus the house's own typical daily draw, which
//     models neither the timing within the day nor the battery's state.
//   * With no fitted yield (see data/forecast.js), it falls back to naming
//     the sunniest day from the forecast's own radiation figures, which is
//     still the right answer to "when", just without a kWh attached.

import React from 'react';
import InfoPopover from '../InfoPopover.jsx';
import { Lede } from '../Screens/parts.jsx';
import useForecast from './useForecast.js';
import useUiPref from '../useUiPref.js';
import { bestChargeDay, typicalHouseLoadPerDay } from '../../data/forecast.js';
import { vehicleConfig, vehicleClause } from '../../data/vehicle.js';

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
  // Energy already carries the offer and the way back into it. Once it has
  // been declined there, this panel would be the second ad for the same
  // feature on a screen the household came to for something else, so it says
  // nothing at all until the forecast is on.
  const [declined, , prefReady] = useUiPref('forecastDeclined', false);

  if (!hasLocation) {
    if (!prefReady || declined) return null;
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
  const ranked = bestChargeDay(days, houseLoad, data?.calibration);
  // Spare kWh in the units the car shows, when this household has entered
  // them. null otherwise, and the sentence reads exactly as it always has.
  const vehicle = vehicleConfig(state?.config);

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
  const measured = Boolean(best.spareBasis?.startsWith('measured'));
  // One clause, not a second sentence: this is the panel whose whole point is
  // to answer one question and stop.
  const inCarUnits = vehicleClause(best.spareKwh, vehicle);

  return (
    <div className="panel">
      <h3 className="panel-title">Best day to charge</h3>
      <Lede>
        Charge the car <strong>{whenLabel(best.date, idx)}</strong> — about{' '}
        <strong>{kwh(best.kwh)}</strong> expected
        {averageOther != null && ` against ${kwh(averageOther)} on the other days`}.
      </Lede>
      {best.spareKwh != null && (
        <div className="panel-foot">
          {measured ? (
            <>
              On past days like it, about <strong>{kwh(best.spareKwh)}</strong> actually went
              spare, so that is what the car has to work with
              {inCarUnits ? <> — <strong>{inCarUnits}</strong>.</> : '.'}
            </>
          ) : (
            <>
              Roughly <strong>{kwh(best.spareKwh)}</strong> of that is beyond what the house
              itself usually draws in a day, so it is what is going spare for the car
              {inCarUnits ? <> — <strong>{inCarUnits}</strong>.</> : '.'}
            </>
          )}
          <InfoPopover label="What 'spare' means here" className="section-info">
            {measured ? (
              <>
                <p>
                  Measured, not assumed. Of the {best.spareDays} days when this roof made
                  about as much as this one should, the middle one had this much energy with
                  nowhere else to go: what was exported, plus what the car took straight off
                  the panels.
                </p>
                <p>
                  Because it is what really happened, your house, your appliances and your
                  battery are already inside it. It counts only what left the property, so it
                  errs low: energy the car could pull back out of the battery is not in the
                  figure, since whether that is there tomorrow depends on the battery&apos;s
                  state of charge.
                </p>
              </>
            ) : (
              <>
                <p>
                  The day&apos;s expected production, less this household&apos;s own average
                  daily use over the last few complete months with the car&apos;s charging
                  taken out of it (otherwise the car would be counted on both sides).
                </p>
                <p>
                  It is a whole-day energy figure, not a plan for the day: it does not know
                  when the sun and your appliances actually coincide, or where the battery
                  will be sitting. Treat it as which day is worth choosing, not as a
                  guaranteed number of kilowatt-hours. Once enough comparable days are on
                  record, this switches to what actually went spare on them.
                </p>
              </>
            )}
            {inCarUnits && (
              <p>
                The share of the battery and the distance are that same figure divided by
                the numbers you entered under Data &rarr; EV charging data &rarr; Your Car.
                Treat both as a ceiling: a little of the energy becomes heat rather than
                charge on the way into the pack, and the app does not guess how much.
              </p>
            )}
          </InfoPopover>
        </div>
      )}
    </div>
  );
}
