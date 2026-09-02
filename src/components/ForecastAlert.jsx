// ForecastAlert - the catch-up half of the notifications, on Home.
//
// Periodic background sync is best effort: Chrome fires it when it feels like
// it, and an app that has not been opened for a week may get nothing at all.
// So the same decision that would have produced a notification is re-run when
// the app is opened, and anything that never went out is said here instead.
// That is what makes the feature honest - a household can miss the buzz, but
// they cannot miss the message.
//
// Showing it here COUNTS as delivery: it is marked sent, so the phone does not
// buzz hours later with advice already read. It is also gated on the household
// having turned notifications on at all, because it is the same feature - not
// a new panel that appears uninvited.

import React, { useEffect, useMemo, useState } from 'react';
import { SunIcon } from './Dashboard/icons.jsx';
import useForecast from './Dashboard/useForecast.js';
import { decideNotification, markSent } from '../data/notify.js';
import { loadNotifySettings, saveNotifySettings } from '../data/notifyClient.js';

export default function ForecastAlert({ state, onGoTo }) {
  const { data } = useForecast(state);
  const [settings, setSettings] = useState(null);
  const [shown, setShown] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let live = true;
    loadNotifySettings().then((s) => { if (live) setSettings(s); });
    return () => { live = false; };
  }, []);

  const candidate = useMemo(() => {
    if (!settings || !data?.days?.length) return null;
    return decideNotification(
      {
        days: data.days,
        calibration: data.calibration,
        digests: state.monthlyDigests,
        dailySeries: state.dailySeries
      },
      settings,
      new Date(),
      { quiet: false }
    ).candidate;
  }, [settings, data, state.monthlyDigests, state.dailySeries]);

  // Capture it once. Marking it sent immediately would otherwise make the
  // banner delete itself on the next render, which is the opposite of the
  // point: it has to stay on screen to have been delivered at all.
  useEffect(() => {
    if (!candidate || shown) return;
    setShown(candidate);
    loadNotifySettings().then((s) => saveNotifySettings(markSent(s, candidate)));
  }, [candidate, shown]);

  if (!shown || dismissed) return null;

  return (
    <div className="attention">
      <span className="attention-icon"><SunIcon /></span>
      <div className="attention-body">
        <div className="attention-title">{shown.title}</div>
        <p className="attention-text">{shown.body}</p>
        <div className="attention-actions">
          <button className="ghost small-btn" onClick={() => onGoTo('Energy')}>
            See the week
          </button>
          <button className="ghost small-btn" onClick={() => setDismissed(true)}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
