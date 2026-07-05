// parseWattpilotSessions.js - the Wattpilot MOBILE APP's charging-session
// export (JSON), not the "Energy balance" monthly XLSX used elsewhere. Each
// row is one charging session with a wall-clock start/end and total energy
// delivered - granularity the Energy Balance export doesn't have, which lets
// us bucket EV charging by time-of-day band (see data/evTimeOfUseSplit.js).
// It does NOT tell us the PV/battery/grid split for a given session - that
// still only exists as a daily total elsewhere.

// "31.05.2026 17:50:29" -> a monotonic ms value for interval arithmetic.
// Deliberately NOT a real UTC conversion - Date.UTC here is just a
// convenient wall-clock clock (the string is already local time, and we
// never convert this back to a real instant), so this is safe regardless of
// what timezone the browser happens to run in.
function parseWattpilotDateTime(str) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(str ?? '');
  if (!m) return null;
  const [, dd, mm, yyyy, HH, MI, SS] = m;
  return Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(HH), Number(MI), Number(SS));
}

// Returns [{ sessionId, start, end, energyKwh }] (original date strings kept
// for display/export; startMs/endMs are recomputed on demand where needed).
// Rows that don't parse (missing start/end/energy) are silently skipped.
export function parseWattpilotSessions(json) {
  const rows = json?.data ?? [];
  const out = [];
  for (const r of rows) {
    const startMs = parseWattpilotDateTime(r.start);
    const endMs = parseWattpilotDateTime(r.end);
    const energyKwh = Number(r.energy);
    if (startMs == null || endMs == null || endMs <= startMs || !Number.isFinite(energyKwh) || energyKwh <= 0) {
      continue;
    }
    out.push({
      sessionId: r.session_identifier || `session_${r.session_number}`,
      start: r.start,
      end: r.end,
      energyKwh
    });
  }
  return out;
}

export { parseWattpilotDateTime };
