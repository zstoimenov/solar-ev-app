// NotificationSettings - the Data screen's Alerts page.
//
// The hard part of this feature is not sending a notification, it is being
// straight about when one will arrive. There is no server behind it: the app
// asks Android to wake it every few hours, Android decides whether to, and the
// alert is composed on the phone from data that never leaves it. That is the
// only shape this could take without breaking the app's own rules, and it means
// "you will get this at 6pm" would be a lie.
//
// So the page shows the whole chain - installed, allowed, scheduled, last
// actually run - instead of a switch that claims to be on. When nothing has
// arrived, the household can see which link is missing rather than guessing.

import React, { useCallback, useEffect, useState } from 'react';
import InfoPopover from '../InfoPopover.jsx';
import { NOTIFICATION_TYPES, NOTIFY_GATES } from '../../data/notify.js';
import {
  loadNotifySettings, saveNotifySettings, notifyStatus,
  enableNotifications, disableNotifications, runCheckNow
} from '../../data/notifyClient.js';

const when = (iso) => {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'never';
  return d.toLocaleString('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
};

function Row({ label, ok, detail }) {
  return (
    <div className="fc-status-row">
      <span className={ok ? 'ok-dot' : 'warn-dot'} aria-hidden="true" />
      <span className="fc-status-label">{label}</span>
      <span className="small">{detail}</span>
    </div>
  );
}

export default function NotificationSettings({ state }) {
  const [settings, setSettings] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const refresh = useCallback(async () => {
    setSettings(await loadNotifySettings());
    setStatus(await notifyStatus());
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (!settings || !status) return <p className="small">Loading…</p>;

  const hasLocation = state?.config?.forecast?.latitude != null;

  async function toggleAll() {
    setBusy(true); setMessage(null);
    try {
      if (settings.enabled) {
        await disableNotifications();
        setMessage('Alerts are off. Nothing will be sent.');
      } else {
        const res = await enableNotifications();
        setMessage(res.ok ? res.note ?? 'Alerts are on.' : res.reason);
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function setType(key, on) {
    const next = { ...settings, types: { ...settings.types, [key]: on } };
    setSettings(next);
    await saveNotifySettings(next);
  }

  async function check(test) {
    setBusy(true); setMessage(null);
    try {
      const res = await runCheckNow({ test });
      setMessage(
        res.sent
          ? test
            ? 'Sent. If nothing appeared, Android is blocking notifications for this app.'
            : `Sent: ${res.title}`
          : `Nothing sent — ${res.reason}.`
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="small">
        Alerts about the week&apos;s solar, worked out and shown by your phone itself —
        no account, no server, and nothing sent anywhere.
        <InfoPopover label="How these alerts work" className="section-info">
          <p>
            Your phone wakes the app every few hours, it makes the same weather request the
            forecast panel already makes, and it decides on the spot whether anything is
            worth saying. There is no notification service in between and nothing about your
            energy data leaves the device.
          </p>
          <p>
            The cost of that is timing. Android decides when to wake the app, and it does so
            more often for apps you actually use. So each alert has a window of hours rather
            than a set time, and anything that never went out is shown on the Today screen
            the next time you open the app instead. Nothing is silently dropped.
          </p>
          <p>
            Nothing is sent between {NOTIFY_GATES.QUIET_FROM_HOUR}:00 and{' '}
            {NOTIFY_GATES.QUIET_UNTIL_HOUR}:00, at most one alert goes out a day, and none
            of them appear until there is enough of your own history to put a kWh figure on
            a day (see the forecast panel on Energy).
          </p>
        </InfoPopover>
      </p>

      {!hasLocation && (
        <div className="banner warn compact">
          <span>
            The 7-day forecast is off, so there is nothing to alert on yet. Turn it on at the
            top of the Energy screen first.
          </span>
        </div>
      )}

      <div className="field-section">
        <button className="primary" onClick={toggleAll} disabled={busy || !hasLocation}>
          {settings.enabled ? 'Turn alerts off' : 'Turn alerts on'}
        </button>
        {message && <p className="small" style={{ marginTop: '.5rem' }}>{message}</p>}
      </div>

      <div className="field-section">
        <h3>What to send</h3>
        {NOTIFICATION_TYPES.map((t) => (
          <label className="field row" key={t.key}>
            <input
              type="checkbox"
              checked={settings.types?.[t.key] !== false}
              disabled={!settings.enabled}
              onChange={(e) => setType(t.key, e.target.checked)}
            />
            <span style={{ margin: 0 }}>
              {t.label}
              <span className="hint" style={{ display: 'block' }}>{t.blurb}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="field-section">
        <h3>Status on this phone</h3>
        <Row
          label="Installed to the home screen"
          ok={status.installed}
          detail={status.installed ? 'yes' : 'no — background checks need this'}
        />
        <Row
          label="Notifications allowed"
          ok={status.permission === 'granted'}
          detail={status.permission}
        />
        <Row
          label="Background checks scheduled"
          ok={status.periodicSyncRegistered}
          detail={
            !status.periodicSyncSupported
              ? 'not supported by this browser'
              : status.periodicSyncRegistered
                ? `yes (${status.periodicSyncPermission})`
                : 'not scheduled'
          }
        />
        <Row label="Last background check" ok={Boolean(status.lastSyncAt)} detail={when(status.lastSyncAt)} />
        <Row label="Last alert sent" ok={Boolean(status.lastNotifiedAt)} detail={when(status.lastNotifiedAt)} />
        {status.lastReason && (
          <p className="small">Last check decided: {status.lastReason}.</p>
        )}

        <div className="row" style={{ marginTop: '.6rem', gap: '.5rem' }}>
          <button className="ghost" onClick={() => check(true)} disabled={busy || !settings.enabled}>
            Send a test
          </button>
          <button className="ghost" onClick={() => check(false)} disabled={busy || !settings.enabled}>
            Check now
          </button>
        </div>
        <p className="small">
          &quot;Check now&quot; runs the real decision immediately and reports what it found,
          so you can see what would be sent without waiting for Android to wake the app.
        </p>
      </div>
    </>
  );
}
