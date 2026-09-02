# Forecast panel — design canvas

Mockups for reworking `src/components/Dashboard/SolarForecast.jsx` (the
"Next 7 days" panel on Energy) and its sibling `BestChargeDay.jsx` on Car.
Published canvas: https://claude.ai/code/artifact/d62729c3-8476-4180-a31a-1dac909a0c8a

The shipped panel is always the code, not this canvas - these artboards are
the record of what was proposed at each decision point.

Each `.dc.html` is one artboard, 412px wide (the project's acceptance
width). They reproduce the real components' values rather than approximating
them — `.panel` at 12px radius and 1rem/1.1rem padding, `.lede` at .92rem,
`.panel-foot` above its hairline, and the `.banner.warn` colours — so a
chosen direction can be built without re-deriving the styling.

The canvas has two pages.

**Page 1 — Weekend card** (current work). The panel shortened: best day on
top, then today and tomorrow, then the rest-of-week button, then ONE combined
weekend card. The three artboards are identical above that card and differ
only in it.

| Artboard | Treatment |
|---|---|
| `Main.dc.html` | **W1 · One number** — a weekend total and one sentence naming the better day. Shortest; adds no new visual language |
| `WeekendSplit.dc.html` | **W2 · Side by side — CHOSEN, built in v2.7** — each day with its own figure, bar, spare kWh and temperature. Most comparable; tallest |
| `WeekendOneBar.dc.html` | **W3 · One quantity** — leads with the combined kWh, splits it as proportions of one bar |

**Page 2 — Round 1 · directions.** The set the first decision was made from;
**B was chosen** and built into `SolarForecast.jsx` (v2.6).

| Artboard | Direction |
|---|---|
| `Verdict.dc.html` | **B · The verdict** — chosen and shipped |
| `Ranked.dc.html` | **C · Ranked** — days sorted best-first |
| `HeatWeek.dc.html` | **D · Heat week** — 7 tiles in the DailyCalendar's language |
| `NoFitYet.dc.html` | State: not enough history to fit kWh — sunshine only, gap named |
| `Offline.dc.html` | State: cached forecast, plot dimmed so it cannot read as today's |
| `CarPanel.dc.html` | The compact Car-screen sibling |

Direction A (week shape) was Main until B shipped; Main now holds the leading
candidate for the current round, as it should.

None of these invent a number to fill the layout, and magnitude is one hue
throughout — see CLAUDE.md's "Presenting information" rules, which they were
drawn against.

## Rebuilding the canvas

The published `.html` is generated and gitignored. Re-seed it from these
sources with the `design` skill's helper, then republish to the same URL:

    node "<skill dir>/seed-canvas.mjs" --template "<skill dir>/payload.template.html" \
      --out solar-forecast-panel.html --title "Solar Forecast Panel" \
      --artboard Main.dc.html --artboard WeekendSplit.dc.html \
      --artboard WeekendOneBar.dc.html --artboard Verdict.dc.html \
      --artboard Ranked.dc.html --artboard HeatWeek.dc.html --artboard NoFitYet.dc.html \
      --artboard Offline.dc.html --artboard CarPanel.dc.html --canvas canvas.json
