import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from '@phosphor-icons/react';
import { GRID_COLS, GRID_ROWS, widgetById } from '../widgets.js';
import { renderWidget } from '../widget-render.js';
import WidgetForm from './WidgetForm.jsx';

const DASH_W = 800;
const DASH_H = 480;
const HEADER_H_BASE = 60;
const FOOTER_H_BASE = 28;
const BODY_H_BASE = DASH_H - HEADER_H_BASE - FOOTER_H_BASE;

const PREVIEW_SCALE = 2;
const PREVIEW_MAX_W = 720;
const PREVIEW_MAX_H = 560;

// Override toggle + form for per-instance widget data. When the user
// flips override ON for the first time, we snapshot the current global
// cfg.<widget> into draft.settings so they start from the same state
// they were already seeing — matches Q6b (snapshot semantics).
//
// Also surfaces a "Copy from →" picker listing every other tile in the
// layout that uses the same widget id, so users can clone a tile's
// settings into this one without re-typing.
function PerInstanceDataBlock({ widgetId, itemId, layout, settings, onSettingsChange }) {
  // Other tiles of the same widget type whose settings we can clone in
  // one click — saves re-typing a stock list / iCal URL / location.
  const siblings = (layout || []).filter(it =>
    it.id !== itemId
    && (it.widgetId || it.id) === widgetId
    && it.settings
  );

  // Every tile carries its own settings (seeded from registry defaults
  // at creation). Fall back to {} just in case a tile created before
  // the new contract is still in the layout.
  const effective = settings || {};
  return (
    <>
      {siblings.length > 0 && (
        <div className="wsm-copy-row">
          <span className="wsm-field-label">Copy from</span>
          <select
            defaultValue=""
            onChange={(e) => {
              const src = siblings.find(s => s.id === e.target.value);
              if (src && src.settings) onSettingsChange({ ...src.settings });
              e.target.value = '';
            }}
          >
            <option value="" disabled>Pick a tile…</option>
            {siblings.map((s, i) => (
              <option key={s.id} value={s.id}>
                {`${widgetId} #${i + 1} (${s.x},${s.y})`}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="wsm-form">
        <WidgetForm
          widgetId={widgetId}
          values={effective}
          onChange={onSettingsChange}
        />
      </div>
    </>
  );
}

function shallowEq(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}

// Stage 1 modal: layout knobs (flush / border / density) + a link
// pointing at the existing global Settings.jsx section for widget
// data. Stage 2 will replace that link with real per-instance fields.
export default function WidgetSettingsModal({
  open,
  item,
  layout,
  cfg,
  previewData,
  onCancel,
  onSave
}) {
  // Snapshot of `item` taken when the modal opened. Cancel restores this.
  // Save commits the working draft to onSave().
  const [draft, setDraft] = useState(item || null);
  const initialRef = useRef(null);
  const [showDiscardPrompt, setShowDiscardPrompt] = useState(false);

  useEffect(() => {
    if (open && item) {
      setDraft(item);
      initialRef.current = item;
      setShowDiscardPrompt(false);
    }
  }, [open, item && item.id]);

  // Compare each tracked field individually so unrelated grid changes
  // (x/y/w/h from a concurrent drag) don't show as dirty here.
  const dirty = useMemo(() => {
    if (!draft || !initialRef.current) return false;
    const a = initialRef.current, b = draft;
    if ((a.flush || false) !== (b.flush || false)) return true;
    if ((a.density || '') !== (b.density || '')) return true;
    // Settings comparison: stringify for deep equality. Cheap because
    // settings objects are flat and small.
    const aSet = a.settings ? JSON.stringify(a.settings) : '';
    const bSet = b.settings ? JSON.stringify(b.settings) : '';
    if (aSet !== bSet) return true;
    return false;
  }, [draft]);

  // ESC dismisses. With unsaved edits → prompt; clean → close.
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

  if (!open || !draft) return null;
  const def = widgetById(draft.widgetId) || { label: draft.widgetId, id: draft.widgetId };

  function attemptClose() {
    if (dirty) setShowDiscardPrompt(true);
    else onCancel();
  }

  function setField(patch) {
    setDraft(prev => ({ ...prev, ...patch }));
  }

  // Live preview matches EditorGrid's render path: same cellW/cellH
  // dimensions on the dashboard's pixel grid, then scaled up.
  const dashW = draft.w * (DASH_W / GRID_COLS);
  const dashH = draft.h * (BODY_H_BASE / GRID_ROWS);
  // Fit-to-modal: shrink the 2× target if it would overflow the
  // preview frame (small laptops, mobile).
  const fitScale = Math.min(
    PREVIEW_SCALE,
    PREVIEW_MAX_W / dashW,
    PREVIEW_MAX_H / dashH
  );
  const previewScale = Math.max(0.5, fitScale);
  const frameW = dashW * previewScale;
  const frameH = dashH * previewScale;

  const classes = ['cell', `cell-${draft.widgetId}`];
  if (draft.flush) classes.push('cell-flush');
  // EditorGrid merges per-item data (perItem[item.id]) into the render
  // context so each tile sees its own fetched payload — without this,
  // mac_nowplaying / mac_battery / clock / per-tile weather all collapse
  // to the "no data" placeholder in the modal preview even though they
  // render fine on the dashboard.
  const itemSlot = (previewData && previewData.perItem && previewData.perItem[draft.id]) || {};
  const previewHtml = renderWidget(draft.widgetId, {
    ...previewData,
    ...itemSlot,
    cellW: draft.w,
    cellH: draft.h,
    density: draft.density,
    settings: draft.settings
  }) || '';
  const cellHtml =
    `<div class="${classes.join(' ')}" style="width:${dashW}px;height:${dashH}px">${previewHtml}</div>`;

  const density = draft.density || '';

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
          className="wsm-panel"
          role="dialog"
          aria-modal="true"
          aria-label={`${def.label} settings`}
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 12, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        >
          <div className="wsm-header">
            <div className="wsm-title">{def.label}</div>
            <button className="wsm-close" aria-label="Close" onClick={attemptClose}><X size={16} weight="bold" /></button>
          </div>

          <div className="wsm-body">
            <div className="wsm-col wsm-col-settings">
              <section className="wsm-section">
                <h3 className="wsm-section-title">Layout</h3>

                <label className="wsm-row wsm-row-check">
                  <input
                    type="checkbox"
                    checked={!!draft.flush}
                    onChange={(e) => setField({ flush: e.target.checked })}
                  />
                  <span>Flush edges (no inner padding)</span>
                </label>

                <div className="wsm-row">
                  <div className="wsm-label">Density</div>
                  <div className="wsm-seg" role="radiogroup" aria-label="Content density">
                    {[
                      { v: '',       label: 'Balanced' },
                      { v: 'rich',   label: 'Rich' },
                      { v: 'sparse', label: 'Sparse' }
                    ].map(opt => (
                      <button
                        key={opt.v || 'balanced'}
                        type="button"
                        role="radio"
                        aria-checked={density === opt.v}
                        className={`wsm-seg-btn ${density === opt.v ? 'on' : ''}`}
                        onClick={() => setField({ density: opt.v || undefined })}
                      >{opt.label}</button>
                    ))}
                  </div>
                </div>
              </section>

              <section className="wsm-section">
                <h3 className="wsm-section-title">Widget data</h3>
                <PerInstanceDataBlock
                  widgetId={draft.widgetId}
                  itemId={draft.id}
                  layout={layout}
                  settings={draft.settings}
                  onSettingsChange={(next) => setDraft(prev => ({ ...prev, settings: next }))}
                />
              </section>
            </div>

            <div className="wsm-col wsm-col-preview">
              <div className="wsm-preview-label">
                Preview · {Math.round(previewScale * 100)}% · {draft.w}×{draft.h} cells
              </div>
              <div
                className="wsm-preview-frame"
                style={{ width: frameW, height: frameH }}
              >
                <div
                  className="wsm-preview-scale"
                  style={{
                    transform: `scale(${previewScale})`,
                    transformOrigin: 'top left'
                  }}
                  dangerouslySetInnerHTML={{ __html: cellHtml }}
                />
              </div>
            </div>
          </div>

          <div className="wsm-footer">
            <div className="wsm-footer-spacer" />
            <button
              type="button"
              className="btn"
              onClick={attemptClose}
            >Cancel</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!dirty}
              onClick={() => onSave(draft)}
            >Save</button>
          </div>

          {showDiscardPrompt && (
            <div className="wsm-discard">
              <div className="wsm-discard-panel">
                <div className="wsm-discard-msg">Discard unsaved changes?</div>
                <div className="wsm-discard-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setShowDiscardPrompt(false)}
                  >Keep editing</button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => { setShowDiscardPrompt(false); onCancel(); }}
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
