// Curated public iCal feeds the user can pick from the Calendar widget's
// "Add from preset" dropdown so they don't have to hunt for URLs. Each
// entry resolves to a real public feed maintained by Google, CalendarLabs,
// or similar — none of these are private user feeds.
//
// Google holiday feeds follow the pattern:
//   https://calendar.google.com/calendar/ical/<lang>.<country>%23holiday%40group.v.calendar.google.com/public/basic.ics
// Other countries can be added by following the same shape.

export const ICAL_PRESETS = [
  {
    group: 'Holidays',
    items: [
      { name: 'US Holidays',          url: 'https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics' },
      { name: 'UK Holidays',          url: 'https://calendar.google.com/calendar/ical/en.uk%23holiday%40group.v.calendar.google.com/public/basic.ics' },
      { name: 'Canada Holidays',      url: 'https://calendar.google.com/calendar/ical/en.canadian%23holiday%40group.v.calendar.google.com/public/basic.ics' },
      { name: 'Australia Holidays',   url: 'https://calendar.google.com/calendar/ical/en.australian%23holiday%40group.v.calendar.google.com/public/basic.ics' },
      { name: 'Germany Holidays',     url: 'https://calendar.google.com/calendar/ical/en.german%23holiday%40group.v.calendar.google.com/public/basic.ics' },
      { name: 'France Holidays',      url: 'https://calendar.google.com/calendar/ical/en.french%23holiday%40group.v.calendar.google.com/public/basic.ics' },
      { name: 'Japan Holidays',       url: 'https://calendar.google.com/calendar/ical/en.japanese%23holiday%40group.v.calendar.google.com/public/basic.ics' },
      { name: 'Spain Holidays',       url: 'https://calendar.google.com/calendar/ical/en.spain%23holiday%40group.v.calendar.google.com/public/basic.ics' },
      { name: 'Italy Holidays',       url: 'https://calendar.google.com/calendar/ical/en.italian%23holiday%40group.v.calendar.google.com/public/basic.ics' },
      { name: 'Brazil Holidays',      url: 'https://calendar.google.com/calendar/ical/en.brazilian%23holiday%40group.v.calendar.google.com/public/basic.ics' },
      { name: 'Mexico Holidays',      url: 'https://calendar.google.com/calendar/ical/en.mexican%23holiday%40group.v.calendar.google.com/public/basic.ics' },
      { name: 'India Holidays',       url: 'https://calendar.google.com/calendar/ical/en.indian%23holiday%40group.v.calendar.google.com/public/basic.ics' },
      { name: 'Christian Holidays',   url: 'https://calendar.google.com/calendar/ical/en.christian%23holiday%40group.v.calendar.google.com/public/basic.ics' },
      { name: 'Jewish Holidays',      url: 'https://calendar.google.com/calendar/ical/en.judaism%23holiday%40group.v.calendar.google.com/public/basic.ics' },
      { name: 'Islamic Holidays',     url: 'https://calendar.google.com/calendar/ical/en.islamic%23holiday%40group.v.calendar.google.com/public/basic.ics' },
    ]
  },
  {
    group: 'Sky',
    items: [
      { name: 'Moon Phases',          url: 'https://www.calendarlabs.com/ical-calendar/ics/27/Phases_of_the_Moon.ics' },
    ]
  }
];

// Flat list of {name, url, group} for easy <select> rendering.
export function flatPresets() {
  const out = [];
  for (const g of ICAL_PRESETS) {
    for (const it of g.items) out.push({ ...it, group: g.group });
  }
  return out;
}
