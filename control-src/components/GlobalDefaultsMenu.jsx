import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { WIDGET_REGISTRY } from '../widgets.js';
import { supportsPerInstance } from './WidgetForm.jsx';
import GlobalDefaultsModal from './GlobalDefaultsModal.jsx';

// Widgets that have bespoke forms in WidgetForm.jsx. Anything else
// surfaces as a "→ jump to global settings panel" entry so the user can
// still edit it via the existing Settings.jsx section while we expand
// WidgetForm coverage in Stage 2.1.
function isInlineEditable(id) { return supportsPerInstance(id); }

export default function GlobalDefaultsMenu({ cfg, onPatchNested, onJumpToSettings }) {
  const [open, setOpen] = useState(false);
  const [modalWidgetId, setModalWidgetId] = useState(null);
  const ref = useRef(null);

  // Outside click + ESC close the dropdown.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function pick(widgetId) {
    setOpen(false);
    if (isInlineEditable(widgetId)) {
      setModalWidgetId(widgetId);
    } else if (onJumpToSettings) {
      onJumpToSettings(widgetId);
    }
  }

  return (
    <>
      <div className="gdm-wrap" ref={ref}>
        <button
          type="button"
          className={`btn gdm-trigger ${open ? 'gdm-trigger-open' : ''}`}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen(o => !o)}
        >
          ⚙ GLOBAL DEFAULTS {open ? '▴' : '▾'}
        </button>
        <AnimatePresence>
          {open && (
            <motion.div
              className="gdm-menu"
              role="menu"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
            >
              <div className="gdm-menu-header">Edit shared defaults</div>
              <ul className="gdm-list">
                {WIDGET_REGISTRY.map(def => (
                  <li key={def.id}>
                    <button
                      type="button"
                      role="menuitem"
                      className="gdm-item"
                      onClick={() => pick(def.id)}
                    >
                      <span className="gdm-item-label">{def.label}</span>
                      <span className="gdm-item-hint">
                        {isInlineEditable(def.id) ? 'EDIT' : 'OPEN PANEL ↓'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="gdm-menu-footer">
                Changes apply to every tile that hasn't overridden.
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <GlobalDefaultsModal
        widgetId={modalWidgetId}
        cfg={cfg}
        onPatchNested={onPatchNested}
        onClose={() => setModalWidgetId(null)}
      />
    </>
  );
}
