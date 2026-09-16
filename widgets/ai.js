// AI widget — turns the dashboard's own data plus a prompt you write into a
// few lines of text on the panel.
//
// Provider-agnostic on purpose: OpenAI and DeepSeek expose the identical
// POST /chat/completions shape, so one code path serves both and switching is
// an env change, not a code change. That is also why this doesn't pull in a
// vendor SDK — it would add a dependency and a second HTTP stack for a single
// endpoint, and every outbound call here has to go through fetchWithTimeout
// anyway (house rule: no unbounded external call can hang the render queue).
//
// CREDENTIALS. The key is read from the secrets store (Settings >
// Connections), NOT from the config: Backup > EXPORT serialises the whole
// config to a file the user may email, and a key that was never in the config
// cannot leak through it. Provider URL and model are not secrets and live in
// `cfg.ai`, so restoring a backup brings those back and asks only for the key.
// Env vars remain a fallback so an instance configured through Railway keeps
// working:
//   aiApiKey / AI_API_KEY   required — absent renders SETUP NEEDED
//   cfg.ai.baseUrl / AI_BASE_URL  default https://api.openai.com/v1
//                                 DeepSeek: https://api.deepseek.com/v1
//   cfg.ai.model / AI_MODEL required, no default. A wrong-but-plausible
//                default would fail at request time with a confusing provider
//                error; a missing one fails immediately naming the fix.
//
// CADENCE IS THE WHOLE DESIGN. The panel wakes every 15-30 min and a colour
// redraw costs 15-26 s, so text that changed on every wake would redraw the
// screen all day and flatten the battery. Generation is therefore time-based,
// not render-based: the cached line is reused until it ages past the widget's
// cadence, so most renders cost nothing and the ETag only moves when the text
// actually changes. A failed call keeps serving the last good text — a wall
// display should never show an error where yesterday's briefing was.

const path = require('path');
const fsp = require('fs/promises');
const { fetchWithTimeout } = require('./_fetch');
const { DATA_DIR, atomicWriteFile } = require('../lib/store');
const status = require('./_status');
const { getSecret } = require('../lib/secrets-store');
const { loadConfig } = require('../lib/config-store');

const CACHE_PATH = path.join(DATA_DIR, 'ai-cache.json');
const REQUEST_TIMEOUT_MS = 30000;   // generation is slower than a data fetch
// Generous because a model with thinking enabled spends this budget on
// reasoning first: at 200 the reasoning consumed the lot and `content` came
// back empty with finish_reason "length". Output is billed per token used,
// not per token allowed, so a high ceiling costs nothing extra.
const MAX_OUTPUT_TOKENS = 800;

// Keys are stable config values — `hourly`/`daily` predate the others and
// must keep resolving. A window is measured from the last generation, not
// aligned to the clock, so the generation time drifts forward by up to one
// wake interval per cycle.
const CADENCES = {
  hourly: 60 * 60 * 1000,
  '3h': 3 * 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
};
const DEFAULT_CADENCE = 'daily';

// The panel is 1-bit: no colour, no emoji (the threshold pass turns them into
// blobs), no markdown (nothing renders it). Say so once, firmly, rather than
// cleaning up prose afterwards — though sanitise() still runs as a backstop
// because a model that ignores this would otherwise put literal ** on a wall.
const SYSTEM_PROMPT = [
  'You write a few lines for a small black-and-white e-ink dashboard on a wall.',
  'Plain text only. No markdown, no asterisks, no bullet characters, no emoji.',
  'No preamble, no sign-off, no restating the question. Answer directly.',
  'Keep it under 45 words unless asked otherwise. Short sentences.',
  'The data you are given is the current state of the dashboard.',
  // "never mention what is absent" made it substitute silently: asked for
  // news with no news in context, it wrote weather advice instead, which
  // reads as an answer and is not one. Padding around a gap is worse than
  // naming it — the reader can fix a named gap.
  'If the request needs data you have not been given, say so in a few words',
  'rather than answering a different question. Do not pad, and do not invent',
  'facts you were not given. Ignoring a missing OPTIONAL detail is fine; the',
  'rule is about being asked for something you genuinely cannot see.',
  'Other tiles on the same screen already show some of this data. Do not',
  'repeat numbers the reader can already see — add what those tiles cannot:',
  'judgement, what it means, what to do. If you have nothing to add beyond',
  'what is already displayed, say one short useful thing instead of padding.',
].join(' ');

