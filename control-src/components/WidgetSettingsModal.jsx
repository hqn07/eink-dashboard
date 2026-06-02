import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from '@phosphor-icons/react';
import { GRID_COLS, GRID_ROWS, widgetById } from '../widgets.js';
import { renderWidget, typographyCss, cellClasses } from '../widget-render.js';
import { fetchPreviewPng } from '../api.js';
import WidgetForm from './WidgetForm.jsx';

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

  // ---------- Preview hooks (must run on every render) ----------
  // Pre-existing hooks above use the `open` early-return below them,
  // but Rules of Hooks require the new preview hooks to run on every
  // render too. The `?.` chain plus `|| ''` defaults make these safe
  // when `draft` is null (modal closed).

  const settingsHash = useMemo(() => {
    if (!draft) return '';
    try { return JSON.stringify(draft.settings || {}); }
    catch { return ''; }
  }, [draft?.settings]);

  const iframeSrc = useMemo(() => {
    if (!draft || !draft.widgetId) return '';
    const qs = new URLSearchParams({
      widget: draft.widgetId,
      w: String(draft.w),
      h: String(draft.h)
    });
    if (settingsHash && settingsHash !== '{}') {
      qs.set('settings', btoa(unescape(encodeURIComponent(settingsHash))));
    }
    if (draft.density) qs.set('density', draft.density);
    try {
      const tok = localStorage.getItem('deviceToken') || '';
      if (tok) qs.set('token', tok);
    } catch (_) {}
    return `/preview/widget?${qs}`;
  }, [draft?.widgetId, draft?.w, draft?.h, settingsHash, draft?.density]);

  // 1-bit PNG preview — fetched on a 600ms idle debounce so a slider
  // drag doesn't queue 50 Puppeteer screenshots. Initial state: null
  // until the first render lands; the iframe shows live HTML in the
  // meantime so the user gets instant feedback.
  const [pngUrl, setPngUrl] = useState(null);
  const [pngLoading, setPngLoading] = useState(false);
  const [pngError, setPngError] = useState(false);
  useEffect(() => {
    if (!open || !draft || !draft.widgetId) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setPngLoading(true);
      setPngError(false);
      try {
        const blob = await fetchPreviewPng({
          widgetId: draft.widgetId,
          w: draft.w, h: draft.h,
          settings: draft.settings || {},
          density: draft.density
        });
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setPngUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
        setPngLoading(false);
      } catch (_) {
        if (!cancelled) { setPngError(true); setPngLoading(false); }
      }
    }, 600);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, draft?.widgetId, draft?.w, draft?.h, settingsHash, draft?.density]);

  useEffect(() => () => { if (pngUrl) URL.revokeObjectURL(pngUrl); }, [pngUrl]);

  if (!open || !draft) return null;
  const def = widgetById(draft.widgetId) || { label: draft.widgetId, id: draft.widgetId };

  function attemptClose() {
    if (dirty) setShowDiscardPrompt(true);
    else onCancel();
  }

  function setField(patch) {
    setDraft(prev => ({ ...prev, ...patch }));
  }

  // Preview dimensions — matches the dashboard's pixel grid so the
  // iframe + screenshot pipeline get the same canvas they would on
  // the live device.
  const dashW = draft.w * (DASH_W / GRID_COLS);
  const dashH = draft.h * (BODY_H_BASE / GRID_ROWS);

  const fitScale = Math.min(
    PREVIEW_MAX_SCALE,
    previewBox.w / dashW,
    previewBox.h / dashH
  );
  const previewScale = Math.max(0.4, fitScale);
  const frameW = dashW * previewScale;
  const frameH = dashH * previewScale;

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
                <PerInstanceDataBlock
                  widgetId={draft.widgetId}
                  itemId={draft.id}
                  layout={layout}
                  settings={draft.settings}
                  onSettingsChange={(next) => setDraft(prev => ({ ...prev, settings: next }))}
                />
              </section>
            </div>

            <div className="wsm-col wsm-col-preview" ref={previewColRef}>
              <div className="wsm-preview-label">
                Preview · {Math.round(previewScale * 100)}% · {draft.w}×{draft.h} cells
                {pngLoading && <span className="wsm-preview-spinner"> · rendering…</span>}
                {pngError && !pngLoading && <span className="wsm-preview-err"> · png render failed</span>}
              </div>
              <div
                className="wsm-preview-frame"
                style={{ width: frameW, height: frameH }}
              >
                {/*
                  Two-layer preview:
                  1. <iframe> with the SSR HTML — instant updates as
                     the user types, isolated DOM so autofit + font
                     metrics match the dashboard render exactly.
                  2. <img> with the Puppeteer/Sharp 1-bit PNG — swaps
                     in once the debounced render finishes so the
                     user sees the actual e-ink output. Falls back to
                     the iframe if the PNG render fails or hasn't
                     finished yet.
                */}
                {iframeSrc && (
                  <iframe
                    className="wsm-preview-iframe"
                    src={iframeSrc}
                    title="Widget HTML preview"
                    style={{ width: dashW, height: dashH, transform: `scale(${previewScale})` }}
                  />
                )}
                {pngUrl && (
                  <img
                    className="wsm-preview-png"
                    src={pngUrl}
                    alt=""
                    style={{ width: dashW * previewScale, height: dashH * previewScale }}
                  />
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
