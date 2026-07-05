// parseFronius.js - Fronius "Energy balance total" monthly XLSX -> energy fields.
// Parsing rules match the source /ingest-solar skill exactly:
//   headers in row 1, units in row 2, data from row 3;
//   stop at the first `None` in column 1.
// We do NOT ingest 30-min interval data - the monthly totals report only.

import * as XLSX from 'xlsx';

// Read the first worksheet into an array-of-arrays (raw cells).
function sheetRows(fileBuf) {
  const wb = XLSX.read(fileBuf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
}

// Data rows = row index 2 onward, stopping at the first row whose column 1
// is the literal `None` sentinel (or empty).
function dataRows(rows) {
  const out = [];
  for (let i = 2; i < rows.length; i++) {
    const c0 = rows[i]?.[0];
    if (c0 == null || String(c0).trim() === 'None' || String(c0).trim() === '') break;
    out.push(rows[i]);
  }
  return out;
}

// Locate a column by scanning the header row (row 1) for a keyword.
function findCol(header, ...keywords) {
  const lc = header.map((h) => (h == null ? '' : String(h).toLowerCase()));
  for (let i = 0; i < lc.length; i++) {
    if (keywords.every((k) => lc[i].includes(k.toLowerCase()))) return i;
  }
  return -1;
}

// Row 2 (index 1) carries the unit for each column, e.g. "[Wh]" or "[kWh]".
// Exports vary between Wh and kWh, so scale to kWh using that row rather
// than assuming a fixed unit.
function unitScale(unitsRow, idx) {
  if (idx < 0) return 1;
  const u = String(unitsRow?.[idx] ?? '').toLowerCase();
  if (u.includes('kwh')) return 1;
  if (u.includes('wh')) return 0.001;
  return 1;
}

const colSum = (rows, idx, scale = 1) =>
  idx < 0 ? null : rows.reduce((a, r) => a + (Number(r[idx]) || 0), 0) * scale;

// Count of days with (effectively) zero solar production - derived from the
// same daily rows used for the monthly total, no manual entry required.
function countZeroProductionDays(rows, idx, scale) {
  if (idx < 0 || rows.length === 0) return null;
  return rows.reduce((a, r) => a + ((Number(r[idx]) || 0) * scale < 0.01 ? 1 : 0), 0);
}

// First data row's date ("01.06.2026", dd.MM.yyyy) -> "2026-06", so the
// Ingest Wizard can auto-fill the month field from the file itself.
function monthFromFirstRow(rows) {
  const d = String(rows?.[0]?.[0] ?? '').match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return d ? `${d[3]}-${d[2].padStart(2, '0')}` : null;
}

// Returns { solarProductionKwh, ownConsumptionKwh, gridExportKwh,
//           gridImportFroniusKwh, totalConsumptionKwh, days,
//           zeroProductionDays, month }
// Column keywords are best-effort against Fronius export headers; adjust
// keyword lists here if a future export renames columns.
export async function parseFronius(file) {
  const buf = await file.arrayBuffer();
  const rows = sheetRows(new Uint8Array(buf));
  const header = rows[0] ?? [];
  const unitsRow = rows[1] ?? [];
  const data = dataRows(rows);

  const production = findCol(header, 'production');
  const consumption = findCol(header, 'consumption');
  const feedIn = findCol(header, 'to', 'grid');     // grid export / feed-in ("Energy to grid")
  const fromGrid = findCol(header, 'from', 'grid'); // grid import ("Energy from grid")

  const productionScale = unitScale(unitsRow, production);
  const solar = colSum(data, production, productionScale);
  const cons = colSum(data, consumption, unitScale(unitsRow, consumption));
  const exp = colSum(data, feedIn, unitScale(unitsRow, feedIn));
  const imp = colSum(data, fromGrid, unitScale(unitsRow, fromGrid));

  return {
    solarProductionKwh: solar,
    totalConsumptionKwh: cons,
    gridExportKwh: exp,
    gridImportFroniusKwh: imp,
    ownConsumptionKwh: cons != null && imp != null ? cons - imp : null,
    days: data.length,
    _rows: data.length,
    zeroProductionDays: countZeroProductionDays(data, production, productionScale),
    month: monthFromFirstRow(data)
  };
}
