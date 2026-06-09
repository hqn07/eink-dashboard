import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowCounterClockwise, FloppyDisk } from '@phosphor-icons/react';

// Sticky bottom save bar — Figma + Notion DB idiom: stays hidden when
// the page is clean, slides up when dirty so the user can act from
// any scroll position. Shows the dirty summary, Discard (if there's
// an undo target), and Save.
//
// Props:
//   status    — 'dirty' | 'saving' | 'saved' | 'synced' | 'syncing' | 'error'
//   label     — text shown on the left when visible (caller computes,
//               e.g. "3 SCREEN EDITS · 1 ALARM CHANGE")
//   onSave    — called when the user clicks Save
//   onDiscard — optional; renders the Discard button when provided
//   disabled  — disables Save (used when validation fails)
//
// Visibility: only renders when status is dirty / saving / error, OR
// the brief moment status is 'saved' (the success toast handles the
// rest). 'synced' / 'syncing' hide the bar — those are quiet states.
const VISIBLE_STATES = new Set(['dirty', 'saving', 'error', 'saved']);

export default function SaveBar({ status, label, onSave, onDiscard, disabled }) {
  const visible = VISIBLE_STATES.has(status);
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="save-bar"
          className={`save-bar save-bar-${status}`}
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        >
          <span className="save-bar-status">{label}</span>
          <div className="save-bar-actions">
            {onDiscard && status === 'dirty' && (
              <button
                type="button"
                className="save-bar-btn save-bar-btn-ghost"
                onClick={onDiscard}
                title="Revert to the last saved state"
              >
                <ArrowCounterClockwise size={12} weight="bold" /> DISCARD
              </button>
            )}
            <button
              type="button"
              className="save-bar-btn save-bar-btn-primary"
              onClick={onSave}
              disabled={disabled || status === 'saving' || status === 'saved'}
            >
              <FloppyDisk size={12} weight="bold" /> {status === 'saving' ? 'SAVING…' : status === 'saved' ? 'SAVED' : 'SAVE & PUSH'}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
