// "Beam to display" — header button + composer modal. Sends a message
// that takes over the panel for N minutes (server opens the fast-wake
// window so the device shows it on its next wake).
import React, { useState } from 'react';
import { m, AnimatePresence } from 'framer-motion';
import { PaperPlaneTilt, X } from '@phosphor-icons/react';
import { sendBeam, clearBeam } from '../api.js';

export default function BeamComposer() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [minutes, setMinutes] = useState(15);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setNote('');
    try {
      const r = await sendBeam(text.trim(), minutes);
      const worst = r && Number.isFinite(r.maxLatencyMinutes) ? r.maxLatencyMinutes : null;
      setNote(worst ? `Sent — on the panel within ~${worst} min.` : 'Sent.');
      setText('');
    } catch (e) {
      setNote(`Failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await clearBeam();
      setNote('Cleared — panel returns to the dashboard on next wake.');
    } catch (e) {
      setNote(`Failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn beam-btn"
        onClick={() => { setNote(''); setOpen(true); }}
        title="Send a message to the display"
      >
        <PaperPlaneTilt size={14} weight="bold" />
        <span className="beam-btn-label">Beam</span>
      </button>
      <AnimatePresence>
        {open && (
          <m.div
            className="wizard-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <m.div
              className="shortcuts-modal beam-modal"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 8, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="shortcuts-header">
                <h2>Beam to display</h2>
                <button className="wsm-close" onClick={() => setOpen(false)} aria-label="Close">
                  <X size={16} weight="bold" />
                </button>
              </div>
              <div className="beam-body">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={4}
                  maxLength={500}
                  placeholder="Dinner at 7 — don't be late"
                  autoFocus
                />
                <label className="beam-minutes">
                  Show for
                  <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                    <option value={5}>5 min</option>
                    <option value={15}>15 min</option>
                    <option value={30}>30 min</option>
                    <option value={60}>1 hour</option>
                    <option value={240}>4 hours</option>
                  </select>
                </label>
                <div className="beam-actions">
                  <button type="button" className="btn" onClick={clear} disabled={busy}>
                    Clear current
                  </button>
                  <button type="button" className="btn btn-primary" onClick={send} disabled={busy || !text.trim()}>
                    {busy ? 'Sending…' : 'Send to panel'}
                  </button>
                </div>
                {note && <div className="beam-note">{note}</div>}
                <div className="beam-hint">
                  Takes over the whole panel until it expires. The display shows it on its
                  next wake, then refreshes fast while the message is live.
                </div>
              </div>
            </m.div>
          </m.div>
        )}
      </AnimatePresence>
    </>
  );
}
