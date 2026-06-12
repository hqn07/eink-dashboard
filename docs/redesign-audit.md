# Redesign Stage 0 — audit + design tokens

Companion to `docs/redesign-prompt.md`. Before-screenshots: `/tmp/redesign/stage0-before/`
(control desktop/mobile, drawer, dashboard 800×480, widgets-matrix, health page, captive
portal, display.png). Re-shoot with `/tmp/redesign/shoot.js` if /tmp got cleared.

## Component inventory

**Shell** — app-header (masthead, VIEW DISPLAY link, sync pill, ?-help, mac-agent badge,
TOOLS menu) · ScreenTabs bar · ScheduleTimeline (collapsible).

**Sidebar** — ScreenPanel (name, units toggle, refresh interval, schedule toggle + active
window) · LocationPanel · AlarmsPanel · BackupPanel · DeviceStatusCard.

**Canvas** — EditorGrid (react-grid-layout) + tile chrome (gear/× on hover) · ADD WIDGET
shelf · drag-hint caption.

**Preview pane** — LivePreview (client-side 800×480 render, scaled) · device status rows.

**Overlays** — WidgetSettingsModal · SetupWizard · ShortcutsHelp · TokenPicker · SaveBar
(floating) · mobile bottom-sheet drawer + FAB.

**Aux** — `/health/widgets` (inline HTML in server.js) · firmware captive portal
(`PORTAL_HTML` in weather_station.ino, coordinate-only) · `/widgets-matrix`.

## Findings vs the four complaints

**Cluttered/busy** — Desktop is three boxed columns, every box a 2px frame; frames compete
with the content. Preview pane duplicates the canvas render pixel-for-pixel right next to
it (two copies of the same screen visible at once). Caption noise: drag-hints, "NONE OF 1
SCHEDULED", schedule timeline header always present. Nearly all text is uppercase
letterspaced mono — when everything is a label, nothing is.

**Amateur/cheap** — Mixed corner language: 6px rounded boxes + pill buttons + sharp e-ink
tiles in one view. iOS-default toggle switch. Orange mac-agent badge is the only saturated
element and reads as an error. Sync pill is a gray blob. Three border weights (1/1.5/2px)
used without a rule for which means what.

**Hard to navigate** — Settings are split across left sidebar, TOOLS menu, and per-tile
modals with no visible hierarchy. Schedule lives in two places (sidebar toggle + timeline
strip). Mobile is one long scroll; the drawer covers the canvas it edits.

**Inconsistent** — Health page is an unstyled black-header table, no masthead, blue link.
Captive portal is system-ui with zero brand. Editor canvas chrome ≠ preview pane chrome
(corner brackets vs plain frame). Off-scale type sizes (14/15/19/20/24/32 px) scattered
between the scale steps.

## Token system (applied)

`control-src/styles.css` `:root` — see the file for the full annotated block:

- **Type families** `--font-serif/-sans-c/-mono/-ui`
- **Type scale** `--fs-2xs(9) -xs(10) -sm(11) -md(12) -lg(13) -xl(16) -2xl(18) -3xl(22)
  -display(30)`; off-scale literals (14/15/19/20/24/32) left in place, prune per-screen in
  Stages 1–3
- **Spacing** `--sp-0(2) -1(4) -2(8) -3(12) -4(16) -5(20) -6(24) -8(32)`; defined, not yet
  applied — current spacing uses off-grid 6/10/14px heavily; normalize per-screen
- **Rules** `--bw-hair(1) -rule(1.5) -frame(2) -heavy(3)` — assign meanings in Stage 1:
  hair = row dividers, rule = inputs/secondary, frame = cards/primary, heavy = masthead only
- **Radius** `--r-sm(4) -md(6) -pill(999)` — candidate for collapse to one radius in Stage 1
- **Elevation** `--shadow-press/lift` (hard print offsets), `--shadow-pop/modal` (soft)
- **Motion** `--dur-fast(120ms) --dur-med(160ms) --ease-snap`

`public/dashboard.css` `:root` — **namespaced `--face-*`** (ink, paper, families,
`--face-rule(2px)/-rule-heavy(4px)`, type floors 11px mono / 14px Oswald). Namespaced
because dashboard.css also loads inside the editor page; sharing names with the editor's
`:root` (e.g. `--ink` #000 vs #111) would let import order pick the winner silently.
Definitions only in Stage 0 — face literals convert in Stage 4.

### Stage 4 flags (face)

- dashboard.css has `font-size: 8px` ×1, `9px` ×4, `10px` ×8 — all below the 11px mono
  floor; inspect each on `/widgets-matrix` and on the physical panel.
- 1px rules in widget renderers risk vanishing on panel — sweep for `--face-rule`.

## Mechanical conversions done (no visual change)

font-family literals → family tokens · exact-match font sizes → scale tokens · border
widths 1/1.5/2/3px solid|dashed → `--bw-*` · radius 4/6/999 → `--r-*` · matched shadows →
`--shadow-*` · `120ms/160ms ease` → `--dur-*`. Verified: vite build clean, control app +
dashboard pixel-stable, `/display.png` 200 at 800×480 1-bit.
