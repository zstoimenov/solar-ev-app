// insights.js - the app explaining its own numbers, in words and in parts.
//
// Every screen before this one answered a question in isolation and left the
// obvious follow-up hanging. Money says "+$75 against a year ago" and never
// says why. Home says "4% ahead of a normal September" and never says whether
// that was sun, usage, or the car. This module answers the "why", and it does
// it WITHOUT modelling anything.
//
// THE ONE PROPERTY THAT MAKES THIS SAFE TO SHIP. The combined saving is,
// exactly, a sum of five figures already stored on every digest:
//
//   combined = gridCostAvoided + exportCredit + counterfactual
//              - evElectricityCost - evHomeChargingCost
//
// (buildDigest.js: layer1 = gridCostAvoided + exportCredit, layer2 =
// counterfactual - evElectricityCost - evHomeChargingCost, combined = the two
// added.) So the CHANGE in the saving between two months is five subtractions
// that sum to the change in the total. Nothing here is apportioned, weighted,
// estimated, or assumed. That is the entire licence for this module to exist
// in an app that refuses guesses everywhere else.
//
// It follows that the sum is CHECKABLE, and it is checked on every call. If
// the parts do not reconcile with the total to within a cent or two, that is
// reported as an explicit "not accounted for" amount - never absorbed into
// the other rows to make the arithmetic look tidy. The usual cause is a
// pre-v1.10 month with no evHomeChargingCostAud (an optional digest field),
// which the Recompute Financials action fills in. A breakdown that silently
// swallows its own residual is a story, not an explanation; don't "fix" the
// reconciliation check by widening the tolerance until it always passes.
//
// THE VOLUME/PRICE SPLIT is the second level, and it matters because "you
// self-supplied less energy" and "the rate you would have paid went up" are
// completely different news and only one of them is yours to act on. Both
// rates come back out of stored fields exactly - the import rate is
// gridCostAvoided / (consumption - import), because the supply charge sits in
// both the baseline and the actual and cancels; the feed-in rate is
// exportCredit / export.
//
// The split uses the SYMMETRIC (Bennet) form, dq*(p0+p1)/2 + dp*(q0+q1)/2,
// which sums to d(q*p) exactly with no cross term left over. The naive
// dq*p0 + dp*q0 leaves a residual that has to be explained or hidden, and
// hiding it is the thing this module is built not to do.
//
// ENERGY AND MONEY, BUT NEVER A NEW NUMBER. Nothing here is stored, and
// buildDigest.js remains the only place a financial figure is produced. This
// module reads figures that already exist and subtracts them. It is pure - no
// DOM, no IndexedDB, no fetch - for the same reason notify.js is: so it can be
// reasoned about and, one day, tested without a browser.

import { typicalForMonth, dailyForMonth, bestDay } from './daily.js';
import { shiftMonth } from './compare.js';

// Rounding on the digest is to the cent, and the total is rounded separately
// from the parts, so a perfect reconciliation can still be a cent or two out
// on arithmetic alone. This is that allowance and nothing more - it is not a
// dial to turn up until awkward months pass.
const RECONCILE_TOLERANCE_AUD = 0.05;

// A contributor smaller than this share of all the movement is noise on a
// phone screen. Folded into one "everything else" row rather than printed.
const SMALL_PART_SHARE = 0.02;

const round2 = (n) => Math.round(n * 100) / 100;

