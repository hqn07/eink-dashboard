import React, { useRef, useState, useEffect, useMemo } from 'react';
import { scheduleIntervals, parseHHMM } from '../widgets.js';

// 24-hour SVG timeline. Renders every screen's enabled schedule as a
// draggable block. Each block has:
//  - A center body the user can drag to translate the window.
//  - Left/right grippers that resize the from/to edges.
//  - An overlay band that highlights any minute interval where two
//    or more screens overlap.
//
// Times snap to 5-minute increments so tiny finger movements don't
// produce 07:13-style oddities. Wrap-midnight windows render as two
// rectangles connected by a thin dashed link.

const TOTAL_MIN = 1440;
const SNAP = 5;

function fmtHHMM(mins) {
  const m = ((mins % TOTAL_MIN) + TOTAL_MIN) % TOTAL_MIN;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function snap(mins) {
  return Math.round(mins / SNAP) * SNAP;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Convert a window's {from, to} HH:MM into one or two raw minute
// intervals (handles wrap). Each interval keeps original from/to for
// hit-testing back to the source window.
function intervalsForScreen(s) {
  const from = parseHHMM(s.schedule?.from);
  const to   = parseHHMM(s.schedule?.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return [];
  if (!s.schedule?.enabled) return [];
  if (from < to) return [{ a: from, b: to, wraps: false, first: true }];
  return [
    { a: from, b: TOTAL_MIN, wraps: true, first: true },
    { a: 0, b: to, wraps: true, first: false }
  ];
}

export default function ScheduleTimeline({
  screens,
  activeId,
  overlapIds,
  timezone,
  onUpdateSchedule,    // (screenId, { from?, to? })
  onSelect             // (screenId)
}) {
  const svgRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    if (!svgRef.current) return;
    const ro = new ResizeObserver(es => {
      for (const e of es) if (e.contentRect.width > 0) setWidth(e.contentRect.width);
    });
    ro.observe(svgRef.current);
    return () => ro.disconnect();
  }, []);

  // Live ticker for the "now" marker — repaint every 30s.
  const [nowMin, setNowMin] = useState(() => nowMinutesLocal(timezone));
  useEffect(() => {
    const id = setInterval(() => setNowMin(nowMinutesLocal(timezone)), 30000);
    return () => clearInterval(id);
  }, [timezone]);

  function nowMinutesLocal(tz) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit'
      }).formatToParts(new Date());
      let h = 0, m = 0;
      for (const p of parts) {
        if (p.type === 'hour') h = parseInt(p.value, 10) % 24;
        if (p.type === 'minute') m = parseInt(p.value, 10);
      }
      return h * 60 + m;
    } catch {
      const d = new Date();
      return d.getHours() * 60 + d.getMinutes();
    }
  }

  // Map pixel x → minutes in 0..1440.
  const pxToMin = (clientX) => {
    if (!svgRef.current) return 0;
    const r = svgRef.current.getBoundingClientRect();
    const ratio = clamp((clientX - r.left) / r.width, 0, 1);
    return snap(Math.round(ratio * TOTAL_MIN));
  };

  // Build a per-minute overlap map across all screens so we can
  // draw the red overlap band quickly.
  const overlapBand = useMemo(() => {
    const cover = new Uint8Array(TOTAL_MIN);
    const bands = [];
    for (const s of screens) {
      for (const it of intervalsForScreen(s)) {
        for (let m = it.a; m < it.b; m++) {
          if (cover[m] >= 1) bands.push(m); // already covered → overlap minute
          cover[m] = cover[m] + 1;
        }
      }
    }
    // Collapse contiguous overlap minutes into ranges
    const ranges = [];
    let start = null;
    for (let m = 0; m <= TOTAL_MIN; m++) {
      const isOverlap = m < TOTAL_MIN && bands.includes(m);
      if (isOverlap && start == null) start = m;
      if (!isOverlap && start != null) { ranges.push([start, m]); start = null; }
    }
    return ranges;
  }, [screens]);

  // Pointer event handlers.
  const onPointerDown = (e, screenId, edge) => {
    e.preventDefault();
    const s = screens.find(x => x.id === screenId);
    if (!s) return;
    const from = parseHHMM(s.schedule?.from);
    const to   = parseHHMM(s.schedule?.to);
    setDrag({
      screenId, edge,
      startX: e.clientX,
      startFrom: from,
      startTo: to,
      startMin: pxToMin(e.clientX)
    });
    if (e.currentTarget.setPointerCapture) {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    }
    if (onSelect) onSelect(screenId);
  };

  // Press on the empty track → paint a new schedule window for the selected
  // screen. Makes the timeline the primary way to schedule (no separate
  // toggle + time-entry needed first).
  const onTrackDown = (e) => {
    if (!activeId) return;
    e.preventDefault();
    const startMin = pxToMin(e.clientX);
    setDrag({ screenId: activeId, edge: 'create', startX: e.clientX, startMin, startFrom: startMin, startTo: startMin });
    if (e.currentTarget.setPointerCapture) {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    }
  };

  const onPointerMove = (e) => {
    if (!drag) return;
    const cur = pxToMin(e.clientX);
    const delta = cur - drag.startMin;
    if (drag.edge === 'from') {
      const next = ((drag.startFrom + delta) % TOTAL_MIN + TOTAL_MIN) % TOTAL_MIN;
      onUpdateSchedule(drag.screenId, { from: fmtHHMM(next) });
    } else if (drag.edge === 'to') {
      const next = ((drag.startTo + delta) % TOTAL_MIN + TOTAL_MIN) % TOTAL_MIN;
      onUpdateSchedule(drag.screenId, { to: fmtHHMM(next) });
    } else if (drag.edge === 'move') {
      const nf = ((drag.startFrom + delta) % TOTAL_MIN + TOTAL_MIN) % TOTAL_MIN;
      const nt = ((drag.startTo   + delta) % TOTAL_MIN + TOTAL_MIN) % TOTAL_MIN;
      onUpdateSchedule(drag.screenId, { from: fmtHHMM(nf), to: fmtHHMM(nt) });
    } else if (drag.edge === 'create') {
      // Paint a new window for the selected screen from the press point to
      // the cursor; onUpdateSchedule enables the screen's schedule.
      const from = Math.min(drag.startMin, cur);
      const to   = Math.max(drag.startMin, cur);
      if (to - from >= 10) onUpdateSchedule(drag.screenId, { from: fmtHHMM(from), to: fmtHHMM(to) });
    }
  };

  const onPointerUp = () => setDrag(null);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e) => onPointerMove(e);
    const onUp = () => onPointerUp();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag]);

  const H = 64;
  const TOP = 18;
  const BOT = TOP + 28;

  const HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

  return (
    <div className="timeline-wrap">
      <div className="timeline-title">
        <span className="timeline-help">Drag empty to schedule · drag block to move · edges resize</span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${H}`}
        width="100%"
        height={H}
        className="timeline-svg"
      >
        {/* baseline track — press-drag on empty space paints a new window */}
        <rect
          x="0" y={TOP} width={width} height={BOT - TOP}
          fill="#fff" stroke="#111" strokeWidth="2"
          className="tl-track"
          onPointerDown={onTrackDown}
        />

        {/* hour ticks */}
        {HOURS.map(h => {
          const x = (h * 60 / TOTAL_MIN) * width;
          return (
            <g key={h}>
              <line x1={x} y1={TOP - 4} x2={x} y2={TOP} stroke="#111" strokeWidth="1" />
              <text x={x} y={TOP - 6} fontSize="9" fontFamily="JetBrains Mono, monospace"
                    textAnchor="middle" fill="#6b6960">{String(h).padStart(2, '0')}</text>
            </g>
          );
        })}

        {/* screen blocks */}
        {screens.flatMap(s => {
          if (!s.schedule?.enabled) return [];
          const isActive = s.id === activeId;
          const isOverlap = overlapIds && overlapIds.has(s.id);
          return intervalsForScreen(s).map((it, idx) => {
            const x = (it.a / TOTAL_MIN) * width;
            const w = ((it.b - it.a) / TOTAL_MIN) * width;
            const fillCls = isOverlap ? 'block-overlap' : (isActive ? 'block-active' : 'block-norm');
            return (
              <g key={`${s.id}-${idx}`}>
                <rect
                  x={x} y={TOP + 1} width={w} height={BOT - TOP - 2}
                  className={`tl-block ${fillCls}`}
                  onPointerDown={(e) => it.first && onPointerDown(e, s.id, 'move')}
                  onClick={() => onSelect && onSelect(s.id)}
                />
                <text
                  x={x + w / 2} y={TOP + (BOT - TOP) / 2 + 4}
                  fontSize="11" fontFamily="Oswald, sans-serif" fontWeight="700"
                  fill={isOverlap || isActive ? '#fff' : '#111'}
                  textAnchor="middle"
                  pointerEvents="none"
                >{s.name}</text>
                {it.first && (
                  <rect
                    x={x - 6} y={TOP} width="12" height={BOT - TOP}
                    className="tl-handle"
                    onPointerDown={(e) => onPointerDown(e, s.id, 'from')}
                  />
                )}
                {!it.wraps || !it.first ? (
                  <rect
                    x={x + w - 6} y={TOP} width="12" height={BOT - TOP}
                    className="tl-handle"
                    onPointerDown={(e) => onPointerDown(e, s.id, 'to')}
                  />
                ) : null}
              </g>
            );
          });
        })}

        {/* overlap band on top */}
        {overlapBand.map(([a, b], i) => {
          const x = (a / TOTAL_MIN) * width;
          const w = ((b - a) / TOTAL_MIN) * width;
          return <rect key={i} x={x} y={TOP} width={w} height={BOT - TOP}
                       className="tl-overlap-band" pointerEvents="none" />;
        })}

        {/* now marker */}
        {Number.isFinite(nowMin) && (
          <g>
            <line
              x1={(nowMin / TOTAL_MIN) * width} y1={TOP - 2}
              x2={(nowMin / TOTAL_MIN) * width} y2={BOT + 2}
              stroke="#c8302a" strokeWidth="2"
            />
            <circle cx={(nowMin / TOTAL_MIN) * width} cy={TOP - 8} r="3" fill="#c8302a" />
          </g>
        )}
      </svg>
    </div>
  );
}
