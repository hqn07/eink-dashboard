// server.js
// Express server that:
//  - Serves a 800x480 dashboard HTML page at /dashboard
//  - Screenshots it via Puppeteer and serves at /display.png (and /display.bin for ESP32)
//  - Serves a control panel at /control
//  - Persists config to data/config.json

require('dotenv').config();
const express = require('express');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const puppeteer = require('puppeteer');
const sharp = require('sharp');

const { fetchWeather, geocodeCity } = require('./widgets/weather');
const { fetchAqi } = require('./widgets/aqi');
const { fetchCodeActivity } = require('./widgets/codeactivity');
const { fetchOnThisDay } = require('./widgets/onthisday');
const { fetchEvents } = require('./widgets/calendar');
const { fetchAlerts } = require('./widgets/alerts');
const widgetStatus = require('./widgets/_status');
const { resolveMessage, renderInlineMarkdown } = require('./widgets/message');
const { fetchMacNowPlaying } = require('./widgets/macnowplaying');
const { fetchMacBattery } = require('./widgets/macbattery');
const { buildClock } = require('./widgets/clock');
const { computeNextAlarm, normalizeAlarmList } = require('./widgets/alarms');
const { fetchPhoto } = require('./widgets/photo');
const { fetchHeadlines } = require('./widgets/headlines');
const { fetchTasks } = require('./widgets/tasks');
const { fetchTransit } = require('./widgets/transit');
const {
  preThreshold, rgbaToMono, packMonoBin,
  isRedPixel, rgbaToPlanes, planesToPng
} = require('./lib/image');
const { FW_DIR, FW_NAME_RE, parseSemver, cmpSemver, findNewestFirmware } = require('./lib/firmware');
const { parseHHMM, hmFormatter, localMinutesNow, scheduleIntervals } = require('./lib/timewin');
const { relAge, dur, batteryTrend, sparkline } = require('./lib/statusfmt');
const { htmlAttr, escapeHtmlServer, strongEtag, decodeSettingsParam } = require('./lib/htmlutil');
const { sizeFor, expandLayout, withinVisibility } = require('./lib/layout');
const { jsonFetch } = require('./lib/geo');

// SSR module — per-widget render functions + chrome helpers, no React.
// Dynamically imported (ESM) at first use and cached. Lets /dashboard
// produce the full page HTML server-side instead of shipping a
// duplicate widget render block to the browser.
const { loadSsr, loadDashboardHtml } = require('./lib/ssr-shell');

// Error ring buffer moved to ./lib/errlog.js — requiring it installs the
// console.error wrapper (side effect) and hands back the shared ring the
// /status page reads.
const { errLog: _errLog } = require('./lib/errlog');

const PORT = process.env.PORT || 3000;
const { DEVICE_TOKEN, IS_PROD } = require('./lib/env');
// On-disk state paths + atomic write live in lib/store.js (single source of
// truth for DATA_DIR). The reset route still needs a couple of them.
const { CONFIG_PATH, DEFAULT_CONFIG_PATH, atomicWriteFile } = require('./lib/store');

// Loud warning when no DEVICE_TOKEN is set in production: the control
// panel + config API end up wide-open. Local dev intentionally allows
// missing token so first-run friction stays low.
if (!DEVICE_TOKEN) {
  const msg = '[security] DEVICE_TOKEN env var is not set — /api/* config endpoints are PUBLIC.';
  if (IS_PROD) {
    console.error(`\n${msg}\n[security] Set DEVICE_TOKEN before exposing this server to the internet.\n`);
  } else {
    console.warn('[security] DEVICE_TOKEN unset (local dev) — set it in .env for any non-localhost deploy.');
  }
}

const SCREEN_W = 800;
const SCREEN_H = 480;

// ---------- Config persistence ----------

