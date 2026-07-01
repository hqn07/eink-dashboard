# TRMNL-inspired design language

**Status: draft spec. No widget code changed yet.** Grounded in the TRMNL
Framework (trmnl.com/framework, v3) + our constraints. Refine the type/tone
choices against the user's TRMNL screenshots before building widgets.

Goal: the clean, structured TRMNL look — strong hierarchy, title-bar cards,
dithered gray zones for depth — adapted to our stack. Inspired-by, not a
copy; no TRMNL fonts/logos/assets.

## Why this is feasible here

TRMNL targets the same 800×480 e-ink panel family, so layouts translate
directly. We already have: SSR with editor/panel parity (`buildTileCtx`),
per-tile chrome + settings, self-hosted fonts, dither tones
(`215-dither-tones.css`), and a visual-regression guard.

## TRMNL → our system (mapping)

| TRMNL | Ours |
|-------|------|
| Screen / View / Layout | `/dashboard` page + grid + screen |
| Title Bar | widget chrome header (`widget-title` / `col-title`) |
| Columns / Mashup | grid tiles / multiple widgets per screen |
| `gray-10..75` (dither) | `.face-tone-g*` scale (expand to match) |
| semantic primary/success/error/warning | black / (tone) / `--face-red` / amber-as-tone |
| `bg--{token}` / `text--{token}` | `.face-tone-*` bg utils (+ a text-tone set, TBD) |

## 1. Grid & structure

- 800×480, the existing 24×12 cell grid. Keep it.
- Every widget is a **card**: a title bar (small-caps label, optional value/
  icon on the right), a hairline rule, then the body. This is the single
  biggest "TRMNL feel" lever and we mostly have it — make it consistent.
- Title bar height + body padding standardized via tokens (below). No
  per-widget ad-hoc spacing.

## Validated direction (2026-06-30)

Reviewed 5 TRMNL panel photos + rendered a mockup through our real 3-color
pipeline (`test/trmnl-mockup.html` → looked correct: title-bar cards, big
sans heroes, dashed dividers, dithered progress bar, pink "on track" chip).
The look is clearly reproducible here.

Concrete TRMNL patterns to adopt (from the photos):
- **Dashed/dotted dividers** between zones + a 2px card border — signature.
- **Title bar**: label left, meta/location or a tone chip right, hairline under.
- **Label+value**: big sans value (−letter-spacing), small-caps label under.
- **Icon+value+label cells** in a 2-col grid (weather conditions, low/high).
- **Dithered bars** (progress: g50 fill / g15 track) and **donut/ring gauges**
  (UV, humidity) and **contribution heatmaps** (dot-density grids).
- **Footer**: small glyph + plugin name left, source/location right.
- **Tone chips**: r50 (pink) for status badges, g50 for neutral.

## 2. Type scale → font decision: B (grotesk)

The photos are unambiguously grotesk sans; serif would fight the look.
**Recommend B: self-host Inter Variable** for labels/body/values, used for
hero numbers too (tight negative tracking reads like TRMNL). Drop DM Serif
from the face (keep it in the editor chrome if desired). Mockup used system
Helvetica as a stand-in; production self-hosts Inter for consistent render.

Scale (px, respecting the 11px floor / eink-lint):
```
hero      48–64  (one big number/headline per card)
title     20–28
value     16–22
label     11–13  small-caps, letter-spaced, mono or grotesk
body      12–14
caption   11     (floor)
```
One hero element per card. Labels are uppercase, tracked, muted via tone.

## 3. Tone & dither (the depth)

