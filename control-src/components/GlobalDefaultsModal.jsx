import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from '@phosphor-icons/react';
import { widgetById } from '../widgets.js';
import WidgetForm, { snapshotGlobalForWidget } from './WidgetForm.jsx';

// Each widget id reports either a nested cfg.<key> (the simple case
// where we write the whole settings blob under one key) or a custom
// commit function that knows how to splay the per-instance shape
// (e.g. `{ items: [...] }`) back across top-level cfg fields.
const COMMIT_RULES = {
  news:    { nested: 'news' },
  stocks:  { nested: 'stocks' },
  github:  { nested: 'github' },
  fx:      { nested: 'fx' },
  sports:  { nested: 'sports' },
  message: { nested: 'message' },
  wod:     { nested: 'wod' },
  photo:   { nested: 'photo' },
  quote:   { nested: 'quote' },
  spacer:  { nested: 'spacer' },
  link_qr: { nested: 'linkQr' },
  wifi_qr: { nested: 'wifi' },
  clock:   { custom: (s, patch, patchNested) => {
    const { timezone, ...rest } = s || {};
    patchNested('clock', rest);
    if (timezone) patch({ timezone });
  }},
  calendar: { custom: (s, _patch, patchNested) => {
    const urls = Array.isArray(s?.icalUrls) ? s.icalUrls.filter(Boolean) : [];
    patchNested('calendar', { icalUrls: urls, icalUrl: urls[0] || '' });
  }},
  todos:     { custom: (s, patch) => patch({ todos:      s?.items || [] }) },
  countdown: { custom: (s, patch) => patch({ countdowns: s?.items || [] }) },
  counter:   { custom: (s, patch) => patch({ counters:   s?.items || [] }) },
  habit:     { custom: (s, patch) => patch({ habits:     s?.items || [] }) },
  chore:     { custom: (s, patch) => patch({ chores:     s?.items || [] }) },
  weather_hero:     { custom: locCommit },
  weather_forecast: { custom: locCommit },
  aqi:              { custom: locCommit },
  moonsun:          { custom: locCommit }
};

// Shared writer for location-derived widgets — overrides the top-level
// cfg.lat/lon/city since weather/aqi all read from there.
function locCommit(s, patch) {
  const out = {};
  if (Number.isFinite(s?.lat) && Number.isFinite(s?.lon)) {
    out.lat = s.lat;
    out.lon = s.lon;
  } else if (s?.lat === null && s?.lon === null) {
    out.lat = null;
    out.lon = null;
  }
  if (typeof s?.city === 'string') out.city = s.city;
  if (Object.keys(out).length) patch(out);
}

// Modal for editing one widget's global defaults. Reuses the .wsm-*
// styles from WidgetSettingsModal so the look matches the per-instance
// modal. Save/Cancel semantics mirror the per-tile modal (Q11/Q17).
export default function GlobalDefaultsModal({ widgetId, cfg, onPatch, onPatchNested, onClose }) {
  const open = !!widgetId;
  const [draft, setDraft] = useState({});
  const initialRef = useRef({});
  const [showDiscardPrompt, setShowDiscardPrompt] = useState(false);

  useEffect(() => {
    if (open) {
      const initial = snapshotGlobalForWidget(widgetId, cfg);
      setDraft(initial);
      initialRef.current = initial;
      setShowDiscardPrompt(false);
    }
  }, [open, widgetId]);

  const dirty = useMemo(() => {
    return JSON.stringify(draft) !== JSON.stringify(initialRef.current);
  }, [draft]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        attemptClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, dirty]);

  if (!open) return null;
  const def = widgetById(widgetId) || { label: widgetId, id: widgetId };

  function attemptClose() {
    if (dirty) setShowDiscardPrompt(true);
    else onClose();
  }

  function commitSave() {
    const rule = COMMIT_RULES[widgetId];
    if (rule) {
      if (rule.nested) onPatchNested(rule.nested, draft);
      else if (rule.custom) rule.custom(draft, onPatch, onPatchNested);
    }
    onClose();
  }

  return (
    <AnimatePresence>
      <motion.div
        className="wsm-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12 }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) attemptClose();
        }}
      >
        <motion.div
          className="wsm-panel gdm-modal-panel"
          role="dialog"
          aria-modal="true"
          aria-label={`${def.label} global defaults`}
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 12, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        >
          <div className="wsm-header">
            <div className="wsm-title">
              <span className="gdm-modal-prefix">GLOBAL DEFAULT</span>
              {def.label}
            </div>
            <button className="wsm-close" aria-label="Close" onClick={attemptClose}><X size={16} weight="bold" /></button>
          </div>

          <div className="wsm-body wsm-body-single">
            <div className="wsm-col wsm-col-settings">
              <p className="wsm-note">
                Edits here apply to every tile that uses this widget and
                hasn't been overridden via its own per-tile settings.
              </p>
              <div className="wsm-form">
                <WidgetForm
                  widgetId={widgetId}
                  values={draft}
                  onChange={setDraft}
                />
              </div>
            </div>
          </div>

          <div className="wsm-footer">
            <div className="wsm-footer-spacer" />
            <button type="button" className="btn" onClick={attemptClose}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!dirty}
              onClick={commitSave}
            >Save</button>
          </div>

          {showDiscardPrompt && (
            <div className="wsm-discard">
              <div className="wsm-discard-panel">
                <div className="wsm-discard-msg">Discard unsaved changes?</div>
                <div className="wsm-discard-actions">
                  <button type="button" className="btn" onClick={() => setShowDiscardPrompt(false)}>
                    Keep editing
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => { setShowDiscardPrompt(false); onClose(); }}
                  >Discard</button>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
