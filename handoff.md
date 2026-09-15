# E-Ink Dashboard — Handoff

> ## 2026-09-15 (later) — AI widget + central-setup stage 1
> - **`ai` widget (32nd).** Prompt + the dashboard's own data -> a few lines.
>   Provider-agnostic over plain `/chat/completions` (OpenAI and DeepSeek are
>   the same shape), so switching is `AI_BASE_URL`. No vendor SDK.
>   **Live on the panel and working.** Env: `AI_API_KEY`, `AI_BASE_URL`,
>   `AI_MODEL` (no default on purpose). User runs `deepseek-flash`.
> - **Cadence is the design.** Generation is time-based (daily default,
>   hourly opt-in), cached on disk under DATA_DIR, so ordinary wakes cost
>   nothing and the ETag only moves when the text does. A failed call keeps
>   serving the last good text.
> - **Two bugs found by photographing it**, both fixed: DeepSeek runs
>   thinking mode BY DEFAULT, so a 200-token ceiling went entirely on
>   reasoning and returned empty `content` (now `thinking: {type:'disabled'}`
>   for DeepSeek, ceiling 800); and the tile said "Generation failed" instead
>   of the provider's actual words.
> - **It restated the forecast beside it** — and disagreed with it, since its
>   "today's high" is the current-conditions daily max while the forecast tile
>   renders its own. Now told what else is on screen and asked for judgement
>   rather than data. The underlying figure mismatch is untouched and
>   pre-existing.
> - **Central setup stage 1** (`docs/setup-architecture.md`): `cfg.home` block
>   + "About you" free text (Settings > Tools), which the AI puts first in its
>   context. Also DECLARES `city`/`lat`/`lon`/`githubUser`, which were read by
>   fetchers and written by SetupWizard but appeared in no schema. Stages 2
>   (read helper + Setup panel) and 3 (widgets inherit) deliberately not
>   started — they change how every location-aware widget reads data.
> - **Simplification stage 1** shipped earlier the same day: the eleven
>   per-tile typography knobs and the layout-density control are gone from the
>   modal (UI only — stored values still render, so nothing restyled itself).
>   The user's own config was the argument: 4 tiles, all `theme: inverted`,
>   4 of 99 variants used, one real typography override across the whole
>   screen. Rule refined by the user: keep controls that change WHAT
>   information appears (forecast days, headline count, zones), cut ones that
>   only decorate it.
>
> ## 2026-09-15 — panel offset SOLVED + VERIFIED ON GLASS
> Fix confirmed on the physical panel: with `Content-Length` shipping and
> `PANEL_SHIFT_3C_PX=0`, the calibration target lands correctly —
> sentinels flush to both edges, diagonals straight, planes registered.
> Not a panel trait. `/display.bin` and `/display-3c.bin` answered with
> `res.end(bin)` and no `Content-Length`, so Node framed the body as
> `<hex size>\r\n` + data + `\r\n0\r\n\r\n`. The firmware reads
> `http.getStreamPtr()` — the raw socket — which does not strip chunk
> framing, so it drew the framing as pixels: `"17700\r\n"` is 7 bytes =
> **56px** of shift on the whole image, and each further chunk boundary
> over TLS inserts ~8 bytes = **64px** more, partway down.
>
> **How it was found.** `lib/calib.js` + `CALIB_3C` serve a measurement
> target instead of the dashboard (no Puppeteer, no fonts, so it renders
> even where Chrome is missing). Three consecutive draws were identical —
> deterministic — and showed the black plane uniformly ~56px right, the red
> plane ~56px down to about row 175 and ~120px below it. 7 bytes, then 8
> more at ~65536 bytes in. Confirmed on a raw socket: the response body
> literally begins with ASCII `17700\r\n`.
>
> Why nobody caught it: a whole-image rotation can't fix bytes inserted at
> two different points in the stream, so `PANEL_SHIFT_3C_PX` could be tuned
> forever without converging — and the "swap the GxEPD2 panel class" tests
> in `fc1066d` / `542482d` were judged against a dashboard photo, which
> can't distinguish this from a hardware offset.
>
> **Fixed:** `ccb7a56` sets `Content-Length` on both device binaries (fixes
> the fleet with no reflash) + a `test:api` case asserting the framing on a
> raw socket. `3efdb4f` = firmware **1.21.0**: `ImageBufferSink` lets
> `HTTPClient::writeToStream()` decode chunked straight into the image
> buffer, used only when `Content-Length` is missing so the well-tested raw
> loop still handles the normal case.
>
> **`PANEL_SHIFT_3C_PX` must now be 0.** It was compensation for this bug;
> any non-zero value actively misaligns the panel. Same for clearing
> `CALIB_3C` once verified.
>
> Left alone deliberately: the BW sketch has the identical raw-stream
> weakness, but that panel is **physically broken**, so it ships no
> untested change. Its CI matrix entry is now dead weight.
>
> ## 2026-08-23 — PROD OUTAGE: Chromium zombie leak (fleet down)
> `fd7f624`. The Aug-13 idle-close change launched + killed a fresh
> Chromium per render; each one spawns a `chrome_crashpad_handler` that
> re-parents to PID 1 on browser death. Container ran bare `node` as
> PID 1 — never reaps — so hourly wake churn piled zombies until the PID
> table was exhausted: `posix_spawn … Resource temporarily unavailable
> (11)` / `fork: EAGAIN`, and every render endpoint (panel,
> `/display.png`, `/display.bin`) 500'd `internal_error`.
> Three layers, redeploy clears the backlog (fresh container):
> 1. **tini as PID 1** (nixpacks pkg + `tini -g -- node server.js`) —
>    reaps orphans. Root fix.
> 2. `BROWSER_IDLE_MS` back to **0 = resident browser** (the pre-Aug-13
>    model that ran stable for months). Re-enable idle-close via env
>    only once tini is confirmed live.
> 3. `--disable-crash-reporter` / `--disable-breakpad` so the handler
>    never spawns.
> **Lesson:** any per-render process churn in a container needs an
> init that reaps. Don't re-enable idle-close without checking PID
> count on the box.
>
> ## 2026-08-13 — cloud RAM/CPU trim (this caused the above)
> `51c8c82`. Railway bills per-minute actual usage; the render path held
> one Chromium resident 24/7 and re-rendered every 5 min for a fleet that
> wakes every 15-30 min (~450 MB idle + renders nobody reads).
> - **A. Idle browser close** (`lib/render.js`): track in-flight renders,
>   arm a `BROWSER_IDLE_MS` timer on the last finish → `killBrowser()`;
>   `getBrowser()` relaunches on demand (+1-2 s cold). Image cache is
>   separate bytes and survives, so devices still serve from cache — only
>   the background revalidate pays. `killBrowser()` nulls the handle
>   synchronously before awaiting close so a racing render relaunches
>   cleanly. **Now defaults 0 (off) after `fd7f624`.**
> - **B. `PRERENDER` now opt-in (`=1`)** — stale-while-revalidate already
>   warms the device cache on wake, so the 24/7 interval render was waste
>   on an infrequently-woken fleet. Opt back in for a shared always-on
>   host with many frequent wakes. Startup logs both states.
>
> ## 2026-07-19 — `.tr-bar` shape variants
> `41860b7`. Per-tile `barShape` on the shared progress/fill bar, five
> shapes over the default rect: `pill`, `ticked` (hairline ink notches at
> 25/50/75%), `segmented` (10 cells split by paper gaps), `battery`
> (rounded body + right tip nub), `notched` (segmented + tip). Pure CSS —
> `::before` draws ticks/segments, `::after` the tip, radii ride the solid
> frame; 1-bit safe. `barShapeClass(settings)` in `_shared.js` appends the
> modifier; wired into `eink_battery`, `mac_battery`, `progress`. Other
> bar users (weather_hero, aqi, uv, moon, now-playing) can opt in by
> threading the same helper.
>
> ## 2026-07-17 — editor batch (widget count now 31)
> - `16d8117` **per-tile layout variants finished.** Universal Layout
>   **Density** control (Detailed / Auto / Minimal) in the settings modal
>   — the `item.density` lever already fed `pickTier` (±1 size tier) and
>   was dirty-tracked but had no UI. Plus **chess variants** (diagram /
>   board-only / with-coords), the last widget without `def.variants`.
> - `7a0a551` **palette bug + search.** The grouped pool iterated only the
>   hardcoded `POOL_CATEGORIES`, but `POOL_META` assigned `Fun` (art,
>   chess) and `Money` (stocks) — those 3 counted in the badge and were
>   **unreachable from the add-widget pool**. Added both categories, and
>   the render now appends any stray category after the known ones so a
>   mis-categorised widget can't silently vanish again. Also: `keywords`
>   synonym string per widget (music/spotify → now-playing, rss/hn →
>   headlines, btc → crypto) folded into pool search, + sticky category
>   filter chips.
> - `bebda0c` **palette keyboard + recents.** Enter-to-add the top match
>   (highlighted with an inset ring, badge swaps to `↵ <label>`), Escape
>   clears the query then closes the pool; `addToCanvas` records the type
>   to a capped localStorage recents list shown as a quick-add chip row in
>   the default browse view. Pool is now type → Enter drivable.
> - `7ea5316` **lazy-load on-demand surfaces.** `WidgetSettingsModal`
>   (drags in WidgetForm + every `form.jsx` + TokenPicker + Radix Tabs),
>   `SetupWizard`, `ShortcutsHelp` → `React.lazy` behind their existing
>   conditional renders. Render modules stay eager (canvas/palette need
>   them). Initial index chunk **384 → 344 kB** (gzip 111 → 101).
> - `a044bea` **dead density knob hidden.** `art` / `codeactivity` /
>   `mac_battery` / `weather_forecast` never read `ctx.density` (they size
>   off cellW/cellH), and on `art` it collided with that widget's own
>   numeric `density` grid-fineness setting. `usesDensity: false` on those
>   four defs; modal gates the section on `def.usesDensity !== false`.
>
> ## 2026-07-07 (later) — hardware slim-down + widget batch
> - HW: user cutting buzzer + button. fw 1.20.2/1.14.2 add buttonless WiFi
>   recovery (portal self-opens on 3rd consecutive fail, then ~daily/6-hourly).
>   Desolder only AFTER roster shows 1.20.2. Alarms now pointless (no buzzer).
> - NEW widget `uv` (28th): Open-Meteo keyless, gauge + WHO-band scale
>   variants; peak-today in foot, moves to titlebar meta on short tiles.
> - `progress` variants: `dots` (10 steps/span, step follows rounded pct)
>   + `pixels` (year day-grid, portrait→vertical orient, compact meta <8w).
> - Gap fixes: gauge must sit DIRECTLY in .tr-body (aspect-ratio chain);
>   WHO band on rounded uv; ▼ literal not &#9660; (eink-lint hex-color FP).
>
> ## 2026-07-07 — open-sourcing POSTPONED (user call)
> Prep done + kept: CI builds secret-free bins (empty wifi/token — captive
> portal + per-device api keys), 40 token-bearing bins removed from tip,
> github.com/hqn07 profile live w/ showcase. NOT done: history scrub
> (wifi pass `REDACTED` + two fleet tokens still in old commits —
> bins in history too), visibility still PRIVATE, local secrets.h reverted
> to match Railway. To resume: mirror clone → git-filter-repo
> (--invert-paths --path public/firmware + --replace-text) → force push →
> rotate DEVICE_TOKEN (Railway + secrets.h) → flip public. ~30 min.
>
> ## 2026-07-06 session (Fable 5) — all pushed
> - **Panel offset bug FIXED (server-side):** B panel displays image rotated
>   right ~64px (hardware trait — GDEY075Z08 vs Z08 class swap changed
>   nothing, both reverted). `/display-3c.bin` now pre-rotates left by
>   `PANEL_SHIFT_3C_PX` env (bit-accurate row rotation in `lib/image.js`
>   `shiftPlanesLeft`; etag suffixed so recalibration busts 304s). **Set
>   `PANEL_SHIFT_3C_PX=64` in Railway, photo panel, tune ±8. No reflash.**
> - **Dither tiles:** ramp g37/g62/g87 + textures diag/hlines/vlines/cross
>   + rdiag (`215-dither-tones.css`). weather_hero bars: humidity=checker,
>   cloud=diag. progress bars: per-span weave (day/week/month/year =
>   checker/diag/vlines/cross).
> - **Remote firmware log:** fw 1.20.0 (needs flash) buffers last failure in
>   RTC, POSTs /api/log on recovery; GET /api/logs (admin) reads. 
> - **Per-device screens:** PATCH /api/device/:id {screen} → that device
>   renders the assigned screen (query param still wins).
> - **Webhook widget:** POST JSON → /api/webhook/<key> (device token auth)
>   → widget renders payload; template mode `{{path}}` per line or auto
>   key/value grid. New widget wired all 5 spots; 20 api tests green.
> - **Stale-enrollment fix (gap found in prod):** roster was empty with a
>   live panel — device NVS held an api_key the server lost, auth fell
>   through to fleet token forever. Server now sends `X-Enroll-Stale: 1`
>   on unknown keys; fw 1.20.1 (b) / 1.14.1 (bw) clear NVS + re-enroll.
>   CI auto-ships bins; B panel OTAs itself, roster repopulates on its own.
> - Polish: webhook cache-bust only on changed payload; progress bars
>   degrade to fit (S=1/M=3/L=4, .tr-l/.tr-v unstyled-outside-.tr-lv bug
>   fixed); visual-regression harness no longer orphans its server.
> - `PANEL_SHIFT_3C_PX=64` LIVE on Railway (etag `-s64` confirmed).
> - Visual baseline refreshed (was stale since the 5-widget batch).
> - Two GxEPD2 copies on disk (libraries/GxEPD2 1.6.5 + misnested
>   libraries/libraries/GxEPD2 1.6.9) — cleanup candidate, not urgent.


