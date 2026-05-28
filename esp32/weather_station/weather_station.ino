// weather_station.ino — Server-rendered version
// Pulls a pre-rendered 800x480 1-bit image from your dashboard server
// and pushes it to the Waveshare 7.5" GDEY075T7 display.
//
// All layout/drawing logic now lives on the server. This firmware only:
//   1. Connects to WiFi
//   2. Downloads /display.bin (48000 bytes raw 1-bit)
//   3. Pushes it to the display
//   4. Asks the server how long to sleep (so refresh interval is configurable from web)
//   5. Deep sleep
//
// Total bandwidth per refresh: ~48 KB. Battery friendly.

#define USE_HSPI_FOR_EPD

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <ArduinoJson.h>
#include <GxEPD2_BW.h>
#include <SPI.h>
#include <driver/rtc_io.h>

// =================== CONFIG ===================
// Per-device secrets live in secrets.h (gitignored). Copy
// secrets.h.example to secrets.h and fill in your values.
#include "secrets.h"

// OTA: bump on every release. Server returns 204 unless its newest
// matching `bw-X.Y.Z.bin` is strictly greater than this.
#define FW_VERSION "1.4.2"
#define FW_BOARD   "bw"
#define OTA_MIN_BATT_PCT 50

#define DEFAULT_SLEEP_MIN 30

// Battery sense — 1MΩ + 1MΩ divider from V_batt to GND, mid-point on GPIO34.
// V_batt = V_GPIO34 × 2.0. Equal resistors keep V_GPIO34 ≤ 2.1V at full
// charge (well within the 11dB ADC range, no risk of pin damage).
#define BATTERY_PIN  34
#define BATT_FULL_V  4.2f
#define BATT_EMPTY_V 3.3f
#define DIVIDER_RATIO 2.0f

// Display geometry — matches server's render
#define SW 800
#define SH 480
#define IMG_BYTES (SW * SH / 8)   // 48000

// Two-zone refresh layout. Server splits /display.bin into a 800x60
// header strip (always-changing clock band) and a 800x420 body region
// that's ETag-gated so quiet 30 min intervals skip the slow refresh.
#define HEADER_ROWS  60
#define BODY_ROWS    (SH - HEADER_ROWS)        // 420
#define HEADER_BYTES (SW * HEADER_ROWS / 8)    // 6000
#define BODY_BYTES   (SW * BODY_ROWS / 8)      // 42000

// Pins (unchanged from your working setup)
static const int EPD_BUSY = 25, EPD_RST = 26, EPD_DC = 27;
static const int EPD_CS = 15, EPD_SCK = 13, EPD_MOSI = 14;

// =================== INPUT PINS ===================
//
// Manual-refresh button on GPIO32 wired to GND. Internal pull-up holds
// pin HIGH idle; press pulls LOW and wakes via ext1 ALL_LOW. GPIO32 is
// RTC-capable, no external resistor needed.
#define BTN_REFRESH  32

#define WAKE_PIN_MASK (1ULL << BTN_REFRESH)

// Active buzzer (drives itself when HIGH). Direct GPIO drive — ~30 mA
// stays within the 40 mA pin limit. Passive buzzers won't work here:
// they need a PWM/tone signal, not just a static HIGH.
//
// Volume is software-controlled via LEDC PWM. The 20 kHz carrier is
// above human hearing so it doesn't add its own whine — it modulates
// the effective voltage the buzzer sees, which scales its loudness.
// Range 0-255. ~64 = soft; below ~10 the buzzer falls under its
// minimum operating voltage and goes silent.
#define BUZZER_PIN     4
#define BUZZER_FREQ    20000
#define BUZZER_RES     8
#define BUZZER_VOLUME  64
#define LOW_BATT_PCT   10

SPIClass hspi(HSPI);
GxEPD2_BW<GxEPD2_750_GDEY075T7, GxEPD2_750_GDEY075T7::HEIGHT>
  display(GxEPD2_750_GDEY075T7(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));

