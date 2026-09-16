# Central Setup — shared facts, widget defaults, AI context

Status: **stages 1-3 shipped** (2026-09-16). Written before any code so the
schema question got settled once; the stage headings below record what each
step actually did.

Not done: `home.tickers` and `home.feeds` from the sketch below were never
added — no widget asked for them, and a fact nothing reads is just a field.
`timezone` is read through the helper everywhere but new writes still go to
the top level for it alone, because eight readers (including the scheduler)
predate `cfg.home`.

## The problem

Facts about the person and the place are scattered across three homes:

- **Top-level config, undeclared.** `cfg.city`, `cfg.lat`, `cfg.lon` and
  `cfg.githubUser` are read by `lib/widget-data.js` and the widget fetchers,
  and written by `SetupWizard`, but they do **not** appear in
  `data-defaults/config.default.json`. They exist only in live configs. Nothing
  documents them and nothing shows them.
- **Duplicated into tiles.** The live config (2026-09-15) has `lat`, `lon` and
  `city` repeated inside a `weather_forecast` tile's `settings`, restating what
  the top level already knows.
- **Nowhere at all.** There is no place to say anything *about the user* —
  which is why the `ai` widget can describe the weather but has no idea whose
  day it is summarising.

The AI widget made this visible, but it isn't an AI problem. Every widget that
asks for a location is asking a question the dashboard already knows the answer
to.

## What exists today (measured, not assumed)

| Fact | Where it lives now | Who reads it |
|---|---|---|
| city / lat / lon | top-level `cfg`, undeclared in defaults | weather, alerts, forecast, sun, uv, aqi |
| timezone | top-level `cfg`, declared | clock, text/message scheduling, calendar |
| GitHub username | `cfg.githubUser`, undeclared | codeactivity |
| iCal URLs | `cfg.calendar.icalUrl` (legacy single) + per-tile `icalUrls` | calendar tiles, `{{nextEvent}}` |
| Saved feeds | `cfg.savedFeeds`, declared | headlines |
| Anything about the user | — | — |

## The design: `cfg.home`

One block holding facts about the person and their place. Not a defaults
*cascade* — a small, fixed set of facts (see "Not the thing we deleted").

```jsonc
{
  "home": {
    "city": "Gainesville, Florida, US",
    "lat": 29.65163,
    "lon": -82.32483,
    "timezone": "America/New_York",
    "icalUrls": [],          // private calendar URLs
    "githubUser": "",
    "tickers": [],
    "feeds": [],
    "about": ""              // free text, AI context only
  }
}
```

`about` is the one genuinely new field and the one with the highest payoff per
byte: "I work from home, gym Tuesday and Thursday, I care more about deadlines
than weather" turns a generic forecast summary into something worth wall space.

Two jobs, one block:

1. **Widget defaults** — a new tile inherits instead of asking. This *removes*
   per-tile configuration, which is the direction set on 2026-09-15.
2. **AI context** — everything here is available to the prompt, including
   `about`.

## Stage 1 — `home.about`, and the AI reads it — DONE

Smallest useful slice. No migration, no UI restructuring.

- Add the `home` block to `data-defaults/config.default.json` (documenting the
  keys that already exist informally, plus `about`).
- `widgets/ai.js` `buildContext()` prepends `about` and includes `home.city`.
- One textarea in the existing Settings menu.

Absent or empty `home` behaves exactly like today, so this cannot regress a
live config.

**Payoff:** the briefing knows who it is for.

## Stage 2 — Setup becomes the single editor for shared facts — DONE

- A `homeValue(cfg, key)` read helper with legacy fallback:
  `cfg.home.city ?? cfg.city`. **Read-time only — no config rewrite.** An old
  config keeps working untouched; a new one is written in the new shape.
- Point the existing readers (`lib/widget-data.js`, weather/alerts/codeactivity)
  at the helper.
- Surface it as one Setup panel (the `SetupWizard` shell already exists) with
  the fields from the table above.

**Payoff:** the facts are visible and editable in one place instead of being
folklore.

## Stage 3 — widgets inherit, and say so — DONE

- Forms show the inherited value as the state, not a blank:
  `Location — using Setup: Gainesville  [Override]`.
- A per-tile value is written **only** when the user overrides.
- The duplicated `lat`/`lon`/`city` in weather tiles stop being written.

**Payoff:** adding a weather tile asks nothing. This is the same goal as the
knob removal, reached from the data side rather than the cosmetic side.

Shipped 2026-09-16. Two things the plan did not anticipate:

- **A blank weather tile used to render NO DATA, not inherit.** `resolveLoc()`
  returned null and the comment above it defended that as the
  self-contained-settings contract. Inheriting a *location* does not breach
  that contract — the tile still gets its own fetch and its own slot; what it
  inherits is where to look, not another tile's data.
- **Migration v6 has to compare places, not strings.** The wizard wrote
  `"Gainesville,Florida,US"` and the tile autocomplete wrote
  `"Gainesville, Florida, US"` for the same spot, so the live config's one
  duplicate would have survived on a space. Coordinates decide when present;
  the city beside them is a label for the same point.

Override seeds BOTH city and coordinates so it starts as an exact copy —
city alone would have quietly cost the tile its severe-weather alerts, which
need a coordinate pair.

## Not the thing we deleted

Commit `fe23a4c` removed a "Global Defaults" dropdown as "overkill for
single-device". This is deliberately **not** that:

| Deleted cascade (`fe23a4c`) | `cfg.home` |
|---|---|
| A defaults layer for *every widget* | One fixed set of facts about the user |
| Grew with the widget count (now 32) | Fixed size regardless of widget count |
| Added a second place to configure each widget | Removes configuration from tiles |
| Answered "what should this widget default to" | Answers "where do I live, what's my calendar" |

If a future session is tempted to delete this for the same reason, the test is:
does it scale with the number of widgets? `cfg.home` does not.

## Risks and open questions

- **iCal URLs are secrets.** A Google "secret address in iCal format" grants
  read access to a calendar. Centralising them concentrates that, and
  Settings → Tools → Backup → EXPORT puts them in a plain JSON file that gets
  emailed and attached. Before stage 2 lands, decide whether export redacts
  `home.icalUrls` (and whether import can then round-trip).
- **`about` goes to a third party** on every generation. It should say so in
  the field's help text — it is the one field whose contents leave the box.
- **Timezone already exists** at top level and is read in several places;
  moving it needs the same read-helper treatment rather than a rename.
- **Stage 3 changes what gets written to tiles**, so the visual-regression
  baseline and a panel photo should bracket it.
