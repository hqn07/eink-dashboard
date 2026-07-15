# Push iPhone data to the panel (Apple Shortcuts → Webhook widget)

The webhook widget renders any JSON you POST at it. Apple Shortcuts can
post your Health data (steps, sleep, weight…) on a schedule — no new
server code, no companion app.

## 1. Add the widget

Editor → Add widget → **Webhook**. Pick a key, e.g. `steps`. Choose the
**Number** variant and set *Value path* to `steps`.

## 2. Build the Shortcut

Shortcuts app → new shortcut:

1. **Find Health Samples** — type *Steps*, Today, Group by Day → *Sum*.
2. **Get Contents of URL**
   - URL: `https://<your-server>/api/webhook/steps?token=<DEVICE_TOKEN>`
   - Method: POST · Request Body: JSON
   - Field `steps` = *Health Samples* (the sum from step 1)

Run it once — the tile shows the number on the next panel refresh.

## 3. Automate

Shortcuts → Automation → Time of Day (e.g. every morning 7:00 and again
21:00) → run the shortcut → turn OFF "Ask Before Running".

## Variations

- **Sleep**: Find Health Samples → Sleep → post as `{"sleep_h": …}`,
  value path `sleep_h`.
- **Multiple fields**: one POST can carry several keys
  (`{"steps": …, "sleep_h": …}`) — the key/value variant lists them all.
- **Template variant** example:
  ```
  {{steps}} steps
  Goal: 10000
  ```

Payload limit is 4 KB; the tile shows how long ago the last push landed.