// Persistence stores (each owns its own cache/lock state; see lib/*-store.js).
// config-store's loadConfig runs the migrator wired below, once it's defined.
const {
  loadConfig, saveConfig, withConfigLock, invalidateConfigCache,
  setMigrator: _setConfigMigrator,
} = require('./lib/config-store');
const {
  loadBatteryState, saveBatteryState, currentBatteryState,
  loadBatteryHistory, appendBatteryHistory,
} = require('./lib/battery-store');
const {
  loadDevicesSync, saveDevices, findDeviceByKey, genApiKey, genFriendlyId,
} = require('./lib/devices-store');
const { buildWidgetData } = require('./lib/widget-data');
const { renderPage } = require('./lib/ssr');
const {
  resolveScreenLayout, migrateConfigToScreens, pickActiveScreen,
  resolveVariant, resolveRefreshMinutes,
} = require('./lib/screens');
const {
  getBrowser, tryAcquirePage, releasePage,
  getCurrentImage, invalidateImage, warmActiveImage, imageCache,
  PRERENDER_ENABLED, PRERENDER_INTERVAL_MS,
} = require('./lib/render');
const {
  pushNow, effectiveRefresh, getFastWakeUntil,
  FAST_WINDOW_MS, FAST_INTERVAL_SECONDS,
} = require('./lib/refresh');
// Wire the config-store to migrate loaded configs to the current screen
// schema. Injected (not imported by config-store) to avoid a require cycle.
_setConfigMigrator(migrateConfigToScreens);

// loadDashboardHtml + loadSsr (the SSR shell + compiled widget bundle) live in
// ./lib/ssr-shell.js — imported at the top.

// parseHHMM/hmFormatter/localMinutesNow/scheduleIntervals moved to
// ./lib/timewin.js (required at the top).

// ---------- Auth ----------

// Auth (device token + api-key, control-panel PIN, sessions, gates) lives in
// lib/auth.js. It reads config via config-store and devices via devices-store.
const {
  checkDeviceAuth, gateControlHtml, checkAdminAuth,
  authBlock, pinConfigured, verifyPin, setPinInConfig,
  makeSession, sessionValid, setSessionCookie, clearSessionCookie,
} = require('./lib/auth');

const { safeError } = require('./lib/http');

// ---------- App ----------

const app = express();
// Railway / Render / Fly all front the app with a proxy that injects
// X-Forwarded-For. Without this, express-rate-limit refuses to use the
// header and crashes the process when it sees it.
app.set('trust proxy', 1);
// Baseline security headers. Deliberately no CSP: the control app relies on
// inline styles / React-injected style tags, and the SSR face uses inline
// accent styles, so a strict policy would break rendering with no real gain
// on a PIN-gated single-tenant tool. These four are safe and free.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  next();
});
// gzip text responses (the ~380KB control bundle, SSR HTML, JSON APIs).
// Skip the raw device image endpoints: the ESP32's HTTP client fetches the
// exact 48000-byte body and does not negotiate/decode gzip.
app.use(compression({
  filter(req, res) {
    if (req.path === '/display.bin' || req.path.endsWith('.bin')) return false;
    return compression.filter(req, res);
  }
}));
app.use(express.json({ limit: '10mb' })); // photo widget can carry a base64 image
// Cache policy for /static: fonts + icons have stable names and rarely
// change, so let the browser hold them for a week (dashboard.css is busted
// via ?v= query, fonts via filename churn on the rare occasion they change).
// HTML must never be held — it references versioned assets and is edited live.
app.use('/static', express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (/\.(woff2?|ttf|otf|png|svg|ico)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 days
    } else if (/\.html$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// Rate limit only the proxy + write endpoints. The display.png/.bin
// fetch is intentionally uncapped so the ESP32 isn't blocked. Anything
// in /api/* gets 60 req / min / IP — well above legitimate use, low
// enough to make abuse expensive.
const rateLimit = require('express-rate-limit');
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  // Raised from 60: the editor is chatty — it refetches /api/preview-data on
  // every edit, so a normal editing burst blew past 60/min and rate-limited
  // the user's own config save. 300/min still bounds real abuse.
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate_limited' },
  // The live-preview read is admin-gated + fires on every keystroke/drag;
  // don't let it eat the budget that saves need.
  skip: (req) => req.path === '/preview-data'
});
app.use('/api/', apiLimiter);

