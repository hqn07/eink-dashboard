import React from 'react';
import { Form as LocalForm } from './_view-clock.form.jsx';
import { Form as ZonesForm } from './_view-worldclock.form.jsx';

// Two views, two existing forms. The zones view carries a full IANA zone
// picker with favourites and search; folding its fields into a merged form by
// hand would have meant reimplementing that for no gain. This dispatches
// instead, so each view keeps the form it already had.
export function Form(props) {
  const view = (props.values && props.values.variant) || 'big';
  return view === 'big' ? <LocalForm {...props} /> : <ZonesForm {...props} />;
}
