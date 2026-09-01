# Forecast panel — design canvas

Mockups for reworking `src/components/Dashboard/SolarForecast.jsx` (the
"Next 7 days" panel on Energy) and its sibling `BestChargeDay.jsx` on Car.
Published canvas: https://claude.ai/code/artifact/d62729c3-8476-4180-a31a-1dac909a0c8a

Each `.dc.html` is one artboard, 412px wide (the project's acceptance
width). They reproduce the real components' values rather than approximating
them — `.panel` at 12px radius and 1rem/1.1rem padding, `.lede` at .92rem,
`.panel-foot` above its hairline, and the `.banner.warn` colours — so a
chosen direction can be built without re-deriving the styling.

| Artboard | Direction |
|---|---|
| `Main.dc.html` | **A · Week shape** — vertical range bars; the bar is the likely range, a line marks the middle |
| `Verdict.dc.html` | **B · The verdict** — the answer at the size of the answer; rest of the week collapsed |
| `Ranked.dc.html` | **C · Ranked** — days sorted best-first, so position is the answer |
| `HeatWeek.dc.html` | **D · Heat week** — 7 tiles in the DailyCalendar's own sequential language |
| `NoFitYet.dc.html` | State: not enough history to fit kWh — sunshine only, gap named |
| `Offline.dc.html` | State: cached forecast, plot dimmed so it cannot read as today's |
| `CarPanel.dc.html` | The compact Car-screen sibling |

None of these invent a number to fill the layout, and magnitude is one hue
throughout — see CLAUDE.md's "Presenting information" rules, which they were
drawn against.

## Rebuilding the canvas

The published `.html` is generated and gitignored. Re-seed it from these
sources with the `design` skill's helper, then republish to the same URL:

    node "<skill dir>/seed-canvas.mjs" --template "<skill dir>/payload.template.html" \
      --out solar-forecast-panel.html --title "Solar Forecast Panel" \
      --artboard Main.dc.html --artboard Verdict.dc.html --artboard Ranked.dc.html \
      --artboard HeatWeek.dc.html --artboard NoFitYet.dc.html --artboard Offline.dc.html \
      --artboard CarPanel.dc.html --canvas canvas.json
