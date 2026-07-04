# server.js split — plan

> **STATUS: DONE (2026-07-04).** All phases shipped. server.js went
> 2935 → 220 lines (a composition root). Logic now lives in 17 `lib/`
> modules + 11 `routes/` routers. Every phase was committed separately
> with `npm run check` + `test:api` green; render output verified
> byte-identical. See git log `refactor(server): …` for the per-phase
> commits. The section below is the original plan, kept for reference.

---


`server.js` is ~2989 lines / 44 routes / one file. Goal: shrink it to a thin
composition root (`require` modules, wire middleware, mount routers, listen)
and move logic into `lib/` + `routes/`. `lib/` already holds 5 extracted
modules (`errlog`, `firmware`, `image`, `statusfmt`, `timewin`) — same pattern,
same test harness. No behaviour change; every phase keeps
`npm run check` + `npm run test:api` green.

## Why this order

Extract **leaf helpers first** (pure, no shared mutable state), then
**stateful subsystems** behind a small surface, then **group routes** last
(highest coupling). Each phase is one commit that leaves the tree working, so
any regression is bisectable and cheap to revert.

## The hard part: module-level mutable state

Several functions close over module-scoped `let` state. These are the real
coupling and dictate the seams:

| State var | Owned by → new module |
|---|---|
| `_configCache`, `_configWriteChain` | `lib/config-store.js` |
| `_batteryState`, battery history | `lib/battery-store.js` |
| devices array | `lib/devices-store.js` |
| `_browser`, page semaphore, image cache Map | `lib/render.js` |
| push-now window var | `lib/refresh.js` |
| geocode LRU cache | `lib/geo.js` |
| dev SSE client Set | `lib/dev.js` |

Rule: **each module owns its own state and exports functions** — no shared
globals passed around.

**Circular-dependency trap:** a config write must invalidate the image cache
(`saveConfig → invalidateImage`). If `config-store` imported `render`, and
`render` imported `config-store` (it reads config), that's a cycle. Break it by
**keeping the invalidation call in the route/caller**, not inside `saveConfig`.
i.e. the `POST /api/config` handler does `await saveConfig(...)` then
`render.invalidateImage()`. Verify no current `saveConfig` body already calls
`invalidateImage` before moving it (grep says it only nulls `_configCache`).

## Phases (each = 1 commit, tests green)

### Phase 0 — safety net (do first)
- Confirm `npm run test:api` + `npm run check` pass on `main` (baseline).
- Add a couple of endpoint tests if a route being moved has none
  (`/display.png` 200 + 48000-byte `/display.bin` shape, `/api/config`
  round-trip). Cheap insurance for the risky phases.

### Phase 1 — pure leaf helpers (zero shared state, lowest risk)
Extract, one small commit each:
- `lib/layout.js` — `sizeFor`, `expandLayout`, `withinVisibility`,
  `resolveScreenLayout`, the `migrate*` funcs, `seedLayoutFromEditorial`.
- `lib/refresh.js` — `resolveRefreshMinutes`, `batteryRefreshFloor`,
  `quietMinutesRemaining`, `effectiveRefresh`, `pushNow`/window var.
- `lib/htmlutil.js` — `htmlAttr`, `escapeHtmlServer`, `strongEtag`,
  `decodeSettingsParam`.
- `lib/geo.js` — `jsonFetch`, `trimGeoCache` + the cache, geocode/reverse
  helpers.

### Phase 2 — persistence stores
- `lib/config-store.js` — `loadConfig`, `saveConfig`, `withConfigLock`,
  `atomicWriteFile`, paths. (Keep `invalidateImage` OUT of here.)
- `lib/battery-store.js` — battery state + rolling history.
- `lib/devices-store.js` — registry + `genApiKey`/`genFriendlyId`/`findDeviceByKey`.

### Phase 3 — auth
- `lib/auth.js` — device auth, PIN hashing/verify, sessions, cookies,
  `gateControlHtml`, `checkAdminAuth`. Depends on `config-store`. Highest-care
  phase: run the full `test:api` suite (all 17 are auth/first-run focused) after.

### Phase 4 — render + SSR
- `lib/ssr.js` — `buildPageBodyHtml`, `renderPage`, `loadSsr`, `loadDashboardHtml`.
- `lib/render.js` — puppeteer browser lifecycle, page semaphore,
  `renderDashboardPng`, image cache, `getCurrentImage`, `invalidateImage`,
  `warmActiveImage`. Depends on `ssr` + `config-store`.
- `lib/widget-data.js` — `buildWidgetData` fan-out + `mergeEvents`.
- `lib/preview.js` — `buildPreviewPayload`, `renderPreviewPng`.
- `lib/dev.js` — `startDevWatchers`, `broadcastDevReload`, SSE clients.

### Phase 5 — routers (highest coupling, do last, optional)
Split routes into `express.Router()` modules, mounted in server.js:
- `routes/display.js` — `/display*.png|.bin`, `/sleep`, `/api/wake`.
- `routes/config.js` — `/api/config*`, `/api/preview-data`.
- `routes/auth.js` — `/api/auth/*`, `/control/login|setup`, `/api/setup`.
- `routes/preview.js` — `/dev/*`, `/preview/widget`, `/api/preview-render`,
  `/widgets-matrix`.
- `routes/mac.js`, `routes/alarms.js`, `routes/firmware.js`,
  `routes/devices.js`, `routes/status.js`, `routes/pages.js`.

Routers take deps via a factory (`module.exports = (deps) => { const r =
Router(); ... }`) so state modules stay singletons and wiring is explicit.

## Guardrails
- One phase per commit; `npm run check && npm run test:api` before each push.
- No signature changes to anything the widgets or firmware call.
- Don't touch the 48000-byte format, image flags, or the `/display.bin` path
  (firmware contract).
- If a phase balloons past a clean extract, stop and split it — the point is
  small reversible steps, not a big-bang rewrite.

## Target end state
- `server.js`: requires + middleware + router mounts + `listen()` — aim < 300 lines.
- `lib/`: ~15 focused modules, each with its own state.
- `routes/`: ~10 router modules.
- Zero behaviour change; test + check suites unchanged and green.
