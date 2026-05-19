import React from 'react';

const DEFAULT_CHROME = {
  header: { enabled: true, left: '{city}', leftSub: '{date}', right: '{time}', rightSub: 'EDITION No. {edition}' },
  footer: { enabled: true, text: 'UPDATED {time} · REFRESH {refresh}MIN · THE DAILY {city}' }
};

// Header + footer chrome editor. Lives inside the Edit Layout card so the
// canvas, the chrome, and these controls all sit together while you're
// composing a screen.
export default function ChromePanel({ screen, onUpdate }) {
  const chrome = (screen && screen.chrome) || DEFAULT_CHROME;
  const setHeader = (patch) => onUpdate({ chrome: { ...chrome, header: { ...(chrome.header || {}), ...patch } } });
  const setFooter = (patch) => onUpdate({ chrome: { ...chrome, footer: { ...(chrome.footer || {}), ...patch } } });
  const headerOn = chrome.header?.enabled !== false;
  const footerOn = chrome.footer?.enabled !== false;

  return (
    <div className="chrome-panel">
      <div className="section-title" style={{ marginTop: 8 }}>Header & Footer</div>
      <div className="terminal-line" style={{ fontSize: 10, marginBottom: 8 }}>
        &gt; TOKENS: <code>{'{city}'}</code> <code>{'{time}'}</code> <code>{'{date}'}</code> <code>{'{refresh}'}</code> <code>{'{edition}'}</code>
      </div>

      <div className="toggle-row">
        <span className="toggle-label">Show header</span>
        <div className={`toggle ${headerOn ? 'on' : ''}`}
          onClick={() => setHeader({ enabled: !headerOn })} />
      </div>
      {headerOn && (
        <>
          <label className="field" style={{ marginTop: 6 }}>
            <span className="label">Header style</span>
            <select value={chrome.header?.variant || 'masthead'}
              onChange={e => setHeader({ variant: e.target.value })}>
              <option value="masthead">Masthead (default · big newspaper)</option>
              <option value="minimal">Minimal (small mono · white)</option>
              <option value="band">Band (full-black tracking-wide)</option>
            </select>
          </label>
          <div className="btn-row" style={{ marginTop: 6, gap: 6 }}>
            <label className="field" style={{ flex: 1, marginTop: 0 }}>
              <span className="label">Header left</span>
              <input type="text" value={chrome.header?.left || ''}
                onChange={e => setHeader({ left: e.target.value })}
                placeholder="{city}" />
            </label>
            <label className="field" style={{ flex: 1, marginTop: 0 }}>
              <span className="label">Left subtitle</span>
              <input type="text" value={chrome.header?.leftSub || ''}
                onChange={e => setHeader({ leftSub: e.target.value })}
                placeholder="{date}" />
            </label>
          </div>
          <div className="btn-row" style={{ marginTop: 6, gap: 6 }}>
            <label className="field" style={{ flex: 1, marginTop: 0 }}>
              <span className="label">Header right</span>
              <input type="text" value={chrome.header?.right || ''}
                onChange={e => setHeader({ right: e.target.value })}
                placeholder="{time}" />
            </label>
            <label className="field" style={{ flex: 1, marginTop: 0 }}>
              <span className="label">Right subtitle</span>
              <input type="text" value={chrome.header?.rightSub || ''}
                onChange={e => setHeader({ rightSub: e.target.value })}
                placeholder="EDITION No. {edition}" />
            </label>
          </div>
        </>
      )}

      <div className="toggle-row" style={{ marginTop: 12 }}>
        <span className="toggle-label">Show footer</span>
        <div className={`toggle ${footerOn ? 'on' : ''}`}
          onClick={() => setFooter({ enabled: !footerOn })} />
      </div>
      {footerOn && (
        <>
          <label className="field">
            <span className="label">Footer style</span>
            <select value={chrome.footer?.variant || 'editorial'}
              onChange={e => setFooter({ variant: e.target.value })}>
              <option value="editorial">Editorial (default · black band)</option>
              <option value="dotted">Dotted (dashed underline · white)</option>
              <option value="compact">Compact (small mono · white)</option>
            </select>
          </label>
          <label className="field">
            <span className="label">Footer text</span>
            <input type="text" value={chrome.footer?.text || ''}
              onChange={e => setFooter({ text: e.target.value })}
              placeholder="UPDATED {time} · REFRESH {refresh}MIN · THE DAILY {city}" />
          </label>
        </>
      )}
    </div>
  );
}
