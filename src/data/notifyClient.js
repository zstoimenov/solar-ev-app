// notifyClient.js - the page half of the notification plumbing: permissions,
// the periodic-sync registration, and an honest status report.
//
// The status report is not decoration. Local notifications on Android depend on
// a chain of things a household cannot see - the app being installed, the
// notification permission, a separate background-sync permission Chrome grants
// silently on engagement, and Chrome actually choosing to fire the sync. When
// nothing arrives, "it is broken" and "Chrome has not fired yet" look
// identical. So the settings page shows every link in that chain and when the
// last sync really happened, rather than a switch that claims to be on.

import { getNotifyState, putNotifyState } from './db.js';
import { defaultNotifySettings } from './notify.js';

export const FORECAST_TAG = 'forecast-check';

// Four hours is a floor, not a schedule: Chrome fires periodic syncs on its own
// judgement, more often for apps that get used. Asking for less than the day
// the notifications actually need gives it room to land inside a window.
const MIN_INTERVAL_MS = 4 * 60 * 60 * 1000;

export async function loadNotifySettings() {
  return { ...defaultNotifySettings(), ...((await getNotifyState()) ?? {}) };
}

export async function saveNotifySettings(next) {
  return putNotifyState(next);
}

const supported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'Notification' in window;

// Installed as a PWA? Periodic background sync is refused outright to a plain
// browser tab, so this is the first thing to report.
export function isInstalled() {
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
    window.navigator.standalone === true
  );
}

export async function notifyStatus() {
  const status = {
    supported: supported(),
    installed: supported() ? isInstalled() : false,
    permission: supported() ? Notification.permission : 'unsupported',
    periodicSyncSupported: false,
    periodicSyncRegistered: false,
    periodicSyncPermission: 'unknown',
    lastSyncAt: null,
    lastNotifiedAt: null,
    lastReason: null
  };
  if (!status.supported) return status;

  const stored = await loadNotifySettings();
  status.lastSyncAt = stored.lastSyncAt;
  status.lastNotifiedAt = stored.lastNotifiedAt;
  status.lastReason = stored.lastReason ?? null;

  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return status;
  status.periodicSyncSupported = 'periodicSync' in reg;
  if (status.periodicSyncSupported) {
    try {
      const tags = await reg.periodicSync.getTags();
      status.periodicSyncRegistered = tags.includes(FORECAST_TAG);
    } catch {
      // getTags can reject in private windows; not knowing is not an error.
    }
  }
  try {
    const p = await navigator.permissions.query({ name: 'periodic-background-sync' });
    status.periodicSyncPermission = p.state;
  } catch {
    status.periodicSyncPermission = 'unknown';
  }
  return status;
}

// Ask for the notification permission (needs the user's tap, which is why this
// is only ever called from a button) and register the periodic sync. Returns
// what actually happened rather than throwing, because a refusal here is a
// normal outcome the settings page has to explain.
export async function enableNotifications() {
  if (!supported()) return { ok: false, reason: 'This browser cannot show notifications.' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, reason: 'Notifications were not allowed. Nothing will be sent.' };
  }

  const reg = await navigator.serviceWorker.ready;
  let periodic = false;
  let note = null;
  if ('periodicSync' in reg) {
    try {
      await reg.periodicSync.register(FORECAST_TAG, { minInterval: MIN_INTERVAL_MS });
      periodic = true;
    } catch (e) {
      note =
        'Android would not schedule background checks yet. This usually means the app ' +
        'is open in a browser tab rather than installed, or Chrome has not seen enough ' +
        'use of it yet. Alerts will still appear when you open the app.';
    }
  } else {
    note =
      'This browser has no background scheduling, so alerts will appear when you open ' +
      'the app rather than arriving on their own.';
  }

  const settings = await loadNotifySettings();
  await saveNotifySettings({ ...settings, enabled: true });
  return { ok: true, periodic, note };
}

export async function disableNotifications() {
  const settings = await loadNotifySettings();
  await saveNotifySettings({ ...settings, enabled: false });
  if (!supported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (reg && 'periodicSync' in reg) {
    try {
      await reg.periodicSync.unregister(FORECAST_TAG);
    } catch {
      // Nothing registered, or the browser refuses to say. Either is fine.
    }
  }
}

// Ask the worker to run now. `test` shows a sample notification so the whole
// path can be proved on this phone; otherwise it runs the real decision,
// ignoring the once-per-period guard, and reports back what it decided.
export async function runCheckNow({ test = false } = {}) {
  if (!supported()) return { sent: false, reason: 'not supported here' };
  const reg = await navigator.serviceWorker.ready;
  if (!reg.active) return { sent: false, reason: 'the app is still starting up' };

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve({ sent: false, reason: 'no answer from the app' }), 15000);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data?.result ?? { sent: false, reason: 'no answer from the app' });
    };
    reg.active.postMessage({ type: test ? 'notify-test' : 'notify-check' }, [channel.port2]);
  });
}
