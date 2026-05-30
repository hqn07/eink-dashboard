// Header badge showing how recently the Mac-side push agent pushed
// state to the cloud. Useful for spotting a dead launchd job — the
// dashboard widgets fall back to MAC OFFLINE after 5 minutes of no
// pushes, but this badge surfaces the staleness before that.

import React, { useEffect, useState } from 'react';
import { fetchMacState } from '../api.js';

const POLL_MS = 15000;       // refresh every 15 s
const STALE_MS = 5 * 60_000; // matches widgets/_mac_state.STALE_MS

function ageLabel(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return '—';
  const s = Math.floor(ageMs / 1000);
  if (s < 60)   return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function MacAgentBadge() {
  const [state, setState] = useState({ at: null, error: false, loading: true });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      try {
        const s = await fetchMacState();
        if (cancelled) return;
        setState({ at: s && s.at, error: false, loading: false });
      } catch {
        if (cancelled) return;
        setState((prev) => ({ ...prev, error: true, loading: false }));
      }
    };
    pull();
    const id = setInterval(pull, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Tick a local clock so the "Ns ago" label advances between polls.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (state.loading) return null;
  if (state.error) {
    return (
      <span className="mac-agent-badge mac-agent-badge--err" title="Could not reach /api/mac-state">
        MAC AGENT: ?
      </span>
    );
  }
  if (!state.at) {
    return (
      <span className="mac-agent-badge mac-agent-badge--off" title="No push received yet">
        MAC AGENT: NEVER
      </span>
    );
  }
  const age = now - state.at;
  const stale = age > STALE_MS;
  const cls = `mac-agent-badge ${stale ? 'mac-agent-badge--stale' : 'mac-agent-badge--ok'}`;
  const tip = stale
    ? 'Agent push is stale — check launchctl / /tmp/eink-mac-agent.log'
    : 'Agent push is fresh';
  return (
    <span className={cls} title={tip}>
      MAC AGENT: {ageLabel(age)}
    </span>
  );
}
