// useForecast - one hook shared by the Energy panel and the Car panel so the
// two never issue competing fetches: whichever mounts first fills the cache
// in IndexedDB, and the other reads it back without touching the network.
//
// The effect keys on the LOCATION only, never on the state object. Screens
// rebuild their scoped state on every render, so depending on it would spin
// a fetch loop; the live state is read through a ref at call time instead.

import { useCallback, useEffect, useRef, useState } from 'react';
import { forecastConfig, loadForecast } from '../../data/forecast.js';

export default function useForecast(state) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const location = forecastConfig(state?.config);
  const key = location ? `${location.latitude},${location.longitude}` : null;

  const load = useCallback(async (force) => {
    if (!key) { setData(null); return; }
    setLoading(true);
    try {
      setData(await loadForecast(stateRef.current, { force }));
    } catch (e) {
      // loadForecast already swallows network failures; anything reaching
      // here is a real bug, and the panel still needs to render something.
      setData({ location: null, days: [], calibration: null, fetchedAt: null, error: e.message });
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => { load(false); }, [load]);

  return { data, loading, reload: () => load(true), hasLocation: Boolean(key) };
}