// The five parts of the saving, in the order they are defined in
// buildDigest.js. `sign` is how the field enters the saving: a cost enters
// negative, so a cost going UP moves the saving DOWN.
//
// `quantity` is what the figure is a price times, where one exists - the
// input to the volume/price split. It is deliberately absent for home
// charging: that figure blends two different rates (the import rate on the
// grid share, the feed-in rate on the solar share), so there is no single
// price to split out and inventing one would be exactly the guess this
// module is built to avoid.
export const ATTRIBUTION_PARTS = [
  {
    key: 'gridCostAvoided',
    field: 'gridCostAvoidedAud',
    sign: 1,
    label: 'Your own power covering the house',
    quantity: {
      // Consumption the grid did not have to supply. The supply charge is in
      // both the baseline and the actual, so this ratio is the usage rate.
      of: (d) =>
        d.totalConsumptionKwh != null && d.gridImportFroniusKwh != null
          ? d.totalConsumptionKwh - d.gridImportFroniusKwh
          : null,
      unit: 'kWh',
      volumeLabel: 'how much you self-supplied',
      priceLabel: 'the rate it saved you'
    }
  },
  {
    key: 'exportCredit',
    field: 'exportCreditAud',
    sign: 1,
    label: 'What you sold back',
    quantity: {
      of: (d) => d.gridExportKwh,
      unit: 'kWh',
      volumeLabel: 'how much you exported',
      priceLabel: 'the feed-in rate'
    }
  },
  {
    key: 'counterfactual',
    field: 'ceratoCounterfactualAud',
    sign: 1,
    label: 'Petrol you did not buy',
    quantity: {
      of: (d) => d.daysInPeriod,
      unit: 'days',
      volumeLabel: 'the length of the month',
      priceLabel: 'the running cost per day'
    }
  },
  {
    key: 'publicCharging',
    field: 'evElectricityCostAud',
    sign: -1,
    label: 'Paid public charging',
    quantity: {
      of: (d) => d.evPublicTripKwh,
      unit: 'kWh',
      volumeLabel: 'how much you bought away from home',
      priceLabel: 'what it cost per kWh'
    }
  },
  {
    key: 'homeCharging',
    field: 'evHomeChargingCostAud',
    sign: -1,
    label: 'Charging the car at home',
    quantity: null
  }
];

// dq*(p0+p1)/2 + dp*(q0+q1)/2. Exact: the two terms sum to q1*p1 - q0*p0 with
// no cross term, which is why this form is used rather than a base-period
// split that leaves a residual to explain away.
function splitPart(part, ref, subject) {
  const q = part.quantity;
  if (!q) return null;
  const q0 = q.of(ref);
  const q1 = q.of(subject);
  const v0 = ref[part.field];
  const v1 = subject[part.field];
  // A zero quantity has no price to recover - dividing by it would invent one.
  if (q0 == null || q1 == null || !(q0 > 0) || !(q1 > 0)) return null;
  if (v0 == null || v1 == null) return null;

  const p0 = v0 / q0;
  const p1 = v1 / q1;
  const volumeDelta = round2(part.sign * (q1 - q0) * ((p0 + p1) / 2));
  const priceDelta = round2(part.sign * (p1 - p0) * ((q0 + q1) / 2));
  // Which half did the work. A half worth less than this share of the row is
  // not worth a clause of its own - saying "the rate went from 8.00 to 8.00"
  // is a sentence about nothing, and it buries the half that did move.
  const total = Math.abs(volumeDelta) + Math.abs(priceDelta);
  const minor = total * 0.1;
  const shape =
    total < 0.005 ? 'none'
      : Math.abs(volumeDelta) < minor ? 'price'
        : Math.abs(priceDelta) < minor ? 'volume'
          : 'both';
  return {
    shape,
    volumeDelta,
    priceDelta,
    q0,
    q1,
    p0,
    p1,
    unit: q.unit,
    volumeLabel: q.volumeLabel,
    priceLabel: q.priceLabel
  };
}

