// useUiPref - one small per-device UI choice, held in IndexedDB rather than in
// the app state.
//
// The distinction matters: `state` is the household's own record and travels
// inside every backup file, so a preference stored there would follow a
// restore onto a new phone and answer a question that phone was never asked.
// These live under db.js's own `uiPrefs` key, beside weatherCache and
// notifyState, for exactly the same reason.
//
// `ready` is returned because the read is asynchronous: a caller that renders
// one thing when the pref is set and another when it is not would otherwise
// show the wrong one for a frame and then swap it under the reader.

import { useCallback, useEffect, useState } from 'react';
import { getUiPrefs, putUiPrefs } from '../data/db.js';

export default function useUiPref(key, fallback = null) {
  const [value, setValue] = useState(fallback);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const prefs = await getUiPrefs();
      if (!live) return;
      if (key in prefs) setValue(prefs[key]);
      setReady(true);
    })();
    return () => { live = false; };
  }, [key]);

  const set = useCallback(async (next) => {
    setValue(next); // optimistic: the write is local and cannot meaningfully fail
    await putUiPrefs({ [key]: next });
  }, [key]);

  return [value, set, ready];
}
