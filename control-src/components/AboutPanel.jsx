import React from 'react';

// "About you" — free text describing the person the dashboard is for.
//
// Stage 1 of docs/setup-architecture.md. Today only the `ai` widget reads it,
// and it is the difference between a generic forecast summary and a briefing
// worth wall space: everything else the model receives describes the world,
// nothing describes who is standing in front of it.
//
// Edits ride the app's normal dirty/save flow through onReplaceConfig rather
// than posting on their own, so this behaves like every other config change —
// one Save button, one undo story.
export default function AboutPanel({ cfg, onReplaceConfig }) {
  const home = (cfg && cfg.home) || {};
  const value = typeof home.about === 'string' ? home.about : '';

  return (
    <div className="about-panel">
      <label className="wsm-field">
        <span className="wsm-field-label">About you</span>
        <textarea
          className="wsm-textarea"
          rows={5}
          value={value}
          placeholder={'e.g. I work from home. Gym Tuesday and Thursday.\nDeadlines matter more to me than weather.'}
          onChange={(e) => onReplaceConfig({
            ...cfg,
            home: { ...home, about: e.target.value },
          })}
        />
        <span className="wsm-field-help">
          Sent to your AI provider with every generation, along with the
          dashboard&apos;s current data. Keep it to what actually changes the
          answer — routines, priorities, what you want flagged.
        </span>
      </label>
    </div>
  );
}
