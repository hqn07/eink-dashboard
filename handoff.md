# E-Ink Dashboard — Handoff

State as of 2026-05-30. Read this + `CLAUDE.md` + memory pointers below before touching anything.

## What shipped in the 2026-05-29 → 2026-05-30 session (commit `72b0b2e`)

Two shipped items, both validated end-to-end against the live ESP32 + Railway:

### Phase B / SSR — dashboard render consolidated server-side

`public/dashboard.html` collapsed from ~1010 lines to ~47. The body
grid is now built in `server.js` from the same per-widget render
functions the React editor uses, so there's no longer a separate inline
mirror to keep in sync.

- Each widget moved to a `<id>.js` (def + render, no React) +
  `<id>.form.jsx` (React Form) pair under `control-src/widgets/`.
  Server dynamically imports the `.js` half via cached `await
  import()` so JSX never enters Node's import graph.
- New `control-src/widgets/_chrome.js` owns header/footer/typography
  helpers — shared by server SSR + React editor.
- New `control-src/widgets/_ssr.js` is the Node-side aggregator
  (renderers + chrome re-exports).
- `widget-render.js` is now a thin dispatcher + re-export of
  `_chrome.js` so React editor import paths stay stable.
- `server.js` gains `buildPageBodyHtml` + `renderPage` + cached
  `loadSsr()`. `/dashboard`, `/widgets-matrix`, `/dev/widget/:id`
  all share the same shell-injection path.
- `_shared.js` picks up the `msg` placeholder glyph;
  `_weather_shared.js` picks up `alertBanner`. Folding these in
  restores alert banners in the editor preview too.

Net: -1900 / +290 lines. Adding a new widget = one new file pair +
one line in `_registry.js`/`_ssr.js`. Adding a variant knob = a
single render-function edit. No more triple-sync.

### Mac-on-cloud — push-based agent kills LAN-base dance

ESP32 used to fall back between LAN (the Mac running `npm start`) and
cloud (Railway), depending on which was reachable, so the Mac widgets
only worked when the device picked LAN. Now ESP32 hits cloud-only and
a Mac-side agent pushes state.

- `widgets/_mac_state.js` — atomic-write on-disk cache at
  `data/mac-state.json`. 5-minute staleness window.
- `widgets/macnowplaying.js` + `widgets/macbattery.js` — read from
  the cache whenever `MAC_FROM_CACHE=1` or the process isn't on
  darwin. Stale = "MAC OFFLINE".
- `server.js` — `POST /api/mac-state` (auth via `DEVICE_TOKEN`).
  Server dedupes album art by `trackKey`; the agent can omit
  `artworkBase64` when the song hasn't changed and the server
  preserves the previously stored frame. Companion `GET` for
  debugging.
- `mac-agent.js` + `npm run mac-agent` — polls local Mac every 30 s
  (configurable via `MAC_AGENT_INTERVAL_MS`), hashes
  `title|artist|album`, POSTs to `CLOUD_URL`. ~50 MB/mo bandwidth
  with realistic listening.
- launchd plist at
  `~/Library/LaunchAgents/com.huynguyen.eink-mac-agent.plist`
  (RunAtLoad + KeepAlive). Survives reboot, auto-restarts on crash.
  Logs to `/tmp/eink-mac-agent.log`.
- `.env.example` documents `CLOUD_URL` + `MAC_AGENT_INTERVAL_MS` +
  `MAC_FROM_CACHE`. `.gitignore` covers
  `data/mac-state.json{,.tmp}` + `data/devices.json`.

ESP32 deep-sleeps and hits only the Railway base — no more LAN
re-probe failures killing the Mac widgets when DHCP shuffles or the
Mac sleeps mid-day. Validated on hardware: agent push → cloud cache
→ /display.bin render → physical e-ink screen showed Mac widgets the
first refresh after deploy.

### Bonus

Dropped now-unused `jsonForScript` helper. Added `_shared.js` `msg`
placeholder + `_weather_shared.js` `alertBanner`. `widgets/package.json`
sets `{"type":"module"}` to silence Node's MODULE_TYPELESS warning when
the SSR dynamic-import loads the ESM widget files.

## What shipped in the 2026-05-28 → 2026-05-29 session

Long marathon session covering TRMNL-inspired tooling, per-widget
customization, and a brutal WiFi-reliability arc.

### Hardware / firmware (BW sketch is now 1.10.5)

