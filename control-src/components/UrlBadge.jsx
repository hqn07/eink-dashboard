import React from 'react';
import { Check, X, Warning } from '@phosphor-icons/react';

// Tiny status dot rendered next to a URL input. Three states:
//   empty   — no URL yet (just a grey ring)
//   valid   — parses as http/https URL (black check on white)
//   invalid — non-empty but not a parseable http/https URL (white X on black)
//
// Doesn't probe the network — purely shape validation. Lightweight
// enough to render per row inside a ListEditor without flicker.
function classify(url) {
  const s = String(url || '').trim();
  if (!s) return 'empty';
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'invalid';
    return 'valid';
  } catch {
    return 'invalid';
  }
}

export default function UrlBadge({ url, title }) {
  const state = classify(url);
  const cls = `url-badge url-badge-${state}`;
  const label = state === 'valid' ? 'Valid URL'
              : state === 'invalid' ? 'Invalid URL'
              : 'Empty';
  return (
    <span className={cls} title={title || label} aria-label={label}>
      {state === 'valid'   && <Check   size={10} weight="bold" />}
      {state === 'invalid' && <X       size={10} weight="bold" />}
      {state === 'empty'   && <Warning size={10} weight="bold" />}
    </span>
  );
}