// =================== BUZZER ===================

inline void buzzerOn()  { ledcWrite(BUZZER_PIN, BUZZER_VOLUME); }
inline void buzzerOff() { ledcWrite(BUZZER_PIN, 0); }

void beep(int ms) {
  buzzerOn();
  delay(ms);
  buzzerOff();
}

// Set by the button ISR when a press happens mid-cycle. The main refresh
// loop re-runs while this flag is set, so a click during the active
// window queues another fetch+render instead of being ignored.
volatile bool refreshRequested = false;

// Diagnostic state populated early in setup() so drawFailScreen() can
// surface it on the e-ink panel without needing extra parameters. Lets
// the screen double as a troubleshooting log when there's no Serial.
const char* g_wakeLabel = "?";
float       g_battV     = NAN;
int         g_battPct   = -1;

// Last body-region ETag returned by the server, preserved across deep
// sleep via RTC slow memory. On cold boot (POR) RTC memory is zeroed,
// so the first request after a reset always misses the cache and pulls
// a full body refresh. Sized for sha1 hex (40 chars) + quotes + slack.
RTC_DATA_ATTR char g_lastBodyEtag[80] = {0};

// Count of consecutive partial refreshes since the last full one. BW
// e-ink particles don't fully settle under partial refresh, so after
// ~10 cycles a faint ghost of the previous image bleeds through and
// the panel looks dirty. Force a full refresh every this many wakes
// to clear the carry-over.
RTC_DATA_ATTR uint16_t g_partialRefreshCount = 0;
#define FULL_REFRESH_EVERY 10

// Pin-change ISR: mirror button state to buzzer AND latch a refresh
// request on press. While awake, any press buzzes for the duration the
// button is held; on release the buzzer goes silent. During deep sleep
// the CPU is off and this ISR doesn't run — the ~200 ms boot + beep(50)
// on buttonWake covers that case instead.
void IRAM_ATTR onButtonEdge() {
  bool pressed = digitalRead(BTN_REFRESH) == LOW;
  ledcWrite(BUZZER_PIN, pressed ? BUZZER_VOLUME : 0);
  if (pressed) refreshRequested = true;
}

// Two short beeps with a small gap — "OK / done" chime.
void beepChime() {
  beep(30);
  delay(50);
  beep(30);
}

// Two longer beeps — louder/longer than chime so a low-battery alert
// isn't mistaken for a successful-refresh chime.
void beepLowBattery() {
  beep(200);
  delay(100);
  beep(200);
}

// =================== SERVER SELECTION (LAN → cloud fallback) ===================

// Resolved at runtime after WiFi connects. Points at whichever URL in
// secrets.h answered /health first (LAN preferred). All HTTP helpers
// below use this instead of the raw config constants.
const char* activeServerBase = "";

// Quick reachability probe — 3 s timeout, single /health round-trip.
// Used to decide between the LAN server (typically a Mac on the same
// network) and the always-on cloud deployment.
bool probeBase(const char* base) {
  if (!base || !*base) return false;
  HTTPClient http;
  http.setTimeout(3000);
  String url = String(base) + "/health";
  if (!http.begin(url)) return false;
  int code = http.GET();
  http.end();
  return code == 200;
}

void selectServerBase() {
  if (probeBase(serverBaseLan)) {
    activeServerBase = serverBaseLan;
    Serial.printf("Server: LAN (%s)\n", activeServerBase);
    return;
  }
  if (serverBaseCloud && *serverBaseCloud) {
    activeServerBase = serverBaseCloud;
    Serial.printf("Server: CLOUD fallback (%s)\n", activeServerBase);
    return;
  }
  activeServerBase = serverBaseLan;
  Serial.printf("Server: no cloud configured, sticking with LAN (%s)\n", activeServerBase);
}

// =================== WIFI ===================

