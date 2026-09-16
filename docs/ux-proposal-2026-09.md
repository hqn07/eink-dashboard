# UX / UI / QoL proposals — 2026-09-16

Status: **batch 1 (P10, P4, P5) shipped 2026-09-16.** Everything else is a
proposal. Written after measuring the live system rather than from memory,
and each item says what it costs and what it risks, because several of these
are not obviously worth doing.

The brief: *unified system, easy to use, adequate customisation, effortless
and useful.* Consolidation, new widgets, open-source integration and
appearance retouches are all in scope.

---

## What I measured first

| | |
|---|---|
| Widgets | **30** |
| Variants across all widgets | **43** |
| Form fields across all widgets | **93** |
| Widgets with ≤2 form fields | **13** |
| Widgets with >6 form fields | **3** (weather_forecast 10, weather_hero 9, calendar 7) |
| Palette categories | **10**, four of them with a single member |
| Widgets needing an API key | **1** (`ai`) |
| Editor source | ~6,800 lines JSX; `WidgetForm.jsx` 1,242, `App.jsx` 1,009 |

Two things this measurement corrected, which matter before planning anything:

1. **The stack is keyless except AI.** Weather, forecast, sun, UV and air
   quality all run on Open-Meteo. `fetchWeather()` took an `_apiKey` argument
   and ignored it; `OPENWEATHER_API_KEY` was threaded from `lib/widget-data.js`
   and read by nothing. **Fixed in P10** — the parameter is gone, so the
   documentation cannot rot back.
2. **Two CLAUDE.md gotchas were therefore wrong.** #5 ("Weather NO DATA means
   `OPENWEATHER_API_KEY` is missing or invalid") and #6 ("OpenWeatherMap UV
   endpoint is deprecated") described a provider the code no longer uses.
   **Fixed in P10.**

---

## Diagnosis: three problems, not thirty

### 1. The editor spends its space on the wrong thing

At 1440×900 the canvas — the only thing you actually manipulate — gets the
middle third. A permanent left column holds **Screen Settings** (name, units,
refresh interval): three controls you set once and never touch. A permanent
right column holds **Live preview**, which renders the same screen you are
already looking at, smaller.

Two renderings of one screen, side by side, and the editable one is not the
bigger one.

### 2. Adding a widget is a scroll away from the thing you are adding to

The pool opens *below* the canvas. With 30 cards in 10 categories, the card
you want is often on screen while the canvas you are dropping it onto is not
— and the help text says "drag pool card onto canvas". (Click-to-add does
work — `addToCanvas` in `EditorGrid.jsx:721` — but the help text advertises
the harder gesture.)

### 3. The palette is organised by what engineers built, not by what a user wants

Ten categories for thirty widgets, four of them singletons (Media, News,
System, Money). Meanwhile five separate widgets read the same weather API,
three separate widgets render a price list, and three render a daily text
card. A user scanning the pool has to know that "sun", "UV" and "air quality"
are weather before they can find them.

---

## Proposals

Ordered by **outcome per unit of risk**, not by how quick they are.

### P1 — Canvas-first editor *(high value, medium cost, low risk)*

- Delete the Live preview pane. Move its one real differentiator — the 1-bit
  / 3-colour threshold view — onto the canvas as a toggle. The canvas is
  already bit-accurate; the pane's only edge was showing the threshold pass.
- Move Screen Settings (name, units, refresh) into a popover on the screen
  tab, where the object it configures already lives.
- Result: canvas roughly doubles in width, and the editor stops rendering the
  same screen twice.

**Risk:** people who use the preview pane as a "is this really what ships"
check lose it until the canvas toggle lands. Ship the toggle in the same
change, not after.

### P2 — Consolidate 30 widgets → 21 *(high value, high cost, medium risk)*

Four merges, each replacing N palette entries with one widget and a **view**
or **source** setting. Per the 2026-09-15 rule, these are settings that change
*what information appears*, so they are the kind worth keeping.

| Merge | From | To |
|---|---|---|
| **Weather** | weather_hero, weather_forecast, sun, uv, aqi | one `weather`, views: now / forecast / sun / uv / air |
| **Markets** | stocks, crypto, fx | one `markets`, a symbol list mixing `AAPL`, `BTC-USD`, `EUR/USD` |
| **Clock** | clock, world_clock | one `clock`, a zone list (empty = local) |
| **Daily card** | quote, wordofday, onthisday | one `daily`, source picker |

Net: **30 → 21 palette entries, with more capability, not less** — a Markets
tile can currently show stocks *or* crypto, never both; after the merge it can
mix them. Two weather tiles on one screen still work: they are two instances
with different views.

**Cost is real:** four migrations (the v5–v7 pattern is established and
tested), four sets of settings to unify, and the visual baseline re-captured
each time.

**Risk, stated plainly:** consolidation moves a choice from the palette into a
dropdown. That is a win when the palette is what you scan and the dropdown is
what you set once — which is this product — but it is not free. **Recommend
piloting with Markets alone** (three near-identical widgets, lowest coupling)
and judging the pattern on the panel before committing to the other three.

### P3 — One "Sources" library *(high value, medium cost, low risk)*

`cfg.savedFeeds` already does this for RSS/iCal URLs. Extend the same idea to
everything a tile needs *from the outside*: calendar URLs, feeds, ticker
symbols, GitHub user, webhook keys — all named once in Setup, referenced by
tiles.

