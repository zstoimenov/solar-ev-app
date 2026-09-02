import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Repo name drives the Pages base path so assets resolve at
// https://zstoimenov.github.io/solar-ev-app/
const BASE = '/solar-ev-app/';

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // A HAND-WRITTEN service worker (src/sw.js), not a generated one. The
      // generated worker cannot carry a `periodicsync` handler, which is what
      // fires the forecast notifications with no server behind them. It still
      // precaches the same app shell - see src/sw.js.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Solar, Battery & EV ROI',
        short_name: 'Solar ROI',
        description: 'Local-only tracker for solar, battery and EV return-on-investment.',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      injectManifest: {
        // A CLASSIC worker, not an ES module one. Module service workers are
        // Chrome-only; building IIFE keeps the offline shell working in every
        // browser that had it before this file was hand-written.
        rollupFormat: 'iife',
        // Offline app shell only. No data is precached beyond the shell +
        // the shipped seed file; the only data call the app makes is the
        // weather forecast, which caches itself in IndexedDB.
        globPatterns: ['**/*.{js,css,html,png,svg,json,webmanifest}']
      }
    })
  ]
});
