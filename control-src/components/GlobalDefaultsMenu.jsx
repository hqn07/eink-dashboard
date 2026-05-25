import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Gear, CaretDown, CaretUp } from '@phosphor-icons/react';
import { WIDGET_REGISTRY } from '../widgets.js';
import { supportsPerInstance } from './WidgetForm.jsx';
import GlobalDefaultsModal from './GlobalDefaultsModal.jsx';
import BackupPanel from './BackupPanel.jsx';

export default function GlobalDefaultsMenu({ cfg, onPatch, onPatchNested, onReplaceConfig }) {
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
    if (!supportsPerInstance(widgetId)) return; // disabled — no settings
    setOpen(false);
    setModalWidgetId(widgetId);
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
          <Gear size={14} weight="bold" /> GLOBAL DEFAULTS {open ? <CaretUp size={12} weight="bold" /> : <CaretDown size={12} weight="bold" />}
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
                {WIDGET_REGISTRY.map(def => {
                  const enabled = supportsPerInstance(def.id);
                  return (
                    <li key={def.id}>
                      <button
                        type="button"
                        role="menuitem"
                        className={`gdm-item ${enabled ? '' : 'gdm-item-disabled'}`}
                        disabled={!enabled}
                        onClick={() => pick(def.id)}
                      >
                        <span className="gdm-item-label">{def.label}</span>
                        <span className="gdm-item-hint">
                          {enabled ? 'EDIT' : 'NO SETTINGS'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <BackupPanel cfg={cfg} onReplaceConfig={onReplaceConfig} />
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
        onPatch={onPatch}
        onPatchNested={onPatchNested}
        onClose={() => setModalWidgetId(null)}
      />
    </>
  );
}