bool connectWiFiOnce(unsigned long timeoutMs = 15000) {
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true, true);
  delay(100);
  WiFi.begin(ssid, password);
  Serial.print("WiFi");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - start) < timeoutMs) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("Connected: %s  RSSI=%d\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
    return true;
  }
  return false;
}

// Retry WiFi a few times — landlord AP is flaky, single attempt fails often
bool connectWiFi() {
  for (int attempt = 1; attempt <= 3; attempt++) {
    Serial.printf("WiFi attempt %d/3\n", attempt);
    if (connectWiFiOnce()) return true;
    WiFi.disconnect(true, true);
    delay(1000);
  }
  Serial.println("WiFi FAILED after 3 tries");
  return false;
}

// =================== HTTP HELPERS ===================

// Wake Railway free-tier server before big download.
// Free tier sleeps after ~15min idle — first req takes 30-60s to boot Puppeteer.
// Cheap /health ping kicks it awake while we still have time budget.
void warmServer() {
  String url = String(activeServerBase) + "/health";
  HTTPClient http;
  http.setTimeout(45000);
  http.begin(url);
  Serial.print("Warming server... ");
  unsigned long t0 = millis();
  int code = http.GET();
  Serial.printf("HTTP %d in %lums\n", code, millis() - t0);
  http.end();
}

String addToken(String url) {
  if (strlen(deviceToken) == 0) return url;
  url += (url.indexOf('?') >= 0) ? "&" : "?";
  url += "token=";
  url += deviceToken;
  return url;
}

// Download a fixed-size slice of the rendered display image from one of
// the server's split endpoints. Returns:
//   1 = HTTP 200, `buf` is filled with `expectedBytes`, etagOut populated
//   2 = HTTP 304, body unchanged, `buf` left untouched
//   0 = error (timeout, wrong size, bad status code, etc.)
//
// ETag round-trip lets the server skip the slow body refresh entirely
// during quiet 30 min intervals when nothing in the dashboard changed.
int downloadSlice(const char* path, uint8_t* buf, int expectedBytes,
                  const char* ifNoneMatch, char* etagOut, size_t etagOutSize) {
  String url = addToken(String(activeServerBase) + path);
  Serial.printf("GET %s\n", url.c_str());

  HTTPClient http;
  http.setTimeout(60000);
  http.begin(url);
  if (ifNoneMatch && *ifNoneMatch) {
    http.addHeader("If-None-Match", ifNoneMatch);
  }
  static const char* collectHdrs[] = { "ETag" };
  http.collectHeaders(collectHdrs, 1);

  int code = http.GET();
  if (code == 304) {
    Serial.println("304 — unchanged");
    http.end();
    return 2;
  }
  if (code != 200) {
    Serial.printf("HTTP %d\n", code);
    http.end();
    return 0;
  }

  if (etagOut && etagOutSize > 0) {
    String etag = http.header("ETag");
    strlcpy(etagOut, etag.c_str(), etagOutSize);
  }

  int len = http.getSize();
  if (len > 0 && len != expectedBytes) {
    Serial.printf("Unexpected size %d (expected %d)\n", len, expectedBytes);
    http.end();
    return 0;
  }

  WiFiClient* stream = http.getStreamPtr();
  int readBytes = 0;
  unsigned long lastData = millis();
  while (readBytes < expectedBytes) {
    size_t avail = stream->available();
    if (avail) {
      int n = stream->readBytes(buf + readBytes,
                                min((int)avail, expectedBytes - readBytes));
      readBytes += n;
      lastData = millis();
    } else {
      if (millis() - lastData > 10000) {
        Serial.println("stream timeout");
        break;
      }
      delay(5);
    }
  }
  http.end();

  if (readBytes != expectedBytes) {
    Serial.printf("Short read: %d / %d\n", readBytes, expectedBytes);
    return 0;
  }
  Serial.printf("Got %d bytes\n", readBytes);
  return 1;
}

// =================== BATTERY ===================

void setupBattery() {
  analogReadResolution(12);
  analogSetPinAttenuation(BATTERY_PIN, ADC_11db);
}

