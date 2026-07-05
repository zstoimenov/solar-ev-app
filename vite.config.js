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
      workbox: {
        // Offline app shell only. No data is precached beyond the shell +
        // the shipped seed file; the app never makes data network calls.
        globPatterns: ['**/*.{js,css,html,png,svg,json,webmanifest}'],
        navigateFallback: `${BASE}index.html`
      }
    })
  ]
});