// React control panel build output (built by Vite via `npm run build`).
const CONTROL_APP_DIR = path.join(__dirname, 'public', 'control-app');
const CONTROL_APP_INDEX = path.join(CONTROL_APP_DIR, 'index.html');
// Vite emits content-hashed filenames under /assets, so those are safe to
// cache forever (immutable). index.html references them and must stay fresh
// on every deploy, so it is explicitly never cached.
app.use('/control-app', gateControlHtml, express.static(CONTROL_APP_DIR, {
  setHeaders(res, filePath) {
    if (/[\\/]assets[\\/].+\.(js|css|woff2?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (/\.html$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// ============ SSR PIPELINE ============
//
// Renders the full dashboard HTML server-side from the widget render
// functions under control-src/widgets/<id>.js. The dashboard.html shell
// is now just chrome (CSS link + autofit script); the body grid is
// inlined as a static string the browser doesn't have to recompute.
// Puppeteer still loads /dashboard via headless Chrome to snap the PNG,
// but it only runs the autofit pass + font wait, not a widget loop.



// Resolve a raw layout item to one with explicit w/h. Stored geometry
// always wins; size preset is the fallback. Drops items pointing at
// unknown widget ids.



// SSR dashboard + dev/preview/matrix render surfaces.
app.use(require('./routes/render-pages'));

// Config CRUD + editor preview-data.
app.use(require('./routes/config'));

// Device-facing render + sleep/wake endpoints.
app.use(require('./routes/display'));

// Control panel
app.get('/', (req, res) => res.redirect('/control'));

// ---------- Control-panel PIN auth ----------
// Login page: editorial-styled, no webfonts/JS deps, posts the PIN and
// redirects on success. Served unauthenticated (it's the unlock door).
// Control-panel PIN auth pages + API + /control SPA entry.
app.use(require('./routes/auth'));

// ---------- Geocoding / weather-check (Open-Meteo, no API key) ----------
// React fetches these instead of calling Open-Meteo directly so that
// (a) we can cache responses on the server and (b) the path is stable
// if we ever switch providers.

// Geocode / reverse-geocode / weather-check (setup UI helpers).
app.use(require('./routes/geocode'));

// Returns the full payload the dashboard would render — minus the
// HTML. The React editor uses this to render live widget tiles locally.

// Battery report/read (ESP32).
app.use(require('./routes/battery'));

// ---------- Mac state (pushed from the Mac-side agent) ----------
//
// `mac-agent.js` running on the user's Mac periodically POSTs the
// latest nowplaying + battery snapshot here. Cloud renderers read it
// via the shared widgets/_mac_state cache. Payload shape:
//   {
//     nowplaying: { title, artist, album, isPlaying, durationSec,
//                   elapsedSec, sourceLabel, artworkBase64 } | null,
//     battery:    { percent, state } | null,
//     trackKey:   <optional hash>
//   }
//
// The agent dedupes artwork by track key — when the trackKey matches
// what the server already has it can omit `artworkBase64` and we keep
// the previous frame's image. Keeps bandwidth bounded (~50MB/mo).
// Mac-agent push endpoints (now-playing + battery).
app.use(require('./routes/mac-state'));

// ---------- Alarms ----------
//
// Stored at cfg.alarms — see widgets/alarms.js for the shape. Time
// math runs in the server's local timezone; set the TZ env var on
// Railway to match your real timezone or alarms will misfire by the
// offset.

// Alarm CRUD + device next-alarm lookup.
app.use(require('./routes/alarms'));

// ---------- Firmware OTA ----------
//
// Layout: drop compiled `.bin` files into `public/firmware/` named
// `<board>-<semver>.bin` (e.g. `bw-1.2.0.bin`, `b-1.0.3.bin`). The device
// hits /api/firmware/manifest with its board + current version; if a
// newer binary exists, the manifest returns it and the device pulls the
// raw file from /firmware/<filename> via ESP32 httpUpdate.
// parseSemver/cmpSemver/findNewestFirmware + FW_DIR/FW_NAME_RE moved to
// ./lib/firmware.js (required at the top).

// Firmware OTA manifest + raw .bin serving.
app.use(require('./routes/firmware'));

// ---------- Device enrollment ----------
//
// First-boot handshake: device POSTs its MAC; server returns a
// long-lived api_key + a short friendly_id ("A3F2B7") for the
// control UI. Idempotent — re-enrolling the same MAC returns the
// existing record so a re-flashed device that lost NVS can recover.
//
// No auth: this is the bootstrap path. Rate-limited at the global
// /api/* middleware to keep abuse from filling the device store.
// Device enrollment + roster.
app.use(require('./routes/devices'));

// Health
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ---------- Ops status page ----------
// Human-readable "is it working?" dashboard. checkAdminAuth (PIN/token):
// it exposes device + battery telemetry. Auto-refreshes every 60s.
const _serverStartedAt = Date.now();
// relAge/dur/batteryTrend/sparkline moved to ./lib/statusfmt.js
// (required at the top).

app.get('/status', checkAdminAuth, async (req, res) => {
  try {
    const cfg = await loadConfig();
    const battery = await loadBatteryState();
    const history = await loadBatteryHistory();
    const devices = Object.values(loadDevicesSync());
    // Most recent render across cached variants.
    let lastRender = 0;
    for (const e of imageCache.values()) if (e.at > lastRender) lastRender = e.at;

    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const ok = (b) => b ? '<span class="ok">OK</span>' : '<span class="bad">—</span>';

    const baseMin = resolveRefreshMinutes(cfg);
    const battPct = battery && Number.isFinite(battery.pct) ? battery.pct : undefined;
    const refresh = effectiveRefresh(cfg, battPct);
    const fastActive = Date.now() < getFastWakeUntil();

    let refreshNote;
    if (refresh.fast) {
      refreshNote = `<span class="warn">FAST</span> ${refresh.seconds}s · push-now window`;
    } else if (refresh.quiet) {
      refreshNote = `${refresh.minutes} min · <span class="warn">quiet hours</span> (sleeping through)`;
    } else if (refresh.battSaver) {
      refreshNote = `${refresh.minutes} min · <span class="warn">battery-saver</span> (base ${baseMin})`;
    } else {
      refreshNote = `${refresh.minutes} min`;
    }

    // Each row: [label, value-html, explanation]. The explanation drives a
    // click-to-expand "ⓘ" so a non-expert can tell good from bad at a glance.
    const rows = [];
    rows.push(['Server', `${ok(true)} up ${dur(Date.now() - _serverStartedAt)}`,
      'How long the server has been running. Resets to 0 on every deploy/restart — a small number right after you push is normal.']);
    rows.push(['Refresh now', refreshNote,
      'How often the panel updates right now. Normally your configured interval. It speeds up during a Push-now window, and slows down on low battery or during quiet hours (that is intended, not a fault).']);
    rows.push(['Pre-render', PRERENDER_ENABLED
      ? `${ok(true)} every ${Math.round(PRERENDER_INTERVAL_MS / 1000)}s`
      : '<span class="warn">off</span>',
      'The server keeps the next image ready in advance so the device never waits on a slow render. OK = on (what you want).']);
    rows.push(['Last render', lastRender ? relAge(lastRender) : 'not yet',
      'Time since the dashboard image was last drawn. Should be recent if anything is viewing it; "not yet" just means nothing has requested an image since the last restart.']);
    rows.push(['Push window', fastActive
      ? `<span class="ok">active</span> · ${dur(getFastWakeUntil() - Date.now())} left`
      : '<span class="muted">idle</span>',
      'Active = a Push-now fast-refresh window is currently open, so the device polls quickly. Idle is the normal resting state.']);
    rows.push(['Weather key', ok(!!process.env.OPENWEATHER_API_KEY),
      'OpenWeatherMap API key. Blank/— is usually FINE: the default weather uses Open-Meteo, which needs no key. Only set this if you add a widget that specifically needs OpenWeatherMap.']);
    rows.push(['Device token', ok(!!DEVICE_TOKEN),
      'A shared secret the device sends so strangers cannot pull your image endpoints. OK = set (recommended). Blank = anyone with the URL can fetch /display.*']);
    rows.push(['Control PIN', pinConfigured(cfg) ? '<span class="ok">SET</span>' : '<span class="warn">not set</span>',
      'Whether the editor is PIN-locked. SET = the control panel asks for a PIN. "not set" means anyone who reaches the URL can edit.']);
    if (battery) {
      rows.push(['Battery', `${battery.pct}% · ${Number(battery.v).toFixed(2)} V · ${relAge(battery.at)}`,
        'The last battery reading the device reported: charge %, voltage, and how long ago. If "ago" is large the device has not checked in recently.']);
    } else {
      rows.push(['Battery', '<span class="warn">no reading yet</span>',
        'No battery reading received yet. The device reports this on each wake, so it fills in after the next refresh on battery power.']);
    }
    const trend = batteryTrend(history);
    if (trend) {
      let t;
      if (trend.ratePerH < -0.05) {
        const eta = trend.etaH != null && trend.etaH < 1000 ? ` · ~${dur(trend.etaH * 3_600_000)} to empty` : '';
        t = `▼ ${Math.abs(trend.ratePerH).toFixed(1)}%/h${eta}`;
      } else if (trend.ratePerH > 0.05) {
        t = `<span class="ok">▲ charging ${trend.ratePerH.toFixed(1)}%/h</span>`;
      } else {
        t = 'flat';
      }
      const spark = sparkline(history.slice(-24).map(h => h.pct));
      rows.push(['Battery trend', `${t}${spark ? ` · <span class="muted">${spark}</span>` : ''}`,
        'Which way the battery is going over recent readings. ▼ = draining (with %/hour and a rough time-to-empty), ▲ = charging, flat = no change. flat is FINE — it just means steady (e.g. on USB power or few readings). The sparkline is the recent % history, left=older.']);
    }
    rows.push(['Battery history', `${history.length} point${history.length === 1 ? '' : 's'}`,
      'How many battery readings are stored. These feed the trend and sparkline above; more points = a better trend estimate.']);
    const lastErr = _errLog[_errLog.length - 1];
    rows.push(['Errors', _errLog.length === 0
      ? '<span class="ok">none</span>'
      : `<span class="warn">${_errLog.length}</span> · last ${relAge(lastErr.at)}`,
      'Server errors captured since the last restart (cleared on restart). 0 is what you want. If this climbs, expand the Recent errors list below. A few stale ones from a transient blip are usually harmless.']);

    const STALE_MS = 2 * 86400000; // 2 days without contact = prunable
    const devRows = devices.length ? devices.map(d => {
      const id = esc(d.friendly_id || d.mac);
      const stale = d.last_seen_at && (Date.now() - d.last_seen_at) > STALE_MS;
      const seen = `${relAge(d.last_seen_at)}${stale ? ' <span class="warn">stale</span>' : ''}`;
      return `<tr><td>${id}</td><td>${esc(d.board || '?')}</td>`
        + `<td>${esc(d.fw_version || '?')}</td><td>${seen}</td>`
        + `<td><button class="rm" data-id="${id}">remove</button></td></tr>`;
    }).join('') : '<tr><td colspan="5" class="muted">No devices enrolled yet.</td></tr>';

    const liveRenderHref = '/display.png' + (DEVICE_TOKEN ? `?token=${encodeURIComponent(DEVICE_TOKEN)}` : '');

    res.type('html').send(`<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60"><title>Status · E-Ink Dashboard</title>
<style>body{font-family:Georgia,serif;background:#faf8f3;color:#111;max-width:560px;margin:32px auto;padding:0 16px}
h1{font-size:26px;font-weight:400;border-bottom:3px solid #111;padding-bottom:10px}
h2{font-family:ui-monospace,monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6b6960;margin:26px 0 8px}
table{width:100%;border-collapse:collapse;font-family:ui-monospace,monospace;font-size:13px}
td{padding:7px 0;border-bottom:1px solid #e2ded3;vertical-align:top}
tr td:first-child{color:#6b6960;width:42%}
.ok{color:#1a7f37;font-weight:700}.bad{color:#b00}.warn{color:#b06a00}.muted{color:#999}
thead td{font-weight:700;color:#111;text-transform:uppercase;font-size:11px;letter-spacing:1px}
a{color:#111}
.info{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;margin-left:7px;border:1px solid #b7b2a4;border-radius:50%;color:#8a857a;font-size:10px;font-style:italic;font-family:Georgia,serif;cursor:pointer;user-select:none;vertical-align:middle}
.info:hover{border-color:#111;color:#111}
.desc{display:none}
.desc.show{display:table-row}
.desc td{font-family:Georgia,serif;font-size:13px;line-height:1.5;color:#555;background:#f3f0e8;padding:10px 12px;border-bottom:1px solid #e2ded3}
button.rm{font-family:ui-monospace,monospace;font-size:11px;color:#b00;background:none;border:1px solid #e0c4c4;padding:2px 8px;cursor:pointer;border-radius:3px}
button.rm:hover{background:#b00;color:#fff;border-color:#b00}</style></head><body>
<h1>E-Ink Dashboard · Status</h1>
<p style="font-family:ui-monospace,monospace;font-size:11px;color:#8a857a;margin-top:-4px">Tap the <span class="info">i</span> on any row for what it means.</p>
<h2>System</h2>
<table>${rows.map(([k, v, desc], i) =>
  `<tr><td>${k}${desc ? `<span class="info" data-d="d${i}">i</span>` : ''}</td><td>${v}</td></tr>`
  + (desc ? `<tr class="desc" id="d${i}"><td colspan="2">${esc(desc)}</td></tr>` : '')
).join('')}</table>
<h2>Devices <span class="info" data-d="ddev">i</span></h2>
<p class="desc" id="ddev-p" style="display:none;font-family:Georgia,serif;font-size:13px;line-height:1.5;color:#555;background:#f3f0e8;padding:10px 12px;border:1px solid #e2ded3">Each ESP32 that has checked in. <b>Board</b> = panel it reported (<code>b</code> = 3-colour, <code>bw</code> = black/white). <b>Firmware</b> = its flashed version. <b>Last seen</b> = time since its last request; <b>stale</b> means &gt;2 days — usually an old enrollment from before a reflash. Removing a row just prunes the list; a live device re-adds itself automatically on its next wake.</p>
<table><thead><tr><td>ID</td><td>Board</td><td>Firmware</td><td>Last seen</td><td></td></tr></thead>
<tbody>${devRows}</tbody></table>
${_errLog.length ? `<h2>Recent errors (${_errLog.length})</h2>
<table>${_errLog.slice(-8).reverse().map(e =>
  `<tr><td style="width:auto;white-space:nowrap;vertical-align:top">${relAge(e.at)}</td>`
  + `<td style="font-size:11px;color:#a33">${esc(e.msg)}</td></tr>`).join('')}</table>` : ''}
<h2>Links</h2>
<table>
<tr><td>Control panel</td><td><a href="/control">/control</a></td></tr>
<tr><td>Live render</td><td><a href="${liveRenderHref}">/display.png</a></td></tr>
<tr><td>Health JSON</td><td><a href="/health">/health</a></td></tr>
</table>
<p style="font-family:ui-monospace,monospace;font-size:10px;color:#999;margin-top:24px">Auto-refreshes every 60s.</p>
<script>
var qtok=new URLSearchParams(location.search).get('token');
// Remember which explanations are open so the 60s auto-refresh doesn't
// collapse them mid-read.
var OPEN_KEY='eink-status-open';
function openSet(){try{return new Set(JSON.parse(sessionStorage.getItem(OPEN_KEY)||'[]'));}catch(e){return new Set();}}
function saveOpen(s){try{sessionStorage.setItem(OPEN_KEY,JSON.stringify([...s]));}catch(e){}}
function setOpen(id,on){
  var t=document.getElementById(id); if(t)t.classList.toggle('show',on);
  var p=document.getElementById(id+'-p'); if(p)p.style.display=on?'block':'none';
}
var _open=openSet();
_open.forEach(function(id){setOpen(id,true);});
document.querySelectorAll('.info[data-d]').forEach(function(b){
  b.addEventListener('click',function(){
    var id=b.dataset.d, s=openSet(), on=!s.has(id);
    on?s.add(id):s.delete(id); saveOpen(s); setOpen(id,on);
  });
});
document.querySelectorAll('button.rm').forEach(function(b){
  b.addEventListener('click',function(){
    var id=b.dataset.id;
    if(!confirm('Remove device '+id+'? It re-adds itself if it checks in again.'))return;
    fetch('/api/device/'+encodeURIComponent(id)+(qtok?'?token='+encodeURIComponent(qtok):''),{method:'DELETE'})
      .then(function(r){if(r.ok)location.reload();else alert('Remove failed ('+r.status+')');})
      .catch(function(){alert('Remove failed');});
  });
});
</script>
</body></html>`);
  } catch (err) {
    console.error('status error:', err);
    res.status(500).send(safeError(err).error);
  }
});

// JSON dump of every data-widget's last fetch outcome.
app.get('/api/health/widgets', (req, res) => {
  res.json({ now: Date.now(), widgets: widgetStatus.snapshot() });
});

// Human-readable status dashboard. Each fetched widget gets a row:
// last call time, success rate, latency, cache state, last error.
app.get('/health/widgets', (req, res) => {
  const snap = widgetStatus.snapshot();
  const now = Date.now();
  const fmtAgo = (ms) => {
    if (!ms) return '—';
    const s = Math.round((now - ms) / 1000);
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    return Math.round(s / 3600) + 'h ago';
  };
  const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const widgetNames = Object.keys(snap).sort();
  if (!widgetNames.length) {
    widgetNames.push('(no fetched widgets yet)');
  }
  const rows = widgetNames.map(name => {
    const e = snap[name];
    if (!e) {
      return `<tr><td>${name}</td><td colspan="6" class="muted">no calls yet</td></tr>`;
    }
    const okRate = e.calls > 0 ? Math.round((e.ok / e.calls) * 100) : 0;
    const statusCell = e.lastErr && e.lastAt > (e.lastOk || 0)
      ? `<span class="bad">FAIL</span>`
      : e.lastCacheHit ? `<span class="cached">CACHED</span>` : `<span class="ok">OK</span>`;
    return `<tr>
      <td>${name}</td>
      <td>${statusCell}</td>
      <td>${e.calls}</td>
      <td>${okRate}%</td>
      <td>${fmtAgo(e.lastAt)}</td>
      <td>${e.lastLatencyMs != null ? e.lastLatencyMs + 'ms' : '—'}</td>
      <td class="err">${escapeHtml(e.lastErr || '')}</td>
    </tr>`;
  }).join('');
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Widget health</title>
<link rel="stylesheet" href="/static/fonts/fonts.css">
<style>
  /* Shares the control app's editorial system: newsprint bg, serif
   * masthead on an Oxford rule, mono table marked by rules not boxes. */
  body { font-family: 'JetBrains Mono', ui-monospace, monospace; background: #faf8f3; color: #111; margin: 0; padding: 24px; }
  .masthead { max-width: 980px; border-bottom: 3px solid #111; padding-bottom: 12px; margin-bottom: 4px; position: relative; }
  .masthead::after { content: ''; position: absolute; left: 0; right: 0; bottom: -6px; height: 1px; background: #111; }
  h1 { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; font-size: 30px; letter-spacing: -1px; margin: 0; }
  .muted { color: #6b6960; }
  table { border-collapse: collapse; width: 100%; max-width: 980px; margin-top: 20px; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid rgba(17,17,17,0.18); font-size: 12px; }
  tr:last-child td { border-bottom: 2px solid #111; }
  th { border-bottom: 2px solid #111; text-transform: uppercase; letter-spacing: 2px; font-size: 11px; font-weight: 700; }
  td.err { color: #c8302a; max-width: 360px; overflow-wrap: anywhere; }
  .ok { color: #111; font-weight: 700; }
  .bad { color: #c8302a; font-weight: 700; }
  .cached { color: #b68a3c; font-weight: 700; }
  .note { font-size: 11px; color: #6b6960; margin-top: 16px; max-width: 980px; line-height: 1.5; }
  a { color: #111; text-transform: uppercase; letter-spacing: 1.5px; font-size: 11px; }
</style>
</head><body>
<div class="masthead"><h1>Widget health</h1></div>
<div class="note">Counts reset whenever the server process restarts. Cache hits don't increment call/ok/fail.</div>
<table>
  <thead><tr><th>Widget</th><th>Status</th><th>Calls</th><th>OK%</th><th>Last call</th><th>Latency</th><th>Last error</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="note">Auto-refreshes every 15s. <a href="/api/health/widgets">JSON</a></div>
<script>setTimeout(() => location.reload(), 15000);</script>
</body></html>`);
});

// Node 15+ exits on unhandled rejections by default. Log first so we
// can see what went wrong, then let the platform restart us (Railway,
// systemd, launchd). Without this hook the trace can get clipped and
// debugging a production crash means re-running it locally.
process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
  if (reason && reason.stack) console.error(reason.stack);
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err && err.stack || err);
  // Exit so the supervisor restarts a clean process. In-memory state
  // (weather cache, in-flight Puppeteer pages) is invalid after a
  // bug-level throw — better to start fresh than limp on.
  process.exit(1);
});

// Lockout recovery: set RESET_PIN=1 (env) and restart to clear a forgotten
// control PIN. Strips the PIN hash and rotates the session secret (so old
// sessions die), leaving the editor open so a new PIN can be set. Works on
// Railway with no shell access — set the var, redeploy, then REMOVE it and
// set a fresh PIN immediately.
async function clearPinIfRequested() {
  // Only an explicit on-value triggers it; "0"/"false"/"no"/empty/unset are
  // all OFF, so RESET_PIN=0 safely disables instead of clearing.
  if (!/^(1|true|yes|on)$/i.test(process.env.RESET_PIN || '')) return;
  try {
    const cfg = await loadConfig();
    if (cfg.auth && (cfg.auth.pinHash || cfg.auth.pinSalt)) {
      delete cfg.auth.pinHash;
      delete cfg.auth.pinSalt;
      cfg.auth.sessionSecret = crypto.randomBytes(32).toString('hex');
      await saveConfig(cfg);
      invalidateImage();
      console.warn('⚠ RESET_PIN set — control PIN CLEARED. Remove the RESET_PIN env var now and set a new PIN in the editor.');
    } else {
      console.warn('RESET_PIN set — no PIN was configured; nothing to clear.');
    }
  } catch (e) {
    console.error('RESET_PIN failed:', e.message);
  }
}

// Unknown /api path → clean JSON 404 (not the default HTML page).
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'not_found', path: req.originalUrl });
});

// Final backstop error handler. Per-route try/catch handles the common cases;
// this catches anything a handler throws synchronously or passes to next(err)
// so a single bad route returns a clean 500 instead of leaking a stack /
// hanging the request. Logged into the error ring surfaced on /status.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Route error:', req.method, req.originalUrl, err && (err.stack || err.message || err));
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err && err.status) ? err.status : 500;
  res.status(status).json(safeError(err));
});

app.listen(PORT, () => {
  console.log(`E-ink dashboard listening on http://localhost:${PORT}`);
  console.log(`  Control panel:  http://localhost:${PORT}/control`);
  console.log(`  Preview PNG:    http://localhost:${PORT}/display.png`);
  console.log(`  Dashboard HTML: http://localhost:${PORT}/dashboard`);

  clearPinIfRequested();

  // Pre-render the active screen so the first device wake hits a warm cache,
  // then keep it warm on an interval. Stale-while-revalidate (above) means a
  // device request never blocks on a cold render once this has run once.
  if (PRERENDER_ENABLED) {
    console.log(`  Pre-render:     every ${Math.round(PRERENDER_INTERVAL_MS / 1000)}s`);
    warmActiveImage();
    const timer = setInterval(warmActiveImage, PRERENDER_INTERVAL_MS);
    if (timer.unref) timer.unref(); // don't keep the process alive just for this
  }
});