// Returns battery voltage in volts. Averages 16 calibrated samples
// (analogReadMilliVolts applies the per-chip eFuse Vref so we don't have
// to assume Vref = 3.3V).
float readBatteryVoltage() {
  long sumMv = 0;
  for (int i = 0; i < 16; i++) {
    sumMv += analogReadMilliVolts(BATTERY_PIN);
    delay(2);
  }
  float v_gpio = (sumMv / 16.0f) / 1000.0f;
  return v_gpio * DIVIDER_RATIO;
}

int batteryPctFromVoltage(float v) {
  int pct = (int)((v - BATT_EMPTY_V) / (BATT_FULL_V - BATT_EMPTY_V) * 100.0f);
  if (pct > 100) pct = 100;
  if (pct < 0)   pct = 0;
  return pct;
}

// Fire-and-forget POST. Battery telemetry is non-critical — short timeout,
// don't block the image refresh if the endpoint is slow.
void postBattery(float v, int pct) {
  String url = addToken(String(activeServerBase) + "/api/battery");
  HTTPClient http;
  http.setTimeout(5000);
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  char body[80];
  snprintf(body, sizeof(body), "{\"v\":%.2f,\"pct\":%d}", v, pct);
  int code = http.POST(body);
  Serial.printf("Battery POST: %.2fV %d%% → HTTP %d\n", v, pct, code);
  http.end();
}

// =================== OTA ===================
//
// Each timer wake: GET /api/firmware/manifest?board=...&from=FW_VERSION.
// Server returns 204 when up-to-date, otherwise {version, url, size}.
// If newer, run httpUpdate which flashes the inactive OTA partition and
// reboots into the new build. Skipped on button wake (user wants instant
// refresh, not a 30s flash) and on low battery (brick risk if LiPo dies
// mid-flash). setInsecure() skips TLS cert validation — DEVICE_TOKEN in
// the URL is the auth, cert pinning isn't worth the rotation pain.
void checkForUpdate(int battPct, bool buttonWake) {
  if (buttonWake) {
    Serial.println("OTA: skip on button wake");
    return;
  }
  if (battPct < OTA_MIN_BATT_PCT) {
    Serial.printf("OTA: skip, battery %d%% < %d%%\n", battPct, OTA_MIN_BATT_PCT);
    return;
  }

  String url = String(activeServerBase) + "/api/firmware/manifest?board=" + FW_BOARD + "&from=" + FW_VERSION;
  url = addToken(url);

  HTTPClient http;
  http.setTimeout(10000);
  http.begin(url);
  int code = http.GET();
  if (code == 204) {
    Serial.println("OTA: up-to-date");
    http.end();
    return;
  }
  if (code != 200) {
    Serial.printf("OTA: manifest HTTP %d\n", code);
    http.end();
    return;
  }
  String body = http.getString();
  http.end();

  StaticJsonDocument<512> doc;
  if (deserializeJson(doc, body) != DeserializationError::Ok) {
    Serial.println("OTA: bad manifest JSON");
    return;
  }
  String newVer = String((const char*)(doc["version"] | ""));
  String binUrl = String((const char*)(doc["url"] | ""));
  if (binUrl.length() == 0) {
    Serial.println("OTA: empty url");
    return;
  }
  Serial.printf("OTA: %s -> %s\n", FW_VERSION, newVer.c_str());
  Serial.printf("OTA: %s\n", binUrl.c_str());

  WiFiClientSecure secureClient;
  secureClient.setInsecure();
  WiFiClient plainClient;
  bool isHttps = binUrl.startsWith("https://");

  httpUpdate.rebootOnUpdate(true);
  t_httpUpdate_return result = isHttps
    ? httpUpdate.update(secureClient, binUrl)
    : httpUpdate.update(plainClient, binUrl);

  switch (result) {
    case HTTP_UPDATE_FAILED:
      Serial.printf("OTA FAILED (%d): %s\n",
                    httpUpdate.getLastError(),
                    httpUpdate.getLastErrorString().c_str());
      break;
    case HTTP_UPDATE_NO_UPDATES:
      Serial.println("OTA: no updates");
      break;
    case HTTP_UPDATE_OK:
      // Unreachable — rebootOnUpdate(true) restarts before we return.
      Serial.println("OTA: applied (rebooting)");
      break;
  }
}

