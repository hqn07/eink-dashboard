// Tasks widget — server side. Pulls a to-do list from Todoist (REST v2,
// Bearer token) or an iCal feed's VTODO items (Apple Reminders / any CalDAV
// export). Normalizes to { items:[{title, due, priority}], stale }. Cached
// per source key so multiple tiles / refreshes don't re-hit the API.

const ical = require('node-ical');
const { fetchWithTimeout, fetchPublicUrl } = require('./_fetch');
const status = require('./_status');

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map(); // key → { at, data }

// Todoist priority is 4=urgent … 1=normal. Map to our 1=highest scale so the
// renderer can flag urgent tasks red regardless of source.
function mapTodoistPriority(p) {
  return p === 4 ? 1 : p === 3 ? 2 : p === 2 ? 3 : 4;
}

// Friendly due label from an ISO date/datetime. Returns '' when absent.
function dueLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((day - today) / 86400000);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff < 7) return day.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
  return day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
}

async function fetchTodoist(token, limit) {
  const res = await fetchWithTimeout('https://api.todoist.com/rest/v2/tasks',
    { headers: { Authorization: `Bearer ${token}` } }, 6000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const arr = await res.json();
  const items = (Array.isArray(arr) ? arr : []).map(t => ({
    title: String(t.content || '').trim(),
    due: dueLabel(t.due && (t.due.datetime || t.due.date)),
    dueSort: t.due && (t.due.datetime || t.due.date) ? Date.parse(t.due.datetime || t.due.date) : Infinity,
    priority: mapTodoistPriority(t.priority),
    order: Number.isFinite(t.order) ? t.order : 0
  })).filter(i => i.title);
  // Todoist returns in project order; sort by due date then manual order so
  // the most time-relevant tasks surface on a small tile.
  items.sort((a, b) => (a.dueSort - b.dueSort) || (a.order - b.order));
  return items.slice(0, limit);
}

async function fetchIcalTodos(url, limit) {
  const res = await fetchPublicUrl(url, {}, 6000); // SSRF guard on user URL
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const parsed = ical.parseICS(text);
  const items = [];
  for (const k of Object.keys(parsed)) {
    const c = parsed[k];
    if (!c || c.type !== 'VTODO') continue;
    if (String(c.status || '').toUpperCase() === 'COMPLETED') continue;
    // node-ical usually hands DUE back as a Date, but can pass a raw string;
    // coerce safely so a weird value doesn't blow up the whole fetch.
    let dueISO = null;
    if (c.due) {
      const d = (c.due instanceof Date) ? c.due : new Date(c.due);
      if (!isNaN(d)) dueISO = d.toISOString();
    }
    items.push({
      title: String(c.summary || '').trim(),
      due: dueLabel(dueISO),
      dueSort: dueISO ? Date.parse(dueISO) : Infinity,
      priority: Number.isFinite(c.priority) && c.priority > 0 && c.priority <= 4 ? 1
        : Number.isFinite(c.priority) && c.priority <= 6 ? 2 : 4,
      order: 0
    });
  }
  items.sort((a, b) => a.dueSort - b.dueSort);
  return items.filter(i => i.title).slice(0, limit);
}

// settings: { source: 'todoist'|'ical', token, icalUrl, count }
async function fetchTasks(settings) {
  const s = settings || {};
  const limit = Number.isFinite(s.count) ? s.count : 8;
  let key;
  if (s.source === 'ical') {
    const url = typeof s.icalUrl === 'string' ? s.icalUrl.trim() : '';
    if (!/^https?:\/\//i.test(url)) return null;
    key = `ical:${url}`;
  } else {
    const token = typeof s.token === 'string' ? s.token.trim() : '';
    if (!token) return null;
    key = `todoist:${token.slice(0, 8)}`;
  }

  const hit = cache.get(key);
  if (hit && (Date.now() - hit.at) < CACHE_MS) { status.cacheHit('tasks'); return hit.data; }

  const t0 = Date.now();
  try {
    const items = s.source === 'ical'
      ? await fetchIcalTodos(s.icalUrl.trim(), limit)
      : await fetchTodoist(s.token.trim(), limit);
    const data = { items, stale: false };
    cache.set(key, { at: Date.now(), data });
    status.record('tasks', { ok: true, ms: Date.now() - t0 });
    return data;
  } catch (err) {
    status.record('tasks', { ok: false, ms: Date.now() - t0, err: err.message || String(err) });
    if (hit) return { ...hit.data, stale: true };
    return null;
  }
}

module.exports = { fetchTasks };
