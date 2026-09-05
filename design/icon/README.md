# design/icon/

Working files for the **app icon** design canvas — four replacement
directions for `public/icons/icon-{192,512}.png`.

- `build-artboards.mjs` — the generator. Each icon is authored ONCE as SVG in
  `ICONS`, then rendered five times per board (home-screen size, circle mask,
  64/32/48). **Edit this, never the `.dc.html` files** — they are output, and a
  hand edit is lost on the next run.
- `Current.dc.html` — the icon as it ships at v2.19, and the mask problem.
- `Main.dc.html` — Option A, the leading candidate. Per the design skill's
  convention `Main` holds the front-runner, not a fifth option.
- `OptionB/C/D.dc.html` — the alternates.
- `canvas.json` — artboard layout.

Regenerate with `node design/icon/build-artboards.mjs`, then re-seed the
canvas from all six files.

Not part of the build. Vite only bundles `src/` and `public/`, so nothing here
ships to GitHub Pages. The seeded canvas bundle is gitignored (~2.5 MB, the
editor is baked into every one) — re-seed it rather than committing it.

## Why the icon is being replaced

`vite.config.js` declares both sizes `purpose: 'any maskable'`. A maskable
icon may be cropped to a circle covering the **inner 80%** (radius 204.8 on a
512 canvas), and every ray of the current sun runs past that — cropped, it is
a plain yellow disc. Every option here is drawn inside that circle, which is
what the circle specimen on each board shows: the real crop, not a mock-up.

Colours are the app's own (`src/styles/app.css`): `#0f172a` background,
`#facc15` accent, `#34d399` for money, `#60a5fa` for the panel.
