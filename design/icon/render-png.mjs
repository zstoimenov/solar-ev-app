// Renders icon.svg into the two PNGs the manifest ships. icon.svg is the
// master - never hand-edit the PNGs, change the SVG and re-run this:
//
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node design/icon/render-png.mjs
//
// Each size is rendered NATIVELY (the SVG laid out at that pixel size), not
// downscaled from 512 - a 24px bar rounded to 8px reads better drawn at 192
// than resampled from a 512 raster.
//
// Before shipping a change, re-read the safe-zone note in icon.svg. See
// CLAUDE.md, "The app icon is maskable".
import { readFileSync } from 'node:fs';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const here = new URL('.', import.meta.url).pathname;
const svg = readFileSync(`${here}icon.svg`, 'utf8');
const OUT = `${here}../../public/icons/`;
const SIZES = [512, 192];

const browser = await chromium.launch();
for (const size of SIZES) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<style>html,body{margin:0;padding:0}svg{display:block}</style>` +
      svg.replace(/width="512" height="512"/, `width="${size}" height="${size}"`),
    { waitUntil: 'load' }
  );
  await page.screenshot({ path: `${OUT}icon-${size}.png`, omitBackground: false });
  await page.close();
  console.log(`icon-${size}.png`);
}
await browser.close();
