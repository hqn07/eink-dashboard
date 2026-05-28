// widgets/alarms.js
// Alarm scheduling math + persistence helpers. Alarms live in
// cfg.alarms as an array of:
//   {
//     id:      string,                       // stable identifier
//     time:    "HH:MM",                      // 24-hour
//     days:    ["sun","mon",...],            // empty/missing = every day
//     enabled: boolean,                      // default true
//     label:   string                        // optional, free text
//   }
//
// Time handling notes:
// - All math runs in the server's local timezone via JS Date.
// - Set the TZ env var on Railway (or wherever) to match your real
//   timezone or alarms will fire at the wrong wall-clock time.

const DAY_IDX = { sun:0, mon:1, tue:2, wed:3, thu:4, fri:5, sat:6 };
const DAY_NAMES = ['sun','mon','tue','wed','thu','fri','sat'];

// Default duration the alarm screen + buzzer should hold the device
// awake before auto-dismissing. Keep aligned with firmware defaults.
const DEFAULT_DURATION_SEC = 60;

function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm };
}

function dayIndexes(days) {
  if (!Array.isArray(days) || days.length === 0) return [0,1,2,3,4,5,6];
  const out = [];
  for (const d of days) {
    const k = String(d || '').toLowerCase().slice(0, 3);
    if (k in DAY_IDX) out.push(DAY_IDX[k]);
  }
  return out.length ? out : [0,1,2,3,4,5,6];
}

// Return the next firing time of one alarm as a Unix ms timestamp, or
// null if it never fires (no enabled days). Looks up to 8 days ahead.
function nextFireMs(alarm) {
  if (!alarm || alarm.enabled === false) return null;
  const t = parseHHMM(alarm.time);
  if (!t) return null;
  const days = dayIndexes(alarm.days);
  const now = new Date();
  for (let offset = 0; offset < 8; offset++) {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    d.setHours(t.hh, t.mm, 0, 0);
    if (d.getTime() <= now.getTime()) continue;
    if (days.includes(d.getDay())) return d.getTime();
  }
  return null;
}

// Return { ts, label, durationSec } for the soonest-firing alarm in
// the list, or null if none enabled.
function computeNextAlarm(alarms) {
  if (!Array.isArray(alarms)) return null;
  let best = null;
  for (const a of alarms) {
    const ts = nextFireMs(a);
    if (ts == null) continue;
    if (!best || ts < best.ts) {
      best = {
        ts,
        label: a.label || a.time,
        durationSec: DEFAULT_DURATION_SEC
      };
    }
  }
  return best;
}

// Lightweight validation/normalization for incoming POST bodies.
function normalizeAlarm(a, idx) {
  if (!a || typeof a !== 'object') return null;
  const t = parseHHMM(a.time);
  if (!t) return null;
  const id = String(a.id || `alarm-${Date.now().toString(36)}-${idx}`);
  return {
    id,
    time: `${String(t.hh).padStart(2,'0')}:${String(t.mm).padStart(2,'0')}`,
    days: dayIndexes(a.days).map(i => DAY_NAMES[i]),
    enabled: a.enabled !== false,
    label: typeof a.label === 'string' ? a.label.slice(0, 80) : ''
  };
}

function normalizeAlarmList(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeAlarm).filter(Boolean);
}

module.exports = { computeNextAlarm, normalizeAlarmList, DEFAULT_DURATION_SEC };
