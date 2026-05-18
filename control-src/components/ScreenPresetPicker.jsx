import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { SCREEN_PRESETS, inflatePresetLayout } from '../widgets.js';
import LiveDashboard from './LiveDashboard.jsx';

// Each thumbnail measures its container and scales the LiveDashboard
// canvas down to fit. 800×480 source, container varies.
function PresetThumb({ preset, previewData }) {
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(0.25);
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
  const layout = inflatePresetLayout(preset);
  const thumbData = { ...(previewData || {}), layout };
  return (
    <div className="preset-thumb" ref={wrapRef}>
      <div
        className="preset-thumb-scale"
        style={{
          width: 800,
          height: 480,
          transform: `scale(${scale})`,
          transformOrigin: 'top left'
        }}
      >
        <LiveDashboard data={thumbData} />
      </div>
    </div>
  );
}

// Modal that shows the curated SCREEN_PRESETS as scaled-down preview
// thumbnails. User clicks one → onPick(preset) → caller creates the new
// screen with that layout.
export default function ScreenPresetPicker({ onPick, onClose, previewData }) {
  // Esc closes.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <motion.div
      className="wizard-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="wizard-modal preset-modal"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>NEW SCREEN</h2>
          <div className="terminal-line">&gt; PICK A STARTING LAYOUT · YOU CAN EDIT EVERYTHING AFTER</div>
        </header>

        <div className="preset-grid">
          {SCREEN_PRESETS.map(p => (
            <button
              key={p.id}
              className="preset-card"
              onClick={() => onPick(p)}
            >
              <PresetThumb preset={p} previewData={previewData} />
              <div className="preset-meta">
                <div className="preset-name">{p.name}</div>
                <div className="preset-desc">{p.description}</div>
              </div>
            </button>
          ))}
        </div>

        <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onClose}>CANCEL</button>
        </div>
      </motion.div>
    </motion.div>
  );
}