Expand `215-dither-tones.css` to a small scale mirroring TRMNL's intent
(not all 14 — we don't need that many): `g15, g25, g40, g50, g65, g75`
plus `r25, r50` (pink/light-red on the B panel).

Rules:
- Use tone for **zones**: card sub-panels, table header rows, selected/now
  rows, value chips, dividers, chart fills.
- **Gray text**: TRMNL dithers text to gray; at our 11px floor it gets
  muddy. Allow it only ≥16px and sparingly (e.g. a large secondary number),
  otherwise use a real hairline/label, not gray text.
- Red tone = accent only (alerts, "now", deltas). Never large fills (the B
  panel's red refresh is slow + heavy).

## 4. Components to standardize

- **Title bar**: `label` left, optional `value`/icon right, hairline under.
- **Label + value stack**: small-caps label over a big value. The TRMNL
  staple. Use for weather temp, AQI, counts, battery %.
- **List rows**: full-width rows, hairline between, optional leading time/
  icon column, tone band on the "now"/active row.
- **Table**: tone header row, hairline rows, right-aligned numbers (mono).
- **Mini chart**: line/bars with an optional `g15` fill zone (the sparkline
  fix already set up crisp lines + sane domains).

## 5. Icons

One line-weight set, ≥2px strokes (eink-lint). Keep the existing face SVG
glyphs; unify weight/size. No filled/heart-shaped icons (the old bug).

## 6. Constraints (don't forget)

- 11px type floor, 2px stroke floor — eink-lint enforced.
- Parity: build through `buildTileCtx` / shared chrome; never re-derive a
  tile's classes at a call site (bug `193b74b`).
- Dither only on non-stretched HTML blocks, not inside the sparkline SVG
  (it's `preserveAspectRatio:none`).
- Red needs the B panel; degrades to gray on BW.
- Every batch: `npm run test:visual:update` after intentional change +
  panel photo before sign-off.

## 7. Flagship batch (first 3) — DONE (2026-06-30)

Shipped as opt-in `trmnl` variants (existing variants untouched):
1. **weather_hero** — title-bar card, hero temp + icon, 2×2 conditions grid.
2. **calendar** — title-bar agenda, time/title/day rows, g15 "now" band.
3. **eink_battery** — charge + voltage label/value over a dithered bar
   (g50 fill / g15 track, r50 low), status/updated stats at h≥6.

All verified through the real pipeline (weather/calendar live data, battery
seeded). Foundation: Inter (`--face-grotesk`), tone scale incl. g15,
`220-trmnl-components.css`. Standalone module-render is the quick way to
verify widgets the /preview harness can't feed (battery has no preview data).

### Rollout — DONE (2026-06-30)

`trmnl` is now the **default variant** for: weather_hero, calendar,
eink_battery, clock, countdown, quote, moon, aqi, onthisday, world_clock,
sparkline, weather_forecast (12 widgets). Old variants stay available.

- **mac_battery**: `trmnl` variant exists but default stays `gauge` — its
  4×2 / 6×3 tiles are too short for a full card frame.
- **Left as purpose-built primitives** (no card): `text` (bar/strip),
  `qr` (scannable code needs the space), `mac_nowplaying` (its variants
  drive bookend slots, not layout).

Verified via standalone module renders through the real pipeline; visual
baseline refreshed each batch; lint + widget guards clean.

### Still open / optional
- Panel-photo verification on real hardware (set a screen to the new
  defaults and flash).
- Minor polish: ~~world_clock long zone names ellipsize~~ (DONE — fit
  ladder wraps them to 2 lines); tune row counts.
- **Space-aware fit ladder (DONE 2026-06-30):** dither never sits behind
  small text (the "now" row uses a solid left accent bar, not a tone
  band — 1-bit legibility). Text follows a *wrap-before-you-clip* ladder:
  `.tr-clamp` + `--fit-lines` (wrap to N lines, then ellipsize) and
  `.tr-rows-fill` (under-full lists grow to fill the card). Shared by
  calendar / world_clock / onthisday via `.tr-row-title`. Font-fit
  (autofit binary search) is the separate axis for hero numbers; unifying
  its 4 mirrored copies is the remaining generalization.
- New components seen in the TRMNL photos: **donut/ring gauges** (UV,
  humidity, precip) + **contribution heatmap** (activity) — would let
  aqi/weather show gauges and enable a code-activity widget.
  - **DONE (2026-06-30):** both built as reusable primitives —
    `gaugeHtml()` / `heatmapHtml()` in `control-src/widgets/_shared.js`,
    styled by `225-trmnl-gauge-heatmap.css`. Gauge = value arc over a
    hairline track, solid-ink (red-plane opt-in), big centered number;
    verified live via a new **aqi `gauge` variant** (in the matrix +
    visual baseline). Heatmap = weeks×days dither-toned dot grid
    (levels 0..4 → g15/g25/g50/g75/ink), column-major so the last cell is
    "today". Eyeball both through the real pipeline with
    `node scripts/preview-components.mjs`.
  - Heatmap has **no live consumer yet** — its natural first home is a
    code-activity widget (GitHub contributions), which needs a data
    fetcher + the user's username/token. Wire that next.

## 8. Open / needs user input

- The 6+ TRMNL screenshots → confirm taste, spacing density, which widgets.
- Font decision (A vs B) — after seeing the spec rendered.
- Final 3rd flagship widget.
- How heavily to use gray-text dither vs hairlines.
