import React, { useEffect, useRef, useState } from 'react';

// Live preview: render the actual /dashboard HTML inside an iframe scaled
// to fit our preview frame. This way the time / weather data in the
// preview is always current, instead of showing whatever moment the
// last screenshot was taken at.
//
// The ESP32 still fetches /display.png — the iframe is only for the
// control panel's WYSIWYG view.
export default function Preview({ screen, cacheKey, onRefresh }) {
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

  // Reload the iframe when the parent asks for a refresh.
  const src = `/dashboard?screen=${screen}&_=${cacheKey}`;

  return (
    <>
      <div className="preview-frame" ref={wrapRef}>
        <iframe
          key={src}
          title="dashboard preview"
          src={src}
          style={{
            width: 800,
            height: 480,
            border: 0,
            transform: `scale(${scale})`,
            transformOrigin: 'top left'
          }}
        />
      </div>
      <div className="preview-meta">
        <span>LIVE PREVIEW · 800×480</span>
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