> ## ▶ RESUME HERE (2026-09-15)
> Run `/continue`. Everything below is on `origin/main` (tip `fd7f624`,
> 2026-08-23). Repo state verified today: `check:widgets` 31 widgets wired
> + token registry in sync, `lint:eink` clean, `build:css` produces no
> drift against the committed `public/dashboard.css`. Working tree clean.
>
> **⇒ PRIORITY 1 — PARTLY DONE 2026-09-15.** A dashboard photo (not just the
> calibration target) confirms the chunked-framing fix on a real render:
> clean left and right edges, no wrapped strip, `PANEL_SHIFT_3C_PX=0`. The
> `weather_forecast` / `clock` / `world_clock` / `ai` screen reads well on
> glass. What is still unverified is every OTHER widget's visual work since
> 07-01 — the four on that screen are now confirmed, the other 28 are not.
>
> **Original note (still true for the unverified widgets):**
> Every visual change since 2026-07-01 (gauge/heatmap primitives, space-
> aware fit ladder, moon NASA disc, uv widget, progress dots/pixels,
> chess variants, `.tr-bar` shapes, 5-day calendar strip) is verified only
> through the 1-bit sim harness (`node scripts/preview-components.mjs` —
> a scratch file, rewritten per task: renders through the real face CSS +
> Chrome, then `sharp.threshold(128)` to fake the panel). Until 09-15 the
> panel itself was misaligned by the chunked-framing bug, so any photo
> judgement was being made through a 56px shift — worth re-checking
> anything that was assessed on glass before that date. Product intent =
> ship one self-unit first, so this gates further polish.
>
> **⇒ TOP PRIORITY 2: tini never shipped — `nixpacks.toml` is inert.**
> The Railway service's builder is **RAILPACK** (`get-service-config`,
> 2026-09-15), so `nixpacks.toml` is not read at all: not the `tini` pkg,
> not the `tini -g -- node server.js` start command, not its `[variables]`
> block (`PUPPETEER_EXECUTABLE_PATH`, `PUPPETEER_SKIP_DOWNLOAD`,
> `DATA_DIR` — Railpack apt-installs its own Chrome deps and the real
> `DATA_DIR` is a Railway variable). An earlier note in this file claimed
> tini was live because `fd7f624` deployed successfully; that was wrong —
> a successful deploy says nothing about a file the builder ignores.
>
> So of the Aug-23 outage fix, only the code layers are live:
> `BROWSER_IDLE_MS=0` (resident browser — no relaunch churn, hence no
> orphaned crashpad handlers) and the `--disable-crash-reporter` /
> `--disable-breakpad` launch args in `lib/render.js`. The resident
> browser is what's actually holding prod up, and there is **no reaper
> behind it**. Do not raise `BROWSER_IDLE_MS` off 0 until either the
> service builder is switched back to NIXPACKS or tini (or another init)
> is arranged under Railpack — that combination is the exact Aug-23
> fleet-down configuration.
>
> Volume/DATA_DIR pairing is fine, checked 2026-09-15: the Railway
> variable `DATA_DIR=/data` matches the volume mount at `/data`, so config
> does survive redeploys. (The inert `nixpacks.toml` still says
> `/app/data` — ignore it; it documents a builder that isn't in use.)
> Check: container PID 1 is `tini`, and no `chrome_crashpad_handler`
> pile-up across a few hours of device wakes.
>
> **Also pending from earlier sessions (not code work):**
> - **Firmware roster before desolder.** Don't cut the buzzer + button
>   until `/status` shows the device on fw **1.20.2** (buttonless WiFi
>   recovery). Alarms become pointless once the buzzer is gone.
> - **History scrub** if open-sourcing resumes — wifi pass
>   `REDACTED` + two fleet tokens are still in old commits, and the
>   repo is still PRIVATE. Recipe in the 2026-07-07 entry, ~30 min.
>
> **Closed since the old resume block (don't re-plan these):**
> - **Transit widget — SHIPPED** (`b8e73a5` NYC MTA live arrivals,
>   extended `db3c3d9` to both platforms). It was listed as "open".
> - **code-activity "SETUP NEEDED" in the editor — fixed in code.**
>   `/api/preview-data` now calls `buildWidgetData(cfg, units, layout)`,
>   whose per-item loop hits `fetchCodeActivity` like the panel does
>   (`lib/widget-data.js:234`). Worth one look in the editor to confirm
>   visually, but there's no missing plumbing.
> - **Bundle-size split — partly done.** `7ea5316` lazy-loads the settings
>   modal / setup wizard / shortcuts overlay: index chunk 384 → 344 kB
>   (gzip 111 → 101). Vendor chunks (grid/icons/motion) are still eager
>   because first paint needs them; `manualChunks` on those is what's left
>   if the warning is worth chasing.
>
> **Deploy hygiene — `railway.json` is IGNORED, same as `nixpacks.toml`.**
> It sets `build.watchPatterns` to skip `**/*.md`, `docs/**`, `.github/**`,
> `esp32/**` and `test/visual-baseline/**`, but observed behaviour on
> 2026-09-15 is that docs-only and firmware-only commits still trigger full
> deploys. This service takes its build config from the Railway dashboard,
> not from the repo (builder is RAILPACK). To actually stop the churn, set
> Watch Paths in Service → Settings → Build; otherwise delete
> `railway.json`, which is currently decorative. Keep `public/**` watched
> either way — CI-built firmware bins live in `public/firmware/`.
>
> **Open (small, not started):** heatmap 2px cell borders read a bit
> heavy; two GxEPD2 copies on disk (`libraries/GxEPD2` 1.6.5 + misnested
> `libraries/libraries/GxEPD2` 1.6.9); `npm audit` vulns (node-ical axios
> + esbuild via vite) all need breaking bumps, untouched on purpose.
>
> **Visual baseline caveat:** `test/visual-baseline/` was last rebaselined
> `192acaa` (2026-07-15), before chess variants (`16d8117`) and `.tr-bar`
> shapes (`41860b7`). Both defaulted to the existing look, so the matrix
> may still pass — but run `test:visual` before trusting a diff, and
> `:update` only if the drift is intended. Baselines are machine-specific.
>
> **Workflow per unit:** `build:css` → `lint:eink` → `check:widgets` →
> `test:visual` (compare; `:update` only when the drift is intended) →
> `vite build` (editor changes) → `test:api` (server). Commit + push each
> unit (auto-push is on). New widget = wire all the spots
> `scripts/check-widgets.mjs` guards (see `reference_widget_wiring`
> memory): render module + `form.jsx` + `_registry.js` + `_ssr.js` +
> `widgets.js` palette — plus a `POOL_META` category that actually exists
> in `POOL_CATEGORIES` (see `7a0a551`).

## 2026-07-01 session (all pushed)

- Gauge + heatmap primitives — `gaugeHtml()` / `heatmapHtml()` in
  `control-src/widgets/_shared.js`; `225-trmnl-gauge-heatmap.css`. aqi
  has a `gauge` variant. heatmap: `orient:'h'|'v'`, empty cells white.
- **Space-aware fit ladder** (calendar/world_clock/onthisday): dotted—no,
  accent bar on `.tr-row-inner` (hugs text, not the grown band);
  `.tr-clamp`+`--fit-lines` wrap-before-clip; `.tr-rows-fill` fills
  under-full lists; `fillRowFont()` grows title text to fill big tiles.
- **Moon** (`widgets/moon.js`): fixed inverted polarity (lit=light,
  shadow=dark); lit face is a real dithered **PD NASA** photo
  (`_moon-image.js`, SVS 5187) clipped to the terminator; `flow` variant
  = flat **phase timeline** (today centred, ⅛-cycle step so neighbours
  are distinct + directional). Cover-flow 3-D was tried + dropped (round
  discs → coins).
- **Dotted dividers** on TRMNL cards (was dashed).
- **Code Activity** widget — GitHub contribution heatmap, no-token
  jogruber API, per-tile `username` (user = `hqn07`). Fills portrait
  tiles via vertical orientation.
- **Editor placement fix** — removed the `<motion.div layout>` FLIP that
  fought react-grid-layout (tiles flickered on drop / reverted on resize).
- **Autofit unified** — 4 copies → `control-src/autofit.js` (React
  imports; server injects at `<!--__AUTOFIT__-->`).

Everything below is historical session log, newest first. Read the RESUME
block above + `CLAUDE.md` + the memory pointers at the end of this file
before touching anything.

## 2026-06-29 session

### Quality pass (SaaS-readiness, single-tenant)

- **Endpoint tests**: `npm run test:api` (node:test + fetch, zero deps) —
  boots a server on a temp DATA_DIR, covers auth gating, config-body
  validation, refresh/battery-aware/quiet/push-now headers, enroll+delete,
  battery validation. 12 tests ~2s. Separate from deploy `prebuild` (boots
  Puppeteer). Docs in CONTRIBUTING.
- **Error visibility**: `console.error` wrapped into a 50-entry ring,
  surfaced on `/status` (Errors count + Recent errors section). Cleared on
  restart.
- **Config guard**: `POST /api/config` rejects non-object body / non-array
  screens (was spreadable → corruptible).
- **Visual baseline** rebaselined (was stale since `afbf62e`; guard had
  been silently failing on dimensions). `test:visual` PASS 0px.
- **RESET_PIN** lockout-recovery env hatch (clears forgotten PIN on boot;
  only `1/true/yes/on` trigger, `0/false/unset` = off). `/control-classic`
  PIN-gate fixed. `/api/setup` token-gated.
- Remaining quality items (not done): first-run security gate (force
  PIN+token on fresh deploy).



### Multi-tenant / SaaS architecture doc — WRITTEN (not built)

User confirmed the eventual target is SaaS (other people run their own
devices off one instance), still parked behind hardware validation. Full
design in `docs/multitenant-architecture.md`: Supabase schema
(accounts/screens/devices), device claim-code flow, per-device request
resolution (no firmware change — device already sends its api_key),
caching at scale, file→DB build sequence, single-tenant guardrails.
**Keystone = config file→DB; the only expensive-to-retrofit piece.** Also
pointed at from `CLAUDE.md` and the `project_eink_multitenant` memory.

Security note (single-tenant, now): going public = set a Control PIN
(immediately, or someone could claim the first-run set-pin) AND a
`DEVICE_TOKEN` in Railway. That locks editor + settings writes.
`/api/setup` is now gated behind `DEVICE_TOKEN` too (was open) — closes
the mint-a-key-then-read-image gap; firmware `enrollDevice()` sends the
token via `addToken()`. Already-enrolled devices are unaffected; a device
that loses NVS needs firmware with the addToken enroll change (flashed
1.15.0 does NOT have it yet — reflash before relying on auto re-enroll).
`/control-classic` PIN-gate bug fixed.

### Header → single Settings menu

Consolidated five header controls (Mac-agent status, Setup, Panel view,
Lock/PIN, Tools) plus the `?` keyboard-shortcuts button into one gear
**Settings** dropdown (`control-src/components/SettingsMenu.jsx`).
Layout is sectioned (Option A): STATUS / DEVICE / SECURITY / TOOLS, every
row iconed, Mac status shows a broadcast icon + label, and Alarms +
Backup collapse behind expandable rows. `PanelPreview` and `PinButton`
gained a `block` prop (render trigger as a menu row, keep their own
modal/popover). `ToolsButton.jsx` deleted (folded in). Mobile
screen-settings FAB icon changed Gear → `SlidersHorizontal` so it no
longer clashes with the Settings gear.

### Railway persistent volume (config now survives redeploys)

User upgraded to Railway **Hobby**. Mutable state already routes through
`DATA_DIR` (server.js; default `./data`, seed defaults in `data-defaults/`
so a volume doesn't shadow them — all writes funnel through
`atomicWriteFile`). To persist across deploys:

- Set env var `DATA_DIR=/data` on the service.
- Attach a Railway **Volume** mounted at **`/data`** (right-click service
  → Attach Volume, or Cmd+K → Volume). **Mount path MUST equal
  `DATA_DIR`** — keep both `/data`, not `/app/data`.
- A fresh volume starts empty → server seeds from `data-defaults/`, so the
  pre-switch live config is lost. Export config first (Settings → Tools →
  Backup → EXPORT), then IMPORT after the volume is live.

Code/docs pushed (`.env.example` documents `DATA_DIR`). Volume + var are
configured in the Railway dashboard, not in the repo.

### Background pre-render (warm cache for device wakes) — DONE

`server.js` image cache is now **stale-while-revalidate**: once an entry
exists, `getCurrentImage` returns it instantly and refreshes stale
entries (`>IMAGE_CACHE_MS`, 60s) in the background — only a cold cache
renders inline. A boot warm + `setInterval` (`warmActiveImage`,
`PRERENDER_INTERVAL_MS` default 5 min, `unref`'d) keeps the active
variant fresh; `invalidateImage()` re-warms right after a config save.
Disable with `PRERENDER=0`. Net effect: the ESP32 wake no longer waits
on a ~2-3s cold Puppeteer render. Verified locally — first `/display.bin`
hit served warm in ~1.7ms (48000 B). Relies on Hobby always-on; if the
service ever sleeps the first wake after idle is cold again.

### Push now (fast-refresh window) — DONE (server+UI; firmware optional)

Deep-sleep ESP32 can't be woken remotely, so push-now opens a server
fast window rather than a true push. `effectiveRefresh()` / `pushNow()` /
`fastWakeUntil` in server.js: while the window is open the device is told
to poll every `FAST_INTERVAL_SECONDS` (env `PUSH_INTERVAL_SECONDS`, def
20) for `PUSH_WINDOW_MS` (def 5 min), then back to normal. Honored by
`/display.bin`, `/display-3c.bin`, `/sleep`. `POST /api/wake` (admin)
opens it, re-renders + re-warms, returns `maxLatencyMinutes` (one current
interval — the device must wake once to enter the window). "Push now"
button lives in the Settings menu → Device.

**B firmware flashed `1.15.0`** (2026-06-29): now sleeps in seconds and
reads `X-Refresh-Seconds`, so a push-now window polls at the exact server
cadence (20s) not the 1-minute floor. Repo `weather_station_b.ino` synced
to match the flashed device. BW (`weather_station`) firmware NOT converted
— still minute-based; apply `esp32/PUSH_NOW_FIRMWARE.md` if that board is
ever revived. Inherent ceiling unchanged: latency to *enter* fast mode =
current sleep interval (device must wake once); can't beat that on battery
deep-sleep without always-on radio.

### Battery-aware refresh — DONE (no reflash)

`effectiveRefresh(cfg, battPct)` raises the refresh-interval floor as the
battery drains (`batteryRefreshFloor`: <35% →60min, <20% →120, <10% →240).
Only raises a floor — never shortens below the configured interval — and
push-now fast windows still override it. Reads the `Battery-Pct` header the
firmware already sends (so no flash); `/sleep` + the warmer fall back to the
cached `_batteryState.pct`. `battSaver` flag exposed on `/sleep`. Disable
with `BATTERY_AWARE=0`. Precedence in `effectiveRefresh`: fast window >
battery floor > config interval. Verified locally (5min base → 60/120/240
at 30/15/5%).

### /status explanations + device cleanup — DONE

Per-row click-to-expand "i" explanations on `/status` (flat battery = fine,
blank weather key = fine since default is Open-Meteo, what "stale" means,
etc.). Live-render link now carries `?token=` (was returning "bad token").
Devices table marks rows >2d stale and has a "remove" action (`DELETE
/api/device/:id`, admin, matches friendly_id or MAC) to prune old
enrollments; a live device re-adds itself on next wake. Board strings:
`b` = 3-colour firmware, `bw` = black/white. The two `bw`/1.13.x rows were
pre-reflash enrollments — removable; the reflashed B device shows board
`b` / FW `1.15.0` once it next checks in.

### /status enrichment — DONE

`/status` now shows the device-cadence state: **Refresh now** (effective
interval + reason: FAST push window / battery-saver vs base), **Pre-render**
(warmer on/off + cadence), **Push window** (active countdown / idle), and
**Battery trend** (drain %/h, rough time-to-empty, block-char sparkline of
recent %). Helpers `batteryTrend()` + `sparkline()` added above the route.

### Quiet hours — DONE (no reflash)

Global `cfg.quietHours = { enabled, from:'HH:MM', to:'HH:MM' }` (tz-aware,
wrap-aware). `quietMinutesRemaining()` → during the window `effectiveRefresh`
returns minutes-until-window-end (capped 1440), so the device wakes once at
the end instead of all night. Precedence: push-now > quiet > battery floor >
config. `quiet` flag on `/sleep`; "quiet hours" reason on `/status`. Editor
control `QuietHours.jsx` in the schedule-collapsible. Default (disabled) in
`config.default.json`. Verified: /sleep 5min → 1288min inside a covering
window.

Still-open options (no reflash needed): Puppeteer `MAX_PAGES` bump. Custom
domain — user wants LAST. Firmware sub-minute push-now — parked, write-up in
`esp32/PUSH_NOW_FIRMWARE.md`.

## What shipped in the 2026-06-16 session (HEAD on `origin/main`)

A visual-regression harness, a variant-thumbnail fix, and **six new
widgets** — all no-key. Pushed `196c9c5` → `afbf62e`. Widget count
8 → 14. Every widget rides the contract-v2 scaffold (def.variants +
defaultVariant + degrade, render(ctx) reads ctx.variant) and is covered
by the new visual-regression test.

### Visual-regression test (`88182ad`)

`npm run test:visual` boots the server, screenshots
`/widgets-matrix?demo=1`, and pixel-diffs (via sharp — no new deps,
matches the eink-lint script idiom) against a committed baseline
(`test/visual-baseline/widgets-matrix.png`). `test:visual:update`
rebaselines. Exit 1 on drift + writes a red-pixel diff PNG (gitignored).

- New `?demo=1` on the matrix route skips the live fetch so every tile
  renders from frozen demo data → output is **byte-identical** (0 px on
  an unchanged render). A single spacing-token nudge trips it.
- Threshold 0.05%; baseline is **machine-specific** — regenerate with
  `--update` on a new machine. **Rebaseline whenever the matrix changes
  on purpose (every new widget / layout edit), or the test fails.**

### mac_nowplaying variant thumbnails (`edf790b`)

Its variants only change stacked (extended/full) tiles, so the settings
picker rendered every thumbnail identically. Added `def.variantThumb
{ w, h }` (the picker renders thumbnails at that size instead of the
live tile) + seeded `demoCtxForWidget` into `PresetCard` so thumbnails
have data even when live is absent. Reusable for any tier-specific
variant.

### Six new widgets (all no-key)

| commit | widget | data | notes |
|--------|--------|------|-------|
| `1067162` | **aqi** | Open-Meteo air-quality (no key) | server fetcher `widgets/aqi.js`; reuses weather's geocoder; variants big/bar/minimal; severity = filled scale + word, never color |
| `1b5a9b6` | **countdown** | pure compute | no fetcher; reads ctx.now (frozen demo) else Date.now(); variants big/detail/minimal |
| `03cff6f` | **moon** | pure compute | synodic-month phase; disc is a 1-bit SVG (limb semicircle + half-ellipse terminator) **verified at all 8 phases** before wiring |
| `7c1380e` | **world_clock** | pure compute | Intl.DateTimeFormat; zones as `LABEL\|IANA` strings; variants stack/big/dual |
| `dd6cdcb` | **quote** | built-in set | rotates by day-of-year; optional custom list; uses autofit `multiline` so long quotes wrap (not clip) |
| `afbf62e` | **onthisday** | Wikipedia REST (no key) | server fetcher `widgets/onthisday.js`; **needs a descriptive User-Agent or 403**; variants list/feature/compact |

**Adding a widget — the wiring (all six followed this):**
1. `control-src/widgets/<id>.js` (def + render) + `<id>.form.jsx`.
2. Register in THREE places:
   - `control-src/widgets/_registry.js` (import + MODULES array + FORMS entry)
   - `control-src/widgets/_ssr.js` (import + MODULES array)
   - `control-src/widgets.js` → `WIDGET_REGISTRY` (`{ ...migratedDef('<id>') }`)
   **The last one is the editor palette's source of truth.** Miss it and
   the widget renders server-side + in the matrix but never shows in the
   add-widget pool (the `+ ADD WIDGET` badge count = WIDGET_REGISTRY
   length). This bit all six 06-16 widgets — fixed in `4eceed1` after the fact.
3. Demo data in `control-src/widgets/_pool_demo.js`
   (`demoCtxForWidget` case) — frozen so the matrix stays deterministic.
4. A `control-src/face-css/0NN-<id>.css` partial (numeric-ordered;
   `build:css` concatenates).
5. Data widgets only: a `widgets/<id>.js` CommonJS fetcher + `server.js`
   plumbing (`wantX` gate → Promise.all → buildWidgetData return →
   `...data` → `ctxBase` + the destructure at the top of
   `buildPageBodyHtml`).
6. `npm run build:css && npm run test:visual:update`, verify on the
   matrix, commit.

Note: legacy `cfg.*` keys (aqi/quote/photo/news/github/iss/etc.) are
pre-redesign scaffolding; the new widgets don't read them.

## What shipped in the 2026-06-13 → 06-15 sessions

Widgets-refresh **W2** (per-widget variant contract) finished, plus a
small TRMNL-parity pass **W3**. All pushed to `origin/main`

Widgets-refresh **W2** (per-widget variant contract) finished, plus a
small TRMNL-parity pass **W3**. All pushed to `origin/main`
(`70fc191` → `196c9c5`).

### W2 — every widget onto contract v2 (one variant model + one picker)

Contract v2 (defined in `control-src/widgets/_registry.js` header):
a widget declares `def.variants { <name>: { label } }` +
`def.defaultVariant` + advisory `def.degrade { <tier>: [dropped] }`;
`buildTileCtx` resolves `settings.variant` → `ctx.variant`; the
settings modal auto-renders the shared visual variant picker for any
widget with `def.variants` (no hand-rolled `<select>`). Render fns take
`render(ctx)` and read `ctx.variant`.

Batches (one commit each, panel-checked between):
- `40725a7` **W2-B1** weather pair — `weather_hero` (classic/split/
  minimal) + `weather_forecast` variants.
- `70fc191` **W2-B2** clock + battery pair — `clock` (big/thin/banner),
  `eink_battery` + `mac_battery` (gauge/inline/minimal, shared layout so
  the two batteries read as a pair). Legacy `settings.style` maps
  forward to a variant. Also: `/widgets-matrix` fills no-live-data slots
  (clock/batteries/now-playing) with frozen demo data via
  `demoCtxForWidget` (`control-src/widgets/_pool_demo.js`) so rows show
  layouts, not SETUP NEEDED.
- `14df252` **W2-B3** `mac_nowplaying` onto contract v2 — its six
  side-space options (time_bookends/centered/vertical_text/play_state/
  bars/metadata) became `def.variants`; dropped the hand-rolled select.
  NOTE: these variants only re-fill the bookend slots on **stacked
  (extended/full) tiers**, so picker thumbnails read alike at small
  sizes — expected.
- `af4d4f8` **W2-B4** `calendar` onto contract v2 — `viewMode`
  (list/strip/month) became `def.variants`; legacy `viewMode` maps
  forward (variant → viewMode → default). **calendar is grid-based on
  purpose** (month/strip are CSS grid, not flex). Also fixed a matrix
  bug: the per-row settings merge let `def.defaults()` clobber demo-data
  settings (calendar's empty `icalUrls` overwrote the demo feed → four
  SETUP NEEDED rows). Now demo settings win over defaults, per-row
  variant re-pinned last. `/widgets-matrix` renders 0 placeholders.

All eight widgets (calendar, clock, eink_battery, mac_battery,
mac_nowplaying, text, weather_forecast, weather_hero) now share the
contract. Verified each: `build:css` + `lint:eink` + `vite` clean,
`/widgets-matrix` 200, variants render distinct (screenshots).

### W3 — TRMNL framework parity (partial)

Audited TRMNL's framework (trmnl.com/framework) for primitives we
lack. Plan + read-only codecheck in `docs/plan-framework-hardening.md`.

- `196c9c5` **shipped**: a face-namespaced spacing scale
  `--face-gap-2…20` in `005-*` design tokens; 39 hardcoded `gap:` values
  swapped to `var()` refs across the partials. Tokens map **1:1** to the
  face's existing rhythm (2/4/6/8/12/16/20 — NOT TRMNL's 5/7/30/40,
  which never appear here), so the swap is a visual no-op with one
  source of truth. One-offs (1px, 14px) left bare.
- **Dropped — tabular numerals.** Looked obvious (numbers jitter as
  digits change) but measured `tabular-nums` directly on the self-hosted
  woff2: **zero effect** on DM Serif Display + Oswald (the gstatic Latin
  subsets carry no `tnum` table; JetBrains Mono is already monospaced).
  Would've been dead code. Number-jitter fix parked pending a
  tnum-enabled font build or a mono-digit decision.
- **Dropped — `.columns` primitive.** The three "column" consumers
  (forecast / hourly / cal-strip) use *different* layouts (flex /
  flex+space-between / CSS grid), so a shared primitive earns ~nothing.
- **Parked (not started):** `title_bar` unification, `.item > .icon`
  slot, layout alignment utilities. Skipped as N/A to a 1-bit fixed
  800×480 face: responsive prefixes, view mashups, 16-shade grayscale.

### Font audit (no defect found)

Investigated whether bold was broken (Oswald/JetBrains weights share
woff2 files). Measured: Oswald 700 renders genuinely heavier than 400
(278.9 vs 253.9px @100px) — variable-font weight axis works; shared
files are normal for variable fonts. DM Serif Display `font-weight:700`
is inert but that's correct (single-weight display face). Only real
font limitation = no `tnum` table (see W3 above). Nothing to fix.

## What shipped in the 2026-06-09 session

One long CAVEMAN-ULTRA pass spanning four big areas:
**token system**, **chrome removal**, **calendar overhaul +
settings-component upgrades**, and **main-page UI rebuild** (8
sub-stages G/H/J/I/F/#3/K + a SaveBar/+ button fix). Plus a
reliability sweep on the server. Every change rebuilt + verified
locally; `/display.png` re-checked at the visual milestones.

### Reliability sweep (server.js)

- Process-level `unhandledRejection` + `uncaughtException` handlers
  log instead of crashing the dashboard renderer.
- `atomicWriteFile` for battery state file (write to `*.tmp` →
  rename) — partial writes can't corrupt the snapshot.
- `jsonFetch` wraps every outbound fetch with
  `AbortSignal.timeout(10000)` — no hangs against dead upstream APIs.
- LRU trim on `geocodeCache` at 500 entries.
- Puppeteer page semaphore (`MAX_PAGES = 2`) — concurrent dashboard
  renders queue instead of OOMing Chrome.
- `withConfigLock()` serializes the read-merge-write cycle on
  `data/config.json` — concurrent PATCHes can no longer drop fields.

### Token system + chrome retirement

New `widgets/_tokens.js` exposes a logic-less TOKENS registry
(`date`, `day`, `city`, `temp`, `weather`, `lastRefresh`, `battery`)
and a `renderTokens()` parser for `{{token|format|default:VALUE}}`.
Multi-pipe parsing; missing values fall back to `—` em dash.

`server.js#buildWidgetData` now assembles a `tokenCtx` per render
and exposes it to all widgets. `/api/alarm/next` runs labels
through `renderTokens()` so alarm labels can interpolate.

The hard-coded dashboard **header + footer were removed**. The
replacement is a new user-controlled `text_bar` widget
(`control-src/widgets/text_bar.js`) with full token support and
view-tier awareness (subtitle drops below 2 rows; dashed
empty-state). `_chrome.js` collapsed to just `typographyCss` +
`scaleWrap` + `cellClasses`.

`public/dashboard.css` got a new TRMNL-inspired `.item` primitive
(meta / content / trailing slots + emphasis + `--allday` modifier)
and all `.hdr*` / `.ftr*` rules deleted. `.cell-flush` now strips
padding only — borders preserved (commit `aa42f5f`).

### Album-art dither polish

`widgets/_dither.js` runs `.normalize().gamma(1.2).linear(1.15,
-20)` before Floyd–Steinberg. Output dropped to 240 px to match
the extended-tier render 1:1 — fixes the visible noise band on
mac_nowplaying.

### Calendar — 3 view modes + presets

`control-src/widgets/calendar.js` now supports three view modes:
- `renderList` — agenda list (existing).
- `renderStrip` — 7-day horizontal strip (auto when ≥ 7×2).
- `renderMonth` — full month grid w/ event titles + dynamic row
  trim (auto when ≥ 7×4).

`control-src/widgets/_ical_presets.js` ships 18 iCal feeds grouped
**Countries / Religions / Sky** (Vietnam + Buddhism included on
user request). The form picks them via the new SearchableSelect,
and each preset card declares its own `viewMode` so the four
presets actually look different in the preview.

### Settings-component upgrades

Seven additions land under `control-src/components/`:

- `SearchableSelect.jsx` — cmdk-style grouped picker, keyboard
  nav, no external dep.
- `TokenInput.jsx` — typing `{{` opens a floating completion
  popover; arrow / enter / tab to accept.
- `UrlBadge.jsx` — dot indicator on URL rows (valid / invalid /
  empty).
- `TimeField.jsx` — HH:MM input mask, auto-colon, red-border on
  invalid (used in alarm + message schedules).
- `WidgetForm.jsx` — accordion swapped for **pill tabs**
  (`TabbedForm`); canonical 4-tab taxonomy
  `['Data', 'Content', 'Layout', 'Style']`. Always-visible
  "Edited" pill in `FieldLabel`. Slider thumb bubble. Drag-grip
  on `ListEditor` rows. `onHoverPreset` wired through
  `PresetContext` for live hover-preview.
- `WidgetSettingsModal.jsx` — `hoveredPresetValues` overlay so
  hovering a preset card live-applies its values to the preview
  pane.

### Main-page rebuild — stages G H J I F #3 K

(Sub-stage letters were the chat shorthand; commit order ≈ same.)

| Stage | Commit | What |
|-------|--------|------|
| G | `8172419` | Schedule timeline collapses by default; state in localStorage. |
| H | `8b927aa` | New `--accent-warm` ochre `#b68a3c` replaces the saturated web-app green. |
| J | `7ef38de` | Micro-interactions: button hover-lift, field-flash, slider bubble, framer-motion presence transitions. |
| I | `6074cf8` | Global keyboard shortcuts + `?` help overlay (`ShortcutsHelp.jsx`). |
| F | `7eaa424` | Always-on **Live preview** pane at ≥ 1200 px; ResizeObserver-driven CSS scale. |
| #3 | `f5d338c` | Pre-save validation scrolls to + flashes the first invalid field. |
| K | `e232460` | Mobile / tablet responsive: `@media (max-width: 760px)` collapses sidebar to a bottom-sheet drawer behind a FAB. |

Header rebuilt as a 3-zone layout with an inline `SyncPill` status
indicator + `?` shortcut button. `ScreenTabs.jsx` switched to pill
style with HTML5 drag-reorder + grip handle (no `dnd-kit` dep).
`SetupWizard.jsx` got a Stripe/Vercel-style numbered
`StepIndicator`. `SaveBar.jsx` rewritten as a floating pill with
slide-in `AnimatePresence`; hidden when `synced` / `syncing`.

### Final two fixes (commit `baa5bcb` + follow-up)

- `+ ADD SCREEN` glyph re-centered: `font-size: 18px;
  min-height: 30px; display: inline-flex; align-items: center;
  justify-content: center`.
- SaveBar lingered after a successful save → first attempt added
  an auto-fade timer (`saved` → `synced` after 1.5 s).
- Second pass found the *real* bug: `App.jsx` was passing
  `statusDef.cls` (not raw `status`) into `<SaveBar>`. Both
  `synced` and `saved` mapped to `cls: 'saved'`, so the bar's
  visibility check `VISIBLE_STATES.has(status)` was permanently
  true. Fix: pass raw `status`.

### Cross-cutting CSS additions (`control-src/styles.css`)

`SyncPill`, save-bar pill, schedule-collapsible, `--accent-warm`,
button hover-lift, slider bubble, edited pill, mobile drawer, FAB,
preview pane, field-flash keyframe, shortcuts modal, the 760 px /
980 px / 1200 px breakpoints.

### Post-stage polish (commits `91fd5d3`, `193b74b`)

- **Rounded corners pass** (`91fd5d3`). User flagged sharp edges
  on main-page cards. Added `border-radius: 6px` to: `section.card`,
  `.screen-tabs`, `.timeline-wrap`, `.editor-wrap`, `.preview-stage`,
  `.trash-zone`, `.palette`, `.palette-toggle`. Matches the existing
  `.preview-pane` radius. Roundness scale is now consistent across
  the main page.
- **Preview-pane parity bug** (`193b74b`). `<LiveDashboard>` was
  building each widget's render ctx as
  `{ ...data, cellW, cellH, density }` — missing the per-item slot
  + `item.settings`, and skipping `scaleWrap` / `typographyCss` /
  `cellClasses`. Editor canvas (`EditorGrid.jsx:398`) and SSR
  (`server.js:1086`) both include all four, so widgets in the
  preview pane fell back to defaults (clock → SETUP NEEDED,
  weather_hero → extended-tier FEELS panel) while the canvas
  rendered correctly. Mirror the ctx + chrome wrap so
  **preview pane = editor canvas = server render**. Added a small
  `cssDeclToStyleObj()` helper so `typographyCss`'s declaration
  string (which carries the `--w-font` custom property) survives
  the bridge into a React `style` object.

### Verified

- `npx vite build` — clean across every commit in the session.
- `/api/preview-data` curl confirms tokens resolve end-to-end.
- `import('./control-src/widgets/calendar.js')` smoke-tested per
  view mode.
- `/display.png` re-rendered at each visual milestone.

### Open / next-session candidates

- **Visual regression** — preview-pane bug was caught only by the
  user spotting the FEELS panel. A small playwright snapshot of
  `/control-app/` after a known config would have caught it
  pre-push. Still un-built.
- **Bundle size** — vite warns the JS chunk is > 500 kB. Likely
  candidates for `manualChunks`: framer-motion, phosphor icons,
  the react-grid-layout cluster, and the `_pool_demo` PNG strings.
- **Editor canvas + preview-pane drift risk** — two places now
  build the same widget render ctx. Worth extracting a single
  `buildTileCtx(item, data)` helper used by both `EditorGrid` and
  `LiveDashboard`. Memorialised here so the next drift bug doesn't
  require another user catch.
- **Hardware reality check** — 2026-06-08 was Stage 0 (validate on
  physical e-ink). Several of the visual polish items in this
  session were tuned against the PNG preview; re-run on the
  e-ink panel to catch dither / contrast issues that the LCD
  hides (memory: `project_eink_hardware_delay.md`).

---

## What shipped in the 2026-05-31 → 2026-06-02 session (`92bd733` → `4942c1b`)

Customization roadmap finishing pass + Radix UI integration + a
two-step preview architecture exploration that ended back at "fast
+ close" instead of "perfect + slow".

### Phase D — per-tile title override (commit `3399632`)

Hardcoded headings (`NOW PLAYING`, `MARKETS`, `UPCOMING`, `MAC
BATTERY`, `N-DAY OUTLOOK`) replaced with `settings.title`. Blank
falls back to the original default. Closes the last open variant
phase from the customizability roadmap.

### Inverted theme fixes (commits `72e2c9e`, `7649fc1`, `71af033`)

Three follow-ups to the `theme: 'inverted'` knob added in Phase F.
Sevesalm SVGs shipped with explicit `style="background-color:
white"` + `fill="white"` on the root — under `filter: invert(1)`
that became a solid black rectangle on the inverted tile, hiding
the temperature number below. Stripped the inline background-color
from all 21 SVGs; weather + battery glyphs now render as white
outlines on the black tile. `.mac-np-art-empty` (the album-art
fallback when no artwork is loaded) gains a `.cell-inverted`
override so the black tile doesn't surface a white square.
mac_nowplaying gains `showStateIcon` to hide the giant centered
play / pause glyph entirely.

### mac_nowplaying position knobs (commits `4332229`, `32b4924`)

Substantial layout-control pass driven by user requests:

- `showColTitle` toggle on the "NOW PLAYING" heading.
- `headerAlign` (left / center / right) on that heading.
- `artPosition` (left / right) for the horizontal layout — flips
  which side the album cover sits on via flex-direction.
- `textAlign` (left / center / right) on the artist + song block.
- Split the meta-block visibility into two toggles: `showSongTitle`
  and `showArtist` so users can hide the artist line independently
  of the title.
- `textOffsetY` slider (±120 px via `transform: translateY`) so the
  user can pull the text block up against tall art (e.g. close the
  gap below cover art on extended/full tier).

CSS: `.mac-np-head-{left|center|right}`, `.mac-np-text-{...}` (also
cascades into `.mac-np-stacked-text`), `.mac-np-body-art-{left|
right}`. mac_nowplaying.form.jsx gains a Position section with the
three SelectFields + the slider.

### Widget pool — hover preview + demo data (commits `cfa14fb`, `bb2cbc9`)

Widget pool used to render every card with live previewData, which
meant a brand-new install showed SETUP NEEDED placeholders for
half the widgets. Two changes:

- **Hover-card preview (Radix UI)**: each palette card wraps its
  thumbnail in `HoverCard.Trigger`. Hovering for 250 ms opens a
  popover at the widget's "showcase" size (clock / mac_battery →
  S, weather_forecast / message / calendar / stocks → M,
  weather_hero / mac_nowplaying → L). Popover capped at 480×280
  with hard-shadow editorial styling.
- **Frozen demo data**: new `control-src/widgets/_pool_demo.js`
  ships a generic dataset per widget — 82°F partly cloudy, 7-day
  forecast, Crumb · Empty Seats with a stylised PNG placeholder
  for album art (generated via Sharp at b/w-only so it threshold-
  safe), AAPL / NVDA / BTC sparklines, a calendar week with
  "Mom's birthday" so all-day badges + sections both fire.
  Thumbnail + popover both render the same demo so the pool reads
  as "this is what each widget will look like fully configured".

### Tabbed widget settings (Radix UI) (commit `d769017`)

Modal form rewritten with Radix `Tabs.Root` driven off the existing
`<FormSection>` blocks. `TabbedForm` walks the rendered form's
React tree, splits out the FormSection elements, and rebuilds each
as a `Tabs.Content` keyed by its title. Pure-render-function
constraint on `<id>.form.jsx` makes the direct call safe. CSS
matches the editorial palette: solid-black underline on active,
muted color on inactive, dashed focus ring, 140 ms fade-in.

Removed the legacy top-of-modal Layout section (Flush edges +
Density) in commit `42bf45d` — both were duplicates / vestigial
once per-widget Layout tabs landed.

### Battery + album-art polish (commit `46cc599`)

Two e-ink threshold cleanups:

- mac_battery charging indicator was U+26A1 ⚡ which Chrome
  rendered through the colour-emoji font as a yellow glyph
  — threshold rounded it inconsistently and the dark theme
  couldn't invert it. Replaced with inline SVG `<path>` filled
  `#000`, flips to `#fff` on `.cell-inverted` via the existing
  global SVG rule.
- Pool demo Now Playing widget gains a 160×160 base64 PNG of
  nested rotated diamonds (palette: 2, b/w only) so the hover
  popover doesn't render the empty-fallback square.

### Settings modal preview — two-step architecture exploration

The user reported the modal preview's MITSKI vertical position
drifted vs the live editor canvas. The root cause: the modal's
`dangerouslySetInnerHTML` mount skipped the autofit binary-search
pass the live dashboard runs, plus cell pixel dimensions differed
between the two contexts. Two paths:

1. **Hybrid iframe + 1-bit PNG (commits `7bb1b00`, `204b3ff`,
   `5079ac1`, `41fe001`)** — new server endpoints:
   - `GET /preview/widget?widget=…&w=…&h=…&settings=<b64>` renders
     a single widget through the SSR pipeline. New `preview` mode
     in `buildPageBodyHtml` collapses the html / body / .page from
     800×480 down to the widget's pixel size so an iframe at the
     same dimensions matches 1 : 1 (no cropped corner of the full
     dashboard).
   - `POST /api/preview-render` Puppeteer screenshots the same
     URL, runs the threshold + 1-bit palette pipeline /display.bin
     uses, returns a bit-identical PNG. Concurrency capped at 2
     in-flight so slider drags don't queue 50 simultaneous
     screenshots.
   Modal stacked an iframe (instant feedback) under a debounced
   PNG (bit-fidelity once the 600 ms idle timer fires).

2. **Revert: instant client render + autofit (commit `4942c1b`)** —
   The user said the preview latency was unacceptable: iframe
   reload on every keystroke + 600 ms PNG debounce + 1-2 s
   Puppeteer queue made sliders flicker. Reverted to the original
   `dangerouslySetInnerHTML` mount but added a post-mount autofit
   pass that runs the same binary-search the dashboard's
   `<script>` block runs. Close-to-pixel-perfect, instant.

   The `/preview/widget` + `/api/preview-render` endpoints stay
   in place — cheap to keep, useful for future "Save preview"
   PNG-on-demand or external tooling.

`5079ac1` was a hooks-order fix: the new preview hooks lived
*after* the `if (!open || !draft) return null` guard so the first
open from a closed modal tripped React's "more hooks than last
render" check and unmounted the whole app — visible to the user as
a fully blank /control page. Hoisted the hooks above the guard.

### Misc

- `cellClasses(settings)` now flows through the single-widget render
  path (preview + dev) so theme: inverted reflects correctly in
  both modes (`41fe001`).
- `WidgetForm` extracts a `PresetField` primitive plus a
  `FormSection` wrapper so widget forms can group fields into
  sections — Tabs feed off the same structure.

## What shipped in the 2026-05-30 → 2026-05-31 session (commits `e96c77f` → `90204c7`)

> **Customization phases A–F complete** (commits `50bc1f7` + `90204c7`).
> See `project_eink_widget_customizability_roadmap.md` for the full
> per-widget knob catalog and open follow-ups.


## What shipped in the 2026-05-30 → 2026-05-31 session (commits `e96c77f` → `90204c7`)

Long customization session — finished the per-tile knob roadmap and
fixed a pile of 1-bit threshold + auth gotchas surfaced along the way.

### Customization roadmap — phases A through F shipped

Modal form rewritten per the TRMNL plugin editor + HA mushroom-card
pattern (research summarized in commit `90204c7`'s body).

- **Phase A (commit `50bc1f7`):** Each per-widget Form groups fields
  into named `FormSection`s — `Data / Content / Layout / Show / Style`.
  Flat 8-field columns scaled poorly; sections cap perceived complexity.
  Pure restructure, no field added or removed.
- **Phase B (in `90204c7`):** Every widget gains flat `show_X` toggles
  for sub-elements. mac_nowplaying gets showAlbumArt / showProgress /
  showSource; weather_hero gets show {Desc, Stats, Alerts, Sunbar,
  Hourly}; weather_forecast gets showDayName / showIcons; calendar
  gets showDayLabel / showTime; stocks gets showSpark / showChange.
  Defaults preserve prior rendering; toggles only ever HIDE.
- **Phase E (in `90204c7`):** New `PresetField` primitive plus per-widget
  preset lists (3–4 each) so users can "pick a look" without fiddling
  individual knobs — `editorial / minimal / wind / sun` for weather,
  `default / minimal / bold / art_off` for now-playing, etc.
  Picker resets after applying so the user can keep tweaking.
- **Phase F (in `90204c7`):** Universal `theme: 'inverted'` knob in
  TypographyFields. New `cellClasses(settings)` helper on
  `widgets/_chrome.js` returns extra classes for the .cell wrapper —
  consumed by the SSR pipeline, the editor preview, AND the modal
  preview from a single source. `.cell-inverted` flips to solid
  black tile + white ink, including SVG fills and raster-image inversion.
- Variant pass earlier in the session (commits `e96c77f`, `41f469a`,
  `5bc0af4`, `d1a0a24`) shipped concrete variant knobs:
  - mac_nowplaying side-space: `time_bookends` (default) /
    `centered` / `vertical_text` / `play_state` / `bars` / `metadata`
  - weather_hero `stats[4]` slot picker — feels / humid / wind / gust /
    cloud / rise / set / cloud_or_rise
  - weather_forecast `precipMode` (auto/always/never) +
    `hiloStyle` (stack/inline/arrows)
  - calendar `density` override
  - stocks `layout` (hero_watch / list_only / hero_only)

### Mac-agent freshness badge (in `d1a0a24`)

New `MacAgentBadge.jsx` in the /control header reads `GET /api/mac-state`
every 15 s and shows "MAC AGENT: 7s ago" coloured green / orange / gray /
red for fresh / stale / never / endpoint-down. Tooltip points the user
at `/tmp/eink-mac-agent.log` so a dead launchd job is obvious without
SSHing in.

### Mac-state hardening (commit `87a62ad`)

Post-mortem audit found three issues with the original Mac-on-cloud
write path:
- `_lastTrackKey` race when two pushes raced — fixed with a
  single-slot Promise chain (`_macStateChain`).
- Orphan `data/mac-state.json.tmp` from a writer crash — `loadSync`
  now unlinks it on startup.
- `invalidateImage()` fired on every push even when nothing changed,
  trashing the 60 s image cache. New `sameMacState()` compares the
  new payload (5-second elapsed bucket) to the previous and skips
  the invalidation when render output wouldn't differ.

### Firmware 1.11.x — cloud-only + actionable fail screen + battery curve

- **1.11.0 (commit `1434c27`):** `selectServerBase()` is cloud-only;
  the LAN base + probe were removed now that the Mac-side agent
  pushes state through the cloud. ESP32 stays on the Railway base
  permanently — no more LAN ↔ cloud dance.
- **1.11.1 (commit `8ab5e55`):** Fail screen surfaces the underlying
  HTTP code (`Could not fetch image (HTTP 401)`), a per-code one-liner
  tip (`Tip: DEVICE_TOKEN mismatch (server vs firmware)` for 401,
  similar for 404/-1/-11/5xx), WiFi RSSI, local IP, friendly_id, and
  "LAST OK: 2h ago" backed by an RTC_DATA_ATTR timestamp that survives
  deep sleep.
- **1.11.2 (commit `7955614`):** Battery percent now uses a nonlinear
  LiPo curve (4.10 V → 100 %, 3.30 V → 0 %) so a fully-charged cell
  actually reads 100 %. The old linear formula maxed out at 88–97 %
  because the 1 MΩ+1 MΩ divider + ESP32 ADC nonlinearity cap real
  readings around 4.10 V.

### Server-side auth softening (commit `6a3aab0`)

`checkDeviceAuth` used to reject any request that carried an unknown
`X-API-Key` outright. That bricked devices that had enrolled against
the local server and then were repointed at the cloud — the api_key
in their NVS wasn't known to the cloud's `devices.json`. Now: unknown
X-API-Key falls through to the fleet `?token=` check, so the legacy
credential still rescues the device.

### Build pipeline noise (commits `b564d4c`, `5540d61`, `e881d43`)

Railway log aggregator flags npm stderr at severity=error, so an
otherwise harmless `npm warn config production` looked like a build
failure. Fixed by:
- `npm install --include=dev` so devDependencies (vite + plugin-react)
  are present for the build phase.
- Wrapping npm in `env -u NPM_CONFIG_PRODUCTION` so the deprecated
  legacy config var isn't visible to npm.
- New `Procfile` (`web: node server.js`) bypasses `npm start`
  entirely on launchers that prefer Procfile over nixpacks `[start]`.

### Misc polish

- `1007f83`: Settings modal locks `html`/`body` overflow on open so
  wheel/touch gestures don't scroll the editor underneath the panel.
- `e65a906`: mac_nowplaying state glyph swapped from Unicode ❚❚ to
  inline SVG — Sharp's threshold pass was clipping the thin bars.
  Also bumped `.mac-np-source` from 10 px / #555 / wide-letter-spacing
  to 13 px / weight 700 / pure black; the old style dithered into
  noise on the panel.
- `96a570f`: `typographyCss` emits `zoom: <scale>` for fontScale so
  every widget visibly scales (not just message + mac_nowplaying that
  multiplied the value themselves). WidgetSettingsModal cellHtml now
  passes the typoStyle into the live preview so font/scale/padding
  changes are visible while editing.

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
