// Quick-events editor — a real calendar input instead of bare list rows.
// Month grid on top (solid dot = quick event, hollow ring = feed event
// from the live preview data), day panel below with that day's events
// and a composer (title / time / repeat). Rows edit in place.
//
// Data model is unchanged: rows of { title, date: 'YYYY-MM-DD',
// time?: 'HH:MM', repeat?: 'none'|'daily'|'weekdays'|'weekly'|
// 'biweekly'|'monthly'|'yearly' } living in settings.localEvents.
import React, { useContext, useMemo, useState } from 'react';
import { CaretLeft, CaretRight, X, PencilSimple, ArrowClockwise } from '@phosphor-icons/react';
import { TokenCtx } from './token-ctx.js';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const REPEAT_LABEL = {
  none: '', daily: 'daily', weekdays: 'weekdays', weekly: 'weekly',
  biweekly: 'every 2 wks', monthly: 'monthly', yearly: 'yearly'
};

const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

// Does a repeat rule anchored at `anchor` land on calendar day `day`?
function ruleHits(row, day) {
  const anchor = parseDate(row.date);
  if (!anchor) return false;
  const diffDays = Math.round((day - anchor) / 86400000);
  if (diffDays < 0) return false;
  switch (row.repeat || 'none') {
    case 'none':     return diffDays === 0;
    case 'daily':    return true;
    case 'weekdays': return day.getDay() >= 1 && day.getDay() <= 5;
    case 'weekly':   return diffDays % 7 === 0;
    case 'biweekly': return diffDays % 14 === 0;
    case 'monthly':  return day.getDate() === anchor.getDate();
    case 'yearly':   return day.getDate() === anchor.getDate() && day.getMonth() === anchor.getMonth();
    default:         return false;
  }
}

function fmtTime(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
  if (!m) return 'all day';
  let h = +m[1];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${m[2]} ${ampm}`;
}

export default function QuickEventsEditor({ value, onChange }) {
  const rows = Array.isArray(value) ? value : [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [view, setView] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(() => keyOf(today));
  // Composer state; editIdx >= 0 means "Save replaces rows[editIdx]".
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('');
  const [repeat, setRepeat] = useState('none');
  const [editIdx, setEditIdx] = useState(-1);

  // Feed events (hollow ring markers) from the live preview context.
  const tokenCtx = useContext(TokenCtx);
  const feedDays = useMemo(() => {
    const set = new Set();
    for (const ev of (tokenCtx && tokenCtx.events) || []) {
      if (ev && ev.startISO) set.add(keyOf(new Date(ev.startISO)));
    }
    return set;
  }, [tokenCtx]);

  // 6-week grid covering the viewed month.
  const grid = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [view]);

  const quickHits = (day) => rows.filter(r => r.title && ruleHits(r, day));
  const selectedDate = parseDate(selected) || today;
  const dayRows = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.title && ruleHits(r, selectedDate));

  const resetComposer = () => { setTitle(''); setTime(''); setRepeat('none'); setEditIdx(-1); };

  const commit = () => {
    if (!title.trim()) return;
    const row = { title: title.trim(), date: selected, time: time || '', repeat };
    const next = rows.slice();
    if (editIdx >= 0) next[editIdx] = row;
    else next.push(row);
    onChange(next);
    resetComposer();
  };

  const remove = (idx) => {
    onChange(rows.filter((_, i) => i !== idx));
    if (editIdx === idx) resetComposer();
  };

  const startEdit = ({ r, i }) => {
    setTitle(r.title || '');
    setTime(r.time || '');
    setRepeat(r.repeat || 'none');
    setSelected(r.date || selected);
    const d = parseDate(r.date);
    if (d) setView(new Date(d.getFullYear(), d.getMonth(), 1));
    setEditIdx(i);
  };

  const nav = (delta) => setView(v => new Date(v.getFullYear(), v.getMonth() + delta, 1));

  return (
    <div className="qe">
      <div className="qe-head">
        <button type="button" className="qe-nav" onClick={() => nav(-1)} aria-label="Previous month">
          <CaretLeft size={13} weight="bold" />
        </button>
        <span className="qe-month">{MONTHS[view.getMonth()]} {view.getFullYear()}</span>
        <button type="button" className="qe-nav" onClick={() => nav(1)} aria-label="Next month">
          <CaretRight size={13} weight="bold" />
        </button>
      </div>
      <div className="qe-grid">
        {DOW.map((d, i) => <span key={`h${i}`} className="qe-dow">{d}</span>)}
        {grid.map((d) => {
          const k = keyOf(d);
          const inMonth = d.getMonth() === view.getMonth();
          const hits = quickHits(d).length;
          const cls = ['qe-day'];
          if (!inMonth) cls.push('qe-day-out');
          if (k === selected) cls.push('qe-day-sel');
          if (d.getTime() === today.getTime()) cls.push('qe-day-today');
          return (
            <button type="button" key={k} className={cls.join(' ')} onClick={() => { setSelected(k); if (!inMonth) setView(new Date(d.getFullYear(), d.getMonth(), 1)); }}>
              <span className="qe-day-num">{d.getDate()}</span>
              <span className="qe-marks">
                {hits > 0 && <span className="qe-dot" />}
                {feedDays.has(k) && <span className="qe-ring" />}
              </span>
            </button>
          );
        })}
      </div>
      <div className="qe-legend">
        <span><span className="qe-dot" /> quick event</span>
        <span><span className="qe-ring" /> from feed</span>
      </div>

      <div className="qe-daypanel">
        <div className="qe-daytitle">
          {selectedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          <span className="qe-daycount">{dayRows.length ? `${dayRows.length} quick` : ''}</span>
        </div>
        {dayRows.map(({ r, i }) => (
          <div key={i} className={`qe-row${editIdx === i ? ' qe-row-editing' : ''}`}>
            <span className="qe-row-time">{fmtTime(r.time)}</span>
            <span className="qe-row-title">{r.title}</span>
            {r.repeat && r.repeat !== 'none' && (
              <span className="qe-row-repeat"><ArrowClockwise size={10} weight="bold" /> {REPEAT_LABEL[r.repeat]}</span>
            )}
            <button type="button" className="qe-row-btn" onClick={() => startEdit({ r, i })} aria-label="Edit">
              <PencilSimple size={12} weight="bold" />
            </button>
            <button type="button" className="qe-row-btn" onClick={() => remove(i)} aria-label="Delete">
              <X size={12} weight="bold" />
            </button>
          </div>
        ))}
        <div className="qe-composer">
          <input
            type="text"
            value={title}
            placeholder="Pick up package…"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
          />
          <div className="qe-composer-row">
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} title="Empty = all day" />
            <select value={repeat} onChange={(e) => setRepeat(e.target.value)}>
              <option value="none">Once</option>
              <option value="daily">Daily</option>
              <option value="weekdays">Weekdays</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Every 2 wks</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
            {editIdx >= 0 && (
              <button type="button" className="btn" onClick={resetComposer}>Cancel</button>
            )}
            <button type="button" className="btn btn-primary" onClick={commit} disabled={!title.trim()}>
              {editIdx >= 0 ? 'Save' : 'Add'}
            </button>
          </div>
          <div className="wsm-field-help">
            Adds to the selected day. Empty time = all-day. Repeats expand like a real calendar.
          </div>
        </div>
      </div>
    </div>
  );
}