// ---------- disk cache ----------
// Survives redeploys via DATA_DIR (a Railway volume in production), so a
// restart doesn't trigger a fresh generation and an unnecessary redraw.
let memo = null;

async function loadCache() {
  if (memo) return memo;
  try {
    memo = JSON.parse(await fsp.readFile(CACHE_PATH, 'utf8'));
  } catch {
    memo = {};                       // absent or corrupt — start clean
  }
  return memo;
}

async function saveCache(cache) {
  memo = cache;
  try {
    await atomicWriteFile(CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch (err) {
    // A cache we can't persist still works in memory for this process.
    console.error('ai: cache write failed:', err.message);
  }
}

// ---------- context ----------
// What the model is told about "now". Deliberately a compact digest rather
// than the raw widget payloads: the panel only has room for a few lines, and
// a tighter prompt is cheaper, faster, and less likely to wander.
function buildContext(ctx) {
  const lines = [];
  // Field names match widgets/weather.js's payload exactly — it rounds with a
  // '--' fallback rather than leaving numbers undefined, so guard on that too.
  const w = ctx && ctx.weather;
  const num = (v) => (Number.isFinite(v) ? v : null);
  if (w && num(w.temp) !== null) {
    const unit = ctx.units === 'metric' ? 'C' : 'F';
    const parts = [`Weather: ${w.temp}°${unit}`];
    if (w.desc) parts.push(String(w.desc));
    if (num(w.tempMax) !== null && num(w.tempMin) !== null) {
      parts.push(`high ${w.tempMax}, low ${w.tempMin}`);
    }
    if (num(w.feelsLike) !== null) parts.push(`feels like ${w.feelsLike}`);
    if (num(w.humidity) !== null) parts.push(`humidity ${w.humidity}%`);
    if (num(w.windSpeed) !== null) parts.push(`wind ${w.windSpeed}`);
    if (ctx.city) parts.push(`in ${ctx.city}`);
    lines.push(parts.join(', '));
  }

  const events = Array.isArray(ctx && ctx.events) ? ctx.events.slice(0, 6) : [];
  if (events.length) {
    lines.push('Calendar: ' + events.map((e) => {
      const when = e.isAllDay ? 'all day' : (e.startLabel || '');
      const day = e.dayLabel ? `${e.dayLabel} ` : '';
      return `${e.title || 'Untitled'}${when || day ? ` (${day}${when})`.replace(' )', ')') : ''}`;
    }).join('; '));
  }

  const tasks = Array.isArray(ctx && ctx.tasks) ? ctx.tasks.slice(0, 6) : [];
  if (tasks.length) {
    lines.push('Tasks: ' + tasks.map((t) => t.title || t.text || '').filter(Boolean).join('; '));
  }

  // fetchHeadlines returns { items: [...] }; the bare-array form is accepted
  // too so a caller passing the list directly still works.
  const hRaw = ctx && ctx.headlines;
  const heads = Array.isArray(hRaw) ? hRaw.slice(0, 8)
    : (hRaw && Array.isArray(hRaw.items) ? hRaw.items.slice(0, 8) : []);
  if (heads.length) {
    lines.push('Headlines: ' + heads.map((h) => h.title || '').filter(Boolean).join(' | '));
  }

  const batt = ctx && ctx.battery;
  if (batt && Number.isFinite(batt.pct)) lines.push(`Panel battery: ${Math.round(batt.pct)}%`);

  const now = new Date(Number.isFinite(ctx && ctx.now) ? ctx.now : Date.now());
  lines.unshift(`Now: ${now.toDateString()} ${now.toTimeString().slice(0, 5)}`);

  // Who this is for. Everything above describes the world; without this the
  // model is briefing a stranger, and a forecast summary is all it can
  // honestly produce. Goes first so it frames the rest.
  const about = ctx && ctx.home && typeof ctx.home.about === 'string'
    ? ctx.home.about.trim() : '';
  if (about) lines.unshift(`About the person reading this: ${about}`);

  // What the reader can already see. Without this the model restates the
  // forecast sitting next to it — and worse, disagrees with it, because its
  // "today's high" comes from the current-conditions payload while the
  // forecast tile renders its own daily figure. Naming the neighbours turns
  // duplication into commentary.
  const others = Array.isArray(ctx && ctx.otherWidgets) ? ctx.otherWidgets : [];
  if (others.length) {
    lines.push(`Already visible on this screen (do not restate): ${others.join(', ')}`);
  }
  return lines.join('\n');
}

// Backstop for a model that ignores the formatting instruction. Markdown and
// emoji both survive the 1-bit threshold as noise, so strip rather than trust.
function sanitise(text) {
  return String(text || '')
    .replace(/[*_`#>]+/g, '')
    .replace(/^\s*[-•]\s*/gm, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Credentials + provider, resolved in one place so the SETUP NEEDED gate and
// the request itself can never disagree about whether this tile is usable.
async function resolveProvider() {
  const cfg = await loadConfig().catch(() => ({}));
  const ai = (cfg && cfg.ai) || {};
  const key = await getSecret('aiApiKey');
  const base = (ai.baseUrl || process.env.AI_BASE_URL || 'https://api.openai.com/v1')
    .replace(/\/+$/, '');
  const model = (ai.model || process.env.AI_MODEL || '').trim();
  return { key, base, model };
}

// ---------- generation ----------
async function generate(prompt, context, provider) {
  const { key, base, model } = provider;
  if (!key) throw new Error('No AI key — add one in Settings > Connections');
  if (!model) throw new Error('No AI model — set one in Settings > Connections');

  const body = {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `${context}\n\n---\n${prompt}` },
    ],
  };
  // DeepSeek enables thinking mode by default, which is wasted on a 40-word
  // briefing: it burns budget and latency reasoning about a summary. Turn it
  // off there. Sent only for DeepSeek because `thinking` is not an OpenAI
  // parameter and strict providers reject unknown body fields.
  if (/deepseek/i.test(base)) body.thinking = { type: 'disabled' };

  const res = await fetchWithTimeout(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  }, REQUEST_TIMEOUT_MS);

  if (!res.ok) {
    // Body often carries the actionable part (bad model id, no credit).
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ }
    throw new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
  }
  const json = await res.json();
  const choice = (json && json.choices && json.choices[0]) || {};
  const msg = choice.message || {};
  const text = sanitise(msg.content);
  if (!text) {
    // "empty completion" alone sent me hunting; the cause is almost always
    // visible right here. finish_reason "length" plus reasoning_content means
    // the budget went on thinking before any answer was written.
    const why = [
      choice.finish_reason ? `finish_reason=${choice.finish_reason}` : '',
      msg.reasoning_content ? 'reasoning-only output' : '',
    ].filter(Boolean).join(', ');
    throw new Error(`empty completion${why ? ` (${why})` : ''}`);
  }
  return text;
}

// Returns { text, at, stale, error } or null when unconfigured.
// `itemId` scopes the cache so two AI tiles with different prompts don't
// overwrite each other.
async function fetchAi(settings, ctx, itemId) {
  const s = settings || {};
  const prompt = typeof s.prompt === 'string' ? s.prompt.trim() : '';
  if (!prompt) return null;
  const provider = await resolveProvider();
  if (!provider.key || !provider.model) {
    return { text: '', at: 0, needsSetup: true };
  }

  const cadenceMs = CADENCES[s.cadence] || CADENCES[DEFAULT_CADENCE];
  const cache = await loadCache();
  const slot = cache[itemId || 'default'];
  const fresh = slot
    && slot.prompt === prompt
    && (Date.now() - (slot.at || 0)) < cadenceMs;

  if (fresh) { status.cacheHit('ai'); return { text: slot.text, at: slot.at }; }

  const t0 = Date.now();
  try {
    const text = await generate(prompt, buildContext(ctx), provider);
    const entry = { text, prompt, at: Date.now() };
    await saveCache({ ...cache, [itemId || 'default']: entry });
    status.record('ai', { ok: true, ms: Date.now() - t0 });
    return { text, at: entry.at };
  } catch (err) {
    status.record('ai', { ok: false, ms: Date.now() - t0, err: err.message });
    // Last good text beats an error on a wall display. Only when there has
    // never been one does the widget admit the failure.
    if (slot && slot.text) return { text: slot.text, at: slot.at, stale: true };
    return { text: '', at: 0, error: err.message };
  }
}

module.exports = { fetchAi, CADENCES, DEFAULT_CADENCE };
