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

## 7. Flagship batch (first 3)

Proposed to set the language, then roll out:
1. **weather_hero** — hero number + icon + label/value stack + a tone zone.
2. **calendar** — list/table rows, tone header, "now" row band.
3. A **data/number** widget — `aqi` (semantic state → red accent) or
   `eink_battery` (label+value + the trend chart). Pick with screenshots.

## 8. Open / needs user input

- The 6+ TRMNL screenshots → confirm taste, spacing density, which widgets.
- Font decision (A vs B) — after seeing the spec rendered.
- Final 3rd flagship widget.
- How heavily to use gray-text dither vs hairlines.
