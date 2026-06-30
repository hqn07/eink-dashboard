import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Gear, MagicWand, Keyboard, Broadcast, Bell, Archive, CaretRight,
} from '@phosphor-icons/react';
import MacAgentBadge from './MacAgentBadge.jsx';
import PanelPreview from './PanelPreview.jsx';
import PinButton from './PinButton.jsx';
import AlarmsPanel from './AlarmsPanel.jsx';
import BackupPanel from './BackupPanel.jsx';

// Single header settings menu. Consolidates what used to be separate
// header controls — Mac-agent status, Setup wizard, Panel view, PIN/Lock,
// keyboard shortcuts, and Tools (alarms + backup) — into one gear
// dropdown, grouped into labelled sections (Option A layout).
//
// Panel view + PIN keep their own modal/popover logic; they render their
// trigger as a full-width menu row here (block prop). Alarms + Backup are
// heavy blocks, so they collapse behind expandable rows to keep the menu
// short.
export default function SettingsMenu({ cfg, onReplaceConfig, onSetup, onShortcuts }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(null); // 'alarms' | 'backup' | null
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

  const toggle = (key) => setExpanded((cur) => (cur === key ? null : key));

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
            className="gdm-menu settings-menu"
            role="menu"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
          >
            <div className="settings-section-label">Status</div>
            <div className="settings-status-row">
              <Broadcast size={14} weight="bold" />
              <MacAgentBadge />
            </div>

            <div className="settings-section-label">Device</div>
            <button
              type="button"
              className="settings-row"
              onClick={() => { setOpen(false); onSetup && onSetup(); }}
            >
              <MagicWand size={14} weight="bold" /> Setup
            </button>
            <PanelPreview block />

            <div className="settings-section-label">Security</div>
            <PinButton block />
            <button
              type="button"
              className="settings-row"
              onClick={() => { setOpen(false); onShortcuts && onShortcuts(); }}
            >
              <Keyboard size={14} weight="bold" /> Keyboard shortcuts
            </button>

            <div className="settings-section-label">Tools</div>
            <button
              type="button"
              className={`settings-row settings-row--expandable ${expanded === 'alarms' ? 'is-open' : ''}`}
              aria-expanded={expanded === 'alarms'}
              onClick={() => toggle('alarms')}
            >
              <Bell size={14} weight="bold" /> Alarms
              <CaretRight className="settings-row-caret" size={12} weight="bold" />
            </button>
            {expanded === 'alarms' && (
              <div className="settings-collapse-body"><AlarmsPanel /></div>
            )}
            <button
              type="button"
              className={`settings-row settings-row--expandable ${expanded === 'backup' ? 'is-open' : ''}`}
              aria-expanded={expanded === 'backup'}
              onClick={() => toggle('backup')}
            >
              <Archive size={14} weight="bold" /> Backup &amp; reset
              <CaretRight className="settings-row-caret" size={12} weight="bold" />
            </button>
            {expanded === 'backup' && (
              <div className="settings-collapse-body">
                <BackupPanel cfg={cfg} onReplaceConfig={onReplaceConfig} />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