// Why one month's saving differs from another's, decomposed into the five
// stored figures it is the sum of. `reference` is any earlier month - the UI
// offers the month before and the same month a year earlier, which are the
// two that mean something (see compare.js on why the year-earlier one is the
// important one in a place with seasons).
//
// Returns null when there is nothing to compare, never a half-answer.
export function savingAttribution(digests, month, reference) {
  if (!Array.isArray(digests) || !month || !reference) return null;
  const subject = digests.find((d) => d.month === month) ?? null;
  const ref = digests.find((d) => d.month === reference) ?? null;
  if (!subject || !ref) return null;
  if (subject.combinedSavingAud == null || ref.combinedSavingAud == null) return null;

  const totalDelta = round2(subject.combinedSavingAud - ref.combinedSavingAud);

  const parts = [];
  for (const part of ATTRIBUTION_PARTS) {
    const v0 = ref[part.field];
    const v1 = subject[part.field];
    // An optional field missing on either month makes this part unknowable.
    // It is left out, which pushes it into the residual below and trips the
    // reconciliation flag - the honest outcome, not a zero.
    if (v0 == null || v1 == null) continue;
    const delta = round2(part.sign * (v1 - v0));
    parts.push({
      key: part.key,
      label: part.label,
      delta,
      from: v0,
      to: v1,
      split: splitPart(part, ref, subject)
    });
  }

  const explained = round2(parts.reduce((a, p) => a + p.delta, 0));
  const residual = round2(totalDelta - explained);
  const reconciles = Math.abs(residual) <= RECONCILE_TOLERANCE_AUD;

  // Biggest mover first: the answer to "why" is almost always the top row,
  // and a household should not have to scan five rows to find it.
  parts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // A part that rounds to nothing did not move, and a row reading "+$0.00" is
  // a line of screen saying so at length. They are dropped outright rather
  // than folded, because they contribute nothing to fold.
  const moved = parts.filter((p) => Math.abs(p.delta) >= 0.005);

  // Fold the remaining also-rans into one row. Only when there are at least
  // two of them - a single small row is detail, two or more is noise.
  const sumAbs = moved.reduce((a, p) => a + Math.abs(p.delta), 0);
  const floor = sumAbs * SMALL_PART_SHARE;
  const small = moved.filter((p) => Math.abs(p.delta) < floor);
  let shown = moved;
  if (small.length >= 2) {
    shown = moved.filter((p) => Math.abs(p.delta) >= floor);
    shown.push({
      key: 'other',
      label: 'Everything else',
      delta: round2(small.reduce((a, p) => a + p.delta, 0)),
      from: null,
      to: null,
      split: null,
      folded: small.length
    });
  }

  return {
    month,
    reference,
    value: subject.combinedSavingAud,
    referenceValue: ref.combinedSavingAud,
    totalDelta,
    parts: shown,
    // The one volume/price split the panel shows. Any more than one and the
    // panel becomes a spreadsheet. Preference goes to a row where BOTH halves
    // actually moved - that is the case the split exists to reveal (you
    // exported more AND the rate was cut) - falling back to the biggest row
    // that has a split at all.
    lead: shown.find((p) => p.split?.shape === 'both') ?? shown.find((p) => p.split) ?? null,
    residual: reconciles ? null : residual,
    reconciles,
    partial: subject.partialMonth === true || ref.partialMonth === true,
    subjectPartial: subject.partialMonth === true,
    referencePartial: ref.partialMonth === true
  };
}

// The two reference months worth offering, filtered to the ones that exist.
// Same pair Deltas renders, so the two surfaces can never disagree about
// what "a year earlier" means.
export function attributionOptions(digests, month) {
  if (!Array.isArray(digests) || !month) return [];
  const has = (m) => digests.some((d) => d.month === m && d.combinedSavingAud != null);
  const out = [];
  const lastYear = shiftMonth(month, -12);
  const prev = shiftMonth(month, -1);
  // Year-earlier first: it is the one that removes the season, and therefore
  // the one that should be on screen by default.
  if (has(lastYear)) out.push({ key: 'lastYear', month: lastYear, caption: 'a year earlier' });
  if (has(prev)) out.push({ key: 'prev', month: prev, caption: 'the month before' });
  return out;
}

// --- The month in words ---------------------------------------------------
// Sentences are returned as SEGMENTS rather than strings so the figures can be
// emphasised without this module importing React or emitting markup. `em` is
// "this is a number, set it in the app's figure weight" - a presentation hint,
// not styling.
const seg = (text, em = false) => ({ text, em });

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const monthName = (m) => MONTH_NAMES[Number(m.slice(5, 7)) - 1];
// "a August" is the kind of thing that makes generated prose read as
// generated. Only three month names start with a vowel sound.
const article = (name) => (/^[AO]/.test(name) ? 'an' : 'a');
const kwhText = (n) => `${Math.round(n).toLocaleString('en-AU')} kWh`;

