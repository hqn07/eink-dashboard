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
#include <esp_wifi.h>   // esp_wifi_get_config — saved SSID even while disconnected
#include <esp_task_wdt.h>
#include <time.h>
// Captive-portal WiFi provisioning. On cold boot with no saved creds,
// brings up an AP named `eink-setup`; the user joins from their phone
// and picks the home network. Cached in NVS automatically — subsequent
// boots reuse the same creds without showing the portal.
// In-house captive portal replaces tzapu/WiFiManager — that lib
// 2.0.17 silently breaks on arduino-esp32 core 3.1.0+ (issues
// #1797, #1490). softAP + WebServer + Preferences gives us the same
// flow in ~80 lines with no external dep.
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>

// =================== CONFIG ===================
// Per-device secrets live in secrets.h (gitignored). Copy
// secrets.h.example to secrets.h and fill in your values.
#include "secrets.h"

// OTA: bump on every release. Server returns 204 unless its newest
// matching `bw-X.Y.Z.bin` is strictly greater than this.
#define FW_VERSION "1.10.4"
#define FW_BOARD   "bw"
#define OTA_MIN_BATT_PCT 50

#define DEFAULT_SLEEP_MIN 30

// USB-power detection: TP4056 holds VBAT at ~4.2V while charging. On
// battery alone the cell drops to ~3.7V soon after disconnect. A
// threshold of 4.10V cleanly separates "USB plugged in" from "running
// off the LiPo" without flapping when the battery is near full.
// When USB-powered we skip light sleep entirely and just delay() —
// CPU stays awake, no sleep-mode complexity, infinite power budget.
// On battery we light-sleep so the radio's association survives the
// idle period and we don't burn ~5 s on a re-join each cycle.
#define VBAT_USB_THRESHOLD 4.10f

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

// Alarm window: if NTP time lands within this many seconds of the
// scheduled fire, treat the wake as the alarm and start ringing.
#define ALARM_WINDOW_SEC 30
// Auto-stop after this long if the user doesn't press the button.
#define ALARM_TIMEOUT_SEC 60

// Holder for the next-alarm payload. Declared above any function that
// touches it because the Arduino IDE's auto-prototype generator scans
// for function signatures and inserts forward declarations at the very
// top of the translation unit — before the rest of the .ino's struct
// definitions would be reached.
struct NextAlarm {
  uint64_t tsMs;           // Unix epoch ms (server clock)
  uint64_t serverNowMs;    // Server's "now" — for measuring clock skew
  int      durationSec;
  char     label[48];
};

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
// Server's last-reported next-refresh interval, captured from the
// X-Refresh-Rate response header on /display.bin. -1 = none yet
// (firmware falls back to /sleep until the server has answered once).
int         g_serverRefreshMin = -1;

// Survives deep sleep. Set when drawFailScreen paints the connection
// error (lots of solid black in the header banner), checked on the
// next successful refresh so we can pre-wipe the panel and stop the
// fail-screen ghost from bleeding through.
RTC_DATA_ATTR bool g_lastRenderWasFail = false;


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

// Wrap HTTPClient.begin so HTTPS URLs go through WiFiClientSecure
// with setInsecure() — Railway, Render, etc. all use TLS. Without
// this every cloud call (probe, /display.bin, /api/*) silently fails
// because the default HTTPClient can't validate the cert.
// Caller-owned WiFiClientSecure to avoid lifetime issues across calls.
bool httpBegin(HTTPClient& http, WiFiClientSecure& tls, const String& url) {
  if (url.startsWith("https://")) {
    tls.setInsecure();
    return http.begin(tls, url);
  }
  return http.begin(url);
}

