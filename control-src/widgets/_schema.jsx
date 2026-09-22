// D4 — widget settings as DATA instead of as JSX.
//
// A widget's form was ~100 lines of hand-written React per widget, 1,886 of
// them across the pool, and most of it was the same four shapes typed out
// again: a label, a control, a help string, and an occasional `when this other
// field is set`. Worse, the fields and the widget's `defaults()` had no
// relationship a machine could check, so a default could name a key no form
// exposed (unreachable) or a form could write a key the renderer never read
// (dead), and both survive review easily.
//
// A field descriptor is a plain object. `buildForm(FIELDS)` turns the list into
// exactly the tree the hand-written forms produced — `FormSection` blocks
// holding field primitives — so `TabbedForm`'s introspection, the pill tabs and
// the per-widget section memory all keep working untouched. Nothing downstream
// knows the difference.
//
// THE HOOK-FREE RULE STILL APPLIES, and now it is structural rather than a
// comment people have to remember: `TabbedForm` CALLS the form as a plain
// function to read its sections, so a hook inside one is an invalid-hook crash
// that blanks the whole editor (it happened — photo.form used useRef/useState
// and took the app down; see ErrorBoundary). A generated form cannot hold a
// hook, because there is nowhere to write one.
//
// A widget that genuinely needs custom JSX — photo's uploader with its live
// dither preview, calendar's preset adder — keeps its hand-written Form. This
// is a way to stop writing the boring 80%, not a rule that every form must be
// expressible as data.

import React from 'react';

// Field types → the primitive that renders them. The primitives themselves
// arrive in `fields` (WidgetForm's FIELD_PRIMITIVES bag) rather than being
// imported here, because this module is loaded by the server's widget scan too
// and must stay free of editor-only imports.
const RENDERERS = {
  text:      (P, f, props) => <P.TextField {...props} />,
  select:    (P, f, props) => <P.SelectField {...props} options={f.options} />,
  segmented: (P, f, props) => <P.SegmentedField {...props} options={f.options} />,
  toggle:    (P, f, props) => <P.ToggleField {...props} />,
  slider:    (P, f, props) => <P.SliderField {...props} min={f.min} max={f.max} step={f.step} format={f.format} />,
  // CsvField commits on blur/Enter rather than on every keystroke, so it takes
  // onCommit — typing "AAPL, BT" must not briefly parse as a symbol called BT.
  csv:       (P, f, props) => {
    const { onChange, ...rest } = props;
    return <P.CsvField {...rest} onCommit={onChange} />;
  },
  textarea:  (P, f, props) => <P.TextAreaField {...props} rows={f.rows} />,
  multi:     (P, f, props) => <P.MultiField {...props} options={f.options} />,
  // A list of plain strings needs `replaceRow`, or every keystroke spreads the
  // string into an object and the row becomes untypeable (bug 3289942).
  list:      (P, f, props) => {
    const { value, onChange, ...rest } = props;
    return (
      <P.ListEditor
        {...rest}
        replaceRow
        items={Array.isArray(value) ? value : []}
        blank=""
        addLabel={f.addLabel}
        onChange={onChange}
        renderRow={(it, set) => (
          <input
            type="text"
            value={typeof it === 'string' ? it : ''}
            placeholder={f.rowPlaceholder}
            onChange={(e) => set(e.target.value)}
            style={{ flex: 1 }}
          />
        )}
      />
    );
  },
  // LocationFields emits a COMPLETE settings object rather than a patch —
  // merging it here would defeat clearing a location (see weather.form.jsx).
  // It is the one field that takes the raw onChange.
  location:  (P, f, props, ctx) => <P.LocationFields values={ctx.values} onChange={ctx.onChange} />,
  // N pickers that write into one ARRAY by index — the weather stats grid,
  // where "slot 3 shows wind" is a position, not a separate setting. Writing
  // them as four independent fields would need four keys the renderer does not
  // read, which the defaults guard would (correctly) reject.
  slots:     (P, f, props, ctx) => {
    const list = Array.isArray(props.value) && props.value.length === f.count
      ? props.value
      : (f.fallback || []);
    return (
      <>
        {Array.from({ length: f.count }, (_, i) => (
          <P.SelectField
            key={i}
            label={f.slotLabel ? f.slotLabel(i) : `Slot ${i + 1}`}
            value={list[i]}
            options={f.options}
            onChange={(x) => {
              const next = list.slice();
              next[i] = x;
              ctx.patch({ [f.key]: next });
            }}
          />
        ))}
      </>
    );
  },
  // A row of one-tap presets that write several keys at once. Applied through
  // the raw onChange because a preset is a whole shape, not a patch.
  presets:   (P, f, props, ctx) => (
    <P.PresetField presets={f.presets} onApply={(vals) => ctx.onChange({ ...ctx.values, ...vals })} />
  ),
  // Static prose. Not a setting — the blurb that tells you what the selected
  // view does, which several forms carried as a bare div.
  note:      (P, f, props, ctx) => (
    <div className="wsm-field-help" style={{ marginBottom: 6 }}>
      {typeof f.text === 'function' ? f.text(ctx.values) : f.text}
      {f.code && (
        <code style={{
          display: 'block', marginTop: 6, fontSize: 11, background: '#f4f2ec',
          padding: '6px 8px', borderRadius: 4, wordBreak: 'break-all', userSelect: 'all'
        }}>{typeof f.code === 'function' ? f.code(ctx.values) : f.code}</code>
      )}
    </div>
  )
};

