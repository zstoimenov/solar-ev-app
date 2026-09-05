import { writeFileSync } from 'node:fs';
const OUT = new URL('.', import.meta.url).pathname;

/* ---------- the icon artwork, one function per option ---------- */

const rays = (cx, cy, r0, r1, sw, color, angles) => angles.map((a) => {
  const t = (a * Math.PI) / 180;
  const s = Math.sin(t), c = Math.cos(t);
  const x1 = (cx + r0 * s).toFixed(1), y1 = (cy - r0 * c).toFixed(1);
  const x2 = (cx + r1 * s).toFixed(1), y2 = (cy - r1 * c).toFixed(1);
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`;
}).join('');

const EIGHT = [0, 45, 90, 135, 180, 225, 270, 315];

const ICONS = {
  current: `
    <rect width="512" height="512" fill="#0f172a"/>
    <g fill="#f5c518">
      ${[...Array(16)].map((_, i) => {
        const a = (i * 22.5 * Math.PI) / 180;
        const pts = [[-17, -152], [17, -152], [11, -248], [-11, -248]]
          .map(([x, y]) => {
            const X = x * Math.cos(a) - y * Math.sin(a);
            const Y = x * Math.sin(a) + y * Math.cos(a);
            return `${(256 + X).toFixed(1)},${(256 + Y).toFixed(1)}`;
          }).join(' ');
        return `<polygon points="${pts}"/>`;
      }).join('')}
    </g>
    <circle cx="256" cy="256" r="137" fill="#f5c518"/>`,

  a: `
    <defs>
      <linearGradient id="aSun" x1="0.3" y1="0" x2="0.7" y2="1">
        <stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#f59e0b"/>
      </linearGradient>
      <linearGradient id="aBar" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="#0d9488"/><stop offset="1" stop-color="#34d399"/>
      </linearGradient>
      <radialGradient id="aGlow" cx="0.5" cy="0.32" r="0.55">
        <stop offset="0" stop-color="#facc15" stop-opacity="0.16"/>
        <stop offset="1" stop-color="#facc15" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="512" height="512" fill="#0f172a"/>
    <rect width="512" height="512" fill="url(#aGlow)"/>
    ${rays(256, 165, 72, 94, 16, '#facc15', EIGHT)}
    <circle cx="256" cy="165" r="56" fill="url(#aSun)"/>
    <rect x="158" y="374" width="44" height="38" rx="10" fill="url(#aBar)"/>
    <rect x="234" y="340" width="44" height="72" rx="10" fill="url(#aBar)"/>
    <rect x="310" y="300" width="44" height="112" rx="10" fill="url(#aBar)"/>`,

  b: `
    <defs>
      <radialGradient id="bSun" cx="0.36" cy="0.3" r="0.78">
        <stop offset="0" stop-color="#fef3c7"/>
        <stop offset="0.55" stop-color="#facc15"/>
        <stop offset="1" stop-color="#ea9a08"/>
      </radialGradient>
      <radialGradient id="bGlow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#facc15" stop-opacity="0.20"/>
        <stop offset="1" stop-color="#facc15" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="512" height="512" fill="#0f172a"/>
    <rect width="512" height="512" fill="url(#bGlow)"/>
    <g transform="translate(256,256)" fill="#facc15" stroke="#facc15" stroke-width="10" stroke-linejoin="round">
      ${EIGHT.map((a) => `<path transform="rotate(${a})" d="M -15 -114 L 15 -114 L 7 -184 L -7 -184 Z"/>`).join('')}
    </g>
    <circle cx="256" cy="256" r="96" fill="url(#bSun)"/>`,

  c: `
    <defs>
      <linearGradient id="cSun" x1="0.25" y1="0" x2="0.75" y2="1">
        <stop offset="0" stop-color="#fde047"/><stop offset="1" stop-color="#eab308"/>
      </linearGradient>
    </defs>
    <rect width="512" height="512" fill="#0f172a"/>
    ${rays(256, 256, 156, 188, 16, '#facc15', EIGHT)}
    <circle cx="256" cy="256" r="140" fill="url(#cSun)"/>
    <path d="M 288 128 L 186 272 L 248 272 L 224 384 L 326 240 L 264 240 Z" fill="#0f172a"/>`,

  d: `
    <defs>
      <linearGradient id="dSun" x1="0.3" y1="0" x2="0.7" y2="1">
        <stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#f59e0b"/>
      </linearGradient>
      <linearGradient id="dPanel" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stop-color="#93c5fd"/><stop offset="1" stop-color="#3b82f6"/>
      </linearGradient>
    </defs>
    <rect width="512" height="512" fill="#0f172a"/>
    ${rays(256, 176, 78, 100, 14, '#facc15', [270, 315, 0, 45, 90])}
    <circle cx="256" cy="176" r="66" fill="url(#dSun)"/>
    <path d="M 200 288 L 392 288 L 352 404 L 160 404 Z" fill="url(#dPanel)"/>
    <g stroke="#0f172a" stroke-width="13" stroke-linecap="butt">
      <line x1="264" y1="288" x2="248" y2="404"/>
      <line x1="328" y1="288" x2="296" y2="404"/>
      <line x1="186" y1="346" x2="372" y2="346"/>
    </g>`
};

const svg = (key, size, extra = '') =>
  `<svg viewBox="0 0 512 512" width="${size}" height="${size}" style="display:block${extra}" aria-hidden="true">${ICONS[key]}</svg>`;

/* ---------- artboard shell ---------- */

const FONTS = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&amp;display=swap">`;

const CSS = `
  body { margin: 0; }
  a { color: #facc15; } a:hover { color: #fde047; }
  .board {
    width: 420px; height: 600px; box-sizing: border-box;
    background: #0b1120; color: #e2e8f0;
    padding: 26px 24px;
    display: flex; flex-direction: column; gap: 20px;
    font-family: "Space Grotesk", system-ui, sans-serif;
  }
  .kicker { font-size: 11px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: #64748b; }
  .name { margin: 7px 0 0; font-size: 23px; font-weight: 600; line-height: 1.1; letter-spacing: -.01em; }
  .why { margin: 8px 0 0; font-size: 13px; line-height: 1.5; color: #94a3b8; text-wrap: pretty; }
  .specimens { display: flex; gap: 20px; align-items: flex-start; }
  .cap { margin-top: 9px; font-size: 10.5px; letter-spacing: .07em; text-transform: uppercase; color: #64748b; }
  .sq { border-radius: 24%; overflow: hidden; }
  .ci { border-radius: 50%; overflow: hidden; }
  .sizes { display: flex; gap: 22px; align-items: flex-end; }
  .note {
    margin-top: auto;
    border-top: 1px solid #1e293b; padding-top: 14px;
    display: flex; flex-direction: column; gap: 5px;
  }
  .note .lab { font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: #64748b; }
  .note .txt { font-size: 12.5px; line-height: 1.5; color: #cbd5e1; text-wrap: pretty; }
`;

const board = ({ kicker, name, why, key, noteLab, noteTxt }) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  ${FONTS}
  <style>${CSS}</style>
</helmet>
<div class="board">
  <div>
    <div class="kicker">${kicker}</div>
    <h2 class="name">${name}</h2>
    <p class="why">${why}</p>
  </div>

  <div class="specimens">
    <div>
      <div class="sq">${svg(key, 180)}</div>
      <div class="cap">On the home screen</div>
    </div>
    <div>
      <div class="ci">${svg(key, 96)}</div>
      <div class="cap">Circle mask</div>
    </div>
  </div>

  <div class="sizes">
    <div><div class="sq">${svg(key, 64)}</div><div class="cap">64</div></div>
    <div><div class="sq">${svg(key, 48)}</div><div class="cap">48</div></div>
    <div><div class="sq">${svg(key, 32)}</div><div class="cap">32</div></div>
  </div>

  <div class="note">
    <div class="lab">${noteLab}</div>
    <div class="txt">${noteTxt}</div>
  </div>
</div>
</x-dc>
</body>
</html>
`;

const FILES = {
  'Current.dc.html': board({
    kicker: 'Today',
    name: 'The sun as it ships',
    why: 'Sixteen rays running to the edge of a 512&nbsp;px square, on the app background.',
    key: 'current',
    noteLab: 'Why it needs fixing',
    noteTxt: 'The manifest asks for a <b>maskable</b> icon, which means Android may crop it to the circle beside it &mdash; and every ray tip goes with it. What is left is a plain yellow blob. It also says nothing beyond &ldquo;sun&rdquo;: no battery, no car, no money.'
  }),
  'Main.dc.html': board({
    kicker: 'Option A',
    name: 'Sun and return',
    why: 'The sun is the source, the rising bars are what it gives back. The only option that says <em>tracker</em> rather than just <em>solar</em>.',
    key: 'a',
    noteLab: 'Trade-off',
    noteTxt: 'Two elements and two colours, so it works hardest at 180&nbsp;px and least at 32. The green is the app&rsquo;s own money colour, which ties the icon to what the app is actually for.'
  }),
  'OptionB.dc.html': board({
    kicker: 'Option B',
    name: 'The sun, done properly',
    why: 'The current idea kept, and fixed: eight tapered rays instead of sixteen thin ones, a lit disc, everything inside the mask&rsquo;s safe circle.',
    key: 'b',
    noteLab: 'Trade-off',
    noteTxt: 'Nothing is lost to a crop and it is unmistakable at 32&nbsp;px. But it is still just a sun &mdash; a weather app could wear it.'
  }),
  'OptionC.dc.html': board({
    kicker: 'Option C',
    name: 'Sun with a charge',
    why: 'A solid solar disc with a bolt cut out of it. Sunlight that ends up in a car.',
    key: 'c',
    noteLab: 'Trade-off',
    noteTxt: 'The boldest shape of the four and the strongest at small sizes &mdash; two silhouettes, no detail to lose. The bolt is a common mark, so it is the least distinctive on a crowded home screen.'
  }),
  'OptionD.dc.html': board({
    kicker: 'Option D',
    name: 'Roof and sun',
    why: 'A panel with a sun over it. This one is about a household, not an energy company.',
    key: 'd',
    noteLab: 'Trade-off',
    noteTxt: 'The most specific of the four, and the most literal. The panel gaps carry the meaning, and they are the first thing to close up at 32&nbsp;px.'
  })
};

for (const [name, html] of Object.entries(FILES)) {
  writeFileSync(`${OUT}${name}`, html);
}

const canvas = {
  artboards: [
    { file: 'Current.dc.html', x: 0, y: 0, w: 420, h: 600, title: 'Today (v2.19)' },
    { file: 'Main.dc.html', x: 500, y: 0, w: 420, h: 600, title: 'Option A - Sun and return' },
    { file: 'OptionB.dc.html', x: 1000, y: 0, w: 420, h: 600, title: 'Option B - The sun, done properly' },
    { file: 'OptionC.dc.html', x: 500, y: 720, w: 420, h: 600, title: 'Option C - Sun with a charge' },
    { file: 'OptionD.dc.html', x: 1000, y: 720, w: 420, h: 600, title: 'Option D - Roof and sun' }
  ],
  annotations: [
    { id: 'note-mask', x: 0, y: -150, w: 420, text: 'The manifest declares the icon "any maskable", so Android is entitled to crop it to a circle covering the inner 80%. Nothing in the current icon respects that circle.\n\nEvery option below is drawn inside it - the circle specimen on each board is the crop, not a mock-up.' },
    { id: 'note-options', x: 500, y: -150, w: 920, text: 'Four directions, drawn at the size they will actually be seen. Palette is the app’s own: #0f172a background, #facc15 accent, #34d399 for money, #60a5fa for the panel.\n\nPick one and I will render the 192 and 512 PNGs and swap them in.' }
  ],
  launch: { view: 'canvas' }
};
writeFileSync(`${OUT}canvas.json`, JSON.stringify(canvas, null, 2));
console.log('wrote', Object.keys(FILES).join(', '), 'canvas.json');
