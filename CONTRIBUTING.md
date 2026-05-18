# Contributing

Patches, issues, and discussions are welcome.

## Scope

This repo is the **free, open-source** version of the e-ink dashboard. Paid features (multi-tenant SaaS, fleet management) will live in a separate repo when they ship — please don't open PRs adding them here.

In scope:
- New widgets (weather sources, transit, fitness, sports, etc.)
- Layout / tier polish
- Performance, reliability, accessibility
- Firmware improvements (ESP32 power, wake handling, telemetry)
- Bug fixes
- Documentation

Out of scope (here):
- Multi-tenant authentication / user accounts
- Hosted-SaaS billing or quota plumbing
- Anything that requires server state per-user
- Closed-source dependencies

## Local dev

```bash
git clone <repo>
cd eink-dashboard
npm install
npm start         # backend on :3000
npm run control-dev   # React control panel hot-reload on :5173 (Vite)
```

Visit `http://localhost:3000/control` for the production-built UI, or `http://localhost:5173` for hot-reload editing.

## Layout

- `server.js` — Express + Puppeteer + Sharp. Renders `/dashboard` to PNG/BIN.
- `widgets/*.js` — server-side data fetchers (weather, calendar, news, etc.)
- `public/dashboard.html` — the 800×480 page Puppeteer screenshots. Inlines a widget renderer.
- `public/dashboard.css` — editorial e-ink styling (pure black + white).
- `control-src/` — React control panel. Built into `public/control-app/` by Vite.
- `control-src/widget-render.js` — **mirror** of dashboard.html's render logic, used for the live editor previews. **Keep these two render paths in sync** when adding widgets.
- `esp32/weather_station.ino` — firmware. Mostly stable; only touch if you're working on hardware.

## Widget anatomy

A widget lives in **three places**:

1. **Registry** in `control-src/widgets.js` — declare `id`, `label`, `sizes`, `minSize`, `defaultSize`.
2. **Server-side fetcher** (optional) in `widgets/<id>.js` — exports an async function that fetches/computes data; called from `buildWidgetData()` in `server.js`.
3. **Renderer** in BOTH `public/dashboard.html` (inside `WIDGET_REGISTRY`) and `control-src/widget-render.js` (in `RENDERERS`). Same output, same DOM, same classes.

Renderers receive `(ctx, cellW, cellH)`. Use `pickTier(cellW, cellH)` to branch on size. Add a `minSize` to the registry so the editor can't shrink your widget below a known-good floor.

## E-ink rules

The display is **1-bit** (pure black + white, no grey). Things that fail on real hardware but look fine in the browser preview:

- **CSS opacity / rgba / mix-blend-mode** — dithers into noisy stipple. Use `#000` or `#fff` only.
- **Sub-11px fonts** — single-pixel strokes vanish on the panel.
- **Thin 1px borders** — sometimes drop. Use 1.5px minimum.
- **Tiny progress bars** — read as battery indicators / unrelated UI. Threshold visibility.

When in doubt, photograph the physical panel before claiming a render is "fine".

## Style

- No package manager opinions — plain `npm`.
- Default to **no comments** unless the WHY is non-obvious.
- Match the existing tier-matrix pattern when adding size-aware behavior to a widget.
- One feature per PR; keep diffs small.

## Reporting bugs

Please include:

- What you did (URL, widget, action)
- What you expected
- What happened
- A photo of the physical e-ink panel if the bug is render-related
- Your Railway / local environment

## License

By contributing you agree your contribution is licensed under the MIT License (see `LICENSE`).
