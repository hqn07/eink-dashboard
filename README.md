# E-Ink Dashboard

Server-rendered dashboard for a Waveshare 7.5" e-ink display + ESP32 driver board.

The server renders your dashboard as HTML, screenshots it to a 800×480 1-bit image, and serves it to the ESP32. You control widgets, todos, messages, etc. from a webpage.

## Quick deploy

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.com/new/github/hqn07/eink-dashboard)

Click → Railway creates a service from this repo. **No API keys to set** — weather is from Open-Meteo (free, keyless). The deploy takes ~2 min, then visit `/control` on the generated domain.

Want to run locally first instead? See [Part 1](#part-1--run-it-locally-first) below.

## Architecture

```
[Phone/laptop] --edits--> [Control Panel /control]
                              |
                              v
                          [config.json]
                              |
                              v
                   [Dashboard HTML /dashboard]
                              |
                       (Puppeteer screenshot)
                              |
                              v
              [/display.bin  +  /display.png]
                              ^
                              |
              [ESP32 wakes every N min, downloads, displays, sleeps]
```

---

## Part 1 — Run it locally first

Make sure Node.js 20+ is installed: `node -v`

```bash
# In this folder:
npm install
cp .env.example .env
# Edit .env — put your NEW OpenWeatherMap key in it
npm start
```

Then visit:

- **http://localhost:3000/control** — control panel
- **http://localhost:3000/dashboard** — live HTML preview (what gets screenshot)
- **http://localhost:3000/display.png** — the rendered image the ESP32 will get

If `display.png` looks right, you're 90% done.

### Troubleshooting local

- **Puppeteer fails to launch** → run `npx puppeteer browsers install chrome`
- **Sharp errors** → delete `node_modules`, run `npm install` again
- **Fonts look wrong** → check internet connection (Google Fonts loads at render time). For full offline use, self-host the fonts later.

---

## Part 2 — Deploy to Railway (free, public URL)

1. Push this repo to GitHub:
   ```bash
   git init
   git add .
   git commit -m "initial"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/eink-dashboard.git
   git push -u origin main
   ```

2. Go to **railway.app** → New Project → Deploy from GitHub repo → pick this repo.

3. After the first build, click **Variables** and add:
   - `OPENWEATHER_API_KEY` = your new key
   - `CITY` = `Gainesville,FL,US`
   - `DEVICE_TOKEN` = (optional, see below)

4. Railway needs Chrome for Puppeteer. Add a `nixpacks.toml` file (already in this repo) and it'll work. If you see Chrome errors, also set:
   - `PUPPETEER_CACHE_DIR` = `/app/.cache/puppeteer`

5. Click **Settings → Networking → Generate Domain**. You'll get a URL like `your-app.up.railway.app`.

6. Visit `https://your-app.up.railway.app/control` — your control panel is now public.

### About `DEVICE_TOKEN`

If you don't set this, anyone with your URL can hit `/display.png` and `/display.bin`. Not a big deal (it's just a dashboard image), but if you want to lock the ESP32 endpoints, set a random string in Railway's env vars and the same string in your `.ino` file (`const char* deviceToken`).

The control panel itself is currently unauthenticated. For v1 that's fine since the URL is hard to guess. For v2 we can add basic auth.

---

## Part 3 — Flash the new ESP32 firmware

Open `esp32/weather_station.ino` in Arduino IDE.

Change two lines:

```cpp
const char* ssid     = "YOUR_WIFI";
const char* password = "YOUR_PASS";
const char* serverBase = "https://your-app.up.railway.app";  // <— your Railway URL
```

Upload to your ESP32 driver board (same as before — ESP32 Dev Module).

Open Serial Monitor at 115200. You should see:

```
=== E-Ink Dashboard Client ===
WiFi...
Connected: 192.168.1.x
GET https://your-app.up.railway.app/display.bin
Got 48000 bytes
Sleep 30 min
```

And the display shows your dashboard. 🎉

### Local-only testing

While developing, you can point the ESP32 at your laptop instead of Railway:

```cpp
const char* serverBase = "http://192.168.1.42:3000";  // your computer's IP
```

Find your IP with `ipconfig` (Windows) or `ifconfig | grep inet` (Mac/Linux).

---

## Part 4 — Daily use

1. Open `https://your-app.up.railway.app/control` on your phone.
2. Toggle widgets, edit the message, check off todos.
3. Hit **SAVE & PUSH**.
4. The display updates on its next wake cycle (within ~30 min by default).

Want it to update immediately? Press the EN button on the ESP32 board.

---

## File map

```
server.js                  Main server. Express + Puppeteer + Sharp.
package.json               Node deps.
public/
  dashboard.html           The 800x480 page Puppeteer screenshots.
  dashboard.css            Editorial e-ink styling.
  control.html             Mobile control panel.
widgets/
  weather.js               OpenWeatherMap fetcher.
  calendar.js              iCal feed parser.
data/
  config.default.json      Defaults.
  config.json              Live config (auto-generated).
esp32/
  weather_station.ino      New firmware.
```

## Customizing the look

Edit `public/dashboard.css`. Open `http://localhost:3000/dashboard` in your browser to preview instantly — no ESP32 reflash needed.

Tips for e-ink:
- Use pure black and white. Greys get thresholded.
- Avoid thin strokes < 2px. They get crushed.
- Stick to bold, condensed fonts. Thin weights disappear.
- The display is 800×480. The CSS already locks `<body>` to those dimensions.

## Adding widgets

1. Create `widgets/mything.js` exporting `async function fetchMyThing()`.
2. Import it in `server.js` and add to the `/dashboard` route payload.
3. Add a section to `dashboard.html` that reads from `window.__DASHBOARD__`.
4. Add a toggle in `control.html`.
