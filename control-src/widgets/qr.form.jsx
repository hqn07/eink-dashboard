import { buildForm } from './_schema.jsx';

// Settings as data (D4). Every key here exists in qr.js `defaults()` and every
// key there is reachable from here — `check:widgets` fails the build if that
// stops being true, which is the thing a hand-written form could never promise.
//
// `when` carries the conditionals the JSX used to: the WiFi fields only exist
// while the code is encoding a network, and the password only while the
// network has security.
export const FIELDS = [
  {
    key: 'mode', type: 'select', label: 'Encode',
    options: [
      { value: 'url',  label: 'Link / text' },
      { value: 'wifi', label: 'WiFi network (scan to join)' }
    ]
  },
  {
    key: 'data', type: 'text', label: 'Link or text',
    placeholder: 'https://example.com',
    help: 'URL or any text to encode.',
    when: (v) => v.mode !== 'wifi'
  },
  {
    key: 'ssid', type: 'text', label: 'Network name (SSID)',
    placeholder: 'MyWiFi',
    when: (v) => v.mode === 'wifi'
  },
  {
    key: 'auth', type: 'select', label: 'Security',
    options: [
      { value: 'WPA',    label: 'WPA/WPA2/WPA3' },
      { value: 'WEP',    label: 'WEP' },
      { value: 'nopass', label: 'Open (no password)' }
    ],
    when: (v) => v.mode === 'wifi'
  },
  {
    key: 'password', type: 'text', label: 'Password', secret: true,
    placeholder: '••••••••',
    help: 'Encoded into the QR. Anyone who scans it joins.',
    when: (v) => v.mode === 'wifi' && v.auth !== 'nopass'
  },
  {
    key: 'hidden', type: 'toggle', label: 'Hidden network',
    when: (v) => v.mode === 'wifi'
  },
  {
    key: 'caption', type: 'text', label: 'Caption', tokens: true,
    placeholder: 'Scan me',
    help: 'Shown under the code. Optional.'
  },
  {
    key: 'title', type: 'text', label: 'Tile heading', tokens: true,
    placeholder: 'QR',
    help: 'Leave blank for none.'
  },
  {
    key: 'level', type: 'select', label: 'Error correction',
    options: [
      { value: 'L', label: 'Low (7%) — smallest code' },
      { value: 'M', label: 'Medium (15%)' },
      { value: 'Q', label: 'Quartile (25%)' },
      { value: 'H', label: 'High (30%) — most robust' }
    ]
  }
];

export const Form = buildForm(FIELDS);