int fetchSleepMinutes() {
  String url = addToken(String(activeServerBase) + "/sleep");
  HTTPClient http;
  http.setTimeout(5000);
  http.begin(url);
  int code = http.GET();
  int mins = DEFAULT_SLEEP_MIN;
  if (code == 200) {
    String body = http.getString();
    StaticJsonDocument<128> doc;
    if (deserializeJson(doc, body) == DeserializationError::Ok) {
      mins = doc["minutes"] | DEFAULT_SLEEP_MIN;
    }
  }
  http.end();
  if (mins < 1) mins = 1;
  if (mins > 1440) mins = 1440;
  return mins;
}

// =================== DISPLAY ===================

// Draw a fallback "couldn't connect" screen so you know what's up
void drawFailScreen(const char* reason) {
  display.setRotation(0);
  display.setFullWindow();
  // Two full refreshes: first wipes any partial-refresh ghosting to
  // white, second draws the message. Otherwise the prior dashboard
  // image bleeds through behind the error text.
  display.clearScreen();
  // Counter resets — clearScreen() + the upcoming page render are full
  // cycles, so we're starting clean.
  g_partialRefreshCount = 0;

  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    display.fillRect(0, 0, SW, 60, GxEPD_BLACK);
    display.setTextColor(GxEPD_WHITE);
    display.setCursor(20, 38);
    display.setTextSize(3);
    display.print("CONNECTION ERROR");

    display.setTextColor(GxEPD_BLACK);
    display.setTextSize(2);
    int y = 100;
    display.setCursor(20, y); y += 30;
    display.print(reason);

    display.setCursor(20, y); y += 30;
    display.print("SSID:    ");
    display.print(ssid);

    display.setCursor(20, y); y += 30;
    display.print("SERVER:  ");
    display.print((activeServerBase && *activeServerBase) ? activeServerBase : "(none yet)");

    display.setCursor(20, y); y += 30;
    display.print("FIRMWARE: ");
    display.print(FW_VERSION);
    display.print(" (board=");
    display.print(FW_BOARD);
    display.print(")");

    display.setCursor(20, y); y += 30;
    display.print("WAKE:    ");
    display.print(g_wakeLabel);

    display.setCursor(20, y); y += 30;
    if (g_battPct >= 0 && !isnan(g_battV)) {
      display.print("BATTERY: ");
      display.print(g_battV, 2);
      display.print("V (");
      display.print(g_battPct);
      display.print("%)");
    } else {
      display.print("BATTERY: --");
    }

    display.setCursor(20, y); y += 30;
    display.print("Retrying in 5 min");
  } while (display.nextPage());
  display.hibernate();
}

// Push a region of the rendered image and trigger a partial refresh.
// The BW T7 panel supports partial updates of arbitrary windows, so the
// always-changing header strip can be repainted in ~1 s and the larger
// body region can be skipped entirely when the server ETag matches.
void pushRegion(const uint8_t* buf, int x, int y, int w, int h) {
  display.setRotation(0);
  display.setPartialWindow(x, y, w, h);
  display.epd2.writeImage(buf, x, y, w, h, false, false, false);
  display.refresh(true);
}

// Push the entire 48000-byte image with one FULL refresh. Used on cold
// boot and periodically (every FULL_REFRESH_EVERY partial cycles) to
// scrub accumulated ghosting that partial refresh leaves behind.
void pushFullImage(const uint8_t* header, const uint8_t* body) {
  display.setRotation(0);
  display.setFullWindow();
  display.epd2.writeImage(header, 0, 0, SW, HEADER_ROWS, false, false, false);
  display.epd2.writeImage(body,   0, HEADER_ROWS, SW, BODY_ROWS, false, false, false);
  display.refresh(false);  // false = full-update mode
}

