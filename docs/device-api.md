# E-Ink Dashboard — Device HTTP API

Wire protocol between the ESP32 firmware and the dashboard server. This
is the contract; firmware and server can evolve independently as long
as both sides honor a documented version.

Current version: **v1**.

## Conventions

- All paths are relative to the active server base. The firmware
  selects between `serverBaseLan` and `serverBaseCloud` at boot via a
  `/health` probe.
- Methods, headers, response codes are HTTP/1.1.
- JSON payloads are UTF-8.
- Time values are Unix milliseconds unless otherwise noted.

## Authentication

Two paths are supported in priority order:

1. **Per-device API key** (preferred). The device enrolls once via
   `POST /api/setup` (see below), receives an `api_key`, and sends it
   on every subsequent request as `X-API-Key: <key>`. Server matches
   the key against the registry it persisted at enrollment.
2. **Legacy fleet token**. If no `X-API-Key` is provided, the server
   falls back to a shared `DEVICE_TOKEN` env var, sent as either
   `?token=<DEVICE_TOKEN>` or `X-Device-Token: <DEVICE_TOKEN>`.

A bad or missing credential returns `401`. When neither
`DEVICE_TOKEN` nor any enrolled devices exist (single-user local dev),
auth is skipped.

## Image format (v1)

The display is **800 × 480**, 1-bit. The packed binary form is exactly
**48000 bytes** (800 × 480 / 8).

