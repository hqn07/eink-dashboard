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
#include <esp_netif.h>  // esp_netif_set_dns_info — fallback DNS override
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
#define FW_VERSION "1.12.2"
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
// Populated by downloadImage on a failed fetch so drawFailScreen can
// show the underlying HTTP code + a short tip per status. Resets to
// 0 on every cycle entry so a fail screen always shows the *current*
// cycle's failure, not a stale one from before.
int         g_lastHttpCode = 0;
// Survives deep sleep — `time_t` of the last successful download
// (set immediately after pushImage). 0 = never. drawFailScreen shows
// "Last good: Nm ago" so the user knows whether this is a fresh
// outage or a long-running one.
RTC_DATA_ATTR time_t g_lastGoodAt = 0;

// Survives deep sleep. Set when drawFailScreen paints the connection
// error (lots of solid black in the header banner), checked on the
// next successful refresh so we can pre-wipe the panel and stop the
// fail-screen ghost from bleeding through.
RTC_DATA_ATTR bool g_lastRenderWasFail = false;

// Fast-reconnect cache. After the first successful full-scan join we
// remember the AP's BSSID + channel + the DHCP-leased IP/gateway/mask
// /DNS in RTC memory. Subsequent boots feed these directly to
// `WiFi.begin(ssid, pass, channel, bssid)` + `WiFi.config(...)` so the
// radio skips the SSID scan (~2 s) AND the DHCP handshake (~1.5 s).
// Typical association drops from 4-6 s cold to 0.4-0.9 s warm. A failed
// fast-reconnect falls through to the regular scan+DHCP path and the
// cache is rewritten with whatever the AP just handed out.
//
// Reference: github.com/SensorsIot/ESP32-Quick-Wifi-Connect (Spiess).
// Captured early in setup() before WiFi powers up, so the reading is
// taken under idle CPU draw rather than under WiFi-TX transients. The
// LiPo discharge curve assumes open-circuit voltage; reading under
// load lands 50-150 mV low and undercounts %. runCycle pulls this
// value instead of re-reading mid-cycle.
float g_idleBattV = NAN;
int   g_idleBattPct = -1;

RTC_DATA_ATTR uint8_t  g_cachedBssid[6] = {0};
RTC_DATA_ATTR int32_t  g_cachedChannel  = 0;
RTC_DATA_ATTR uint32_t g_cachedLocalIp  = 0;
RTC_DATA_ATTR uint32_t g_cachedGateway  = 0;
RTC_DATA_ATTR uint32_t g_cachedSubnet   = 0;
RTC_DATA_ATTR uint32_t g_cachedDns      = 0;
RTC_DATA_ATTR bool     g_wifiCacheValid = false;


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

