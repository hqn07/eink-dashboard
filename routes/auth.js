// Control-panel PIN auth surfaces: the login + first-run setup pages, the
// auth API (login/logout/status/set-pin), and the /control SPA entry (gated by
// gateControlHtml). PIN logic lives in lib/auth; this is just the HTTP layer.
const fs = require('fs');
const path = require('path');
const router = require('express').Router();
const { IS_PROD } = require('../lib/env');
const { loadConfig } = require('../lib/config-store');
const {
  gateControlHtml, authBlock, pinConfigured, verifyPin, setPinInConfig,
  makeSession, sessionValid, setSessionCookie, clearSessionCookie,
  lockoutRemainingMs, recordLoginFailure, clearLoginFailures,
} = require('../lib/auth');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const CONTROL_APP_INDEX = path.join(PUBLIC_DIR, 'control-app', 'index.html');
const CONTROL_HTML = path.join(PUBLIC_DIR, 'control.html');

const LOGIN_PAGE = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Unlock · E-Ink Dashboard</title>
<style>body{font-family:Georgia,serif;background:#faf8f3;color:#111;max-width:360px;margin:64px auto;padding:0 16px}
h1{font-size:24px;font-weight:400;border-bottom:3px solid #111;padding-bottom:10px}
label{display:block;font-family:ui-monospace,monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6b6960;margin:22px 0 6px}
input{width:100%;box-sizing:border-box;padding:11px 12px;font-size:18px;letter-spacing:4px;font-family:inherit;background:#fff;border:1.5px solid #111}
button{margin-top:18px;padding:12px;font-family:ui-monospace,monospace;font-weight:700;letter-spacing:3px;text-transform:uppercase;border:2px solid #111;background:#111;color:#fff;width:100%;cursor:pointer}
.err{font-family:ui-monospace,monospace;font-size:12px;color:#b00;margin-top:14px;min-height:16px}</style>
</head><body><h1>E-Ink Dashboard</h1>
<form id="f"><label>Enter PIN</label>
<input id="pin" type="password" inputmode="numeric" autocomplete="current-password" autofocus>
<button>Unlock</button><div class="err" id="e"></div></form>
<script>
const f=document.getElementById('f'),e=document.getElementById('e');
f.onsubmit=async(ev)=>{ev.preventDefault();e.textContent='';
const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pin:document.getElementById('pin').value})});
if(r.ok){location.href='/control';}else{e.textContent='Wrong PIN';document.getElementById('pin').value='';}};
</script></body></html>`;

// First-run "create a PIN" page. Shown in production when no PIN is set yet,
// so a freshly-deployed public instance can't sit with an open editor.
const SETUP_PAGE = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Secure your dashboard · E-Ink</title>
<style>body{font-family:Georgia,serif;background:#faf8f3;color:#111;max-width:380px;margin:56px auto;padding:0 16px}
h1{font-size:24px;font-weight:400;border-bottom:3px solid #111;padding-bottom:10px}
p.lede{font-size:14px;line-height:1.5;color:#555}
label{display:block;font-family:ui-monospace,monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6b6960;margin:18px 0 6px}
input{width:100%;box-sizing:border-box;padding:11px 12px;font-size:18px;letter-spacing:4px;font-family:inherit;background:#fff;border:1.5px solid #111}
button{margin-top:18px;padding:12px;font-family:ui-monospace,monospace;font-weight:700;letter-spacing:3px;text-transform:uppercase;border:2px solid #111;background:#111;color:#fff;width:100%;cursor:pointer}
.err{font-family:ui-monospace,monospace;font-size:12px;color:#b00;margin-top:14px;min-height:16px}</style>
</head><body><h1>Secure your dashboard</h1>
<p class="lede">This instance has no PIN yet. Set one to lock the editor before anyone else finds it.</p>
<form id="f"><label>New PIN (4+ digits)</label>
<input id="pin" type="password" inputmode="numeric" autocomplete="new-password" autofocus>
<label>Confirm PIN</label>
<input id="pin2" type="password" inputmode="numeric" autocomplete="new-password">
<button>Set PIN &amp; continue</button><div class="err" id="e"></div></form>
<script>
const f=document.getElementById('f'),e=document.getElementById('e');
f.onsubmit=async(ev)=>{ev.preventDefault();e.textContent='';
const p=document.getElementById('pin').value,p2=document.getElementById('pin2').value;
if(p.length<4){e.textContent='PIN must be 4+ digits';return;}
if(p!==p2){e.textContent='PINs do not match';return;}
const r=await fetch('/api/auth/set-pin',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pin:p})});
if(r.ok){location.href='/control';}else{e.textContent='Could not set PIN';}};
</script></body></html>`;

router.get('/control/login', async (req, res) => {
  const cfg = await loadConfig().catch(() => ({}));
  if (sessionValid(req, cfg)) return res.redirect('/control');
  // No PIN yet: force setup in prod, open editor locally.
  if (!pinConfigured(cfg)) return res.redirect(IS_PROD ? '/control/setup' : '/control');
  res.type('html').send(LOGIN_PAGE);
});

// First-run PIN setup. Only meaningful when no PIN is configured; once one
// exists this bounces to login/editor so it can't be used to view a form.
router.get('/control/setup', async (req, res) => {
  const cfg = await loadConfig().catch(() => ({}));
  if (sessionValid(req, cfg)) return res.redirect('/control');
  if (pinConfigured(cfg)) return res.redirect('/control/login');
  res.type('html').send(SETUP_PAGE);
});

router.post('/api/auth/login', async (req, res) => {
  const cfg = await loadConfig();
  if (!pinConfigured(cfg)) return res.status(400).json({ error: 'no_pin_set' });

  // Backoff before the compare, so a locked-out caller learns nothing about
  // whether the PIN they sent was right.
  const waitMs = lockoutRemainingMs(cfg);
  if (waitMs > 0) {
    res.set('Retry-After', String(Math.ceil(waitMs / 1000)));
    return res.status(429).json({ error: 'locked_out', retryAfterMs: waitMs });
  }

  const pin = (req.body && req.body.pin) || '';
  if (!verifyPin(cfg, pin)) {
    await recordLoginFailure();
    return res.status(401).json({ error: 'bad_pin' });
  }
  await clearLoginFailures();
  setSessionCookie(res, makeSession(authBlock(cfg).sessionSecret));
  res.json({ ok: true });
});

router.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/api/auth/status', async (req, res) => {
  const cfg = await loadConfig().catch(() => ({}));
  res.json({ configured: pinConfigured(cfg), authed: sessionValid(req, cfg) });
});

