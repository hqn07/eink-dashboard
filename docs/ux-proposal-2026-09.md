# UX / UI / QoL proposals — 2026-09-16

Status: **P1, P4, P5, P8, P9 and P10 shipped 2026-09-16.** Everything else is a
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

### P1 — Canvas-first editor — **DONE 2026-09-16**

The editor gave the canvas the middle third: a permanent left column for three
controls you set once, and a right column re-rendering the screen you were
already looking at.

Shipped:
- **Live preview pane deleted.** Its supposed differentiator, the 1-bit
  threshold view, turned out not to exist as a live control at all: the CSS
  (`.editor-wrap.editor-1bit`) had been in the stylesheet since the redesign,
  and the only toggle ever written for it lived in `components/Preview.jsx`,
  which was imported nowhere. The canvas now has that toggle.
- **Screen settings** moved from a 300px column into a disclosure bar above
  the canvas, matching the Schedule bar already there — collapsed it shows
  `Default · °F · every 30m`, expanded it is a four-column row.
- **Device status** moved into Settings > Device, next to Push now, which is
  where the other device controls already were.
- **Mobile FAB + bottom-sheet drawer removed.** They existed only because the
  sidebar was hidden below 760px; with screen settings inline at every width
  they duplicated a visible control.

Net: the canvas goes from one third of the window to all of it.

Dead code removed with it: `components/Preview.jsx` (dead), the mobile drawer,
and every CSS rule whose selectors were entirely `.preview-pane-*`,
`.preview-frame/canvas/stage`, `.settings-sidebar` or `.mobile-drawer-*` —
16 rules plus a 77-line block inside a media query.

**Found, not fixed:** on a 375px viewport the bottom row of canvas tiles
renders blank. All five tiles are in the DOM with sensible boxes, and it
happens with the 1-bit filter off, so it predates this change. The panel
itself always renders at 800×480, so this is an editor-preview issue only.

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
what you set once — which is this product — but it is not free.

### Markets pilot — **DONE 2026-09-16**, 30 -> 28

`markets` takes one mixed list (`AAPL, BTC, EUR/USD`), rendered in the order
written. Kind is inferred — a slash means a currency pair, a known coin ticker
means crypto, anything else is a stock — with `stock:` / `crypto:` / `fx:` to
settle an ambiguous ticker like ETH.

No new network code: it parses the list into buckets and calls the three
existing fetchers, so their caching, timeouts, SSRF guard and partial-failure
behaviour are untouched. The server modules stay; only the widget-facing
modules were removed.

Migration v8 CONVERTS rather than drops (unlike v7): symbols, heading and grid
position all survive, and CoinGecko ids carry over verbatim because
`markets.js` classifies a known id as crypto.

**Verified live**: one tile returning `AAPL 332.41 +0.32% / BTC 76,339 +0.70%
/ EUR/USD 1.1537 / VOO 693.24 -0.43%` — a stock after a currency pair, proving
rows follow the user's order rather than provider grouping. That mixed tile
was impossible before.

**One bug the live render caught that the unit test did not:** `Number(null)`
is `0`, which is finite, so currency pairs rendered a confident `▲0.0%`.
Absent must stay absent.

**Verdict on the pattern: it holds.** Judge it on the panel before merging
weather, clock and daily.

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

### P8 — AI credentials in the app — **DONE 2026-09-16**

`ai` was the only widget needing a key, and the tile instructed the user to
"Set AI_API_KEY + AI_MODEL" — env vars the editor could not set, so on a
hosted instance the fix lived outside the app.

**Decision taken: keys live outside the exportable config**, rather than
export learning to redact. Backup > Export is `JSON.stringify(cfg)` in the
browser, so a secret that is not in `cfg` cannot be exported by a path that
forgets to redact, and cannot be resurrected by an import written before the
redaction existed. Structure beats a step someone has to remember.

Shipped as:
- `lib/secrets-store.js` → `DATA_DIR/secrets.json`, chmod 0600, never merged
  into the config. Env vars stay as a fallback so a Railway-configured
  instance keeps working; a key saved in the UI takes precedence.
- `GET/PATCH /api/connections` — the value only travels inbound. The read
  returns presence, source (`stored` / `env`) and the last four characters.
- Settings > Tools > **Connections**. Provider URL and model are NOT secrets
  and ride the config, so restoring a backup brings those back and asks only
  for the key.
- `test:api` asserts the key never appears in `/api/config` — the payload
  export serialises. Probed by making the endpoint leak deliberately.

**What this is not:** encryption at rest. The file sits on the same volume as
everything else, and anyone who can read the volume can read the key. The
threat addressed is the key leaving the box inside a backup file. Real
at-rest encryption needs a key that is not also on the volume — an env secret
or a KMS — and is worth doing if this goes multi-tenant.

### P9 — Appearance retouches — **DONE 2026-09-16** (two of three)

- **Calendar no longer repeats the day label.** Four consecutive rows each
  reading `TODAY` spent 58px of an eight-column tile saying one word four
  times, while the titles they squeezed wrapped to three lines. Now: when
  every visible event shares a day the label moves to the title bar and every
  row gets the full width (`.item--nometa` drops the 50px column); when days
  differ, a label shows only when it changes, and never when it merely repeats
  its own section heading. No events are lost — the budget is unchanged.
- **The AI tile's timestamp became a signal.** It showed the age on every
  render, so a daily briefing announced `18H AGO` about text behaving exactly
  as configured, which reads as staleness and is not. The server now sends
  `cadenceMs` with the answer and the tile shows the age only when it carries
  information: the refresh failed (`offline`), or the text is older than the
  cadence, meaning a generation was actually missed.

**The third item was withdrawn, because measuring it showed it was wrong.**
The proposal claimed "title/subtitle treatment varies per widget" and that one
rule in `_chrome.js` would unify thirty widgets. In fact `.tr-titlebar` covers
26 of 30, and the other two idioms (`.widget-title`, `.col-title`) already
carry an identical type spec — grotesk 700, 11px, 1.5px tracking, uppercase,
2px rule. The `#000` hard-codes look like a bug on inverted tiles but are not:
`.cell.cell-inverted *` overrides `border-color` with `!important`. There was
nothing to unify, and a sweep would have been churn.

What that measurement did surface: making `.widget-title` flex — which the
calendar needed for its day tag — would have silently shunted the `stale`
marker to the right edge in headlines, tasks and transit, three widgets this
change has no business restyling. The rule is scoped to `.widget-cal`. The
visual guard could not have caught it, because the demo data is never stale.

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
2. ~~P1~~ canvas-first editor — done.
3. ~~P9~~ appearance retouches — done (two of three; the third was withdrawn).
4. **P2 pilot: Markets only** — judge the consolidation pattern on glass
   before committing to weather, clock and daily.
5. **P3** Sources library, then **P6** + **P7** first-run and auto-arrange,
   which depend on it.
6. ~~P8~~ done.

Panel photo between each numbered step — every one of these changes what the
device draws or what the user does to it.

## Open questions

1. **P2**: pilot Markets first, or commit to all four merges?
2. ~~P8 secrets~~ — answered: keys live outside the exportable config. Done.
3. ~~P11 Home Assistant~~ — answered: no HA, ruled out.
