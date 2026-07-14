import React, { useState, useEffect, useRef } from 'react';
import { TOKEN_META } from '../widgets/_token_meta';
import { useLiveTokenValue } from './TokenInput.jsx';

export function TokenPicker({ onInsert, title = 'Insert token' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const liveValue = useLiveTokenValue();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (tok) => { onInsert(tok); setOpen(false); };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title={title}
        style={{
          fontFamily: 'monospace',
          fontSize: 11,
          padding: '4px 8px',
          background: '#f4f4f4',
          border: '1px solid #ccc',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        {'{{ }}'}
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 50,
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
            padding: 4,
            minWidth: 260,
            maxHeight: 320,
            overflowY: 'auto',
          }}
        >
          {TOKEN_META.map(t => (
            <div key={t.name} style={{ borderBottom: '1px solid #eee', paddingBottom: 4, marginBottom: 4 }}>
              <button
                type="button"
                onClick={() => pick(`{{${t.name}}}`)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '4px 6px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                <code style={{ color: '#06f' }}>{`{{${t.name}}}`}</code>
                <span style={{ float: 'right', color: '#767676', fontSize: 11 }}>{liveValue(`{{${t.name}}}`, t.example)}</span>
              </button>
              {t.formats.map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => pick(`{{${t.name}|${f}}}`)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '2px 6px 2px 20px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 11,
                    color: '#555',
                  }}
                >
                  <code>{`{{${t.name}|${f}}}`}</code>
                  <span style={{ float: 'right', color: '#999', fontSize: 10 }}>{liveValue(`{{${t.name}|${f}}}`, '')}</span>
                </button>
              ))}
            </div>
          ))}
          <div style={{ padding: '6px 8px', fontSize: 10, color: '#767676', lineHeight: 1.4 }}>
            Missing data shows <code>—</code>.<br />
            Override per-spot: <code>{'{{temp|default:N/A}}'}</code>
          </div>
        </div>
      )}
    </div>
  );
}
