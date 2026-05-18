import React, { useEffect, useRef, useState } from 'react';
import LiveDashboard from './LiveDashboard.jsx';

// Live preview: renders the dashboard directly as React (no iframe). The
// 800×480 canvas sits inside a responsive frame and is visually scaled
// via CSS transform to fit the parent's width while preserving aspect.
//
// Because this is rendered with the same widget-render mirror the editor
// uses, the preview reflects unsaved cfg changes instantly — no Puppeteer
// round-trip, no iframe reload.
export default function Preview({ data, cacheKey, onRefresh }) {
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const w = e.contentRect.width;
        if (w > 0) setScale(w / 800);
      }
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <>
      <div className="preview-frame" ref={wrapRef}>
        <div
          className="preview-canvas"
          style={{
            width: 800,
            height: 480,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            position: 'absolute',
            top: 0,
            left: 0
          }}
          key={cacheKey}
        >
          <LiveDashboard data={data} />
        </div>
      </div>
      <div className="preview-meta">
        <span>LIVE PREVIEW · 800×480 · REACT</span>
        <button
          className="btn"
          onClick={onRefresh}
          style={{ fontSize: 10, padding: '4px 10px' }}
        >
          ↻ REFRESH
        </button>
      </div>
    </>
  );
}
