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

const colSum = (rows, idx) =>
  idx < 0 ? null : rows.reduce((a, r) => a + (Number(r[idx]) || 0), 0);

// Returns { solarProductionKwh, ownConsumptionKwh, gridExportKwh,
//           gridImportFroniusKwh, totalConsumptionKwh, days }
// Column keywords are best-effort against Fronius export headers; adjust
// keyword lists here if a future export renames columns.
export async function parseFronius(file) {
  const buf = await file.arrayBuffer();
  const rows = sheetRows(new Uint8Array(buf));
  const header = rows[0] ?? [];
  const data = dataRows(rows);

  const production = findCol(header, 'production');
  const consumption = findCol(header, 'consumption');
  const feedIn = findCol(header, 'feed');       // grid export / feed-in
  const fromGrid = findCol(header, 'from', 'grid'); // grid import

  const solar = colSum(data, production);
  const cons = colSum(data, consumption);
  const exp = colSum(data, feedIn);
  const imp = colSum(data, fromGrid);

  return {
    solarProductionKwh: solar,
    totalConsumptionKwh: cons,
    gridExportKwh: exp,
    gridImportFroniusKwh: imp,
    ownConsumptionKwh: cons != null && imp != null ? cons - imp : null,
    days: data.length,
    _rows: data.length
  };
}
