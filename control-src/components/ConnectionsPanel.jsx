import React, { useEffect, useState } from 'react';
import { fetchConnections, saveConnection } from '../api.js';

// Settings > Tools > Connections — the provider credentials the AI widget
// needs, which until now could only be set as env vars on the host. The tile
// literally told people to "Set AI_API_KEY + AI_MODEL", which is not
// something the editor could do, so the fix lived outside the app.
//
// The split is deliberate and is the whole answer to "does a backup leak my
// key?":
//   - the KEY goes to /api/connections, which writes a file outside the
//     config, so Backup > EXPORT (a JSON.stringify of the config) cannot
//     contain it — by structure, not by a redaction step someone must
//     remember to keep working;
//   - the provider URL and model are not secrets and ride the config, so
//     restoring a backup brings them back and asks only for the key.
//
// The key is write-only from here. The server returns whether one is set,
// where it came from, and its last four characters — never the value.
export default function ConnectionsPanel({ cfg, onReplaceConfig }) {
  const ai = (cfg && cfg.ai) || {};
  const [desc, setDesc] = useState(null);     // { aiApiKey: {configured,...} }
  const [draft, setDraft] = useState('');     // the key being typed, if any
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchConnections()
      .then(d => { if (!cancelled) setDesc(d && d.secrets); })
      .catch(() => { if (!cancelled) setDesc({}); });
    return () => { cancelled = true; };
  }, []);

  const key = (desc && desc.aiApiKey) || {};

  const submit = async (value) => {
    setBusy(true); setMsg('');
    try {
      const d = await saveConnection({ aiApiKey: value });
      setDesc(d && d.secrets);
      setDraft('');
      setMsg(value ? 'Key saved' : 'Key cleared');
    } catch {
      setMsg('Could not save — try again');
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(''), 4000);
    }
  };

  const setAi = (patch) => onReplaceConfig({ ...cfg, ai: { ...ai, ...patch } });

  return (
    <div className="connections-panel">
      <label className="wsm-field">
        <span className="wsm-field-label">AI API key</span>
        {key.configured && !draft && (
          <div className="loc-badge ok">
            Set {key.hint}
            {key.source === 'env' && <span> · from {key.envName}</span>}
          </div>
        )}
        <input
          type="password"
          autoComplete="off"
          value={draft}
          placeholder={key.configured ? 'Replace the key…' : 'Paste your provider key'}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="btn-row" style={{ marginTop: 6, gap: 6 }}>
          <button
            type="button"
            className="btn"
            disabled={busy || !draft.trim()}
            onClick={() => submit(draft.trim())}
          >
            {busy ? 'Saving…' : 'Save key'}
          </button>
          {key.configured && key.source === 'stored' && (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => submit('')}
            >
              Clear
            </button>
          )}
        </div>
        {msg && <span className="wsm-field-help">{msg}</span>}
        <span className="wsm-field-help">
          Stored outside your config, so <strong>Backup &gt; Export never
          contains it</strong>. A restored backup brings back the provider and
          model below and asks for the key again.
        </span>
      </label>

      <label className="wsm-field">
        <span className="wsm-field-label">Model</span>
        <input
          type="text"
          value={ai.model || ''}
          placeholder="e.g. gpt-4o-mini, deepseek-chat"
          onChange={(e) => setAi({ model: e.target.value })}
        />
        <span className="wsm-field-help">
          No default on purpose — a plausible-but-wrong model fails later with
          a confusing provider error.
        </span>
      </label>

      <label className="wsm-field">
        <span className="wsm-field-label">Provider URL</span>
        <input
          type="url"
          value={ai.baseUrl || ''}
          placeholder="https://api.openai.com/v1"
          onChange={(e) => setAi({ baseUrl: e.target.value })}
        />
        <span className="wsm-field-help">
          Anything speaking the OpenAI <code>/chat/completions</code> shape.
          DeepSeek: <code>https://api.deepseek.com/v1</code>
        </span>
      </label>
    </div>
  );
}