// Labels, help and placeholders may be functions of the current values — a
// view-switching widget says something different per view, and duplicating the
// field per view just to change its placeholder is how these forms got long.
// Second argument is the form's context (cfg, so a field can say what it
// inherits from Settings rather than showing a fake example).
const resolve = (x, v, ctx) => (typeof x === 'function' ? x(v, ctx) : x);

export function fieldKeys(FIELDS) {
  return (FIELDS || []).filter(f => f && f.key && f.type !== 'note').map(f => f.key);
}

// Sections keep the order they first appear in the list, which is also the
// order the tabs show — so the schema reads top to bottom like the form does.
function groupBySection(FIELDS) {
  const out = [];
  for (const f of FIELDS || []) {
    if (!f) continue;
    const title = f.section || 'Content';
    let sec = out.find(s => s.title === title);
    if (!sec) { sec = { title, fields: [] }; out.push(sec); }
    sec.fields.push(f);
  }
  return out;
}

// Consecutive fields that name the same `collapse` group fold into one
// Collapsible. Grouping by adjacency rather than by a nested structure keeps
// the schema a flat list — the thing that makes it readable — while still
// letting a form tuck its fiddly end away.
function foldGroups(list) {
  const out = [];
  for (const f of list) {
    const last = out[out.length - 1];
    if (f.collapse && last && last.collapse === f.collapse) last.fields.push(f);
    else if (f.collapse) out.push({ collapse: f.collapse, storageScope: f.collapseScope, fields: [f] });
    else out.push({ field: f });
  }
  return out;
}

export function buildForm(FIELDS) {
  // Named so React DevTools and any error boundary report something useful
  // rather than "Anonymous".
  return function SchemaForm({ values, patch, onChange, fields, cfg }) {
    const v = values || {};
    const P = fields || {};
    const defaults = P.defaults || {};
    const sections = groupBySection(FIELDS);
    void onChange; // used by the location/presets renderers via ctx

    return (
      <>
        {sections.map(sec => {
          const visible = sec.fields.filter(f => typeof f.when !== 'function' || f.when(v));
          if (!visible.length) return null;
          const renderField = (f) => {
                const render = RENDERERS[f.type];
                if (!render) return null;
                // `value` falls back to the widget's own default rather than to
                // an empty string: a field whose default is `true` must render
                // as on before anyone touches it.
                const current = v[f.key] !== undefined ? v[f.key] : defaults[f.key];
                const props = {
                  key: f.key || `${f.type}-${sec.title}`,
                  label: resolve(f.label, v, { cfg }),
                  help: resolve(f.help, v, { cfg }),
                  placeholder: resolve(f.placeholder, v, { cfg }),
                  // `toField` lets a field present a value the renderer does
                  // not store — the forecast's day count is a number or null,
                  // and the picker needs the string 'auto' for the null.
                  value: f.toField ? f.toField(current) : current,
                  defaultValue: defaults[f.key],
                  tokens: f.tokens,
                  secret: f.secret,
                  onChange: (x) => patch({ [f.key]: f.fromField ? f.fromField(x) : x })
                };
                return render(P, f, props, { values: v, onChange, patch, cfg });
          };

          return (
            <P.FormSection key={sec.title} title={sec.title}>
              {foldGroups(visible).map((entry, i) => (
                entry.field
                  ? renderField(entry.field)
                  : (
                    <P.Collapsible
                      key={`${entry.collapse}-${i}`}
                      title={entry.collapse}
                      storageScope={entry.storageScope}
                      defaultOpen={false}
                    >
                      {entry.fields.map(renderField)}
                    </P.Collapsible>
                  )
              ))}
            </P.FormSection>
          );
        })}
      </>
    );
  };
}
