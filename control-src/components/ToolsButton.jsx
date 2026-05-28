import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wrench } from '@phosphor-icons/react';
import BackupPanel from './BackupPanel.jsx';
import AlarmsPanel from './AlarmsPanel.jsx';

// Small header button — replaces the heavier Global Defaults dropdown.
// Currently just hosts BackupPanel (export / import / reset). Cheap
// home for future cross-cutting tools (theme, debug toggles, etc.).
export default function ToolsButton({ cfg, onReplaceConfig }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="gdm-wrap" ref={ref}>
      <button
        type="button"
        className={`btn gdm-trigger ${open ? 'gdm-trigger-open' : ''}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(o => !o)}
      >
        <Wrench size={14} weight="bold" /> TOOLS
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
            style={{ width: 340 }}
          >
            <AlarmsPanel />
            <hr className="gdm-divider" />
            <BackupPanel cfg={cfg} onReplaceConfig={onReplaceConfig} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
