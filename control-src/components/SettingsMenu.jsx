import React, { useEffect, useRef, useState } from 'react';
import { m, AnimatePresence } from 'framer-motion';
import {
  Gear, MagicWand, Keyboard, Archive, CaretRight, User, Plug, MoonStars, Sun,
} from '@phosphor-icons/react';
import PushNowButton from './PushNowButton.jsx';
import PanelPreview from './PanelPreview.jsx';
import PinButton from './PinButton.jsx';
import SetupPanel from './SetupPanel.jsx';
import ConnectionsPanel from './ConnectionsPanel.jsx';
import DeviceStatusCard from './DeviceStatusCard.jsx';
import BackupPanel from './BackupPanel.jsx';
import QuietHours from './QuietHours.jsx';
import { faceIsDark } from '../widget-render.js';
import { homeCoords } from '../home.js';

// Single header settings menu. Consolidates what used to be separate
// header controls — Setup wizard, Panel view, PIN/Lock,
// keyboard shortcuts, and Tools (shared facts + backup) — into one gear
// dropdown, grouped into labelled sections (Option A layout).
//
// Panel view + PIN keep their own modal/popover logic; they render their
// trigger as a full-width menu row here (block prop). "You & your place"
// (cfg.home) and Backup are heavy blocks, so they collapse behind
// expandable rows to keep the menu short.
export default function SettingsMenu({ cfg, onReplaceConfig, onSetup, onShortcuts, telemetry, refreshMinutes }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(null); // 'quiet' | 'home' | 'connections' | 'backup' | null
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

  // PANEL section. Both of these are properties of the device's face, not of
  // a screen, and both used to be somewhere else: polarity was a per-tile
  // setting you had to visit every tile to change, and quiet hours sat under
  // the schedule timeline, which is about screens.
  const dark = faceIsDark(cfg && cfg.faceTheme);
  const quiet = (cfg && cfg.quietHours) || {};
  const quietSummary = !quiet.enabled
    ? 'off'
    : quiet.mode === 'sun'
      ? 'follows the sun'
      : `${quiet.from || '00:00'}–${quiet.to || '00:00'}`;

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
          <m.div
            className="gdm-menu settings-menu"
            role="menu"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
          >
            <div className="settings-section-label">Device</div>
            {telemetry && (
              <DeviceStatusCard refreshMinutes={refreshMinutes} telemetry={telemetry} />
            )}
            <PushNowButton block />
            <button
              type="button"
              className="settings-row"
              onClick={() => { setOpen(false); onSetup && onSetup(); }}
            >
              <MagicWand size={14} weight="bold" /> Setup wizard
            </button>
            <PanelPreview block />

            <div className="settings-section-label">Panel</div>
            <button
              type="button"
              className="settings-row"
              aria-pressed={dark}
              title={dark
                ? 'Every tile is white-on-black — click for black-on-white'
                : 'Every tile is black-on-white — click for white-on-black'}
              onClick={() => onReplaceConfig({ ...cfg, faceTheme: dark ? 'light' : 'dark' })}
            >
              {dark ? <MoonStars size={14} weight="bold" /> : <Sun size={14} weight="bold" />}
              {' '}Colours
              <span className="settings-row-value">{dark ? 'white on black' : 'black on white'}</span>
            </button>
            <button
              type="button"
              className={`settings-row settings-row--expandable ${expanded === 'quiet' ? 'is-open' : ''}`}
              aria-expanded={expanded === 'quiet'}
              onClick={() => toggle('quiet')}
            >
              <MoonStars size={14} weight="bold" /> Quiet hours
              <span className="settings-row-value">{quietSummary}</span>
              <CaretRight className="settings-row-caret" size={12} weight="bold" />
            </button>
            {expanded === 'quiet' && (
              <div className="settings-collapse-body">
                <QuietHours
                  value={cfg.quietHours}
                  hasLocation={!!homeCoords(cfg)}
                  onChange={(next) => onReplaceConfig({ ...cfg, quietHours: next })}
                />
              </div>
            )}

            <div className="settings-section-label">Security</div>
            <PinButton block />

            <div className="settings-section-label">Tools</div>
            <button
              type="button"
              className={`settings-row settings-row--expandable ${expanded === 'home' ? 'is-open' : ''}`}
              aria-expanded={expanded === 'home'}
              onClick={() => toggle('home')}
            >
              <User size={14} weight="bold" /> You &amp; your place
              <CaretRight className="settings-row-caret" size={12} weight="bold" />
            </button>
            {expanded === 'home' && (
              <div className="settings-collapse-body">
                <SetupPanel cfg={cfg} onReplaceConfig={onReplaceConfig} />
              </div>
            )}
            <button
              type="button"
              className={`settings-row settings-row--expandable ${expanded === 'connections' ? 'is-open' : ''}`}
              aria-expanded={expanded === 'connections'}
              onClick={() => toggle('connections')}
            >
              <Plug size={14} weight="bold" /> Connections
              <CaretRight className="settings-row-caret" size={12} weight="bold" />
            </button>
            {expanded === 'connections' && (
              <div className="settings-collapse-body">
                <ConnectionsPanel cfg={cfg} onReplaceConfig={onReplaceConfig} />
              </div>
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

            <div className="settings-section-label">Help</div>
            <button
              type="button"
              className="settings-row"
              onClick={() => { setOpen(false); onShortcuts && onShortcuts(); }}
            >
              <Keyboard size={14} weight="bold" /> Keyboard shortcuts
            </button>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
