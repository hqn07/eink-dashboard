# Firmware OTA

Drop compiled `.bin` files in this directory. Devices auto-pull on next wake.

## Filename convention

`<board>-<major>.<minor>.<patch>.bin`

- `board` matches `FW_BOARD` constant in the `.ino` (`bw` or `b`)
- Three-part semver. Newest wins per board.

Examples:

- `bw-1.0.0.bin` — Waveshare 7.5" BW V2 build
- `b-1.0.0.bin` — Waveshare 7.5" B (3-color) V2 build

## How to build a .bin

1. Open the `.ino` in Arduino IDE
2. Bump `FW_VERSION` constant
3. **Board → ESP32 Dev Module** → **Partition Scheme → Minimal SPIFFS (1.9MB APP with OTA/128KB SPIFFS)**
4. **Sketch → Export Compiled Binary** → grabs `.ino.bin` from build dir
5. Rename to `<board>-<version>.bin`, drop here, commit + push

## How the device picks it up

1. Each wake, after WiFi connect, hits `GET /api/firmware/manifest?board=<bw|b>&from=<currentVersion>`
2. Server scans this dir, returns `{version, url, size}` if newer exists; else 204
3. Device runs `httpUpdate.update(url)` → flashes inactive OTA partition → reboots into new build
4. Skipped automatically when battery < 50% (avoids brick on dying LiPo)