- **1.6.0** — setup-once / loop-many refactor + auto-detect USB vs.
  battery. Battery mode uses `esp_light_sleep_start()` (keeps WiFi
  associated, skips the per-cycle re-join); USB mode just `delay()`s.
- **1.7.0** — adaptive refresh: device sends `Battery-Voltage`,
  `Battery-Pct`, `RSSI`, `FW-Version`, `FW-Board` as request headers
  on `/display.bin`; server returns `X-Refresh-Rate` so the per-tile
  refreshMinutes flows back without a separate `/sleep` round-trip.
  `/sleep` + `POST /api/battery` stay alive for legacy firmware.
- **1.8.0** — WiFiManager captive portal + 5 s long-press factory
  reset. *Did not work* — see 1.10.0.
- **1.9.0** — per-device MAC enrollment via `POST /api/setup`,
  `X-API-Key` header on every authenticated request, NVS-backed
  `api_key` + `friendly_id`. `data/devices.json` holds the registry;
  fleet-wide `DEVICE_TOKEN` stays as fallback.
- **1.9.1 → 1.9.3** — WiFi tuning thrash: `setSleep(false)` +
  `setTxPower(MAX)`. Initially placed at the wrong point in the boot
  sequence and silently broke WiFiManager (see
  espressif/arduino-esp32#8877, #9858, tzapu/WiFiManager#1490).
  1.9.3 moved the calls into `applyWiFiTuning()` that only runs after
  a successful associate.
- **1.10.0** — **dropped WiFiManager entirely** (tzapu#1797: lib
  incompatible with arduino-esp32 core 3.1.0+). In-house captive
  portal: `WebServer` + `DNSServer` + `Preferences` namespace `wifi`
  with `ssid`/`pass` keys. ~80 lines of firmware code, no external
  lib. `secrets.h` no longer needs WiFi creds.
- **1.10.1** — portal kept hitting `TG1WDT_SYS_RESET` on first boot.
  Fixed with `esp_task_wdt_delete(NULL)` for the portal-blocking
  task + hard-reset of WiFi state before `WIFI_AP` + 10 s heartbeat
  log so serial monitor distinguishes alive-from-crashed.
- **1.10.2** — every authenticated HTTP call now goes through a
  shared `httpBegin(http, tls, url)` helper that uses
  `WiFiClientSecure.setInsecure()` for `https://` bases. Previously
  only OTA had this; everything else silently failed against the
  Railway cloud base.
- **1.10.3** — `activeServerBase` selector ran only when WiFi was
  newly connected; on a cold boot where provisionWiFi already
  brought the radio up, runCycle skipped it and every URL was just
  the path. Force selectServerBase whenever the base is empty.
- **1.10.4** — re-probe LAN/cloud every 10 cycles so the Mac going
  to sleep mid-day eventually fails over to Railway. Log "WiFi
  dropped — reconnecting" when light-sleep didn't preserve the link.
- **1.10.5** — folded an immediate re-probe into the download retry
  chain: two `/display.bin` failures → re-pick base → try once more.

### Server / control panel

- **TRMNL spec items 1-4** landed (`docs/device-api.md`,
  `/dev/widget/:id?size=…` hot-reload server, shared
  `widgets/_dither.js`, adaptive headers).
- **TRMNL layout primitives + playlist rotation** server-side: each
  screen gains `layoutKind: 'free' | 'full' | 'half_horizontal' |
  'half_vertical' | 'quadrant'`. Primitive screens populate via
  `slots[]`. `cfg.playlist.enabled` rotates through enabled screens
  on a wall-clock cadence. UI for picking layoutKind is still TODO;
  user can edit `config.json` directly today.
- **MAC-as-identity / `/api/setup` / `/api/devices`** on the server.
  `data/devices.json` holds the registry.
- **TRMNL grayscale framework** adopted under `screen--1bit` scope:
  `bg--black` / `bg--white` / `bg--gray-30` / `bg--gray-55` with
  inline 4x4 SVG dither tiles. Forward-compatible with a future
  `screen--2bit` if/when we adopt bb_epaper.
- **Per-widget settings modal** got a real second life:
  - `mac_nowplaying` → side-space variant (time bookends / centered),
    font scale slider, padding slider.
  - Modal preview now uses real per-item data (`perItem[id]` slot
    merge) and resizes dynamically via ResizeObserver.
  - **Typography settings now apply to every widget** via a single
    `.cell[style*="--w-font"] *:not(svg)` global override rule.
    Shared `TypographyFields` block in `WidgetForm.jsx`. Default
    "unset fontFamily" preserves each widget's mixed-internal look
    until the user explicitly picks a family in the modal.

### Phase A widget refactor

Every widget moved into its own `control-src/widgets/<id>.jsx` module
exporting `{ def, render, Form }`. `_registry.js` aggregates them and
the legacy dispatch points (`widget-render.js`, `widgets.js`,
`WidgetForm.jsx`) consult the registry first. Adding a new widget =
one new file + one line in the MODULES array. `widget-render.js`
shrunk from 659 → 157 lines. **Phase B (kill the `dashboard.html`
mirror by SSR'ing the same render functions in Node) is the next
logical step but not done yet.**

### bb_epaper migration / 4-gray

Researched (per TRMNL's `EP75_800x480_4GRAY_GEN2` and the no-flash
posts) but **explicitly skipped** — brick risk on the only panel is
too high for a beginner-level debugger with no second display.
Documented as "future possible" in the handoff and in user memory.

---

## Original handoff (2026-05-26)

## Where the project sits

- **Hardware in hand.** Waveshare 7.5" + Rev3 ESP32 driver board working end-to-end. WiFi auto-refresh + GPIO32 manual-refresh button wired and confirmed.
- **Server-rendered architecture is the canonical design.** ESP32 is dumb — fetches `/display.bin` (48000 bytes, 1-bit, MSB-first, 0=black) and pushes to GxEPD2. Don't move logic back onto the device without a strong reason.
- **Control panel rewrite to Vite/React SPA is complete.** Bottom Settings.jsx panel retired — every tile is now edited via a per-instance gear modal. Settings cascade was dropped (one tile = its own settings).
- **Open-source kit + future SaaS is the business plan** (memory `project_eink_business_plan.md`). Open-core from day 1; hardware is the moat.
- **Multi-tenant work is parked** until 10+ paying users (memory `project_eink_multitenant.md`).

## What shipped this session (last ~15 commits)

| Commit  | What |
|---------|------|
| `fe23a4c` | Drop Global Defaults dropdown (cascade was overkill for single-device). New TOOLS popover hosts BackupPanel. Restore lost widget customizability: weather city autocomplete (`/api/geocode`), forecast `forecastDays`, message `schedule` list, habit done-today toggle, photo slide reorder, "Copy from →" picker between sibling tiles. |
| `9ff7fab` | Modal Save now persists immediately via `commitLayoutItemNow` instead of waiting for the 2s autosave. Border classes (`cell-border-dashed` / `cell-border-none`) added to editor tile-render + modal preview so the border toggle is finally visible there. |
| `0f19937` | `@phosphor-icons/react` wired through tile actions, dropdown trigger, MAKE DEFAULT, SHOW GRID, CLEAR, backup buttons, modal close. Weather SVG icons rewritten in Erik Flowers / Bas Milius style — heavier strokes, new PartlyCloudy + Drizzle variants, hex snowflakes. Both `widget-render.js` and `dashboard.html` mirrors updated. |
| `1162ec8` | Header trimmed (tagline + AUTO-SAVE removed). MAKE DEFAULT moved to editor card section-title. Editor `1-BIT` toggle deleted — it was a no-op. |
| `44de68a` | Bottom `Settings.jsx` panel deleted entirely. BackupPanel extracted as its own component. ~32 KB JS shaved from the bundle. |
| `7d5211e` | **Stage 2.1** — per-instance for every settable widget: per-tile location override for weather/aqi/moonsun (Q7a), forms for todos/calendar/countdown/counter/habit/chore/photo/quote/clock/link_qr/wifi_qr/spacer. ListEditor primitive + LocationFields. |
| `aa3ea15` | **Stage 3** — Global Defaults dropdown (later removed in `fe23a4c`). Kept here because the modal shell + COMMIT_RULES table it introduced still informs the current architecture. |
| `5098a49` | **Stage 2** — per-instance data model. Layout items now carry an optional `settings` snapshot; server `buildWidgetData` emits `payload.perItem[id]`; `dashboard.html` + editor live preview spread the per-tile slot after the global one. Cache dedup is free via existing per-widget URL/symbol-keyed caches. |
| `31ad1bd` | **Stage 1** — UI shell for the per-tile settings modal. Tile bar trimmed from five buttons to ⚙ + ×. Hover/tap reveal + 5px drag threshold. Layout knobs (flush / border / density) moved into the modal as proper form controls. Live 2× preview. |
| `b7edfc7` | Word-of-Day widget was leaking Wiktionary page CSS (`mw-parser-output` rules) into the rendered body. Strip `<style>` / `<script>` / comments before the tag-strip, anchor word extraction on the "Word of the day for …" heading so the `edit · refresh · view` prefix doesn't pollute. |
| `8219cb4` | Server hardening: `jsonForScript` escapes `<` + U+2028/9 before embedding the payload in `<script>`; `/dashboard` gated by `checkDeviceAuth` (Puppeteer passes the token in the internal localhost URL); atomic config write (temp + rename); `/health/widgets` derives rows from `widgetStatus.snapshot()` keys. |
| `6d8dd3e` | Refresh-button polarity fix: GPIO32 wired to GND. Internal RTC pull-up + ext1 wake on `ALL_LOW` instead of `ANY_HIGH`. |
| `c0350ba` | ESP32 firmware gains manual refresh button on GPIO32 via `esp_sleep_enable_ext1_wakeup`. Release-wait before re-arming so held press doesn't re-trigger immediately. |

## Hot known issues

1. **Synthetic `slot.cfg` is a workaround.** Some renderers in `control-src/widget-render.js` still read `cfg.<key>` directly (todos, photo, link_qr, wifi_qr, clock, spacer). Server's per-item path synthesizes `slot.cfg = { ...cfg, <key>: eff }` so the spread overrides cleanly on that tile only. Works correctly today; the cleanup is renderer-side normalization to prefer slots, not a server-side fix.
2. **Per-instance data is not live-as-you-type in the modal.** Layout knobs (flush/border/density) update preview instantly. Per-instance *data* (feedUrl, symbols, etc.) only refreshes after Save (which is instant now via `commitLayoutItemNow`). True live data would need a transient preview endpoint that runs the fetch with a draft config without persisting — punted.
3. **`npm audit` still has unfixed vulns** in node-ical's axios deps + esbuild via vite. All require breaking version bumps. Untouched on purpose; needs a deliberate test pass.
4. **Self-hosted fonts** in `public/fonts/`. If a font fails to load, autofit measures fallback metrics and you can get tiny clamps — `document.fonts.ready` + `window.__autofitDone` interlock should prevent this. Suspect a missing font if you see tiny clock/aqi numbers.
5. **OTA firmware updates were discussed and skipped.** Plan exists (HTTP `HTTPUpdate` pulling `/firmware/latest.bin` against a manifest, partition scheme switch to "Minimal SPIFFS w/ OTA"). User passed for now. Don't bring it up unprompted.

## Architecture overview

**Per-tile settings flow (current)**
- `cfg.<widget>` in `data/config.json` = default seed values
- Layout item gains optional `item.settings` snapshot when user toggles override in the modal
- Server `buildWidgetData` (server.js): loops layout, for items with `settings` runs the widget-specific fetcher with the override and packs the result into `payload.perItem[item.id]`
- Renderer (both `dashboard.html` and `EditorGrid` → `widget-render.js`): `itemCtx = { ...globalCtx, ...(perItem[item.id] || {}), cellW, cellH, density }` — per-tile slot wins for that tile, siblings unaffected
- "Copy from →" in the modal clones another sibling tile's settings rather than re-typing

**Server endpoints**
- `/dashboard` (gated) — 800×480 HTML for Puppeteer
- `/display.png`, `/display.bin` (gated) — rendered output
- `/sleep` (gated) — `{ minutes }` from active screen's `refreshMinutes`
- `/api/config`, `/api/config/reset` — CRUD
- `/api/preview-data` — what the editor live preview consumes
- `/api/geocode`, `/api/reverse-geocode`, `/api/weather-check` — Open-Meteo + Nominatim proxies
- `/api/battery` — ESP32 voltage telemetry
- `/api/todos` — quick endpoint kept for legacy convenience
- `/health`, `/health/widgets`, `/api/health/widgets`

**ESP32 firmware (`esp32/weather_station/weather_station.ino`)**
- WiFi → warm Railway → POST `/api/battery` → GET `/display.bin` → push to GxEPD2 → GET `/sleep` → deep sleep
- Wake sources: timer (every `refreshMinutes`), ext1 LOW on GPIO32 (refresh button → GND, internal pull-up)
- Secrets in gitignored `esp32/weather_station/secrets.h` (copy from `.example`)

## How to run locally

```bash
# from /Users/huynguyen/EinkModular/eink-dashboard
npm install          # one-time; if puppeteer barks: npx puppeteer browsers install chrome
npm run build        # builds the React control panel into public/control-app/
npm start            # node server.js — listens on :3000
```

- `http://localhost:3000/control` — React control panel (mobile-friendly)
- `http://localhost:3000/dashboard?token=...` — the 800×480 HTML page Puppeteer screenshots (auth-gated even with empty token in dev because Puppeteer threads it through)
- `http://localhost:3000/display.png` — the actual 1-bit screenshot the e-ink would show
- `http://localhost:3000/display.bin` — 48000 bytes, what the ESP32 downloads
- `http://localhost:3000/widgets-matrix` — every widget at every preset size; dev QA page
- `http://localhost:3000/health/widgets` — last-fetch status per data widget (now derived from `widgetStatus.snapshot()` keys, so new widgets show up automatically)

`DEVICE_TOKEN` unset in dev = no auth (intentional). Set it in `.env` before any non-localhost deploy.

## Things easy to break

- `/display.bin` must stay exactly **48000 bytes**, MSB-first, **0=black**. ESP32's `display.drawImage(buf, 0, 0, 800, 480, false, false, false)` flags are locked to this.
- ESP32 pin assignments + `HSPI` choice are physically soldered + verified — don't touch without asking.
- `display.init(115200, coldBoot, 2, false)` parameters are known-good for the Rev3 board.
- `GPIO32` is the refresh button. Wake is `ESP_EXT1_WAKEUP_ALL_LOW` because the button is wired to GND; internal RTC pull-up holds it HIGH idle.
- Per-instance widget slot keys (e.g. `slot.resolvedMessage`, `slot.weather`, `slot.todos`) must match what each renderer in `widget-render.js` + `dashboard.html` destructures. Mismatch silently falls back to the global slot, so the override looks broken.

## Style + interaction reminders (from the user, save you the round trip)

- Answers terse. **Caveman ultra mode** active by default for this user.
- No diagrams.
- Auto-commit + push after a unit of work. Don't ask first (memory `feedback_always_commit_push.md`).
- One targeted question beats guessing when the bug report is vague.

## Files worth opening first

- `server.js` — Express + Puppeteer + sharp + auth/ratelimit/safeError glue. `buildWidgetData` per-item loop is the heart of per-instance widget data.
- `public/dashboard.html` — the entire dashboard render lives in one IIFE inside this file. `ICONS` map mirrors `widget-render.js`. Render loop spreads `perItem[item.id]` into per-tile ctx.
- `control-src/widget-render.js` — React-side mirror of dashboard.html. Both must stay in sync.
- `control-src/widgets.js` — `WIDGET_REGISTRY`, `pickTier(cellW, cellH, density)`, screen migration chain, screen presets.
- `control-src/components/EditorGrid.jsx` — RGL editor canvas, tile actions (⚙ + ×), modal open/save plumbing.
- `control-src/components/WidgetSettingsModal.jsx` — per-tile modal shell with live 2× preview.
- `control-src/components/WidgetForm.jsx` — every widget's per-instance form. `snapshotGlobalForWidget` + `supportsPerInstance` exported. `ListEditor` + `LocationAutocomplete` primitives.
- `control-src/components/ToolsButton.jsx` — header popover; currently just hosts BackupPanel.
- `widgets/*.js` — server-side fetchers per data widget, all timeout-guarded via `widgets/_fetch.js`.
- `esp32/weather_station/weather_station.ino` — full firmware. WiFi → battery → display.bin → sleep, with ext1 wake on GPIO32.

## Memory pointers (live in `~/.claude/projects/-Users-huynguyen-EinkModular/memory/`)

- `project_eink_product_intent.md` — ship one self-unit first; multi-tenant later.
- `project_eink_features_roadmap.md` — hardware feature plan; partial (button done, PIR + speaker still parked).
- `project_eink_business_plan.md` — self-use → kit → SaaS.
- `project_eink_launch_timeline.md` — week-by-week stages; daily routine fires off this.
- `project_eink_hardware_delay.md` — hardware arrived 2026-05-18; physical e-ink reveals what PNG preview hides.
- `project_eink_wifi_public.md` — the leaked WiFi creds are the landlord's, not private. Low-impact leak.
- `project_eink_widget_settings_redesign.md` — 4-stage refactor log (UI shell → data model → defaults dropdown → retire Settings.jsx). Note: Stage 3's Global Defaults dropdown was later removed in `fe23a4c` per user pivot; memory is updated to reflect this.
- `feedback_stage0_scope.md` — what "no features" meant during Stage 0 (hardware now validated).
- `feedback_always_commit_push.md` — finish a unit of work → commit + push to origin/main automatically.