// Quick reachability probe — 3 s timeout, single /health round-trip.
// Used to decide between the LAN server (typically a Mac on the same
// network) and the always-on cloud deployment.
bool probeBase(const char* base) {
  if (!base || !*base) return false;
  HTTPClient http;
  WiFiClientSecure tls;
  http.setTimeout(3000);
  String url = String(base) + "/health";
  if (!httpBegin(http, tls, url)) return false;
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

// Cold-boot WiFi provisioning. If creds were already saved (NVS), this
// returns quickly. Otherwise it brings up a captive portal AP named
// `eink-setup` and blocks for up to 3 minutes waiting for the user to
// pick a network on their phone. Either way, on success NVS holds the
// chosen SSID/password so all future WiFi.begin() calls just work.
// Apply post-connect radio knobs. Must run AFTER the link is up,
// otherwise the calls silently no-op or wedge the driver:
//   setSleep(false) before WiFi.begin → radio stuck at WL_IDLE_STATUS
//                                       (espressif/arduino-esp32#8877)
//   setTxPower      before WiFi.mode  → silent no-op
//                                       (espressif/arduino-esp32#9858)
void applyWiFiTuning() {
  WiFi.setSleep(false);                       // no modem-sleep gaps
  WiFi.setTxPower(WIFI_POWER_19_5dBm);        // crank to chip max
  Serial.printf("WiFi tuning applied — SSID=%s RSSI=%d\n",
                WiFi.SSID().c_str(), WiFi.RSSI());
}

// ---------- In-house captive portal ----------
//
// Keyed on the "wifi" Preferences namespace. NVS schema:
//   ssid : String
//   pass : String
//
// If both are empty at boot, openCaptivePortal() runs softAP +
// WebServer at 192.168.4.1, serves a form, and saves whatever the
// user submits. Block for up to 5 minutes; reboot on save.
//
// Bypasses every WiFiManager 2.0.17 + arduino-esp32 core 3.x bug
// (tzapu/WiFiManager #1797, #1490) because no third-party lib is in
// the path.
Preferences wifiPrefs;
DNSServer dnsServer;
WebServer portal(80);

static const char PORTAL_HTML[] PROGMEM =
  "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
  "<title>eink-setup</title>"
  "<style>body{font-family:system-ui;max-width:420px;margin:24px auto;padding:0 16px;}"
  "h1{font-size:20px}label{display:block;margin:14px 0 6px;font-weight:600}"
  "input{width:100%;padding:10px;font-size:16px;border:2px solid #000;border-radius:0}"
  "button{margin-top:18px;padding:12px 18px;font-size:16px;border:0;background:#000;color:#fff;width:100%}</style>"
  "</head><body><h1>e-ink dashboard setup</h1>"
  "<form action='/save' method='POST'>"
  "<label>WiFi network (SSID)</label><input name='ssid' required>"
  "<label>Password</label><input name='pass' type='password'>"
  "<button>Save &amp; restart</button></form></body></html>";

void openCaptivePortal() {
  Serial.println("Opening captive portal AP=eink-setup …");
  // Deregister this task from any task watchdog that may have been
  // attached during boot — the 5-minute portal loop is intentionally
  // blocking and would otherwise trip TG1WDT_SYS_RESET.
  esp_task_wdt_delete(NULL);

  // Hard-reset WiFi state so leftover STA config from a prior
  // WiFiManager attempt doesn't fight the AP we're about to start.
  WiFi.persistent(false);
  WiFi.disconnect(true, true);
  delay(200);
  WiFi.mode(WIFI_AP);
  delay(200);
  bool apOk = WiFi.softAP("eink-setup");
  Serial.printf("softAP started: %d\n", apOk);
  delay(500);
  IPAddress apIP = WiFi.softAPIP();
  Serial.printf("Portal IP: %s\n", apIP.toString().c_str());

  // DNS hijack so iOS/Android captive-portal detection lands on us.
  dnsServer.start(53, "*", apIP);

  portal.on("/", HTTP_GET, []() {
    portal.send_P(200, "text/html", PORTAL_HTML);
  });
  portal.on("/save", HTTP_POST, []() {
    String ssid = portal.arg("ssid");
    String pass = portal.arg("pass");
    if (!ssid.length()) {
      portal.send(400, "text/plain", "SSID required");
      return;
    }
    wifiPrefs.begin("wifi", false);
    wifiPrefs.putString("ssid", ssid);
    wifiPrefs.putString("pass", pass);
    wifiPrefs.end();
    portal.send(200, "text/html",
      "<html><body style='font-family:system-ui;text-align:center;padding:40px'>"
      "<h2>Saved. Restarting…</h2></body></html>");
    delay(800);
    ESP.restart();
  });
  // Captive-portal redirect endpoints — iOS, Android, Windows probe
  // these and follow the 302 back to the form.
  portal.onNotFound([]() {
    portal.sendHeader("Location", String("http://") + WiFi.softAPIP().toString(), true);
    portal.send(302, "text/plain", "");
  });
  portal.begin();
  Serial.println("Portal ready — join WiFi `eink-setup`, browse http://192.168.4.1/");

  unsigned long start = millis();
  unsigned long lastHb = 0;
  while (millis() - start < 5UL * 60UL * 1000UL) {
    dnsServer.processNextRequest();
    portal.handleClient();
    // Heartbeat every 10 s so we know the loop is alive even with no
    // client traffic. Helps tell "device crashed" from "user hasn't
    // joined the AP yet" while reading serial.
    if (millis() - lastHb > 10000) {
      lastHb = millis();
      Serial.printf("Portal alive (%lus / 300)\n", (millis() - start) / 1000);
    }
    delay(10);
    yield();
  }
  Serial.println("Portal timed out");
  portal.stop();
  dnsServer.stop();
  WiFi.softAPdisconnect(true);
}

bool provisionWiFi() {
  WiFi.mode(WIFI_STA);
  wifiPrefs.begin("wifi", true);
  String ssid = wifiPrefs.getString("ssid", "");
  String pass = wifiPrefs.getString("pass", "");
  wifiPrefs.end();
  if (ssid.length() == 0) {
    Serial.println("No saved WiFi creds — launching portal");
    openCaptivePortal();
    return false;
  }
  Serial.printf("Connecting to saved SSID: %s\n", ssid.c_str());
  WiFi.begin(ssid.c_str(), pass.c_str());
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(300); Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("WiFi up: %s RSSI=%d\n",
                  WiFi.SSID().c_str(), WiFi.RSSI());
    applyWiFiTuning();
    return true;
  }
  Serial.println("Saved creds failed to connect");
  return false;
}