// Two-zone refresh:
//   1. Always download the header strip (clock).
//   2. ETag-gated body download. On 304 (server says unchanged) skip
//      the body fetch entirely; on 200 grab the bytes + new ETag.
//   3. If the counter says we're due for a full refresh (every
//      FULL_REFRESH_EVERY wakes), force a body fetch even if the server
//      would 304, then write both regions in one full-window refresh
//      to reset ghosting. Otherwise paint the header partial and the
//      body partial (when bytes arrived).
//
// Returns true if at least the header was refreshed.
bool refreshTwoZone(bool forceFullBody) {
  uint8_t* header = (uint8_t*)malloc(HEADER_BYTES);
  uint8_t* body   = (uint8_t*)malloc(BODY_BYTES);
  if (!header || !body) {
    Serial.println("malloc failed for header/body buffers");
    free(header); free(body);
    return false;
  }

  int hres = downloadSlice("/display-header.bin", header, HEADER_BYTES,
                           nullptr, nullptr, 0);
  if (hres != 1) {
    free(header); free(body);
    return false;
  }

  // Are we due for a ghost-clearing full refresh?
  const bool dueForFull = (g_partialRefreshCount >= FULL_REFRESH_EVERY);
  const bool needsFullBody = forceFullBody || dueForFull;
  if (needsFullBody) {
    Serial.printf("Full refresh (count=%u, force=%d)\n",
                  g_partialRefreshCount, forceFullBody);
  }

  char newEtag[80] = {0};
  // Force a body download (no If-None-Match) when we plan to do a full
  // refresh — we need the actual bytes for that path, not a 304.
  const char* ifNone = needsFullBody ? nullptr : g_lastBodyEtag;
  int bres = downloadSlice("/display-body.bin", body, BODY_BYTES,
                           ifNone, newEtag, sizeof(newEtag));

  if (needsFullBody && bres == 1) {
    pushFullImage(header, body);
    strlcpy(g_lastBodyEtag, newEtag, sizeof(g_lastBodyEtag));
    g_partialRefreshCount = 0;
    Serial.println("Full refresh applied — ghost cleared");
  } else {
    // Normal partial-refresh path.
    pushRegion(header, 0, 0, SW, HEADER_ROWS);
    if (bres == 1) {
      pushRegion(body, 0, HEADER_ROWS, SW, BODY_ROWS);
      strlcpy(g_lastBodyEtag, newEtag, sizeof(g_lastBodyEtag));
      Serial.println("Body refreshed + ETag saved");
    } else if (bres == 2) {
      Serial.println("Body unchanged (304) — refresh skipped");
    } else {
      Serial.println("Body download failed — header alone refreshed");
    }
    g_partialRefreshCount++;
  }

  free(header); free(body);
  display.hibernate();
  return true;
}

