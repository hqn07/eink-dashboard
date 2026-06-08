import React, { useEffect, useState } from 'react';
import { fetchAlarms, saveAlarms } from '../api.js';
import { Plus, Trash } from '@phosphor-icons/react';
import { TokenPicker } from './TokenPicker';
import TimeField from './TimeField.jsx';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABEL = {
  mon: 'M', tue: 'T', wed: 'W', thu: 'T', fri: 'F', sat: 'S', sun: 'S'
};

function newId() {
  return `alarm-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
}

function blankAlarm() {
  return {
    id: newId(),
    time: '07:30',
    days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    enabled: true,
    label: ''
  };
}

export default function AlarmsPanel() {
  const [alarms, setAlarms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAlarms()
      .then(list => { if (!cancelled) setAlarms(list); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  function patch(idx, fields) {
    setAlarms(prev => {
      const next = prev.slice();
      next[idx] = { ...next[idx], ...fields };
      return next;
    });
    setDirty(true);
  }

  function toggleDay(idx, day) {
    setAlarms(prev => {
      const next = prev.slice();
      const current = next[idx].days || [];
      const hasDay = current.includes(day);
      next[idx] = {
        ...next[idx],
        days: hasDay ? current.filter(d => d !== day) : [...current, day]
      };
      return next;
    });
    setDirty(true);
  }

  function addAlarm() {
    setAlarms(prev => [...prev, blankAlarm()]);
    setDirty(true);
  }

  function removeAlarm(idx) {
    setAlarms(prev => prev.filter((_, i) => i !== idx));
    setDirty(true);
  }

  async function commit() {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveAlarms(alarms);
      setAlarms(saved);
      setDirty(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="alarms-panel"><p className="wsm-note">Loading…</p></div>;
  }

  return (
    <div className="alarms-panel">
      <div className="alarms-header">
        <h3>Alarms</h3>
        <button type="button" className="btn btn-sm" onClick={addAlarm}>
          <Plus size={12} weight="bold" /> ADD
        </button>
      </div>

      {alarms.length === 0 && (
        <p className="wsm-note">
          No alarms set. Click ADD to create one. Server must run with
          the correct <code>TZ</code> env var for times to match your
          wall clock.
        </p>
      )}

      {alarms.map((a, idx) => (
        <div key={a.id || idx} className={`alarm-row ${a.enabled === false ? 'is-disabled' : ''}`}>
          <div className="alarm-row-top">
            <label className="wsm-row wsm-row-check">
              <input
                type="checkbox"
                checked={a.enabled !== false}
                onChange={e => patch(idx, { enabled: e.target.checked })}
              />
              <span>ON</span>
            </label>
            <TimeField
              value={a.time || '07:00'}
              onChange={(x) => patch(idx, { time: x })}
              ariaLabel="Alarm time"
            />
            <input
              type="text"
              value={a.label || ''}
              onChange={e => patch(idx, { label: e.target.value })}
              placeholder="Label (optional) — supports {{day}}, {{date|short}}…"
              className="alarm-label"
            />
            <TokenPicker
              onInsert={(tok) => patch(idx, { label: (a.label || '') + tok })}
              title="Insert dynamic token"
            />
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => removeAlarm(idx)}
              aria-label="Remove alarm"
            >
              <Trash size={12} weight="bold" />
            </button>
          </div>
          <div className="alarm-days">
            {DAYS.map(d => {
              const on = (a.days || []).includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  className={`alarm-day ${on ? 'on' : ''}`}
                  onClick={() => toggleDay(idx, d)}
                  aria-pressed={on}
                  title={d.toUpperCase()}
                >
                  {DAY_LABEL[d]}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="alarms-footer">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!dirty || saving}
          onClick={commit}
        >
          {saving ? 'SAVING…' : (dirty ? 'SAVE ALARMS' : 'SAVED')}
        </button>
        {error && <span className="alarm-err">{error}</span>}
      </div>
    </div>
  );
}