bool connectWiFiOnce(unsigned long timeoutMs = 15000) {
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(100);
  // Read creds from our Preferences namespace (set by the captive
  // portal). Explicit args bypass any ambiguity about whether ESP32's
  // auto-NVS cache is in sync.
  wifiPrefs.begin("wifi", true);
  String ssid = wifiPrefs.getString("ssid", "");
  String pass = wifiPrefs.getString("pass", "");
  wifiPrefs.end();
  if (!ssid.length()) {
    Serial.println("connectWiFiOnce: no saved SSID");
    return false;
  }
  WiFi.begin(ssid.c_str(), pass.c_str());
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
    if (connectWiFiOnce()) { applyWiFiTuning(); return true; }
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
  WiFiClientSecure tls;
  http.setTimeout(45000);
  httpBegin(http, tls, url);
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

// ============ Per-device identity (NVS) ============

Preferences prefs;
String g_apiKey     = "";
String g_friendlyId = "";

void loadAuthFromNVS() {
  prefs.begin("eink", true);   // read-only
  g_apiKey     = prefs.getString("api_key",     "");
  g_friendlyId = prefs.getString("friendly_id", "");
  prefs.end();
  if (g_apiKey.length()) {
    Serial.printf("Loaded api_key (friendly_id=%s)\n", g_friendlyId.c_str());
  }
}

void saveAuthToNVS(const String& k, const String& fid) {
  prefs.begin("eink", false);  // rw
  prefs.putString("api_key",     k);
  prefs.putString("friendly_id", fid);
  prefs.end();
  g_apiKey     = k;
  g_friendlyId = fid;
}

// Attach the device's per-device api key as an HTTP header. Server
// also accepts the legacy ?token= fleet credential, so it's fine to
// call addAuth on requests that already went through addToken.
void addAuth(HTTPClient& http) {
  if (g_apiKey.length() > 0) {
    http.addHeader("X-API-Key", g_apiKey);
  }
}

// First-boot enrollment. POSTs MAC + fw_version + board to /api/setup;
// stores the returned api_key/friendly_id to NVS so subsequent requests
// can authenticate per-device.
bool enrollDevice() {
  if (g_apiKey.length() > 0) return true;
  String url = String(activeServerBase) + "/api/setup";
  Serial.printf("Enrolling: POST %s\n", url.c_str());
  HTTPClient http;
  WiFiClientSecure tls;
  http.setTimeout(8000);
  httpBegin(http, tls, url);
  http.addHeader("Content-Type", "application/json");
  String body = String("{\"mac\":\"") + WiFi.macAddress() +
                "\",\"fw_version\":\"" + FW_VERSION +
                "\",\"board\":\"" + FW_BOARD + "\"}";
  int code = http.POST(body);
  if (code != 200) {
    Serial.printf("Enroll HTTP %d\n", code);
    http.end();
    return false;
  }
  String resp = http.getString();
  http.end();
  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, resp) != DeserializationError::Ok) return false;
  const char* k   = doc["api_key"]     | "";
  const char* fid = doc["friendly_id"] | "";
  if (!k || !*k) return false;
  saveAuthToNVS(k, fid);
  Serial.printf("Enrolled (friendly_id=%s)\n", fid);
  return true;
}