// =================== MAIN ===================

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n=== E-Ink Dashboard Client ===");
  Serial.printf("Firmware: %s board=%s\n", FW_VERSION, FW_BOARD);

  ledcAttach(BUZZER_PIN, BUZZER_FREQ, BUZZER_RES);
  buzzerOff();

  // Arm button-mirror ISR so any click while CPU is awake beeps instantly.
  pinMode(BTN_REFRESH, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(BTN_REFRESH), onButtonEdge, CHANGE);

  // initial=true in GxEPD2 runs the panel through its full init + clear
  // pass. That's needed exactly once on a cold boot; on a deep-sleep wake
  // it just wipes the previously-displayed image to white before the new
  // one paints. Branch on the wake cause so we only clear when we have to.
  esp_sleep_wakeup_cause_t wakeCause = esp_sleep_get_wakeup_cause();
  bool coldBoot = (wakeCause == ESP_SLEEP_WAKEUP_UNDEFINED);
  bool buttonWake = (wakeCause == ESP_SLEEP_WAKEUP_EXT1);

  // Acknowledge the press immediately — WiFi connect takes seconds and
  // the user is standing there waiting to hear something happened.
  if (buttonWake) beep(50);
  const char* wakeLabel = coldBoot ? "cold/POR"
                        : buttonWake ? "BTN_REFRESH"
                        : "timer";
  g_wakeLabel = wakeLabel;
  Serial.printf("Wake cause: %d (%s)\n", wakeCause, wakeLabel);

  hspi.begin(EPD_SCK, -1, EPD_MOSI, EPD_CS);
  display.epd2.selectSPI(hspi, SPISettings(4000000, MSBFIRST, SPI_MODE0));
  display.init(115200, coldBoot, 2, false);

  // Read battery early — voltage is most accurate before WiFi pulls
  // current. We POST it after the radio is up.
  setupBattery();
  float battV   = readBatteryVoltage();
  int   battPct = batteryPctFromVoltage(battV);
  g_battV   = battV;
  g_battPct = battPct;
  Serial.printf("Battery: %.2fV (%d%%)\n", battV, battPct);

  // Audible low-battery alert before WiFi — if battery is critical the
  // wake may fail entirely and the user would never hear about it.
  if (battPct < LOW_BATT_PCT) beepLowBattery();

  int sleepMin = DEFAULT_SLEEP_MIN;

  if (!connectWiFi()) {
    drawFailScreen("WiFi connection failed");
    sleepMin = 5;
  } else {
    selectServerBase();  // probe LAN first, fall back to cloud
    warmServer();   // wake Railway dyno before the big download
    postBattery(battV, battPct);
    checkForUpdate(battPct, buttonWake);   // may not return (reboots on success)

    // Refresh loop: re-runs while a button press came in during the
    // last iteration, so an awake-state click triggers another refresh
    // instead of being dropped on the floor.
    //
    // On cold boot the panel was wiped to white by display.init()'s
    // clear pass — the saved body ETag would mismatch reality, so we
    // force a full body fetch even if the server would have sent 304.
    bool forceBodyOnNext = coldBoot;
    do {
      refreshRequested = false;
      bool ok = refreshTwoZone(forceBodyOnNext);
      if (!ok) {
        Serial.println("Two-zone refresh failed — retry once after 2s");
        delay(2000);
        ok = refreshTwoZone(forceBodyOnNext);
      }
      if (ok) {
        beepChime();   // "refresh done"
        sleepMin = fetchSleepMinutes();
        Serial.printf("Sleep %d min\n", sleepMin);
      } else {
        drawFailScreen("Could not fetch image");
        sleepMin = 5;
      }
      forceBodyOnNext = false;   // only the first pass needs the force
      if (refreshRequested) Serial.println("Press during cycle — re-refreshing");
    } while (refreshRequested);
  }

  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);

  // Wait for button release before arming ext1 — otherwise a still-held
  // press re-triggers wake the instant we enter deep sleep.
  unsigned long t0 = millis();
  while (digitalRead(BTN_REFRESH) == LOW && millis() - t0 < 5000) {
    delay(10);
  }
  detachInterrupt(digitalPinToInterrupt(BTN_REFRESH));
  buzzerOff();   // guarantee silent before deep sleep
  ledcDetach(BUZZER_PIN);
  rtc_gpio_pulldown_dis((gpio_num_t)BTN_REFRESH);
  rtc_gpio_pullup_en((gpio_num_t)BTN_REFRESH);

  esp_sleep_enable_timer_wakeup((uint64_t)sleepMin * 60ULL * 1000000ULL);
  esp_sleep_enable_ext1_wakeup(WAKE_PIN_MASK, ESP_EXT1_WAKEUP_ALL_LOW);
  Serial.flush();
  esp_deep_sleep_start();
}

void loop() {}
