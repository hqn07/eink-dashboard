import { createContext, useContext } from 'react';

// Cross-widget library of named feed URLs (iCal / RSS) the user has saved,
// so they don't re-type the same webcal/ics URL every time they add a
// calendar or headlines widget on a new screen. Persisted at config top
// level under `savedFeeds: [{ id, name, url }]`; the provider lives in
// App.jsx and mutates cfg through the normal undo-tracked path.
export const SavedFeedsContext = createContext({
  feeds: [],
  addFeed: () => {},
  removeFeed: () => {},
  renameFeed: () => {}
});

export const useSavedFeeds = () => useContext(SavedFeedsContext);

// Best-effort human label from a bare URL, used as the default name when
// saving so the user rarely has to type one. Google iCal feeds bury the
// calendar id in the path; fall back to the hostname otherwise.
export function deriveFeedName(url) {
  const s = String(url || '').trim();
  if (!s) return 'Feed';
  try {
    const u = new URL(s.replace(/^webcal:/i, 'https:'));
    const host = u.hostname.replace(/^www\./, '');
    if (host.includes('google.com')) {
      const m = decodeURIComponent(u.pathname).match(/ical\/([^/]+)/);
      if (m) {
        const id = m[1].split(/[#@]/)[0];
        if (id && !/^[a-f0-9]{16,}$/i.test(id)) return id;
      }
      return 'Google Calendar';
    }
    if (host.includes('icloud.com')) return 'iCloud Calendar';
    if (host.includes('outlook') || host.includes('office365')) return 'Outlook Calendar';
    return host;
  } catch {
    return 'Feed';
  }
}