// Cloud-only: LAN base retired now that the Mac pushes its widget
// state through the cloud agent. probeBase() is kept around for the
// download retry chain (re-validates the cloud base after two failed
// /display.bin calls).
void selectServerBase() {
  if (serverBaseCloud && *serverBaseCloud) {
    activeServerBase = serverBaseCloud;
    Serial.printf("Server: CLOUD (%s)\n", activeServerBase);
    return;
  }
  activeServerBase = "";
  Serial.println("Server: no cloud base configured in secrets.h");
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
// Some captive / landlord-shared WiFi networks (SETUP-755E in this
// case) hand out a DHCP DNS that drops requests for non-allowlisted
// hosts. That looks like HTTP -1 ("TCP failed") on every cloud call
// because gethostbyname blocks indefinitely. Force lwIP's resolver to
// fall back to Cloudflare 1.1.1.1 and Google 8.8.8.8 once we have an
// IP — both are typically reachable even when the AP's resolver is
// hostile.
void forceFallbackDns() {
  esp_netif_t* sta = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
  if (!sta) return;
  esp_netif_dns_info_t d{};
  d.ip.u_addr.ip4.addr = 0x01010101; // 1.1.1.1
  d.ip.type = ESP_IPADDR_TYPE_V4;
  esp_netif_set_dns_info(sta, ESP_NETIF_DNS_MAIN,     &d);
  d.ip.u_addr.ip4.addr = 0x08080808; // 8.8.8.8
  esp_netif_set_dns_info(sta, ESP_NETIF_DNS_BACKUP,   &d);
  Serial.println("DNS override: 1.1.1.1 / 8.8.8.8");
}

void applyWiFiTuning() {
  // We deep-sleep between cycles, so modem-sleep no longer matters —
  // the radio is fully off during sleep. Only the TX-power crank is
  // worth keeping for range margin on the landlord AP.
  WiFi.setTxPower(WIFI_POWER_19_5dBm);
  Serial.printf("WiFi tuning applied — SSID=%s RSSI=%d\n",
                WiFi.SSID().c_str(), WiFi.RSSI());
}

// Snapshot the current association into RTC memory so the next deep-
// sleep wake can skip the SSID scan + DHCP handshake. Called once a
// fresh (full-path) connect succeeds.
void cacheWifiState() {
  uint8_t* bssid = WiFi.BSSID();
  if (bssid) memcpy(g_cachedBssid, bssid, 6);
  g_cachedChannel = WiFi.channel();
  g_cachedLocalIp = (uint32_t)WiFi.localIP();
  g_cachedGateway = (uint32_t)WiFi.gatewayIP();
  g_cachedSubnet  = (uint32_t)WiFi.subnetMask();
  g_cachedDns     = (uint32_t)WiFi.dnsIP();
  g_wifiCacheValid = true;
  Serial.printf("WiFi cache saved: ch=%d IP=%s\n",
                g_cachedChannel, WiFi.localIP().toString().c_str());
}

void invalidateWifiCache() {
  g_wifiCacheValid = false;
  Serial.println("WiFi cache invalidated");
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

// Read saved SSID/password from the captive-portal Preferences namespace.
// Returns true when both fields are populated.
static bool loadSavedCreds(String& ssid, String& pass) {
  wifiPrefs.begin("wifi", true);
  ssid = wifiPrefs.getString("ssid", "");
  pass = wifiPrefs.getString("pass", "");
  wifiPrefs.end();
  return ssid.length() > 0;
}

// Fast-path connect using the RTC cache. Skips the SSID scan by passing
// the saved BSSID + channel into WiFi.begin and skips DHCP by feeding
// the prior lease into WiFi.config. ~600-900 ms warm-boot association.
bool connectWiFiFast(unsigned long timeoutMs = 4000) {
  if (!g_wifiCacheValid) return false;
  String ssid, pass;
  if (!loadSavedCreds(ssid, pass)) return false;

  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.config(IPAddress(g_cachedLocalIp),
              IPAddress(g_cachedGateway),
              IPAddress(g_cachedSubnet),
              IPAddress(g_cachedDns));
  Serial.printf("WiFi fast: ch=%d BSSID=%02X:%02X:%02X:%02X:%02X:%02X\n",
                g_cachedChannel,
                g_cachedBssid[0], g_cachedBssid[1], g_cachedBssid[2],
                g_cachedBssid[3], g_cachedBssid[4], g_cachedBssid[5]);
  WiFi.begin(ssid.c_str(), pass.c_str(), g_cachedChannel, g_cachedBssid);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - start) < timeoutMs) {
    delay(50);
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("Fast connect OK in %lu ms — RSSI=%d\n",
                  millis() - start, WiFi.RSSI());
    forceFallbackDns();
    return true;
  }
  Serial.printf("Fast connect FAILED after %lu ms — fall back to full scan\n",
                millis() - start);
  invalidateWifiCache();
  WiFi.disconnect(true, true);
  delay(100);
  return false;
}