// Set or change the PIN. First run (no PIN yet) is open so the user can set
// one from the editor. Once set, requires a valid session OR the current PIN.
router.post('/api/auth/set-pin', async (req, res) => {
  const cfg = await loadConfig();
  const newPin = String((req.body && req.body.pin) || '');
  if (newPin.length < 4) return res.status(400).json({ error: 'pin_too_short' });
  if (pinConfigured(cfg)) {
    const ok = sessionValid(req, cfg)
      || verifyPin(cfg, (req.body && req.body.currentPin) || '');
    if (!ok) return res.status(401).json({ error: 'unauthorized' });
  }
  const auth = await setPinInConfig(newPin);
  setSessionCookie(res, makeSession(auth.sessionSecret));
  res.json({ ok: true });
});

router.get('/control', gateControlHtml, (req, res) => {
  // Prefer the React app; fall back to the legacy vanilla page when the build
  // artifact hasn't been produced yet (e.g. local dev before `npm run build`).
  if (fs.existsSync(CONTROL_APP_INDEX)) {
    res.sendFile(CONTROL_APP_INDEX);
  } else {
    res.sendFile(CONTROL_HTML);
  }
});
router.get('/control-classic', gateControlHtml, (req, res) => {
  res.sendFile(CONTROL_HTML);
});

module.exports = router;