// Download the full 48000-byte image into a heap buffer.
// Returns nullptr on failure (caller frees on success).
uint8_t* downloadImage() {
  String url = addToken(String(activeServerBase) + "/display.bin");
  Serial.printf("GET %s\n", url.c_str());

  HTTPClient http;
  WiFiClientSecure tls;
  http.setTimeout(60000);   // Railway cold start can take 30-60s
  httpBegin(http, tls, url);
  addAuth(http);
  // Telemetry headers — server uses these for adaptive refresh and
  // logs them per request. Server v1 ignores any it doesn't recognise.
  if (!isnan(g_battV))     http.addHeader("Battery-Voltage", String(g_battV, 2));
  if (g_battPct >= 0)      http.addHeader("Battery-Pct",     String(g_battPct));
  http.addHeader("RSSI",       String(WiFi.RSSI()));
  http.addHeader("FW-Version", FW_VERSION);
  http.addHeader("FW-Board",   FW_BOARD);
  // Ask HTTPClient to retain the one response header we care about.
  // X-Refresh-Rate is set by the server on every /display.bin reply.
  const char* keepHeaders[] = { "X-Refresh-Rate" };
  http.collectHeaders(keepHeaders, 1);

  int code = http.GET();
  if (code != 200) {
    Serial.printf("HTTP %d\n", code);
    http.end();
    return nullptr;
  }

  // Capture the adaptive refresh interval before the body read so a
  // mid-stream timeout doesn't drop the hint.
  if (http.hasHeader("X-Refresh-Rate")) {
    int rr = http.header("X-Refresh-Rate").toInt();
    if (rr > 0 && rr <= 1440) {
      g_serverRefreshMin = rr;
    }
  }

  int len = http.getSize();
  if (len > 0 && len != IMG_BYTES) {
    Serial.printf("Unexpected size %d (expected %d)\n", len, IMG_BYTES);
    http.end();
    return nullptr;
  }

  uint8_t* buf = (uint8_t*)ps_malloc(IMG_BYTES);
  if (!buf) buf = (uint8_t*)malloc(IMG_BYTES);
  if (!buf) {
    Serial.println("malloc FAILED");
    http.end();
    return nullptr;
  }

  WiFiClient* stream = http.getStreamPtr();
  int read = 0;
  unsigned long lastData = millis();
  while (read < IMG_BYTES) {
    size_t avail = stream->available();
    if (avail) {
      int n = stream->readBytes(buf + read, min((int)avail, IMG_BYTES - read));
      read += n;
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

  if (read != IMG_BYTES) {
    Serial.printf("Short read: %d / %d\n", read, IMG_BYTES);
    free(buf);
    return nullptr;
  }
  Serial.printf("Got %d bytes\n", read);
  return buf;
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
  WiFiClientSecure tls;
  http.setTimeout(5000);
  httpBegin(http, tls, url);
  addAuth(http);
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
  WiFiClientSecure tls;
  http.setTimeout(10000);
  httpBegin(http, tls, url);
  addAuth(http);
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
  // Prefer the X-Refresh-Rate header the server sent on the most
  // recent /display.bin reply — saves a separate round trip and lets
  // the server adapt per-request (e.g. on low battery / quiet hours).
  if (g_serverRefreshMin > 0) {
    int mins = g_serverRefreshMin;
    if (mins < 1) mins = 1;
    if (mins > 1440) mins = 1440;
    return mins;
  }
  // Legacy fallback for older servers that don't emit the header.
  String url = addToken(String(activeServerBase) + "/sleep");
  HTTPClient http;
  WiFiClientSecure tls;
  http.setTimeout(5000);
  httpBegin(http, tls, url);
  addAuth(http);
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

// =================== ALARMS ===================

// Sync the ESP32's internal RTC against NTP so we can compare local
// wall-clock time to the server's alarm timestamps. Without this the
// "is it alarm time?" check has no anchor.
void syncTime() {
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  struct tm now;
  // Up to 6 s wait for the first NTP response — usually settles in <1 s.
  for (int i = 0; i < 30 && !getLocalTime(&now, 200); i++) {}
  if (getLocalTime(&now, 50)) {
    Serial.printf("NTP synced: %04d-%02d-%02d %02d:%02d:%02d UTC\n",
                  now.tm_year + 1900, now.tm_mon + 1, now.tm_mday,
                  now.tm_hour, now.tm_min, now.tm_sec);
  } else {
    Serial.println("NTP sync FAILED");
  }
}

// Holder for the next-alarm payload. tsMs == 0 means none scheduled.
bool fetchNextAlarm(NextAlarm* out) {
  if (!out) return false;
  out->tsMs = 0;
  out->serverNowMs = 0;
  out->durationSec = 60;
  out->label[0] = 0;

  String url = addToken(String(activeServerBase) + "/api/alarm/next");
  HTTPClient http;
  WiFiClientSecure tls;
  http.setTimeout(5000);
  httpBegin(http, tls, url);
  addAuth(http);
  int code = http.GET();
  if (code != 200) {
    http.end();
    return false;
  }
  String body = http.getString();
  http.end();

  StaticJsonDocument<384> doc;
  if (deserializeJson(doc, body) != DeserializationError::Ok) return false;
  out->serverNowMs = doc["now"] | 0ULL;
  JsonObject next = doc["next"].as<JsonObject>();
  if (next.isNull()) return true;   // no alarm scheduled — still success
  out->tsMs = next["ts"] | 0ULL;
  out->durationSec = next["durationSec"] | 60;
  const char* label = next["label"] | "";
  strlcpy(out->label, label, sizeof(out->label));
  return true;
}

// Big "ALARM" + label + scheduled time text on a full white screen.
void drawAlarmScreen(const char* label) {
  display.setRotation(0);
  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    display.fillRect(0, 0, SW, 80, GxEPD_BLACK);
    display.setTextColor(GxEPD_WHITE);
    display.setCursor(40, 56);
    display.setTextSize(5);
    display.print("ALARM");

    display.setTextColor(GxEPD_BLACK);
    display.setTextSize(4);
    display.setCursor(40, 200);
    display.print(label && *label ? label : "(no label)");

    display.setTextSize(2);
    display.setCursor(40, 280);
    display.print("Press button to dismiss");
  } while (display.nextPage());
  display.hibernate();
}

// Run the alarm loop: paint the alarm screen, then ring the buzzer in
// a pattern until either the user presses the button or the timeout
// elapses. Returns once the alarm is silenced.
void runAlarm(const char* label) {
  Serial.printf("ALARM firing — label=\"%s\"\n", label);
  drawAlarmScreen(label);
  beepChime();   // start of alarm cue
  unsigned long start = millis();
  // Pulse: 200 ms on, 600 ms off.
  while (millis() - start < (unsigned long)ALARM_TIMEOUT_SEC * 1000UL) {
    if (digitalRead(BTN_REFRESH) == LOW) {
      Serial.println("Alarm dismissed by button press");
      break;
    }
    buzzerOn();
    unsigned long t = millis();
    while (millis() - t < 200) {
      if (digitalRead(BTN_REFRESH) == LOW) break;
      delay(10);
    }
    buzzerOff();
    t = millis();
    while (millis() - t < 600) {
      if (digitalRead(BTN_REFRESH) == LOW) break;
      delay(10);
    }
  }
  buzzerOff();
  Serial.println("Alarm ended");
}

// =================== DISPLAY ===================

// Draw a fallback "couldn't connect" screen so you know what's up
void drawFailScreen(const char* reason) {
  g_lastRenderWasFail = true;
  display.setRotation(0);
  display.setFullWindow();

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
    // WiFi.SSID() only returns the SSID of the *current* association,
    // so on the fail screen (= we're not connected) it's empty.
    // esp_wifi_get_config reads the NVS-saved STA config that the
    // last WiFi.begin / WiFiManager.autoConnect persisted, which is
    // what the user actually wants to see when debugging.
    {
      String s = WiFi.SSID();
      if (!s.length()) {
        wifi_config_t conf{};
        if (esp_wifi_get_config(WIFI_IF_STA, &conf) == ESP_OK) {
          s = String((const char*)conf.sta.ssid);
        }
      }
      display.print(s.length() ? s.c_str() : "(unset)");
    }

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

// Direct-write path: send the full 48000-byte buffer to the panel
// controller's RAM once, then trigger a single full refresh. Using
// firstPage/nextPage instead would fire _Update_Full twice (the second
// pass paints WHITE through the OLD-RAM LUT on this panel and wipes
// the image we just drew). One write, one refresh, hibernate.
void pushImage(const uint8_t* buf) {
  display.setRotation(0);
  display.setFullWindow();
  // If the previous render was the fail screen, its big black banner
  // leaves stubborn particles that a single full refresh of the new
  // image can't fully scrub. Pay one extra clearScreen() (white wipe
  // with the full-update LUT) to reset the panel before painting.
  if (g_lastRenderWasFail) {
    Serial.println("Pre-wipe (previous render was fail screen)");
    display.clearScreen();
    g_lastRenderWasFail = false;
  }
  display.fillScreen(GxEPD_WHITE);
  display.epd2.writeImage(buf, 0, 0, SW, SH, false, false, false);
  display.refresh(false);  // false = full refresh — no ghosting
  display.hibernate();
}

// =================== MAIN ===================

// Run one full refresh cycle: read battery → ensure WiFi → check
// alarms/OTA → download + paint image → reschedule. Returns the
// requested sleep length in minutes for the next iteration.
//
// `wakeCause` is the reason we entered this cycle (cold boot, button,
// or timer); used to gate the press-acknowledgement beep and the
// "refresh done" chime.
// How often to re-probe the LAN/cloud /health to refresh the chosen
// base. The Mac LAN server can come up or go away during the day;
// without re-probing the device would stay locked to whichever was
// reachable the first time. Probe every 10 cycles ≈ every ~10 min at
// the default 1-min refresh interval.
#define SERVER_REPROBE_EVERY 10
static int g_cyclesSinceProbe = 999;   // force a probe on the first cycle

int runCycle(esp_sleep_wakeup_cause_t wakeCause) {
  bool coldBoot   = (wakeCause == ESP_SLEEP_WAKEUP_UNDEFINED);
  bool buttonWake = (wakeCause == ESP_SLEEP_WAKEUP_EXT1);

  if (buttonWake) beep(50);
  const char* wakeLabel = coldBoot ? "cold/POR"
                        : buttonWake ? "BTN_REFRESH"
                        : "timer";
  g_wakeLabel = wakeLabel;
  Serial.printf("Wake cause: %d (%s)\n", wakeCause, wakeLabel);

  float battV   = readBatteryVoltage();
  int   battPct = batteryPctFromVoltage(battV);
  g_battV   = battV;
  g_battPct = battPct;
  Serial.printf("Battery: %.2fV (%d%%)\n", battV, battPct);
  if (battPct < LOW_BATT_PCT) beepLowBattery();

  int sleepMin = DEFAULT_SLEEP_MIN;

  // Re-use the existing association if light sleep kept it alive;
  // only re-join when truly disconnected. Light sleep can silently
  // drop the association on some APs, so we always check WiFi.status
  // before assuming we're up.
  bool wifiOk = (WiFi.status() == WL_CONNECTED);
  if (!wifiOk) {
    Serial.println("WiFi dropped — reconnecting");
    wifiOk = connectWiFi();
  }
  // Server-base selection. Run on cold boot, after every reconnect,
  // and periodically (~every 10 cycles) so the device can re-evaluate
  // LAN vs cloud as the Mac server comes up/down during the day.
  if (wifiOk && ((!activeServerBase || !*activeServerBase)
                 || g_cyclesSinceProbe >= SERVER_REPROBE_EVERY)) {
    selectServerBase();
    g_cyclesSinceProbe = 0;
  } else {
    g_cyclesSinceProbe++;
  }

  if (!wifiOk) {
    drawFailScreen("WiFi connection failed");
    return 5;
  }

  warmServer();
  // First-boot enrollment. enrollDevice() is a no-op when g_apiKey is
  // already populated, so this is cheap on every cycle. If the server
  // is unreachable on cold boot the device falls back to the legacy
  // ?token= fleet credential until enrollment succeeds.
  if (g_apiKey.length() == 0) enrollDevice();
  postBattery(battV, battPct);
  checkForUpdate(battPct, buttonWake);   // may not return (reboots on success)
  syncTime();

  NextAlarm na;
  if (fetchNextAlarm(&na) && na.tsMs > 0 && na.serverNowMs > 0) {
    int64_t deltaSec = ((int64_t)na.tsMs - (int64_t)na.serverNowMs) / 1000;
    Serial.printf("Next alarm: \"%s\" in %lld s\n", na.label, deltaSec);
    if (deltaSec >= -ALARM_WINDOW_SEC && deltaSec <= ALARM_WINDOW_SEC) {
      runAlarm(na.label);
    }
  }

  do {
    refreshRequested = false;
    uint8_t* img = downloadImage();
    if (!img) {
      Serial.println("Retry download once after 2s");
      delay(2000);
      img = downloadImage();
    }
    if (img) {
      pushImage(img);
      free(img);
      if (buttonWake) beepChime();
      sleepMin = fetchSleepMinutes();
      Serial.printf("Sleep %d min\n", sleepMin);
    } else {
      drawFailScreen("Could not fetch image");
      sleepMin = 5;
    }
    if (refreshRequested) Serial.println("Press during cycle — re-refreshing");
  } while (refreshRequested);

  NextAlarm post;
  if (fetchNextAlarm(&post) && post.tsMs > 0 && post.serverNowMs > 0) {
    int64_t deltaSec = ((int64_t)post.tsMs - (int64_t)post.serverNowMs) / 1000;
    int64_t targetSec = deltaSec - 15;
    if (targetSec > 0) {
      int alarmMin = (int)((targetSec + 59) / 60);
      if (alarmMin < 1) alarmMin = 1;
      if (alarmMin < sleepMin) {
        Serial.printf("Alarm in %lld s — shortening sleep to %d min\n",
                      deltaSec, alarmMin);
        sleepMin = alarmMin;
      }
    }
  }
  return sleepMin;
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n=== E-Ink Dashboard Client ===");
  Serial.printf("Firmware: %s board=%s\n", FW_VERSION, FW_BOARD);

  ledcAttach(BUZZER_PIN, BUZZER_FREQ, BUZZER_RES);
  buzzerOff();

  pinMode(BTN_REFRESH, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(BTN_REFRESH), onButtonEdge, CHANGE);

  hspi.begin(EPD_SCK, -1, EPD_MOSI, EPD_CS);
  display.epd2.selectSPI(hspi, SPISettings(4000000, MSBFIRST, SPI_MODE0));
  // Force initial=true on cold boot to run the panel through its full
  // reset + clear pass. Subsequent cycles re-init lighter in pushImage.
  display.init(115200, true, 2, false);

  setupBattery();

  // Restore the per-device api_key from NVS if we already enrolled.
  // The first /api/setup POST happens later inside runCycle, once
  // WiFi is up and the server has been selected.
  loadAuthFromNVS();

  // No WiFi.setSleep / setTxPower here — they must run AFTER the radio
  // is associated. See applyWiFiTuning() (called once provisionWiFi
  // and connectWiFi succeed).

  // Run WiFiManager once. If creds are already in NVS this returns
  // fast; otherwise it blocks on the captive portal so the user can
  // configure WiFi on first boot or after a factory reset.
  provisionWiFi();
}

// Wipe both Preferences namespaces and reboot. Triggered by holding
// the refresh button for 5 s — captive portal reopens and the device
// re-enrolls against the server with a fresh identity on the next
// successful provision.
void factoryReset() {
  Serial.println("FACTORY RESET — wiping WiFi creds + api_key");
  buzzerOn();
  delay(1000);
  buzzerOff();
  WiFi.disconnect(true, true);
  wifiPrefs.begin("wifi", false);
  wifiPrefs.clear();             // drop ssid/pass
  wifiPrefs.end();
  prefs.begin("eink", false);
  prefs.clear();                 // drop api_key + friendly_id
  prefs.end();
  delay(200);
  ESP.restart();
}

void loop() {
  esp_sleep_wakeup_cause_t wakeCause = esp_sleep_get_wakeup_cause();

  // 5-second-hold factory reset. We only check on button wakes; a
  // regular timer wake skips this so the user can't accidentally
  // reset by holding the button before sleep ended naturally.
  if (wakeCause == ESP_SLEEP_WAKEUP_EXT1) {
    unsigned long pressStart = millis();
    while (digitalRead(BTN_REFRESH) == LOW) {
      if (millis() - pressStart > 5000) {
        factoryReset();   // never returns
      }
      delay(50);
    }
  }

  int sleepMin = runCycle(wakeCause);
  uint64_t sleepUs = (uint64_t)sleepMin * 60ULL * 1000000ULL;

  // Wait for button release so we don't immediately re-wake on
  // ALL_LOW ext1 with a still-held button.
  unsigned long t0 = millis();
  while (digitalRead(BTN_REFRESH) == LOW && millis() - t0 < 5000) {
    delay(10);
  }
  buzzerOff();

  // Mode select: USB → stay active (no sleep), battery → light sleep.
  // Both keep WiFi associated, so the next cycle doesn't pay the
  // re-join cost on a flaky AP.
  float vbat = readBatteryVoltage();
  bool onUsb = vbat > VBAT_USB_THRESHOLD;

  if (onUsb) {
    Serial.printf("USB (%.2fV) — active wait %d min\n", vbat, sleepMin);
    unsigned long until = millis() + (unsigned long)(sleepUs / 1000ULL);
    while ((long)(until - millis()) > 0) {
      if (refreshRequested) {
        Serial.println("Button pressed — early refresh");
        break;
      }
      delay(200);
    }
  } else {
    Serial.printf("Battery (%.2fV) — light sleep %d min\n", vbat, sleepMin);
    rtc_gpio_pulldown_dis((gpio_num_t)BTN_REFRESH);
    rtc_gpio_pullup_en((gpio_num_t)BTN_REFRESH);
    esp_sleep_enable_timer_wakeup(sleepUs);
    esp_sleep_enable_ext1_wakeup(WAKE_PIN_MASK, ESP_EXT1_WAKEUP_ALL_LOW);
    Serial.flush();
    esp_light_sleep_start();
  }
}