// Slow-path connect. Full scan + DHCP. Used on cold boot, when the AP
// roamed channels, or when the fast path failed.
bool connectWiFiFull(unsigned long timeoutMs = 15000) {
  String ssid, pass;
  if (!loadSavedCreds(ssid, pass)) {
    Serial.println("connectWiFiFull: no saved SSID");
    return false;
  }
  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.config((uint32_t)0, (uint32_t)0, (uint32_t)0);  // DHCP
  WiFi.disconnect();
  delay(100);
  WiFi.begin(ssid.c_str(), pass.c_str());
  Serial.print("WiFi full");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - start) < timeoutMs) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("Full connect OK in %lu ms — IP=%s RSSI=%d\n",
                  millis() - start,
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
    forceFallbackDns();
    return true;
  }
  return false;
}

// Public entry used by both setup() and runCycle. Tries the fast path
// first, falls back to the full path, retries the full path a couple
// of times for the flaky landlord AP. Refreshes the RTC cache after
// any successful full-path join so the next boot can take the fast
// path again.
bool connectWiFi() {
  if (connectWiFiFast()) { applyWiFiTuning(); return true; }
  for (int attempt = 1; attempt <= 3; attempt++) {
    Serial.printf("WiFi attempt %d/3 (full)\n", attempt);
    if (connectWiFiFull()) {
      applyWiFiTuning();
      cacheWifiState();
      return true;
    }
    WiFi.disconnect(true, true);
    delay(1000);
  }
  Serial.println("WiFi FAILED after 3 full-path tries");
  return false;
}

// Cold-boot path: prefer the fast cache, then fall through to the full
// path, then captive portal if no creds are saved at all. Same shape as
// the old provisionWiFi so callers don't need to change.
bool provisionWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  String ssid, pass;
  if (!loadSavedCreds(ssid, pass)) {
    Serial.println("No saved WiFi creds — launching portal");
    openCaptivePortal();
    return false;
  }
  if (connectWiFiFast()) { applyWiFiTuning(); return true; }
  if (connectWiFiFull()) {
    applyWiFiTuning();
    cacheWifiState();
    return true;
  }
  Serial.println("Saved creds failed to connect (fast + full)");
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
    g_lastHttpCode = code;
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

// Returns battery voltage in volts. Takes 33 calibrated samples
// (analogReadMilliVolts applies the per-chip eFuse Vref so we don't
// have to assume Vref = 3.3V), drops the bottom 25 % to reject the
// transient sag from any WiFi DTIM burst that lands inside the window,
// and averages the remainder. The 5 ms inter-sample delay widens the
// window past the AP beacon interval so a single beacon-aligned burst
// can't dominate.
//
// Why so much defensive averaging:
//   - 1 MΩ + 1 MΩ divider has a 500 kΩ Thevenin output that the ESP32
//     ADC's sample/hold capacitor can't fully charge in the default
//     conversion time. Multiple samples lets the cap re-equalise.
//   - WiFi TX bursts pull 80-200 mA on the same rail; raw reads taken
//     during a burst land 50-150 mV low.
//   - Espressif's calibration eFuse handles the per-chip Vref offset
//     but not the non-linearity near the top of the ADC range, so the
//     same sample population gets clipped to mean-of-upper-quartile
//     instead of straight average.
float readBatteryVoltage() {
  const int N = 33;
  int mv[N];
  for (int i = 0; i < N; i++) {
    mv[i] = (int)analogReadMilliVolts(BATTERY_PIN);
    delay(5);
  }
  // Insertion-sort — fine for N=33, no heap, no extra deps.
  for (int i = 1; i < N; i++) {
    int x = mv[i], j = i - 1;
    while (j >= 0 && mv[j] > x) { mv[j + 1] = mv[j]; j--; }
    mv[j + 1] = x;
  }
  // Average the top 50 % of the sorted samples. Reading-low is the
  // dominant error mode (WiFi load), so trimming the bottom half is
  // a directional bias correction, not just noise rejection.
  long sum = 0;
  int  count = 0;
  for (int i = N / 2; i < N; i++) { sum += mv[i]; count++; }
  float v_gpio = (sum / (float)count) / 1000.0f;
  return v_gpio * DIVIDER_RATIO;
}

