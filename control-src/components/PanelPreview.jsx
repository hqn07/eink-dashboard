import React, { useState } from 'react';

// Panel-accurate 3-color preview. The live canvas/preview shows red via
// CSS, which approximates but doesn't run the server's plane-split
// classifier. This opens the *actual* B/W/R composite the panel draws
// (server /display-3c.png), so the user sees true red placement —
// including anything the classifier catches or misses.
export default function PanelPreview() {
  const [open, setOpen] = useState(false);
  const [src, setSrc] = useState('');
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    setSrc(`/display-3c.png?t=${Date.now()}`); // cache-bust each open/refresh
  };
  const show = () => { setOpen(true); load(); };

  return (
    <>
      <button
        type="button"
        className="app-header-shortcut-btn"
        onClick={show}
        title="Preview the true 3-color (B/W/R) render the panel draws"
        style={{ width: 'auto', padding: '0 10px' }}
      >
        Panel view
      </button>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.55)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: 24
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#faf8f3', border: '2px solid #111', padding: 16,
              maxWidth: '90vw', boxShadow: '6px 6px 0 rgba(0,0,0,0.25)'
            }}
          >
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              fontFamily: 'ui-monospace, monospace', fontSize: 11, letterSpacing: 2,
              textTransform: 'uppercase', marginBottom: 10
            }}>
              <span>3-color panel render</span>
              <span style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={load} className="app-header-shortcut-btn"
                  style={{ width: 'auto', padding: '0 8px' }} title="Re-render">↻</button>
                <button type="button" onClick={() => setOpen(false)} className="app-header-shortcut-btn"
                  style={{ width: 'auto', padding: '0 8px' }}>✕</button>
              </span>
            </div>
            <div style={{
              width: 800, maxWidth: '86vw', aspectRatio: '800 / 480',
              border: '1px solid #ccc', background: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              {loading && <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#888' }}>Rendering…</span>}
              {src && (
                <img
                  src={src}
                  alt="3-color panel render"
                  style={{ width: '100%', height: '100%', objectFit: 'contain', display: loading ? 'none' : 'block' }}
                  onLoad={() => setLoading(false)}
                  onError={() => setLoading(false)}
                />
              )}
            </div>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, color: '#6b6960', marginTop: 8 }}>
              True classifier output — red = red plane, black = black plane. What the B panel actually paints.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
