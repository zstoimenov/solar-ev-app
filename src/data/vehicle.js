// vehicle.js - what a spare-kWh figure means to the car, in the two units the
// car itself shows: a percentage of its battery and a distance.
//
// PURE, like notify.js and insights.js: no DOM, no IndexedDB, no network. It
// is imported by the four places that print "spare" (Energy's forecast card,
// Car's best-day panel, Home's one-line verdict, and the notification
// bodies), so all four can never disagree about what 18 kWh is worth.
//
// It PRODUCES NO NEW ENERGY FIGURE. It divides one that data/forecast.js
// already produced by a constant the household typed in. Nothing here is
// fitted, estimated or stored - which is why it can exist in an app that
// refuses guesses everywhere else.
//
// Both fields are OPTIONAL and INDEPENDENT. A household that fills in only
// the battery size gets a percentage and no distance; one that fills in
// neither sees exactly what it saw before this module existed. There is no
// default battery size and no default consumption: a wrong one would be a
// number the app made up, presented in the same type as one it measured.
//
// WHAT IT DELIBERATELY DOES NOT MODEL: charging losses. Spare kWh is energy
// measured at the meter, and a few percent of it becomes heat in the cable,
// the charger and the pack rather than range. Applying an assumed efficiency
// would be exactly the guess-dressed-up-as-a-number this app avoids, so the
// figures are stated as what they are - a ceiling, before charging losses -
// and the panels' InfoPopovers say so.

// Config is authored by hand in Data -> EV charging data -> Your car, so
// treat anything non-numeric or non-positive as "not set" rather than
// trusting it into a division.
const positive = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null);

// Read the household's car figures out of config. Returns null when neither
// field is usable, so a caller can skip the whole feature with one check.
export function vehicleConfig(config) {
  const v = config?.vehicle;
  if (!v) return null;
  const batteryKwh = positive(v.batteryKwh);
  const consumptionKwhPer100km = positive(v.consumptionKwhPer100km);
  if (batteryKwh == null && consumptionKwhPer100km == null) return null;
  return { batteryKwh, consumptionKwhPer100km };
}

// Turn kWh into what the car's own screen would say. Each output is null
// independently of the other.
//
// The percentage is CLAMPED AT 100: a day with more spare energy than the
// battery holds still only fills the battery, and "140% of the battery" reads
// as an arithmetic slip rather than as good news.
export function spareAsVehicle(kwh, vehicle) {
  if (kwh == null || !Number.isFinite(kwh) || kwh < 0 || !vehicle) return null;
  const pct = vehicle.batteryKwh == null
    ? null
    : Math.min(100, (kwh / vehicle.batteryKwh) * 100);
  const km = vehicle.consumptionKwhPer100km == null
    ? null
    : (kwh / vehicle.consumptionKwhPer100km) * 100;
  if (pct == null && km == null) return null;
  return { pct, km, capped: pct != null && kwh > vehicle.batteryKwh };
}

export const formatPct = (pct) => `${Math.round(pct)}%`;
// Rounded to 5 km above 100 and to 1 km below it: the inputs are a weather
// forecast and a household average, so "93 km" claims a precision neither of
// them has, and reading it as "about 95" is the point.
export const formatKm = (km) => `${km >= 100 ? Math.round(km / 5) * 5 : Math.round(km)} km`;

// The two figures as one short phrase, e.g. "30% · 95 km", for a stats row
// that already carries the kWh. Returns null when there is nothing to add.
export function vehicleParts(kwh, vehicle) {
  const v = spareAsVehicle(kwh, vehicle);
  if (!v) return null;
  const parts = [];
  if (v.pct != null) parts.push(formatPct(v.pct));
  if (v.km != null) parts.push(formatKm(v.km));
  return parts;
}

// The same thing as a clause to hang off a sentence, e.g.
// "around 30% of the battery, or 95 km". Null when nothing is configured.
export function vehicleClause(kwh, vehicle) {
  const v = spareAsVehicle(kwh, vehicle);
  if (!v) return null;
  if (v.pct != null && v.km != null) {
    return `around ${formatPct(v.pct)} of the battery, or ${formatKm(v.km)}`;
  }
  if (v.pct != null) return `around ${formatPct(v.pct)} of the battery`;
  return `around ${formatKm(v.km)} of driving`;
}

// The shortest possible form, for the one-line verdict on Home and the
// notification bodies, where a second clause would cost a line. Prefers the
// percentage - it is the shorter string and the one the car shows first.
export function vehicleShort(kwh, vehicle) {
  const v = spareAsVehicle(kwh, vehicle);
  if (!v) return null;
  return v.pct != null ? formatPct(v.pct) : formatKm(v.km);
}