// Lookup table mapping LiPo terminal voltage to remaining charge
// percent. The top entry is below the textbook 4.20V because the
// 1MΩ+1MΩ divider's 5% resistor tolerance plus the ESP32 ADC's
// near-rail nonlinearity means a fully-charged 4.20V battery reads
// around 4.10–4.17V on GPIO34. Calling 4.10V "100%" matches what the
// device can actually measure when the cell is topped off.
//
// Below that, the curve follows a typical LiPo discharge profile at
// low load — the cell sits near 3.7V for most of the runtime and
// only sags below 3.5V near empty, so a linear formula would
// underreport health for most of the battery's life.
struct BattCalPoint { float v; int pct; };
static const BattCalPoint BATT_CURVE[] = {
  { 4.10f, 100 },
  { 4.00f,  90 },
  { 3.90f,  75 },
  { 3.80f,  60 },
  { 3.70f,  45 },
  { 3.60f,  30 },
  { 3.50f,  15 },
  { 3.40f,   5 },
  { 3.30f,   0 }
};

int batteryPctFromVoltage(float v) {
  const int N = sizeof(BATT_CURVE) / sizeof(BATT_CURVE[0]);
  if (v >= BATT_CURVE[0].v)     return 100;
  if (v <= BATT_CURVE[N-1].v)   return 0;
  for (int i = 0; i < N - 1; i++) {
    const BattCalPoint& a = BATT_CURVE[i];
    const BattCalPoint& b = BATT_CURVE[i + 1];
    if (v <= a.v && v >= b.v) {
      float t = (a.v - v) / (a.v - b.v);
      return a.pct + (int)((b.pct - a.pct) * t + 0.5f);
    }
  }
  return 0;
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
// Map an HTTP/HTTPClient return code to a short troubleshooting tip
// the user can act on without having to plug in a serial cable.
// Negative codes are HTTPClient internals (see Arduino's HTTPClient.h).
const char* httpHint(int code) {
  if (code == 401) return "Tip: DEVICE_TOKEN mismatch (server vs firmware)";
  if (code == 403) return "Tip: server rejected — check device enrollment";
  if (code == 404) return "Tip: server URL wrong, /display.bin not found";
  if (code == 408) return "Tip: server slow — cold start or overloaded";
  if (code == 429) return "Tip: rate limited — too many requests";
  if (code >= 500 && code < 600) return "Tip: server error — check Railway logs";
  if (code ==  -1) return "Tip: TCP failed — DNS or firewall blocking";
  if (code ==  -2) return "Tip: HTTPS lib failed to send the request";
  if (code ==  -3) return "Tip: connection lost mid-request";
  if (code == -11) return "Tip: read timed out — flaky WiFi";
  if (code ==   0) return "Tip: no response yet — WiFi up but no route?";
  return "";
}

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
    int y = 80;
    // Headline reason — same string the caller passed in. If we
    // captured an HTTP code on this cycle, append it inline so the
    // first eye-line carries the most useful info.
    display.setCursor(20, y); y += 24;
    if (g_lastHttpCode != 0) {
      display.printf("%s (HTTP %d)", reason, g_lastHttpCode);
    } else {
      display.print(reason);
    }

    // Hint line — tailored to the HTTP code so the user doesn't have
    // to memorise what 401 vs 404 means at a glance. Stays at size 2
    // because size 1 text was getting chewed up by the 1-bit threshold
    // on real hardware. If the hint won't fit on one line, the caller
    // shortened it; we don't auto-wrap here.
    const char* hint = httpHint(g_lastHttpCode);
    if (hint && *hint) {
      display.setCursor(20, y); y += 24;
      display.print(hint);
    }

    display.setCursor(20, y); y += 24;
    display.print("SSID:     ");
    {
      String s = WiFi.SSID();
      if (!s.length()) {
        wifi_config_t conf{};
        if (esp_wifi_get_config(WIFI_IF_STA, &conf) == ESP_OK) {
          s = String((const char*)conf.sta.ssid);
        }
      }
      display.print(s.length() ? s.c_str() : "(unset)");
      // Append RSSI when we have a live association so weak signal
      // can be ruled in or out at a glance.
      if (WiFi.status() == WL_CONNECTED) {
        display.printf("  %ddBm", WiFi.RSSI());
      }
    }

    display.setCursor(20, y); y += 24;
    display.print("IP:       ");
    if (WiFi.status() == WL_CONNECTED) {
      display.print(WiFi.localIP().toString().c_str());
    } else {
      display.print("(no WiFi)");
    }

    display.setCursor(20, y); y += 24;
    display.print("SERVER:   ");
    display.print((activeServerBase && *activeServerBase) ? activeServerBase : "(none yet)");

    display.setCursor(20, y); y += 24;
    display.print("FIRMWARE: ");
    display.print(FW_VERSION);
    display.print(" (");
    display.print(FW_BOARD);
    display.print(")  ID: ");
    display.print(g_friendlyId.length() ? g_friendlyId.c_str() : "(not enrolled)");

    display.setCursor(20, y); y += 24;
    display.print("WAKE:     ");
    display.print(g_wakeLabel);

    display.setCursor(20, y); y += 24;
    if (g_battPct >= 0 && !isnan(g_battV)) {
      display.print("BATTERY:  ");
      display.print(g_battV, 2);
      display.print("V (");
      display.print(g_battPct);
      display.print("%)");
    } else {
      display.print("BATTERY:  --");
    }

    display.setCursor(20, y); y += 24;
    display.print("LAST OK:  ");
    if (g_lastGoodAt > 0) {
      time_t now = time(nullptr);
      long ago = (long)(now - g_lastGoodAt);
      if (ago < 0)         display.print("just now");
      else if (ago < 60)   display.printf("%lds ago", ago);
      else if (ago < 3600) display.printf("%ldm ago", ago / 60);
      else if (ago < 86400)display.printf("%.1fh ago", ago / 3600.0);
      else                 display.printf("%ldd ago", ago / 86400);
    } else {
      display.print("never (first boot?)");
    }

    display.setCursor(20, y); y += 24;
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
  // Wipe last cycle's HTTP code so a fail screen shows the current
  // cycle's failure, not a stale one.
  g_lastHttpCode = 0;
  Serial.printf("Wake cause: %d (%s)\n", wakeCause, wakeLabel);

  // Prefer the pre-WiFi idle reading captured in setup() — it's taken
  // before any TX bursts sag the rail, so it matches the LiPo-curve
  // assumption of open-circuit voltage. Fall back to a fresh read only
  // when setup didn't run (long-running USB-power active cycle).
  float battV   = isfinite(g_idleBattV)   ? g_idleBattV   : readBatteryVoltage();
  int   battPct = (g_idleBattPct >= 0)    ? g_idleBattPct : batteryPctFromVoltage(battV);
  g_battV   = battV;
  g_battPct = battPct;
  Serial.printf("Battery: %.2fV (%d%%)\n", battV, battPct);
  if (battPct < LOW_BATT_PCT) beepLowBattery();

  int sleepMin = DEFAULT_SLEEP_MIN;

  // setup() already ran connectWiFiFast → connectWiFiFull on every
  // deep-sleep wake, so by the time we're here the radio is either up
  // or definitively failed. If a USB-power active cycle dropped the
  // association mid-loop, reconnect on demand.
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
    // Adaptive fallback: if the chosen base failed twice, re-probe to
    // switch LAN ↔ cloud and try one more time. Catches "Mac went to
    // sleep mid-day so LAN /display.bin times out" without waiting for
    // the next periodic re-probe (10 cycles away).
    if (!img) {
      Serial.println("Both attempts failed — re-probing server base");
      selectServerBase();
      g_cyclesSinceProbe = 0;
      delay(500);
      img = downloadImage();
    }
    if (img) {
      pushImage(img);
      free(img);
      g_lastGoodAt = time(nullptr);
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
  // Deep sleep fully powers the EPD controller down between cycles, so
  // every wake — cold POR, timer, button — has to run the full panel
  // init (reset pulse + `_initial_write/_refresh` flags). Skipping it
  // with initial=false on timer/button wakes leaves the controller in
  // a half-configured state and the next writeImage silently no-ops.
  display.init(115200, true, 2, false);

  setupBattery();
  // Snapshot the battery NOW, before WiFi powers up. WiFi TX bursts sag
  // the 3V3 rail 50-150 mV under load, which throws the LiPo-curve
  // lookup off by 10-20 % in the "I'm dying" direction. Reading at idle
  // is the cheapest accuracy fix available — no hardware change needed.
  g_idleBattV   = readBatteryVoltage();
  g_idleBattPct = batteryPctFromVoltage(g_idleBattV);
  Serial.printf("Battery (idle, pre-WiFi): %.2fV (%d%%)\n",
                g_idleBattV, g_idleBattPct);

  // Restore the per-device api_key from NVS if we already enrolled.
  // The first /api/setup POST happens later inside runCycle, once
  // WiFi is up and the server has been selected.
  loadAuthFromNVS();

  // No WiFi.setSleep / setTxPower here — they must run AFTER the radio
  // is associated. See applyWiFiTuning() (called once provisionWiFi
  // and connectWiFi succeed). persistent(false) early so begin() never
  // writes flash on every wake.
  WiFi.persistent(false);

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
  bool buttonWake = (wakeCause == ESP_SLEEP_WAKEUP_EXT1);

  // runCycle runs FIRST so a button press refreshes the display as fast
  // as possible. The factory-reset hold check used to block here for up
  // to 5 s before runCycle could start, which left the user staring at
  // a stale screen and forced the WiFi reconnect to start after the AP
  // had already aged the association out of its table. Now the dashboard
  // refresh starts the moment we wake — the hold check happens after
  // the cycle returns.
  unsigned long wakeAtMs = millis();
  int sleepMin = runCycle(wakeCause);
  uint64_t sleepUs = (uint64_t)sleepMin * 60ULL * 1000000ULL;

  // Long-press factory reset (button still held continuously since wake,
  // for ≥5 s in total). Non-blocking: if the user already released the
  // button during runCycle, this is a no-op. If they're still holding it,
  // wait the remainder of the 5 s window before triggering the reset.
  if (buttonWake) {
    while (digitalRead(BTN_REFRESH) == LOW) {
      if (millis() - wakeAtMs > 5000) {
        factoryReset();   // never returns
      }
      delay(50);
    }
  }
  // Belt-and-braces: small grace window so a quick double-tap doesn't
  // immediately re-wake from ALL_LOW with the button still pressed.
  unsigned long t0 = millis();
  while (digitalRead(BTN_REFRESH) == LOW && millis() - t0 < 1000) {
    delay(10);
  }
  buzzerOff();

  // Mode select: USB → stay active (no sleep), battery → DEEP sleep.
  //
  // Deep sleep tears WiFi down completely, but the warm-boot fast-
  // reconnect path (cached BSSID + channel + static IP) brings the
  // radio back in ~700 ms — well under the cost of trying to keep the
  // association alive across light sleep, which proved unreliable
  // through `WiFi.setSleep(false)` + `esp_light_sleep_start()`. Deep
  // sleep also draws ~10 µA vs light sleep's ~800 µA, so battery life
  // jumps from weeks to months.
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
    Serial.printf("Battery (%.2fV) — deep sleep %d min\n", vbat, sleepMin);
    rtc_gpio_pulldown_dis((gpio_num_t)BTN_REFRESH);
    rtc_gpio_pullup_en((gpio_num_t)BTN_REFRESH);
    esp_sleep_enable_timer_wakeup(sleepUs);
    esp_sleep_enable_ext1_wakeup(WAKE_PIN_MASK, ESP_EXT1_WAKEUP_ALL_LOW);
    Serial.flush();
    esp_deep_sleep_start();   // does not return
  }
}
