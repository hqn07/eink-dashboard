import React from 'react';

// HH:MM text input with auto-formatting as the user types. Replaces
// native <input type="time"> when the form wants a consistent visual
// (the OS-themed time picker varies across mac/Windows/Linux).
//
// Behaviour:
//   "1234" → "12:34"
//   "9"    → "9"
//   "9:"   → "9:"
//   "925"  → "9:25"
//   "2599" → "25:99" (preserves typing; validation flagged via border)
//
// The component never rejects keystrokes; it shows red borders when
// the current value isn't a valid 24h HH:MM so the user knows to fix
// it before save.
function format(raw) {
  // Strip everything except digits + colon.
  let s = String(raw || '').replace(/[^\d:]/g, '');
  // If user typed digits without colon, slot one in after 1–2 hours.
  if (!s.includes(':')) {
    if (s.length >= 3) s = s.slice(0, s.length - 2) + ':' + s.slice(-2);
  }
  return s;
}

function isValid(s) {
  return /^([01]?\d|2[0-3]):([0-5]\d)$/.test(s || '');
}

export default function TimeField({ value, onChange, placeholder = 'HH:MM', ariaLabel, style }) {
  const v = value || '';
  const invalid = v.length > 0 && !isValid(v);
  return (
    <input
      type="text"
      inputMode="numeric"
      value={v}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => onChange(format(e.target.value))}
      className={`time-field ${invalid ? 'time-field-invalid' : ''}`}
      style={style}
      maxLength={5}
    />
  );
}
