// parseWattpilot.js - Wattpilot "Energy balance" monthly XLSX -> EV charging fields.
// Same XLSX layout rules as Fronius (headers row 1, units row 2, data row 3+,
// stop at first `None`). Critically, the PV / battery / grid source columns are
// located by SCANNING the header row for keywords - their positions are NOT fixed.

import * as XLSX from 'xlsx';

function sheetRows(fileBuf) {
  const wb = XLSX.read(fileBuf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
}

function dataRows(rows) {
  const out = [];
  for (let i = 2; i < rows.length; i++) {
    const c0 = rows[i]?.[0];
    if (c0 == null || String(c0).trim() === 'None' || String(c0).trim() === '') break;
    out.push(rows[i]);
  }
  return out;
}

function findCol(header, ...keywords) {
  const lc = header.map((h) => (h == null ? '' : String(h).toLowerCase()));
  for (let i = 0; i < lc.length; i++) {
    if (keywords.every((k) => lc[i].includes(k.toLowerCase()))) return i;
  }
  return -1;
}

const colSum = (rows, idx) =>
  idx < 0 ? null : rows.reduce((a, r) => a + (Number(r[idx]) || 0), 0);

// Count days on which the grid-source column was > 0 (EV grid charging days).
function daysWithGrid(rows, idx) {
  if (idx < 0) return null;
  return rows.reduce((a, r) => a + ((Number(r[idx]) || 0) > 0 ? 1 : 0), 0);
}

// Returns { evTotalChargedKwh, evFromPvKwh, evFromBatteryKwh,
//           evFromHomeGridKwh, evGridChargingDays }
export async function parseWattpilot(file) {
  const buf = await file.arrayBuffer();
  const rows = sheetRows(new Uint8Array(buf));
  const header = rows[0] ?? [];
  const data = dataRows(rows);

  // Keyword scan - positions vary between exports.
  const pvCol = findCol(header, 'pv');
  const batteryCol = findCol(header, 'battery');
  const gridCol = findCol(header, 'grid');

  const fromPv = colSum(data, pvCol);
  const fromBattery = colSum(data, batteryCol);
  const fromHomeGrid = colSum(data, gridCol);
  const total = [fromPv, fromBattery, fromHomeGrid].reduce(
    (a, v) => (v == null ? a : a + v),
    0
  );

  return {
    evTotalChargedKwh: total,
    evFromPvKwh: fromPv,
    evFromBatteryKwh: fromBattery,
    evFromHomeGridKwh: fromHomeGrid,
    evGridChargingDays: daysWithGrid(data, gridCol)
  };
}