// What the month did, in the register a person would use out loud. Every
// finding is gated on its own inputs and simply absent when they are missing -
// the app does not fill a gap to keep a paragraph even.
//
// Deliberately NOT about the money: the attribution above is the money, and
// saying it twice at two lengths is the duplicate rendering this app keeps
// having to cut. These are the energy facts the figures came from.
export function monthNarrative(digests, dailySeries, month) {
  if (!Array.isArray(digests) || !month) return [];
  const d = digests.find((x) => x.month === month);
  if (!d) return [];

  const out = [];
  const name = monthName(month);

  // 1. Production, against this household's own history of the same month -
  //    the only comparison that survives Perth's seasons.
  if (d.solarProductionKwh != null) {
    const typical = typicalForMonth(digests, month);
    if (typical?.kwh) {
      const pct = Math.round(((d.solarProductionKwh - typical.kwh) / typical.kwh) * 100);
      out.push({
        key: 'production',
        segments: Math.abs(pct) < 3
          ? [
              seg('The roof made '), seg(kwhText(d.solarProductionKwh), true),
              seg(`, about what ${article(name)} ${name} normally gives.`)
            ]
          : [
              seg('The roof made '), seg(kwhText(d.solarProductionKwh), true),
              seg(' — '), seg(`${Math.abs(pct)}% ${pct > 0 ? 'above' : 'below'}`, true),
              seg(` than ${article(name)} typical ${name}.`)
            ]
      });
    } else {
      out.push({
        key: 'production',
        segments: [
          seg('The roof made '), seg(kwhText(d.solarProductionKwh), true),
          seg(`. A second ${name} of data will give this something to compare against.`)
        ]
      });
    }
  }

  // 2. How much of the house ran on its own power. The headline number for
  //    "is the system doing its job", and the one figure most people quote.
  if (d.selfSufficiencyPct != null) {
    out.push({
      key: 'selfSufficiency',
      segments: [
        seg('Your own power covered '), seg(`${Math.round(d.selfSufficiencyPct)}%`, true),
        seg(' of everything the house used.')
      ]
    });
  }

  // 3. The car, and how much of its charging never touched the grid.
  const evHome =
    (d.evFromPvKwh ?? 0) + (d.evFromBatteryKwh ?? 0) + (d.evFromHomeGridKwh ?? 0);
  const evOwn = (d.evFromPvKwh ?? 0) + (d.evFromBatteryKwh ?? 0);
  if (evHome > 0 && (d.evFromPvKwh != null || d.evFromBatteryKwh != null)) {
    const ownPct = Math.round((evOwn / evHome) * 100);
    out.push({
      key: 'car',
      segments: [
        seg('The car took '), seg(kwhText(evHome), true), seg(' at home, '),
        seg(`${ownPct}%`, true), seg(' of it straight from your own roof and battery.')
      ]
    });
  }

  // 4. Anything odd. A day the roof produced nothing is not a Perth weather
  //    event - it is worth a household knowing about.
  if (d.zeroProductionDays != null && d.zeroProductionDays > 0) {
    out.push({
      key: 'zeroDays',
      segments: [
        seg('The roof produced nothing on '),
        seg(`${d.zeroProductionDays} day${d.zeroProductionDays === 1 ? '' : 's'}`, true),
        seg(' — worth a look if that was not a planned outage.')
      ]
    });
  }

  // 5. The best day, where the daily rows for that month were captured.
  //    Colour rather than a finding, so it goes last and only if there is room.
  const rows = dailyForMonth(dailySeries ?? [], month);
  const best = rows.length ? bestDay(rows) : null;
  if (best?.solarKwh != null && out.length < 4) {
    out.push({
      key: 'bestDay',
      segments: [
        seg('The best single day was '),
        seg(`${Number(best.date.slice(8, 10))} ${name}`, true),
        seg(' at '), seg(kwhText(best.solarKwh), true), seg('.')
      ]
    });
  }

  return out.slice(0, 4);
}
