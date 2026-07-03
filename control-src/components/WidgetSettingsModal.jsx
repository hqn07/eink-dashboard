import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from '@phosphor-icons/react';
import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';
import { GRID_COLS, GRID_ROWS, widgetById } from '../widgets.js';
import {
  renderWidget, typographyCss, cellClasses, scaleWrap
} from '../widget-render.js';
import { runAutofit } from '../autofit.js';
import WidgetForm from './WidgetForm.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';

const DASH_W = 800;
const DASH_H = 480;
const HEADER_H_BASE = 60;
const FOOTER_H_BASE = 28;
const BODY_H_BASE = DASH_H - HEADER_H_BASE - FOOTER_H_BASE;

// Hard ceiling so the preview can't blow past 3× on a giant monitor —
// the dither + autofit don't look great when extrapolated way past
// the device's actual pixel count.
const PREVIEW_MAX_SCALE = 3;

// Override toggle + form for per-instance widget data. When the user
// flips override ON for the first time, we snapshot the current global
// cfg.<widget> into draft.settings so they start from the same state
// they were already seeing — matches Q6b (snapshot semantics).
//
// Also surfaces a "Copy from →" picker listing every other tile in the
// layout that uses the same widget id, so users can clone a tile's
// settings into this one without re-typing.
function PerInstanceDataBlock({ widgetId, itemId, layout, settings, onSettingsChange, item, previewData, onHoverPreset }) {
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
          item={item}
          previewData={previewData}
          onHoverPreset={onHoverPreset}
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

  // Lock the page scroll while the modal is open so wheel / touch
  // gestures don't drift the editor underneath. Restore the prior
  // overflow value on unmount so we don't stomp on whatever the host
  // page had set.
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
    };
  }, [open]);

  // Dynamic preview sizing — measure the preview column with a
  // ResizeObserver and re-fit on every resize. Must be declared
  // BEFORE the open/draft early return so React sees the same hook
  // order on every render.
  //
  // Initial state is intentionally small (300x220) so the first paint
  // doesn't overshoot — the framer-motion entry animation means
  // ResizeObserver may not fire with the final size for ~150 ms, and
  // we'd rather under-scale briefly than render a clipped widget.
  const previewColRef = useRef(null);
  const [previewBox, setPreviewBox] = useState({ w: 300, h: 220 });
  // Actual-size preview: render at 1:1 device px (what the panel really
  // shows) instead of fit-to-column, so the user can judge real legibility.
  const [actualSize, setActualSize] = useState(false);
  // Hover-preview state: when a preset card is hovered/focused, it
  // broadcasts its values via PresetContext → the main preview merges
  // them on top of the draft so the user sees the preset's effect
  // before committing. null means "no hover", use draft as-is.
  const [hoveredPresetValues, setHoveredPresetValues] = useState(null);
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    let timers = [];
    const update = () => {
      const el = previewColRef.current;
      if (!el) return;
      // clientWidth/Height = content + padding, excluding border + scrollbar
      // — what we actually have for the preview frame. Subtract the
      // .wsm-col padding (20 22) + label gap (~32) so the scaled frame
      // doesn't push past the column edges.
      const w = Math.max(120, el.clientWidth  - 44);
      const h = Math.max(120, el.clientHeight - 72);
      setPreviewBox({ w, h });
    };
    // Re-measure: immediately, on next animation frame, and again after
    // framer-motion settles so the final column size is captured even
    // when the modal opens mid-animation.
    raf = requestAnimationFrame(update);
    timers.push(setTimeout(update, 200));
    timers.push(setTimeout(update, 500));
    const ro = new ResizeObserver(update);
    if (previewColRef.current) ro.observe(previewColRef.current);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [open]);

  // Preview cell — run the dashboard's autofit pass after the HTML
  // mounts so any `.autofit` text in the widget render gets the same
  // binary-search sizing the live dashboard applies. Without this,
  // the modal preview drifts vertically against the editor canvas
  // because flex distribution depends on the autofit-sized box.
  const previewCellRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const el = previewCellRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => runAutofit(el));
    return () => cancelAnimationFrame(raf);
  });

  if (!open || !draft) return null;
  const def = widgetById(draft.widgetId) || { label: draft.widgetId, id: draft.widgetId };

  function attemptClose() {
    if (dirty) setShowDiscardPrompt(true);
    else onCancel();
  }

  function setField(patch) {
    setDraft(prev => ({ ...prev, ...patch }));
  }

  // Preview renders the FULL 800×480 page DOM (same grid the live
  // dashboard uses) then translate+clip+scale to surface only the
  // draft cell. CSS grid `1fr` rounding is identical to live, so there
  // is no drift between modal preview and the on-device render.
  const data = previewData || {};
  const headerH = 0;
  const footerH = 0;
  const bodyH = DASH_H;

  const cellPxW = (draft.w / GRID_COLS) * DASH_W;
  const cellPxH = (draft.h / GRID_ROWS) * bodyH;
  const cellPxLeft = (draft.x / GRID_COLS) * DASH_W;
  const cellPxTop = headerH + (draft.y / GRID_ROWS) * bodyH;

  const fitScale = Math.min(
    PREVIEW_MAX_SCALE,
    previewBox.w / cellPxW,
    previewBox.h / cellPxH
  );
  const previewScale = actualSize ? 1 : Math.max(0.4, fitScale);
  const frameW = cellPxW * previewScale;
  const frameH = cellPxH * previewScale;

  // Effective settings drive the preview pass. When a preset card is
  // hovered, its values overlay the draft so the preview reflects what
  // applying the preset would produce — without actually mutating the
  // draft until the user clicks.
  const effectiveSettings = hoveredPresetValues
    ? { ...draft.settings, ...hoveredPresetValues }
    : draft.settings;
  const classes = ['cell', `cell-${draft.widgetId}`];
  if (draft.flush) classes.push('cell-flush');
  classes.push(...cellClasses(effectiveSettings));
  if (draft.x + draft.w >= GRID_COLS) classes.push('cell-edge-right');
  if (draft.y + draft.h >= GRID_ROWS) classes.push('cell-edge-bottom');
  const itemSlot = (previewData && previewData.perItem && previewData.perItem[draft.id]) || {};
  const previewInner = renderWidget(draft.widgetId, {
    ...data,
    ...itemSlot,
    cellW: draft.w,
    cellH: draft.h,
    density: draft.density,
    settings: effectiveSettings
  }) || '';
  const sw = scaleWrap(effectiveSettings);
  const previewHtml = `${sw.open}${previewInner}${sw.close}`;
  const typoStyle = typographyCss(effectiveSettings);
  const cellStyle =
    `grid-column:${draft.x + 1} / span ${draft.w};grid-row:${draft.y + 1} / span ${draft.h};${typoStyle}`;
  const cellHtml = `<div class="${classes.join(' ')}" style="${cellStyle}">${previewHtml}</div>`;

  const bodyGridCls = `body body-grid${(data && data.cardStyle === 'cards') ? ' body-cards' : ''}`;
  const pageHtml = `<div class="page" style="grid-template-rows:0px minmax(0,1fr) 0px;width:${DASH_W}px;height:${DASH_H}px"><div class="hdr-stub"></div><main class="${bodyGridCls}" style="grid-template-columns:repeat(${GRID_COLS},minmax(0,1fr));grid-template-rows:repeat(${GRID_ROWS},minmax(0,1fr))">${cellHtml}</main><div class="ftr-stub"></div></div>`;

  const density = draft.density || '';
  const previewLoading = !previewData;

  return (
    <AnimatePresence>
      <motion.div
        className="wsm-backdrop wsm-backdrop-sheet"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12 }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) attemptClose();
        }}
      >
        <motion.div
          className="wsm-panel wsm-panel-sheet"
          role="dialog"
          aria-modal="true"
          aria-label={`${def.label} settings`}
          initial={{ x: 32, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 32, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 34 }}
        >
          <div className="wsm-header">
            <div className="wsm-title">{def.label}</div>
            <button className="wsm-close" aria-label="Close" onClick={attemptClose}><X size={16} weight="bold" /></button>
          </div>

          <div className="wsm-body">
            <div className="wsm-col wsm-col-settings">
              <section className="wsm-section">
                <ErrorBoundary
                  resetKeys={[draft.widgetId, draft.id]}
                  fallback={(err, retry) => (
                    <div className="error-boundary-fallback">
                      <div className="eb-title">This widget’s settings couldn’t load</div>
                      <div className="eb-msg">{String(err.message || err)}</div>
                      <button type="button" className="eb-retry" onClick={retry}>Retry</button>
                    </div>
                  )}
                >
                  <PerInstanceDataBlock
                    widgetId={draft.widgetId}
                    itemId={draft.id}
                    layout={layout}
                    settings={draft.settings}
                    onSettingsChange={(next) => setDraft(prev => ({ ...prev, settings: next }))}
                    item={draft}
                    previewData={previewData}
                    onHoverPreset={setHoveredPresetValues}
                  />
                </ErrorBoundary>
              </section>
            </div>

            <div className="wsm-col wsm-col-preview" ref={previewColRef}>
              <div className="wsm-preview-label">
                <span>Preview · {Math.round(previewScale * 100)}% · {draft.w}×{draft.h} cells</span>
                <button
                  type="button"
                  className="wsm-preview-toggle"
                  onClick={() => setActualSize(a => !a)}
                  title="Toggle 1:1 device pixels vs fit-to-panel"
                >{actualSize ? 'Fit' : 'Actual size'}</button>
              </div>
              <div
                className="wsm-preview-frame"
                style={{
                  width: frameW, height: frameH, position: 'relative',
                  maxWidth: '100%',
                  overflow: actualSize ? 'auto' : 'hidden'
                }}
              >
                <div
                  ref={previewCellRef}
                  className="wsm-preview-scale"
                  style={{
                    width: DASH_W,
                    height: DASH_H,
                    transform: `scale(${previewScale}) translate(${-cellPxLeft}px, ${-cellPxTop}px)`,
                    transformOrigin: 'top left'
                  }}
                  dangerouslySetInnerHTML={{ __html: pageHtml }}
                />
                {previewLoading && (
                  <div className="wsm-preview-skeleton">
                    <SkeletonTheme baseColor="#1a1a1a" highlightColor="#3a3a3a" duration={1.1}>
                      <Skeleton
                        width={frameW}
                        height={frameH}
                        style={{ display: 'block', borderRadius: 0 }}
                      />
                    </SkeletonTheme>
                  </div>
                )}
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
