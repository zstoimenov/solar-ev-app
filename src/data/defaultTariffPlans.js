// defaultTariffPlans.js - Synergy's published A1 and EV Add On rate cards
// (WA, GST inclusive). This is public information Synergy publishes on its
// own website - no household-specific data - so it's safe to ship in the
// bundle and offer as a one-click "load" in TariffPlanEditor.jsx instead of
// making the user retype it. Midday Saver is deliberately excluded (not
// requested).
//
// `financialYear` is the Australian FY the price took effect (Synergy
// reprices 1 July every year) - see data/tariffSchedule.js:financialYearLabel.
// Keep this in sync with public/seed-data_v1.json's config.tariffPlans if
// either changes (the seed is a static JSON file so can't just import this).

export const DEFAULT_TARIFF_PLANS = [
  // A1 - flat rate
  { planName: 'A1', financialYear: 'FY2025-26', supplyChargeCPerDay: 116.0505, bandLabel: 'Flat', from: null, to: null, priceCentsPerKwh: 32.3719 },
  { planName: 'A1', financialYear: 'FY2026-27', supplyChargeCPerDay: 119.2419, bandLabel: 'Flat', from: null, to: null, priceCentsPerKwh: 33.2621 },

  // EV Add On - time-of-day bands (Off Peak is two non-contiguous windows at the same price)
  { planName: 'EV Add On', financialYear: 'FY2025-26', supplyChargeCPerDay: 129.2269, bandLabel: 'Super Off Peak', from: '09:00', to: '15:00', priceCentsPerKwh: 8.6151 },
  { planName: 'EV Add On', financialYear: 'FY2025-26', supplyChargeCPerDay: 129.2269, bandLabel: 'Peak', from: '15:00', to: '21:00', priceCentsPerKwh: 53.8446 },
  { planName: 'EV Add On', financialYear: 'FY2025-26', supplyChargeCPerDay: 129.2269, bandLabel: 'Off Peak', from: '21:00', to: '23:00', priceCentsPerKwh: 23.6916 },
  { planName: 'EV Add On', financialYear: 'FY2025-26', supplyChargeCPerDay: 129.2269, bandLabel: 'Off Peak', from: '06:00', to: '09:00', priceCentsPerKwh: 23.6916 },
  { planName: 'EV Add On', financialYear: 'FY2025-26', supplyChargeCPerDay: 129.2269, bandLabel: 'Overnight', from: '23:00', to: '06:00', priceCentsPerKwh: 19.3841 },

  { planName: 'EV Add On', financialYear: 'FY2026-27', supplyChargeCPerDay: 132.7806, bandLabel: 'Super Off Peak', from: '09:00', to: '15:00', priceCentsPerKwh: 8.8520 },
  { planName: 'EV Add On', financialYear: 'FY2026-27', supplyChargeCPerDay: 132.7806, bandLabel: 'Peak', from: '15:00', to: '21:00', priceCentsPerKwh: 55.3253 },
  { planName: 'EV Add On', financialYear: 'FY2026-27', supplyChargeCPerDay: 132.7806, bandLabel: 'Off Peak', from: '21:00', to: '23:00', priceCentsPerKwh: 24.3431 },
  { planName: 'EV Add On', financialYear: 'FY2026-27', supplyChargeCPerDay: 132.7806, bandLabel: 'Off Peak', from: '06:00', to: '09:00', priceCentsPerKwh: 24.3431 },
  { planName: 'EV Add On', financialYear: 'FY2026-27', supplyChargeCPerDay: 132.7806, bandLabel: 'Overnight', from: '23:00', to: '06:00', priceCentsPerKwh: 19.9172 }
];
