# E-Ink Dashboard

A server-rendered, newspaper-style dashboard for the Waveshare 7.5" e-paper display + ESP32.

The server renders your dashboard as HTML, screenshots it to an 800×480 1-bit image, and serves it to the ESP32. You arrange widgets, edit content, and schedule screens from a phone-friendly control panel.

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.com/new/github/hqn07/eink-dashboard)

No API keys required — weather comes from Open-Meteo (free, keyless).

---

## What you get

- **16 widgets**: weather (current + forecast), clock, calendar (multi-iCal), to-dos, message, quote (static / rotating list / daily-API), countdown, photo slideshow, WiFi QR, news (RSS), stocks / crypto (with sparklines), air quality, moon + sun, GitHub contribution heatmap, custom message, divider.
- **Unlimited screens** with per-screen layout, schedule, and chrome (header / footer).
- **Live editor** — drag-resize widgets directly on the preview, no mode toggle.
- **Tier-aware layouts** — every widget has a deliberate compact / standard / extended / full layout. Resize freely; the widget always picks a layout that fits.
- **Screen presets** — Editorial, Wake Up, Bedside, Photo Wall, Office, Quote Card, Status Board…
- **Per-tile customization** — border style, visibility schedule, flush-edge mode.
- **Self-hosted fonts** — no Google Fonts dependency at runtime.
- **All-1-bit** — pure black/white render path tuned for the actual physical panel, not just the browser preview.

---

## Architecture

```
[Phone/laptop] --edits--> [Control panel /control]
                              |
                              v
                          [config.json]
                              |
                              v
                   [Dashboard HTML /dashboard]
                              |
                       (Puppeteer screenshot + Sharp threshold)
                              |
                              v
              [/display.png  +  /display.bin]
                              ^
                              |
              [ESP32 wakes every N min → downloads .bin → renders → sleeps]
```

The ESP32 firmware is intentionally "dumb": it knows how to download a 48000-byte 1-bit image and push it to the display. All layout, fonts, and data fetching happens server-side.

---

## Quick start

### Local

```bash
git clone https://github.com/hqn07/eink-dashboard
cd eink-dashboard
npm install
npm start
```

Visit:
- **http://localhost:3000/control** — control panel
- **http://localhost:3000/dashboard** — live HTML preview (what gets screenshot)
- **http://localhost:3000/display.png** — the rendered 1-bit image the ESP32 will get
- **http://localhost:3000/widgets-matrix** — visual QA page showing every widget at every preset size

If `display.png` looks right, you're 90% done.

### Railway

1. Click the **Deploy on Railway** button above (or push to your own GitHub and connect manually).
2. Wait ~2 min for the build.
3. Click **Settings → Networking → Generate Domain**.
4. Visit `https://<your-app>.up.railway.app/control`.

Optional environment variables:
- `DEVICE_TOKEN` — secret string. If set, the ESP32 must include `?token=<value>` (or `X-Device-Token` header) to hit `/display.bin`. Lock down the device endpoints.
- `PORT` — auto-provided by Railway. Leave alone.

---

## Flash the firmware

1. Open `esp32/weather_station.ino` in Arduino IDE.
2. Update three lines:
   ```cpp
   const char* ssid       = "YOUR_WIFI";
   const char* password   = "YOUR_PASS";
   const char* serverBase = "https://<your-app>.up.railway.app";
   ```
3. Upload to the ESP32 driver board (ESP32 Dev Module, 115200 baud).
4. Open Serial Monitor. Look for `Got 48000 bytes` + `Sleep N min`.

The display refreshes on its next wake cycle. To force an immediate refresh, press the EN button on the driver board (or wire a manual refresh button — see `BOM.md`).

---

## File map

```
server.js                Express + Puppeteer + Sharp. Renders /dashboard → PNG/BIN.
package.json             Node deps.
nixpacks.toml            Railway build config (installs Chromium).

public/
  dashboard.html         The 800×480 page Puppeteer screenshots. Inlines WIDGET_REGISTRY.
  dashboard.css          Editorial e-ink styling (pure black + white).
  fonts/                 Self-hosted WOFF2s.
  control-app/           Built React control panel (output of `npm run build`).

control-src/             React control panel source. Edit + `npm run build` to ship.
  App.jsx                Main editor app.
  widgets.js             Widget registry + pickTier() + screen presets.
  widget-render.js       Mirror of dashboard.html renderers, for live editor previews.
  components/            UI pieces.

widgets/                 Server-side fetchers (one file per data widget).
  weather.js calendar.js news.js stocks.js github.js aqi.js
  countdown.js moonsun.js photo.js quote.js message.js clock.js wifi.js todos.js
  alerts.js              NWS severe weather alerts (US).

data/
  config.default.json    Shipped defaults.
  config.json            Live config (auto-generated; gitignored).

esp32/
  weather_station.ino    Firmware: wake → WiFi → /display.bin → render → sleep.
```

---

## Customizing the look

Edit `public/dashboard.css`. Open `http://localhost:3000/dashboard` in your browser to preview instantly — no reflash needed.

**E-ink rules** (things that look fine in a browser but break on real hardware):
- The display is 1-bit. Use **pure `#000` and `#fff`** only — any `opacity`, `rgba`, or grey dithers into noisy stipple.
- **Minimum 11px** fonts. Sub-11 strokes vanish on the panel.
- **Minimum 1.5px** borders. Thin 1px borders sometimes drop.
- Stick to bold, condensed fonts. Thin weights disappear.
- `<body>` is locked to 800×480.

When in doubt, photograph the physical panel before declaring a render "fine".

---

## Adding a widget

A widget lives in three places:

1. **Registry** in `control-src/widgets.js` — declare `id`, `label`, `sizes`, `minSize`, `defaultSize`.
2. **Server-side fetcher** (optional) in `widgets/<id>.js` — exports an async function called from `buildWidgetData()` in `server.js`.
3. **Renderer** in BOTH `public/dashboard.html` (`WIDGET_REGISTRY`) and `control-src/widget-render.js` (`RENDERERS`). Keep them in sync.

Use `pickTier(cellW, cellH)` in the renderer and branch on `tiny / compact / standard / extended / full`. Set `minSize` so the editor can't shrink your widget below a known-good floor.

See [CONTRIBUTING.md](CONTRIBUTING.md) for more.

---

## Hardware

See [BOM.md](BOM.md) for the parts list, GPIO pinout, and assembly notes. Estimated build cost: **$55–80 USD**.

---

## License

MIT. See [LICENSE](LICENSE).

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for scope, dev setup, widget anatomy, and the e-ink rules of thumb.
