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
  list:      (P, f, props) => <P.ListEditor {...props} />,
  location:  (P, f, props) => <P.LocationFields {...props} />
};

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

export function buildForm(FIELDS) {
  // Named so React DevTools and any error boundary report something useful
  // rather than "Anonymous".
  return function SchemaForm({ values, patch, fields }) {
    const v = values || {};
    const P = fields || {};
    const defaults = P.defaults || {};
    const sections = groupBySection(FIELDS);

    return (
      <>
        {sections.map(sec => {
          const visible = sec.fields.filter(f => typeof f.when !== 'function' || f.when(v));
          if (!visible.length) return null;
          return (
            <P.FormSection key={sec.title} title={sec.title}>
              {visible.map(f => {
                const render = RENDERERS[f.type];
                if (!render) return null;
                // `value` falls back to the widget's own default rather than to
                // an empty string: a field whose default is `true` must render
                // as on before anyone touches it.
                const current = v[f.key] !== undefined ? v[f.key] : defaults[f.key];
                const props = {
                  key: f.key,
                  label: f.label,
                  help: f.help,
                  placeholder: f.placeholder,
                  value: current,
                  defaultValue: defaults[f.key],
                  tokens: f.tokens,
                  secret: f.secret,
                  onChange: (x) => patch({ [f.key]: x })
                };
                return render(P, f, props);
              })}
            </P.FormSection>
          );
        })}
      </>
    );
  };
}
