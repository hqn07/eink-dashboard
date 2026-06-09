import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from '@phosphor-icons/react';

// Help modal listing every global keyboard shortcut. Opened by
// pressing "?" (handled by App.jsx). Esc / click outside closes.
//
// Each row is { keys: [string], desc: string } where `keys` is an
// array of human-readable key names rendered as <kbd> chips.
const SHORTCUTS = [
  { keys: ['?'],             desc: 'Show this shortcuts overlay' },
  { keys: ['⌘', 'S'],        desc: 'Save & push current changes' },
  { keys: ['⌘', 'Z'],        desc: 'Undo last action' },
  { keys: ['['],             desc: 'Previous screen tab' },
  { keys: [']'],             desc: 'Next screen tab' },
  { keys: ['G'],             desc: 'Toggle grid overlay on canvas' },
  { keys: ['Esc'],           desc: 'Close any open modal' }
];

export default function ShortcutsHelp({ open, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="wizard-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="shortcuts-modal"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shortcuts-header">
              <h2>Keyboard shortcuts</h2>
              <button className="wsm-close" onClick={onClose} aria-label="Close">
                <X size={16} weight="bold" />
              </button>
            </div>
            <div className="shortcuts-grid">
              {SHORTCUTS.map(({ keys, desc }) => (
                <div className="shortcuts-row" key={desc}>
                  <div className="shortcuts-keys">
                    {keys.map((k, i) => (
                      <React.Fragment key={i}>
                        <kbd>{k}</kbd>
                        {i < keys.length - 1 && <span className="shortcuts-plus">+</span>}
                      </React.Fragment>
                    ))}
                  </div>
                  <div className="shortcuts-desc">{desc}</div>
                </div>
              ))}
            </div>
            <div className="shortcuts-footer terminal-line">
              &gt; SHORTCUTS IGNORED WHILE TYPING IN A TEXT FIELD
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
