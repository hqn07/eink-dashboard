import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CaretDown, MagnifyingGlass } from '@phosphor-icons/react';

// Searchable command-palette style select. Replaces native <select> for
// long lists (e.g. iCal feed presets, fonts) so users can type to filter
// instead of scrolling. Inspired by cmdk + Radix Combobox, hand-rolled
// to avoid the extra dep.
//
// Props:
//   value          — currently picked value (string)
//   onChange       — (value, item) called on selection
//   groups         — [{ label?, items: [{ value, label, hint? }, ...] }, ...]
//                    or just a single ungrouped list via `items`
//   items          — flat shortcut for ungrouped lists
//   placeholder    — trigger text when no value picked
//   ariaLabel      — accessibility label for the trigger
//
// Behaviour:
//   Click trigger → popover opens, search input autofocuses.
//   Type → list filters (case-insensitive substring on label + hint).
//   Arrow keys move highlight; Enter picks; Esc closes.
//   Click outside closes.
export default function SearchableSelect({
  value, onChange, groups, items, placeholder = 'Pick one…', ariaLabel
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  // Normalize input shape: always work with `groups`.
  const normGroups = useMemo(() => {
    if (Array.isArray(groups) && groups.length) return groups;
    if (Array.isArray(items) && items.length) return [{ items }];
    return [];
  }, [groups, items]);

  // Flat list for filtering + keyboard nav. Each entry carries its
  // group label so we can re-bucket for render.
  const flat = useMemo(() => {
    const out = [];
    for (const g of normGroups) {
      for (const it of (g.items || [])) {
        out.push({ ...it, _group: g.label || '' });
      }
    }
    return out;
  }, [normGroups]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return flat;
    return flat.filter(it =>
      String(it.label || '').toLowerCase().includes(needle) ||
      String(it.hint  || '').toLowerCase().includes(needle) ||
      String(it._group || '').toLowerCase().includes(needle)
    );
  }, [flat, q]);

  // Re-bucket the filtered list back into group headers so the popover
  // still reads as "Countries / Religions / Sky" instead of one long flat list.
  const rendered = useMemo(() => {
    const out = [];
    let current = null;
    for (const it of filtered) {
      if (it._group !== current) {
        current = it._group;
        out.push({ kind: 'header', label: current });
      }
      out.push({ kind: 'item', it });
    }
    return out;
  }, [filtered]);

  // Find the index of `item` inside the filtered list (used to map a
  // global highlight cursor through the header-mixed render list).
  const itemIndices = useMemo(() => {
    const idx = [];
    rendered.forEach((row, i) => { if (row.kind === 'item') idx.push(i); });
    return idx;
  }, [rendered]);

  useEffect(() => {
    if (open) {
      setHighlight(0);
      setQ('');
      requestAnimationFrame(() => inputRef.current && inputRef.current.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function selectAt(i) {
    const it = filtered[i];
    if (!it) return;
    onChange(it.value, it);
    setOpen(false);
  }

  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(filtered.length - 1, h + 1)); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlight(h => Math.max(0, h - 1));                  return; }
    if (e.key === 'Enter')     { e.preventDefault(); selectAt(highlight);                                     return; }
    if (e.key === 'Escape')    { e.preventDefault(); setOpen(false);                                          return; }
  }

  // Resolve the currently-selected value to its label for the trigger.
  const current = flat.find(it => String(it.value) === String(value));
  const triggerText = current ? current.label : placeholder;

  return (
    <div ref={wrapRef} className={`ss-wrap ${open ? 'ss-open' : ''}`}>
      <button
        type="button"
        className="ss-trigger"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className={`ss-trigger-label ${current ? '' : 'ss-trigger-placeholder'}`}>
          {triggerText}
        </span>
        <CaretDown size={12} weight="bold" />
      </button>
      {open && (
        <div className="ss-popover" role="listbox">
          <div className="ss-search">
            <MagnifyingGlass size={12} weight="bold" />
            <input
              ref={inputRef}
              type="text"
              value={q}
              onChange={e => { setQ(e.target.value); setHighlight(0); }}
              onKeyDown={onKey}
              placeholder="Search…"
            />
          </div>
          <div className="ss-list">
            {rendered.length === 0 && (
              <div className="ss-empty">No matches</div>
            )}
            {rendered.map((row, i) => {
              if (row.kind === 'header') {
                return row.label
                  ? <div key={`h-${i}`} className="ss-group">{row.label}</div>
                  : null;
              }
              const it = row.it;
              const flatIdx = filtered.indexOf(it);
              const isHigh = flatIdx === highlight;
              const isSel = String(it.value) === String(value);
              return (
                <button
                  key={`${it.value}-${i}`}
                  type="button"
                  className={`ss-item ${isHigh ? 'ss-item-high' : ''} ${isSel ? 'ss-item-sel' : ''}`}
                  onMouseEnter={() => setHighlight(flatIdx)}
                  onClick={() => selectAt(flatIdx)}
                  role="option"
                  aria-selected={isSel}
                >
                  <span className="ss-item-label">{it.label}</span>
                  {it.hint && <span className="ss-item-hint">{it.hint}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
