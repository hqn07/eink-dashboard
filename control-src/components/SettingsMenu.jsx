import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Gear, MagicWand } from '@phosphor-icons/react';
import MacAgentBadge from './MacAgentBadge.jsx';
import PanelPreview from './PanelPreview.jsx';
import PinButton from './PinButton.jsx';
import AlarmsPanel from './AlarmsPanel.jsx';
import BackupPanel from './BackupPanel.jsx';

// Single header settings menu. Consolidates what used to be five separate
// header controls — Mac-agent status, Setup wizard, Panel view, PIN/Lock,
// and Tools (alarms + backup) — into one gear dropdown.
//
// Panel view + PIN keep their own modal/popover logic; they just render
// their trigger as a full-width menu row here (block prop).
export default function SettingsMenu({ cfg, onReplaceConfig, onSetup }) {
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
        <Gear size={14} weight="bold" /> SETTINGS
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
            <div className="settings-status-row">
              <MacAgentBadge />
            </div>
            <hr className="gdm-divider" />

            <button
              type="button"
              className="settings-row"
              onClick={() => { setOpen(false); onSetup && onSetup(); }}
            >
              <MagicWand size={14} weight="bold" /> Setup
            </button>
            <PanelPreview block />
            <PinButton block />

            <hr className="gdm-divider" />
            <AlarmsPanel />
            <hr className="gdm-divider" />
            <BackupPanel cfg={cfg} onReplaceConfig={onReplaceConfig} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