- Bytes are row-major, top-to-bottom.
- Within each byte, MSB-first.
- Bit `1` = white, bit `0` = black. Matches GxEPD2's `drawImage(...,
  black_on_white=false)`.

The two-zone refresh endpoints split the same image into a top header
strip (60 rows = 6000 bytes) and a body region (420 rows = 42000
bytes). The split is a clean byte boundary; no re-packing.

Future versions may add a 2-bit-per-pixel grayscale variant; clients
that ask for it will negotiate via a separate path / Accept header.
v1 is 1-bit-only.

## Endpoints

### `POST /api/setup`

First-boot enrollment. The device sends its MAC + firmware metadata,
the server hands back a long-lived per-device API key + a short
friendly id for the control UI.

- Auth: **not required** (bootstrap path; rate-limited via the global
  `/api/*` limit).
- Request body:
  ```
  {
    "mac":        "aa:bb:cc:dd:ee:ff",
    "fw_version": "1.9.0",
    "board":      "bw"
  }
  ```
- Validation: `mac` must match `^([0-9a-f]{2}:){5}[0-9a-f]{2}$`
  (case-insensitive). Re-enrolling the same MAC is idempotent and
  returns the existing record so a re-flashed device that lost NVS
  can recover its api_key.
- Response:
  ```
  { "api_key": "<48-hex>", "friendly_id": "A3F2B7" }
  ```

The device persists both in NVS. `api_key` goes in every subsequent
request's `X-API-Key` header; `friendly_id` is the user-facing handle.

### `GET /api/devices`

Lists every enrolled device + last-seen telemetry. Used by the
control UI's fleet view.

- Auth: requires the fleet-wide `DEVICE_TOKEN` (per-device keys
  intentionally can't list other devices).
- Response: `{ "devices": [{ mac, friendly_id, fw_version, board,
  first_seen_at, last_seen_at }] }`.
- `api_key` is intentionally stripped from the response.

### `GET /health`

Connectivity probe. Used by the firmware to pick between LAN and cloud
server bases at boot.

- Auth: **not required** (intentionally — needs to work before the
  device can prove anything).
- Response: `200 {"ok": true, "ts": <ms>}`.

### `GET /display.bin`

Full 800×480 1-bit dashboard image, packed as 48000 bytes.

- Optional request headers (device telemetry; server logs / acts on
  these, ignores any it doesn't recognise):
  - `Battery-Voltage` — float, volts.
  - `Battery-Pct` — int 0–100. If both are present and in-range the
    server persists them as if the device had POSTed `/api/battery`.
  - `RSSI` — int dBm (negative).
  - `FW-Version` — semver, e.g. `1.7.0`.
  - `FW-Board` — board slug, e.g. `bw`.
- Response headers:
  - `Content-Type: application/octet-stream`
  - `Cache-Control: no-store`
  - `X-Image-Width: 800`
  - `X-Image-Height: 480`
  - `X-Refresh-Rate` — minutes the device should sleep before next
    wake. Server picks this per-request based on the active screen's
    `refreshMinutes`. Replaces the separate `/sleep` round-trip.
- Body: 48000 bytes, MSB-first, 1=white / 0=black.

### `GET /display-header.bin`

Top 60-row slice of `/display.bin` (the always-changing header band).
Used for partial-refresh experiments on BW panels.

- Body: 6000 bytes.
- ETag-supported: server sends a strong `ETag`, device can send
  `If-None-Match` and receive `304 Not Modified`.
- `X-Image-Height: 60`.

### `GET /display-body.bin`

Next 420 rows after the header strip.

- Body: 42000 bytes.
- ETag-supported (as above).
- `X-Image-Height: 420`.

### `GET /sleep`

How long the firmware should sleep before the next refresh. Resolves
to the active screen's `refreshMinutes` if set, else the global config
default.

- Response: `200 {"minutes": <int>, "screenId": <string|null>, "screenName": <string|null>}`.

> v2 will fold this into a response header on `/display.bin`
> (`X-Refresh-Rate`). The standalone endpoint stays for backwards
> compatibility.

### `POST /api/battery`

Device reports its battery state. Persisted server-side so the value
survives a restart between refresh cycles (~30 min apart).

- Body: `{"v": <float volts>, "pct": <int 0-100>}`.
- Validation: `0 <= v <= 6`, `0 <= pct <= 100`. Out-of-range → `400`.
- Response: `200 {"ok": true}`.

Triggers an image-cache invalidation so the next render shows the
fresh value.

### `GET /api/battery`

Reads back the last-reported battery state. Used by the dashboard
renderer (the device shouldn't need this).

- Response: `{"v": <float|null>, "pct": <int|null>, "at": <ms|null>}`.

### `GET /api/alarm/next`

Next scheduled alarm (soonest enabled), so the device can shorten its
sleep window to wake before it fires.

- Response:
  ```
  {
    "now":  <server-ms>,
    "next": null
        | { "ts": <ms-fire-time>, "label": <string>, "durationSec": 60 }
  }
  ```
- `now` is the server's clock at request time. The firmware uses
  `next.ts - now` to compute the delta, dodging ESP32 RTC drift.

### `GET /api/firmware/manifest?board=<board>&from=<semver>`

OTA check. Returns the newest available firmware binary for the given
board if it's strictly newer than `from`.

- Query:
  - `board` — slug matching firmware filename prefix (e.g. `bw`, `b`).
  - `from` — current firmware semver (e.g. `1.6.0`).
- Responses:
  - `204 No Content` — no upgrade available.
  - `200`:
    ```
    {
      "version": "1.6.1",
      "board":   "bw",
      "url":     "https://.../firmware/bw-1.6.1.bin?token=...",
      "size":    1248320
    }
    ```
  - `url` is absolute and already token-stamped if `DEVICE_TOKEN` is
    set. The device feeds it straight into `httpUpdate.update(url)`.

### `GET /firmware/:file`

Raw firmware binary. Filename must match
`<board>-<MAJOR>.<MINOR>.<PATCH>.bin`. Anything else returns `400`.

- Response: `application/octet-stream`, the bare .bin contents.

## Endpoints used by the control UI (not the device)

These exist on the same server but aren't part of the firmware's
contract. Listed here for completeness; firmware should not call them.

| Path | Purpose |
|------|---------|
| `GET /dashboard` | The HTML page Puppeteer screenshots. |
| `GET /display.png` | PNG of the current image. Browser preview only. |
| `GET /control` | The React control-panel UI. |
| `GET /widgets-matrix` | Layout debug grid. |
| `GET/POST /api/config` | Read/write the dashboard config. |
| `POST /api/config/reset` | Restore default config. |
| `GET/POST /api/alarms` | Alarm CRUD. |
| `GET /api/preview-data` | Sample data for the live preview. |
| `GET /api/geocode`, `/api/reverse-geocode`, `/api/weather-check` | Location/weather setup helpers for the control UI. |
| `GET /api/health/widgets` | Per-widget last-fetch status. |

## Provisioning (out of band)

WiFi credentials live in the device's NVS, not the HTTP protocol. As
of firmware 1.8.0 (bw):

- On cold boot with empty NVS, the device brings up an open WiFi AP
  named `eink-setup`. The user joins from a phone; iOS/Android
  captive-portal detection auto-loads a configuration page where they
  pick their network and enter the password. WiFi creds persist in
  NVS after the first successful connect.
- Holding the refresh button for 5 seconds wipes WiFi creds and
  restarts the device, re-triggering the captive portal on the next
  boot.

Server URL + device token are still baked into the firmware image at
CI time (see `.github/workflows/build-firmware.yml`). A future change
will move per-device auth onto the wire protocol via `/api/setup` +
`X-API-Key`.

## Layout primitives & playlists (server-side)

Each `cfg.screens[i]` carries a `layoutKind` field. Values:

- `free` (default, backwards-compatible) — uses the saved freeform
  `layout[]` of `{widgetId, x, y, w, h}` tiles.
- `full` — one widget filling the 24×12 grid.
- `half_horizontal` — two widgets stacked (top: 24×6, bottom: 24×6).
- `half_vertical` — two widgets side-by-side (left: 12×12, right: 12×12).
- `quadrant` — four widgets, one per quarter (12×6 each).

Primitive screens populate widgets via a `slots[]` field — an ordered
list of `{widgetId, settings?}` entries, one per slot. The server
generates the layout array at render time so the renderer doesn't need
to know about layoutKind.

Playlist mode: setting `cfg.playlist = { enabled: true, minutesPerScreen: 5 }`
rotates through every enabled screen on a fixed wall-clock cadence,
ignoring per-screen schedules. Deterministic — the active screen is
`floor(epochMinutes / minutesPerScreen) % screens.length`.

## Versioning policy

- **v1** (current) — everything documented above.
- A breaking change to any device-facing endpoint or the `/display.bin`
  byte format bumps the contract to v2. Until v2 lands the server
  promises:
  - 48000-byte raw 1-bit blob at `/display.bin`.
  - Sleep info at `/sleep` as JSON `{minutes, ...}`.
  - OTA manifest at `/api/firmware/manifest` returns `204` or the JSON
    shape above.
  - Token auth via `?token=` or `X-Device-Token`.

- Additive changes (new optional headers, new endpoints) do not bump
  the version.

- When v2 ships, the device negotiates by sending its supported
  version in a request header; the server keeps v1 routes alive for
  one full release cycle so older firmware on devices that haven't
  yet OTA'd doesn't break.
