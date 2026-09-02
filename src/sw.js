// sw.js - the service worker. Two jobs, and they are unrelated to each other.
//
// 1. The offline app shell, exactly as before. This file replaced a generated
//    service worker, so the precaching below has to keep doing what that one
//    did or the app stops working on a train.
//
// 2. The forecast notifications. This is the only reason the shell had to be
//    hand-written: a generated worker cannot carry a `periodicsync` handler.
//
// Everything about the notifications stays inside the same rules as the rest of
// the app. There is no server and no push subscription: the worker wakes, reads
// the household's own IndexedDB, makes the same Open-Meteo request the panel
// already makes, decides locally (data/notify.js), and shows the notification
// itself. Nothing new leaves the device, and the app still holds no API key.
//
// What that costs is precision about WHEN. Chrome decides when a periodicsync
// fires; minInterval is a floor it is free to ignore, and an app the household
// rarely opens gets fired rarely or never. So the decision logic is written
// around windows rather than clock times, and the app repeats anything that
// was missed the next time it is opened. Do not "fix" the timing by adding a
// server - that trade was considered and declined (see CLAUDE.md on cloud
// sync, and on why the weather forecast is allowed to exist at all).

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { getState, getNotifyState, putNotifyState } from './data/db.js';
import { loadForecast } from './data/forecast.js';
import { decideNotification, markSent } from './data/notify.js';

const BASE = import.meta.env.BASE_URL;
export const FORECAST_TAG = 'forecast-check';

// Android's own notification switch for an app is separate from the browser
// permission, so a granted permission can still end in a refusal here.
const REFUSED = 'this phone would not show it — check notifications for the app in Android settings';

// --- 1. The app shell -----------------------------------------------------
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL(`${BASE}index.html`)));

// Matches the old generated worker's autoUpdate behaviour: a new build takes
// over rather than waiting for every tab to close.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// --- 2. The forecast check ------------------------------------------------
// Android can refuse to show a notification even after the browser granted
// permission - the OS-level switch for the app is separate. That refusal has to
// come back as an answer, not as silence: a settings page that says nothing is
// indistinguishable from one that is broken.
async function show(candidate) {
  await self.registration.showNotification(candidate.title, {
    body: candidate.body,
    // One tag per type, so a re-fire replaces the old one in the shade instead
    // of stacking a second copy of the same advice.
    tag: `forecast-${candidate.type}`,
    icon: `${BASE}icons/icon-192.png`,
    badge: `${BASE}icons/icon-192.png`,
    data: { url: BASE, type: candidate.type }
  });
}

// Returns what it decided, so the settings page's "check now" button can say
// why nothing was sent instead of appearing to do nothing.
async function runForecastCheck({ force = false } = {}) {
  const settings = await getNotifyState();
  const stamp = new Date().toISOString();
  if (!settings?.enabled) return { sent: false, reason: 'notifications are off' };

  const state = await getState();
  if (!state) return { sent: false, reason: 'no data in this browser yet' };

  // Same call the panels make, cache and all: a sync that lands minutes after
  // the app was opened costs no request.
  const forecast = await loadForecast(state);
  const { candidate, reason } = decideNotification(
    {
      days: forecast.days,
      calibration: forecast.calibration,
      digests: state.monthlyDigests,
      dailySeries: state.dailySeries
    },
    force ? { ...settings, lastSent: {} } : settings
  );

  if (!candidate) {
    await putNotifyState({ ...settings, lastSyncAt: stamp, lastReason: reason });
    return { sent: false, reason };
  }

  try {
    await show(candidate);
  } catch (e) {
    await putNotifyState({ ...settings, lastSyncAt: stamp, lastReason: REFUSED });
    return { sent: false, reason: REFUSED };
  }
  // Only marked delivered once it actually appeared, so a refusal does not
  // silently consume the one notification this period was allowed.
  await putNotifyState({ ...markSent(settings, candidate), lastSyncAt: stamp, lastReason: null });
  return { sent: true, type: candidate.type, title: candidate.title };
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag !== FORECAST_TAG) return;
  event.waitUntil(runForecastCheck());
});

// Tapping a notification should land on the app that is already open, not a
// second copy of it.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? BASE;
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        if (client.url.includes(BASE) && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })()
  );
});

// The settings page asks for a check on demand - both to prove the whole path
// works on this phone and because a household that just turned it on should not
// have to wait a day to see anything happen.
self.addEventListener('message', (event) => {
  const type = event.data?.type;
  if (type !== 'notify-check' && type !== 'notify-test') return;
  event.waitUntil(
    (async () => {
      let result;
      try {
        if (type === 'notify-test') {
          await show({
            type: 'test',
            title: 'Notifications are working',
            body: 'This is what a forecast alert will look like on this phone.'
          });
          result = { sent: true, type: 'test' };
        } else {
          result = await runForecastCheck({ force: true });
        }
      } catch {
        // Always answer. Without this the page waits out its timeout and can
        // only say "no answer", which is the least useful thing it could say.
        // The browser's own exception text is not shown to a household, for
        // the same reason data/forecast.js never shows "Failed to fetch".
        result = { sent: false, reason: REFUSED };
      }
      // The page replies over a MessageChannel port when it opened one, so the
      // answer goes back to that caller rather than being broadcast.
      const reply = { type: 'notify-result', result };
      if (event.ports?.[0]) event.ports[0].postMessage(reply);
      else event.source?.postMessage(reply);
    })()
  );
});
