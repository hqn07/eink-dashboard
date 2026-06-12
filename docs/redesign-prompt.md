# Redesign brief — e-ink dashboard (full visual + UX refresh)

Redesign this project's entire web surface. You have full creative authority on visuals and UX structure within the constraints below. Read `CLAUDE.md` first — it has the architecture map and the user's communication style (short, direct, no diagrams).

## What's being redesigned (all three)

1. **Control app** (`control-src/`, React + Vite, served at `/control`) — tabs, sidebar, editor canvas, widget settings modal, preview pane, setup wizard, alarms/schedule/location panels, mobile drawer.
2. **E-ink dashboard face** (`control-src/widgets/*.js` render fns + `public/dashboard.css`) — the 800×480 1-bit screen the physical device displays. This is the product's face.
3. **Aux pages** — `/health/widgets` status page (inline HTML in `server.js`) and the firmware captive-portal page (`PORTAL_HTML` in `esp32/weather_station/weather_station.ino`; coordinate only, don't flash).

## Why (the user's words, in priority order)

The current design feels **cluttered/busy**, **amateur/cheap**, **hard to navigate**, and **inconsistent between screens**. Every stage should be judged against these four complaints.

## Direction

**Evolve the existing editorial-newspaper identity — don't replace it.** DM Serif Display + Oswald + JetBrains Mono, black/white, print-inspired. Execute it sharper: stronger hierarchy, more whitespace discipline, fewer competing borders/chrome.

Reference points the user picked:
- **Notion** — calm, friendly, soft chrome, nothing shouting
- **TRMNL / e-ink hardware brands** — the software should feel like it belongs to the physical device

UX structure is fully on the table: navigation, tab/sidebar organization, settings flows, wizard — rethink anything that serves the four complaints.

## Hard constraints

- React + Vite stack stays. No framework swap.
- **Mobile ≤760px is a primary surface**, not an afterthought. The drawer/FAB experience gets first-class design attention.
- E-ink face physics: 800×480 fixed; pure 1-bit black/white — **no grays, no opacity, no subpixel tricks** (they dither into noise on the panel); minimum readable ≈ 11px JetBrains Mono / 14px Oswald; single-pixel strokes vanish.
- Never touch: the 48000-byte `/display.bin` format, device HTTP endpoints, ESP32 pins.
- Parity architecture is load-bearing: editor canvas, preview pane, and server SSR all render tiles through `buildTileCtx` / `tileCellClasses` / `renderWidget` in `control-src/widgets/_chrome.js` + `_ssr.js`. Restyle freely via `dashboard.css` and the widget render fns — but all three surfaces must keep consuming the shared path.
- `App.jsx` passes raw `status` to `<SaveBar>`, never `status.cls` (regression trap).
- Fonts are self-hosted in `public/fonts/` — no CDN fonts.

## Process — staged, commit per stage

Work screen by screen, not one big pass:

1. **Stage 0 — audit + design tokens.** Screenshot every current surface (Puppeteer; desktop + 390px mobile). Define the refreshed system: type scale, spacing scale, border/divider rules, component inventory. Apply tokens as CSS variables. Commit.
2. **Stage 1 — control app shell.** Navigation/IA, header, tabs/sidebar reorganization, mobile drawer. Commit.
3. **Stage 2 — editor canvas + tile interactions.** Commit.
4. **Stage 3 — forms & modals** (widget settings modal, panels, wizard, SaveBar). Commit.
5. **Stage 4 — e-ink dashboard face** (widget renderers + dashboard.css). Commit.
6. **Stage 5 — aux pages.** Commit.

Per stage: before/after screenshots saved to `/tmp/redesign/`, `npx vite build` clean, then verify `GET /display.png` returns 200 at 800×480 (read `DEVICE_TOKEN` from `.env`, append `?token=`). `/widgets-matrix` renders every widget at every size — use it for Stage 4. For Stage 4 also pause and ask the user for a **photo of the physical panel** before moving on; the PNG hides what e-ink reveals.

Git: commit each stage with a descriptive message. **Never `git push` — the user pushes explicitly.**

Dev: `npm start` (server :3000), `npx vite` (HMR :5173, proxies API). A launchd mac-agent and a real device hit the production server, not local — local experiments are safe.

## Definition of done

Each of the four complaints has a visible answer. One coherent product across every screen, desktop and mobile. The dashboard face still reads crisply on real hardware. No regression in: save flow, editor drag/resize, preview parity, display.bin output.
