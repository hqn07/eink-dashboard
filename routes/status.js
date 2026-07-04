// Ops surfaces: a human-readable "is it working?" status page (device +
// battery telemetry, PIN/token state, recent errors), the /health JSON probe,
// and the per-widget fetch-health dashboard. All read-only.
const router = require('express').Router();
const { DEVICE_TOKEN } = require('../lib/env');
const { checkAdminAuth, pinConfigured } = require('../lib/auth');
const { loadConfig } = require('../lib/config-store');
const { loadBatteryState, loadBatteryHistory } = require('../lib/battery-store');
const { loadDevicesSync } = require('../lib/devices-store');
const { imageCache, PRERENDER_ENABLED, PRERENDER_INTERVAL_MS } = require('../lib/render');
const { resolveRefreshMinutes } = require('../lib/screens');
const { effectiveRefresh, getFastWakeUntil } = require('../lib/refresh');
const { errLog: _errLog } = require('../lib/errlog');
const { relAge, dur, batteryTrend, sparkline } = require('../lib/statusfmt');
const { safeError } = require('../lib/http');
const widgetStatus = require('../widgets/_status');

const _serverStartedAt = Date.now();

// Health
router.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ---------- Ops status page ----------
// Human-readable "is it working?" dashboard. checkAdminAuth (PIN/token): it
// exposes device + battery telemetry. Auto-refreshes every 60s.
router.get('/status', checkAdminAuth, async (req, res) => {
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
router.get('/api/health/widgets', (req, res) => {
  res.json({ now: Date.now(), widgets: widgetStatus.snapshot() });
});

// Human-readable status dashboard. Each fetched widget gets a row: last call
// time, success rate, latency, cache state, last error.
router.get('/health/widgets', (req, res) => {
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

module.exports = router;
