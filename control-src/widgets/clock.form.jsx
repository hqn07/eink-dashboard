import { buildForm } from './_schema.jsx';
import { FIELDS as LOCAL_FIELDS } from './_view-clock.form.jsx';
import { FIELDS as ZONE_FIELDS } from './_view-worldclock.form.jsx';

// Two views, and now one schema. This used to dispatch to whichever view form
// matched the variant, because the zones view carries a full IANA picker and
// reimplementing it inline would have been work for nothing. Both view forms
// are field lists now, so the merge is a concatenation with a `when` on each
// side — which is also what makes check-widgets able to see the whole widget's
// settings at once instead of one half at a time.
//
// `format` appears on both sides with the same key and meaning; only one side
// ever renders, so the duplicate is the point rather than a mistake.
const isZones = (v) => String(v.variant || 'big').startsWith('zones');
const gate = (fields, when) => fields.map(f => ({
  ...f,
  when: f.when ? (v) => when(v) && f.when(v) : when
}));

export const FIELDS = [
  ...gate(LOCAL_FIELDS, (v) => !isZones(v)),
  ...gate(ZONE_FIELDS, isZones)
];

export const Form = buildForm(FIELDS);
