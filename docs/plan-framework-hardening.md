# Plan — Framework Hardening (TRMNL parity, batch W3)

Adopt three TRMNL framework primitives we lack: tabular numerals,
a zero-config `.columns` primitive, and a gap token scale. Scope =
items 1–3 from the audit. No hardware/format/dimension changes.

## Constraints (load-bearing — must hold)

- **Face CSS is built, not hand-edited.** Source = `control-src/face-css/*.css`
  partials; `npm run build:css` (`scripts/build-face-css.mjs`) concatenates
  them in numeric order → `public/dashboard.css`. Never edit `dashboard.css`
  directly; edit the partial + rebuild. Verify the diff matches.
- **Render HTML lives once** in `control-src/widgets/*.js` (ESM). Server SSRs
  by dynamically importing those same modules (`server.js:33`). So adding a
  class to a widget's HTML string is a single edit, not a client/server pair.
- **eink-lint must stay clean** (`npm run lint:eink`): 1-bit colors only,
  ≥11px type, ≥2px strokes. New CSS must not introduce grays/thin strokes.
- **Parity path**: EditorGrid / LiveDashboard / SSR all consume the same
  render + `buildTileCtx`/`tileCellClasses`. CSS-only + render-string changes
  ride that path automatically; no per-surface duplication.
- **Verify on `/widgets-matrix`** (every widget × size × variant) + the live
  `/display.png`. Screenshot before/after.

## Item 1 — Tabular numerals (`.tnums`)

**Why:** autofit numbers shift horizontally between refreshes (`1` vs `8`
differ in width in DM Serif / Oswald). Tabular figures lock digit width.

**Change:**
- New utility in a primitives partial (`010-*` grayscale neighbor, or a new
  `012-numeric.css`): `.tnums { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }`
- Apply the class in the render strings at numeric elements (exact
  classes confirmed by codecheck):
  - `clock.js` → `.clock-time` (clock.js:63, 71)
  - `eink_battery.js` → `.eink-batt-pct` (:97)
  - `mac_battery.js` → `.mac-batt-pct` (:60)
  - `weather_hero.js` → `.temp-num` (:135), `.weather-hilo` (:141), `.stat-v` (:154)
  - `weather_forecast.js` → `.fc-hi` / `.fc-lo` (:57,60,62)
  - `calendar.js` → `.strip-day-num` (:178), `.month-num` (:243)
- Confirm DM Serif Display + Oswald + JetBrains Mono expose `tnum` (JetBrains
  Mono is monospace already; serif/sans need the feature). If a face font
  lacks tnum, fall back to leaving that element non-tabular (document it).

**Risk:** font may not ship tnum → silent no-op. Mitigation: codecheck
verifies the font files; visual diff on the matrix confirms.

**Verify:** matrix clock/battery rows — digit columns align; no width change
between demo `82%` and a forced `11%`.

## Item 2 — `.columns` zero-config primitive

**Why:** equal-track column math is hand-rolled 3×: `025-forecast-column.css`,
`070-hourly-strip.css`, `145-cal-strip-view-7-day-horizontal.css`.

**CODECHECK REVISION — DRY win is smaller than first claimed.** The three
are NOT the same distribution:
- forecast (`.fc-strip`) — **flex**, fixed `50+50+1fr` row template, 6px gap, dashed right border
- hourly (`.hourly-strip`) — **flex** + `justify-content: space-between`, 2px gap, no border
- cal-strip (`.cal-strip`) — **CSS grid** `repeat(7,1fr)`, solid borders, 4px

A single flex `.columns` is drop-in only for forecast + hourly, and even
they differ (space-between vs flex:1). Calendar is grid by design — leave
it. So Item 2 reduces to: a flex `.columns` shared by forecast + hourly
(hourly keeps a `--spaced` modifier), calendar untouched. Reassess whether
that's worth a new primitive vs leaving all three as-is.

**Change:**
- New partial `017-columns.css`: `.columns { display:flex; gap:var(--gap-medium); }
  .columns > * { flex:1 1 0; min-width:0; }` plus `.columns--{n}` if fixed
  counts are needed.
- Refactor the three consumers to use `.columns` for track distribution,
  keeping their widget-specific cell styling. Do NOT change visual output.
- This depends on Item 3 (gap tokens) for the gap value.

**Risk:** the three consumers have subtly different gap/border/overflow rules;
a naive merge could shift pixels. Mitigation: refactor one at a time, matrix-
diff each; keep per-widget overrides where they differ intentionally.

**Verify:** forecast / hourly / cal-strip render pixel-identical pre/post on
the matrix (screenshot compare each).

## Item 3 — Gap token scale

**Why:** no spacing tokens exist; gaps are hardcoded per widget. Standardize
rhythm.

**Change:**
- Add to `:root` in `000-header-and-tokens.css` (or `005-*` design tokens):
  ```
  --gap-xsmall: 5px;  --gap-small: 7px;   --gap-medium: 16px;
  --gap-large: 20px;  --gap-xlarge: 30px; --gap-xxlarge: 40px;
  ```
- Adopt incrementally: replace obvious hardcoded `gap:` values in the item
  primitive + columns consumers. Do NOT mass-replace every px in one pass —
  only where a token matches the existing value (no visual change) or where
  the redesign audit flags inconsistency.

**Risk:** token != current value → visual shift. Mitigation: only swap exact
matches first; defer judgment calls.

**Verify:** rebuild, matrix unchanged.

## Sequencing

1. Item 3 tokens (no visual change; unblocks Item 2).
2. Item 1 tnums (independent; visible fix).
3. Item 2 columns refactor (one consumer at a time).

Each step: edit partial(s) + render strings → `build:css` → check `dashboard.css`
diff is the expected concat → `lint:eink` → `vite build` → matrix + display.png
screenshot. Commit per step (`widgets(w3-bN): …`), do not push until panel-checked.

## Rollback

Each step is its own commit; `git revert` is clean. CSS-only + additive utility
classes mean no data/config migration, no firmware impact.

## Out of scope

Responsive prefixes, view mashups, 16-shade grayscale, title_bar unification
(item 4), item icon slot (item 5), layout utilities (item 6). Parked.
