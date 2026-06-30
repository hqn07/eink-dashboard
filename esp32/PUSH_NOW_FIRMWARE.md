# Firmware edit: honor `X-Refresh-Seconds` (true sub-minute push-now)

**Status: written, NOT flashed/verified on hardware.** The server already
sends an `X-Refresh-Seconds` header; current firmware ignores it and uses the
minute-granular `X-Refresh-Rate` (so a push-now window already speeds the
device up to a 1-minute floor). This edit makes the device sleep in **seconds**
so a push-now window can poll every ~20 s instead of every 60 s.

Apply to whichever board you flash:
- `esp32/weather_station_b/weather_station_b.ino` — **3-color B panel (primary)**
- `esp32/weather_station/weather_station.ino` — BW panel (same edits, minor diffs noted)

No server changes — that side is done. After flashing, a push-now window makes
the device converge in ~20 s once it has woken into the window. The ceiling is
unchanged: the device must wake **once** (at its current interval) to enter the
window; deep sleep can't be interrupted remotely.

---

## 1. New global (next to `g_serverRefreshMin`)

Find:

```cpp
int         g_serverRefreshMin = -1;
```

Add right below:

```cpp
// Exact next-refresh interval in SECONDS from the X-Refresh-Seconds
// response header. Enables sub-minute polling during a push-now fast
// window. -1 = not seen yet → fall back to the minute-based value.
int         g_serverRefreshSec = -1;
```

## 2. Retain the new header in `collectHeaders`

**B panel** — find:

```cpp
  const char* keepHeaders[] = { "X-Refresh-Rate", "ETag" };
  http.collectHeaders(keepHeaders, 2);
```

replace with:

```cpp
  const char* keepHeaders[] = { "X-Refresh-Rate", "ETag", "X-Refresh-Seconds" };
  http.collectHeaders(keepHeaders, 3);
```

**BW panel** — find:

```cpp
  const char* keepHeaders[] = { "X-Refresh-Rate" };
  http.collectHeaders(keepHeaders, 1);
```

replace with:

```cpp
  const char* keepHeaders[] = { "X-Refresh-Rate", "X-Refresh-Seconds" };
  http.collectHeaders(keepHeaders, 2);
```

## 3. Parse the header (right after each `X-Refresh-Rate` parse block)

Find each block like:

```cpp
  if (http.hasHeader("X-Refresh-Rate")) {
    int rr = http.header("X-Refresh-Rate").toInt();
    if (rr > 0 && rr <= 1440) {
      g_serverRefreshMin = rr;
    }
  }
```

and add immediately after it:

```cpp
  if (http.hasHeader("X-Refresh-Seconds")) {
    int rs = http.header("X-Refresh-Seconds").toInt();
    if (rs >= 10 && rs <= 86400) g_serverRefreshSec = rs;
  }
```

> **B panel has TWO of these** — the 304 (Not Modified) path and the 200 path.
> Add the seconds parse after **both**. The 304 one is the one-liner
> `if (rr > 0 && rr <= 1440) g_serverRefreshMin = rr;` — add the seconds parse
> after that line too. The BW panel has only the one (200) block.

## 4. New helper (right after `fetchSleepMinutes()`)

```cpp
int fetchSleepSeconds() {
  // Prefer the exact seconds hint (push-now fast window). Otherwise use the
  // minute path (X-Refresh-Rate header, or the /sleep fallback) in seconds.
  if (g_serverRefreshSec > 0) {
    int s = g_serverRefreshSec;
    if (s < 10) s = 10;
    if (s > 86400) s = 86400;
    return s;
  }
  return fetchSleepMinutes() * 60;
}
```

## 5. Convert `runCycle()` from minutes to seconds

This function currently computes/returns minutes. Switch its local to seconds.

- `int sleepMin = DEFAULT_SLEEP_MIN;`
  → `int sleepSec = DEFAULT_SLEEP_MIN * 60;`

- WiFi-fail early return `return 5;`
  → `return 300;`

- each `sleepMin = fetchSleepMinutes();` (BW: 1, B: 2 of them)
  → `sleepSec = fetchSleepSeconds();`

- each `Serial.printf("Sleep %d min\n", sleepMin);`
  → `Serial.printf("Sleep %d s\n", sleepSec);`

- image-fail `sleepMin = 5;`
  → `sleepSec = 300;`

- the alarm-shortening block — find:

```cpp
    if (targetSec > 0) {
      int alarmMin = (int)((targetSec + 59) / 60);
      if (alarmMin < 1) alarmMin = 1;
      if (alarmMin < sleepMin) {
        Serial.printf("Alarm in %lld s — shortening sleep to %d min\n",
                      deltaSec, alarmMin);
        sleepMin = alarmMin;
      }
    }
```

  replace with:

```cpp
    if (targetSec > 0) {
      int alarmSec = (int)targetSec;
      if (alarmSec < 1) alarmSec = 1;
      if (alarmSec < sleepSec) {
        Serial.printf("Alarm in %lld s — shortening sleep to %d s\n",
                      deltaSec, alarmSec);
        sleepSec = alarmSec;
      }
    }
```

- final `return sleepMin;`
  → `return sleepSec;`

## 6. Convert the caller in `loop()`

Find:

```cpp
  int sleepMin = runCycle(wakeCause);
  uint64_t sleepUs = (uint64_t)sleepMin * 60ULL * 1000000ULL;
```

replace with:

```cpp
  int sleepSec = runCycle(wakeCause);
  uint64_t sleepUs = (uint64_t)sleepSec * 1000000ULL;   // already seconds
```

Then the two serial prints further down still reference `sleepMin`:

```cpp
    Serial.printf("USB (%.2fV) — active wait %d min\n", vbat, sleepMin);
...
    Serial.printf("Battery (%.2fV) — deep sleep %d min\n", vbat, sleepMin);
```

change both to:

```cpp
    Serial.printf("USB (%.2fV) — active wait %d s\n", vbat, sleepSec);
...
    Serial.printf("Battery (%.2fV) — deep sleep %d s\n", vbat, sleepSec);
```

## 7. Bump `FW_VERSION`

B panel is at `1.14.2` → set `1.15.0`. (BW: bump its own version similarly.)
The server logs FW-Version, so this confirms the flash took.

---

## Flash + verify

1. Arduino IDE → open the `.ino` → select the ESP32 board → Upload.
2. Open Serial Monitor (115200). Press the refresh button to force a cycle.
3. Hit **Settings → Device → Push now** in the control panel.
4. On the device's next wake you should see `Sleep 20 s` (not `Sleep N min`),
   and the panel should re-poll ~every 20 s for ~5 min, then return to the
   normal `Sleep 1800 s` and deep-sleep.

## Sanity / safety notes

- Floors: seconds clamped to **10 s** min, **86400 s** (24 h) max — a 20 s
  poll is fine on USB, heavier on battery, but the window is short (5 min).
- Battery cost: each wake = WiFi join + fetch. A 20 s cadence for 5 min ≈ 15
  extra wakes; negligible vs a full day of 30-min cycles. Tune the window with
  `PUSH_WINDOW_MS` / `PUSH_INTERVAL_SECONDS` on the server.
- If `X-Refresh-Seconds` is ever absent (old server), `g_serverRefreshSec`
  stays -1 and `fetchSleepSeconds()` falls back to the minute path → no
  regression.
