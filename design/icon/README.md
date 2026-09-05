# design/icon/

The **app icon**: the master artwork, the script that renders it, and the
canvas the four directions were chosen from.

## What ships

- `icon.svg` — the master, 512×512. **This is the source of truth**; the PNGs
  in `public/icons/` are output.
- `render-png.mjs` — draws it into `public/icons/icon-{512,192}.png`. Each size
  is laid out NATIVELY at that pixel size rather than downscaled from 512, so
  a 10px corner radius stays a corner rather than a smudge. Run it after any
  edit to `icon.svg`:

  ```
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node design/icon/render-png.mjs
  ```

## The canvas

- `build-artboards.mjs` — the generator. Each direction is authored ONCE as
  SVG in `ICONS`, then rendered five times per board (home-screen size, circle
  mask, 64/48/32). **Edit this, never the `.dc.html` files** — they are output,
  and a hand edit is lost on the next run. The `a` entry here and `icon.svg`
  are the same drawing in two places; keep them in step if the icon changes.
- `Current.dc.html` — the icon as it shipped up to v2.19.0, and the mask problem.
- `Main.dc.html` — the chosen direction, shipped in v2.19.1.
- `OptionB/C/D.dc.html` — the three not taken, kept on the canvas' second page
  as the record of what was considered.
- `canvas.json` — artboard layout and pages.

Regenerate with `node design/icon/build-artboards.mjs`, then re-seed the
canvas from all six files.

Not part of the build. Vite only bundles `src/` and `public/`, so nothing here
ships to GitHub Pages. The seeded canvas bundle is gitignored (~2.5 MB, the
editor is baked into every one) — re-seed it rather than committing it.

## Why the icon was replaced

`vite.config.js` declares both sizes `purpose: 'any maskable'`. A maskable
icon may be cropped to a circle covering the **inner 80%** (radius 204.8 on a
512 canvas), and every ray of the old sun ran past that — cropped, it was a
plain yellow disc. Everything here is drawn inside that circle, which is what
the circle specimen on each board shows: the real crop, not a mock-up.

In the shipped icon the furthest marks from centre are the top ray tip (193,
including the round cap) and the outer bar corners (184). **Re-measure against
204.8 before moving anything** — there is no build check for this, and the
failure only shows up on an installed phone.

Colours are the app's own (`src/styles/app.css`): `#0f172a` background,
`#facc15` accent, `#34d399` for money, `#60a5fa` for the panel.
