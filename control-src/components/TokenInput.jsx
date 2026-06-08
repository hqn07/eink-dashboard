import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TOKEN_META } from '../widgets/_token_meta';

// Text input with inline {{token}} autocomplete. As soon as the user
// types `{{` followed by any letters the menu surfaces below the
// input, filtered case-insensitive on token names. Arrow keys move
// the highlight, Enter / Tab accepts, Escape dismisses without
// changing the text.
//
// Tab also accepts the highlight, mirroring VS Code / Notion's
// behaviour; this is convenient when the user is already typing and
// doesn't want to switch to the arrow keys.
export default function TokenInput({ value, onChange, placeholder, help, label }) {
  const inputRef = useRef(null);
  const wrapRef = useRef(null);
  const [highlight, setHighlight] = useState(0);
  const [trigger, setTrigger] = useState(null); // {start, query} when active

  // Re-evaluate whether the cursor sits inside an open `{{...` trigger
  // on every keystroke / caret move. Trigger lives from the last `{{`
  // to the cursor position, terminated by `}}`, `|`, or whitespace.
  function recomputeTrigger() {
    const el = inputRef.current;
    if (!el) { setTrigger(null); return; }
    const v = el.value || '';
    const caret = el.selectionStart || 0;
    const head = v.slice(0, caret);
    const start = head.lastIndexOf('{{');
    if (start < 0) { setTrigger(null); return; }
    // If anything between `{{` and the caret closes the trigger,
    // we're not in an open one. `}` `|` and whitespace all end it.
    const between = head.slice(start + 2);
    if (/[}\s|]/.test(between)) { setTrigger(null); return; }
    setTrigger({ start, query: between });
    setHighlight(0);
  }

  function onKey(e) {
    if (!trigger) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(matches.length - 1, h + 1)); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlight(h => Math.max(0, h - 1));                  return; }
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (matches[highlight]) { e.preventDefault(); accept(matches[highlight]); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); setTrigger(null); return; }
  }

  function accept(tokenMeta) {
    const el = inputRef.current;
    if (!el || !trigger) return;
    const v = el.value || '';
    // Replace `{{<query>` with `{{token}}` and place caret after the
    // inserted close-brace.
    const head = v.slice(0, trigger.start);
    const tailFrom = (el.selectionStart || trigger.start + 2 + trigger.query.length);
    const tail = v.slice(tailFrom);
    const insert = `{{${tokenMeta.name}}}`;
    const next = head + insert + tail;
    const caret = (head + insert).length;
    onChange(next);
    setTrigger(null);
    // Restore caret in the next tick once React has re-rendered.
    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      inputRef.current.focus();
      inputRef.current.setSelectionRange(caret, caret);
    });
  }

  useEffect(() => {
    if (!trigger) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setTrigger(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [trigger]);

  const matches = useMemo(() => {
    if (!trigger) return [];
    const q = trigger.query.toLowerCase();
    return TOKEN_META.filter(t => t.name.toLowerCase().includes(q));
  }, [trigger]);

  return (
    <label className="wsm-field" ref={wrapRef}>
      {label && <span className="wsm-field-label">{label}</span>}
      <div className="ti-wrap">
        <input
          ref={inputRef}
          type="text"
          value={value || ''}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          onKeyUp={recomputeTrigger}
          onClick={recomputeTrigger}
          onBlur={() => setTimeout(() => setTrigger(null), 120)}
        />
        {trigger && matches.length > 0 && (
          <div className="ti-popover" role="listbox">
            {matches.map((t, i) => (
              <button
                type="button"
                key={t.name}
                className={`ti-item ${i === highlight ? 'ti-item-high' : ''}`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => { e.preventDefault(); accept(t); }}
                role="option"
                aria-selected={i === highlight}
              >
                <code className="ti-item-name">{`{{${t.name}}}`}</code>
                <span className="ti-item-example">{t.example}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {help && <span className="wsm-field-help">{help}</span>}
    </label>
  );
}