This completes the arc `cfg.home` started: **say a fact once, in one place.**
It also makes a new tile cheaper than the tile before it, which is the real
test of whether the system is unified.

### P4 — A "needs attention" strip *(high value, low cost, low risk)*

Today a misconfigured tile says SETUP NEEDED *on the panel*, and the device's
health lives on a separate admin-gated `/status` page. There is no single
place that answers "why does my dashboard look wrong?"

One line at the top of the editor:

```
2 things need attention — Calendar has no feed · Panel last seen 41m ago
```

Clicking a fragment opens the thing that fixes it.

### P5 — Tell the truth about when the panel updates *(medium value, low cost)*

"Push now" cannot wake a sleeping device — deep sleep is not interruptible —
so the honest statement is "the panel will pick this up within N minutes, when
it next wakes." The endpoint already computes that number
(`maxLatencyMinutes`); the UI should show it as a countdown next to the save
bar, and the Device card should show **last seen** and **next wake**.

This is pure expectation-setting, and it is the single most common way a
dashboard feels broken when it is working.

### P6 — First run asks what you care about, not which preset *(high value, medium cost)*

Today: location → pick a layout preset → PIN. The preset is someone else's
idea of a day.

Proposed: location → **checkboxes** (weather, calendar, news, markets, a
clock, something to look at) → generate a layout from the picks using the same
auto-arrange as P7. The first screen is then about the person, and every
widget on it is one they asked for.

### P7 — Auto-arrange *(medium value, medium cost)*

A 24×12 grid with free drag-and-resize asks a beginner to art-direct. Add:

- **Tidy** — bin-pack current tiles at their preferred sizes, no overlaps.
- **Snap presets** — halves, thirds, sidebar+main, applied to the selection.

Nothing is taken away: manual placement still works. This is the floor being
raised, not the ceiling lowered.

### P8 — AI credentials in the app *(medium value, low cost, security tension)*

`ai` is the only widget needing a key, and the tile currently instructs the
user to "Set AI_API_KEY + AI_MODEL" — env vars that cannot be set from the
editor at all. On Railway that means leaving the app to fix a tile.

A Connections section in Setup would fix it, **but** Backup → EXPORT writes
config to a plain JSON file. We already decided (2026-09-16) not to redact
calendar URLs there, on the grounds that the same URLs ship in per-tile
settings anyway. **An API key is a different class of secret and that argument
does not carry over.** So this needs a decision first: either keys live
outside the exportable config, or export learns to redact. Do not ship the
field before deciding.

### P9 — Appearance retouches *(medium value, low cost, low risk)*

Concrete, from the panel photo and the render code:

- **Calendar repeats the day label on every row.** Four consecutive rows each
  reading `TODAY` while titles wrap to three lines. `sections` (TODAY / LATER
  headings) only switch on at the `extended` and `full` tiers
  (`calendar.js:205–209`). Collapse consecutive identical day labels to one,
  and give the reclaimed width to the title.
- **AI tile.** Its timestamp (`18H AGO`) currently carries the same visual
  weight as the content. Demote it; let the text have the tile.
- **Tile headers.** Title/subtitle treatment varies per widget. One rule,
  applied in `_chrome.js`, would make thirty widgets read as one product —
  this is the cheapest "unified system" win available.

### P10 — Documentation correctness *(low cost, do it first)*

Fix CLAUDE.md gotchas #5 and #6 (see above). Also `control-src/widgets/clock.js`
documents three variants (`big`, `thin`, `banner`) in its header comment while
declaring only `big` — left over from the 2026-09-15 variant cut.

### P11 — Open-source integrations *(exploration, not committed)*

- ~~**Home Assistant.**~~ **Ruled out 2026-09-16** — the user does not run
  Home Assistant, so the widget would have no data to show. Do not revive this
  without asking again.
- **TRMNL plugins.** An existing ecosystem of e-ink recipes. Was scoped in
  `docs/trmnl-inspired-design.md` and parked in June "blocked on user input".
  Importing their Liquid templates would multiply the widget library for free,
  but a Liquid renderer is a real dependency and a real sandbox question.
  Revisit only after P2 proves consolidation works.

---

## Explicitly NOT proposed

- **More per-tile typography knobs.** The 2026-09-15 pass removed them for
  good reasons (four tiles, one real override across an entire screen). Design
  decisions belong in the design.
- **A theme system.** One panel, one look, 1-bit. Theming is customisation
  that costs more than it returns here.
- **Widget marketplace / user-authored widgets.** Correct eventually for the
  SaaS direction, wrong before the single-unit experience is effortless.

---

## Recommended order

1. **P10** documentation correctness, **P4** needs-attention strip, **P5**
   next-wake honesty — small, independent, immediately felt.
2. **P1** canvas-first editor — the biggest single improvement to daily use.
3. **P9** appearance retouches — cheap, and they are what you actually look at.
4. **P2 pilot: Markets only** — judge the consolidation pattern on glass
   before committing to weather, clock and daily.
5. **P3** Sources library, then **P6** + **P7** first-run and auto-arrange,
   which depend on it.
6. **P8** after the secrets decision.

Panel photo between each numbered step — every one of these changes what the
device draws or what the user does to it.

## Open questions

1. **P2**: pilot Markets first, or commit to all four merges?
2. **P8**: should API keys live outside the exportable config, or should
   export redact?
3. ~~P11 Home Assistant~~ — answered: no HA, ruled out.
