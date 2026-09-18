// weather_station_b.ino — Server-rendered version, 3-COLOR (B/W/R) panel
// Waveshare 7.5" V2 B (driver IC GDEY075Z08). Pulls a pre-rendered
// 800x480 1-bit image from your dashboard server, paints it on the BLACK
// plane (red plane left blank), and pushes it to the display.
//
// Ported from the BW firmware — identical WiFi captive portal, buzzer,
// button gestures (2-7s portal / 10s factory reset), OTA, battery, setup
// screen. Only the display class + pushImage (red plane) differ.
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
// ESP32 ROM ships miniz; tinfl is its inflate half. Used to expand the
// DEFLATE'd panel image straight into the 96000-byte frame buffer.
#include "miniz.h"
#include <ArduinoJson.h>
#include <GxEPD2_3C.h>
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
#define FW_VERSION "1.26.0"
#define FW_BOARD   "b"
#define OTA_MIN_BATT_PCT 50

#define DEFAULT_SLEEP_MIN 30

// Desk-development affordance: spin in an active delay() between cycles
// instead of deep-sleeping, so the button answers instantly and the serial
// monitor stays attached across refreshes. Set to 1 while working at a desk;
// it MUST be 0 for anything running on a battery.
//
// This replaces a voltage heuristic (`vbat > 4.10f` meant "on USB") that did
// not work. The claim was that a TP4056 holds VBAT at ~4.2V while charging
// while a disconnected cell "drops to ~3.7V soon after" — but a LiPo straight
// off the charger RESTS at 4.15-4.20V, which is the same reading. So a freshly
// charged device on battery took the stay-awake branch and burned ~125 mAh
// (roughly 2 h at ~60 mA) before it self-discharged below the threshold and
// started sleeping. Every charge cycle, silently.
//
// Battery voltage cannot distinguish the two cases, because in both of them
// the cell sits at its full-charge voltage. Detecting USB properly needs a
// VBUS sense line — divide the charger's 5V input down to a spare RTC-capable
// GPIO and read that. Until that wire exists, there is no runtime signal, so
// this is a build-time flag rather than a guess that misfires.
#define DEV_STAY_AWAKE 0

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
#define BUZZER_FREQ    2731
#define BUZZER_RES     8
#define BUZZER_VOLUME  64
#define LOW_BATT_PCT   10

SPIClass hspi(HSPI);
// 3-color driver class. GDEY075Z08 = Waveshare 7.5" V2 B (800×480, B/W/R).
//
// Second template arg is the page-buffer height (rows). Full HEIGHT (480)
// would allocate 800×480/8 × 2 planes = 96 KB DRAM — overflows ESP32
// dram0_0_seg by ~22 KB once WiFi + mbedtls + Update.h + GxEPD2 share the
// segment. We bypass the page buffer entirely via epd2.writeImage() for
// the main render (pushImage); only the text screens use paged drawing,
// and 60 rows (HEIGHT/8 = 12 KB) is plenty for a few lines.
GxEPD2_3C<GxEPD2_750c_GDEY075Z08, GxEPD2_750c_GDEY075Z08::HEIGHT / 8>
  display(GxEPD2_750c_GDEY075Z08(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));

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
// Exact next-refresh interval in SECONDS from the X-Refresh-Seconds
// response header. Enables sub-minute polling during a push-now fast
// window. -1 = not seen yet → fall back to the minute-based value.
int         g_serverRefreshSec = -1;
// Populated by downloadImage on a failed fetch so drawFailScreen can
// show the underlying HTTP code + a short tip per status. Resets to
// 0 on every cycle entry so a fail screen always shows the *current*
// cycle's failure, not a stale one from before.
int         g_lastHttpCode = 0;
// Newest published firmware for this board, from the X-Firmware-Latest
// response header on /display-3c.bin. Empty = the server did not say (older
// server, or the fetch failed), in which case checkForUpdate falls back to
// asking the manifest. Set every cycle, so it is plain RAM, not RTC.
String      g_latestFw = "";
// Consecutive failures of the DEFLATE image path. Survives deep sleep, so a
// server or decoder that cannot produce a body we can inflate stops being
// asked rather than costing a fail screen every wake. Two strikes, because
// downloadImage is retried up to 3x per cycle — so the third attempt of a bad
// cycle already falls back to the raw body and the panel still updates. Reset
// to 0 on any successful inflate.
RTC_DATA_ATTR uint8_t g_deflateFails = 0;
#define DEFLATE_MAX_FAILS 2
// Sanity bound on the compressed body. A real frame is ~2-6 KB (measured
// 96000 -> 2055 on a typical dashboard), so 32 KB is ~5x headroom and caps
// the transient heap at 96000 + 32768 + ~11 KB of decompressor.
#define DEFLATE_MAX_BYTES 32768
// Survives deep sleep — `time_t` of the last successful download
// (set immediately after pushImage). 0 = never. drawFailScreen shows
// "Last good: Nm ago" so the user knows whether this is a fresh
// outage or a long-running one.
RTC_DATA_ATTR time_t g_lastGoodAt = 0;

// ETag of the last image we actually drew. Sent back as If-None-Match so
// the server replies 304 when nothing changed and we skip the slow
// ~15-26 s color refresh entirely. SHA-1 hex in quotes = 42 chars.
RTC_DATA_ATTR char g_lastEtag[48] = {0};
// Set by downloadImage when the server answered 304 (image unchanged).
// Plain global — meaningful only within the current cycle.
bool g_imageUnchanged = false;

// Survives deep sleep. Set when drawFailScreen paints the connection
// error (lots of solid black in the header banner), checked on the
// next successful refresh so we can pre-wipe the panel and stop the
// fail-screen ghost from bleeding through.
RTC_DATA_ATTR bool g_lastRenderWasFail = false;

// Consecutive failed cycles (WiFi down / image fetch failed), surviving deep
// sleep. Drives an exponential sleep backoff so a prolonged server/WiFi
// outage doesn't wake + fail every 5 minutes and drain the battery. Reset to
// 0 on any successful refresh.
RTC_DATA_ATTR uint8_t g_consecFails = 0;

// Sleep seconds after a failed cycle: 5m, 10m, 20m, 40m, capped at 60m.
// Increment g_consecFails before calling so the first failure sleeps 5m.
static int failBackoffSec() {
  uint8_t n = g_consecFails > 0 ? (uint8_t)(g_consecFails - 1) : 0;
  if (n > 4) n = 4;
  long s = 300L << n;         // 300, 600, 1200, 2400, 4800
  if (s > 3600) s = 3600;     // cap at 1 hour
  return (int)s;
}

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
// SSID the fast cache belongs to — multi-network support means the warm
// boot must know WHICH saved network the BSSID/channel/IP lease maps to,
// so it can look up the matching password. Cleared whenever the cache
// is invalidated. 32 chars + NUL = max SSID length.
RTC_DATA_ATTR char     g_cachedSsid[33] = {0};


// Pin-change ISR: latch a refresh request on press. Flag-only — the
// previous version drove the buzzer via ledcWrite() here, but ledcWrite
// is not IRAM-safe; a press landing during an NVS write or OTA flash
// (flash cache disabled) could crash with "Cache disabled but cached
// memory region accessed". Audible feedback now comes from the main
// code paths instead: beep(50) on button wake, beep(30) when a
// mid-cycle press is picked up.
void IRAM_ATTR onButtonEdge() {
  if (digitalRead(BTN_REFRESH) == LOW) refreshRequested = true;
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

// Compare two "major.minor.patch" strings. Returns >0 when a is newer than
// b, 0 when equal, <0 when older. Anything unparseable compares as 0 so a
// malformed value can never look like an upgrade.
int cmpFwVersion(const String& a, const String& b) {
  int am = 0, an = 0, ap = 0, bm = 0, bn = 0, bp = 0;
  if (sscanf(a.c_str(), "%d.%d.%d", &am, &an, &ap) != 3) return 0;
  if (sscanf(b.c_str(), "%d.%d.%d", &bm, &bn, &bp) != 3) return 0;
  if (am != bm) return am - bm;
  if (an != bn) return an - bn;
  return ap - bp;
}

// Stash the server's X-Firmware-Latest hint. Sent on /display-3c.bin, which
// the device fetches every cycle anyway, so learning about a new build costs
// no extra request. checkForUpdate uses it to decide whether the manifest is
// even worth asking.
void captureFirmwareHint(HTTPClient& http) {
  if (!http.hasHeader("X-Firmware-Latest")) return;
  String v = http.header("X-Firmware-Latest");
  v.trim();
  if (v.length() > 0 && v.length() < 16) g_latestFw = v;
}

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

// Cloud-only: LAN base retired now that the Mac pushes its widget
// state through the cloud agent. (The old probeBase() /health check
// went with it — with a single fixed base there is nothing to probe.)
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
  // Remember which saved network this lease belongs to so the warm-boot
  // fast path can look up the right password (multi-network support).
  strncpy(g_cachedSsid, WiFi.SSID().c_str(), sizeof(g_cachedSsid) - 1);
  g_cachedSsid[sizeof(g_cachedSsid) - 1] = '\0';
  g_wifiCacheValid = true;
  Serial.printf("WiFi cache saved: %s ch=%d IP=%s\n",
                g_cachedSsid, g_cachedChannel, WiFi.localIP().toString().c_str());
}

void invalidateWifiCache() {
  g_wifiCacheValid = false;
  g_cachedSsid[0] = '\0';
  Serial.println("WiFi cache invalidated");
}

// ---------- In-house captive portal + multi-network store ----------
//
// Keyed on the "wifi" Preferences namespace. NVS schema (multi-network):
//   count  : uint   — number of saved networks (0..MAX_WIFI_NETS)
//   ssid0..ssidN : String
//   pass0..passN : String
// Legacy single-network schema (`ssid`/`pass`) is auto-migrated into
// slot 0 the first time the list is saved.
//
// Why a list: the device travels between locations (home, office, etc).
// Storing several networks means it associates with whichever saved SSID
// is in range at wake without the user re-running setup each move. The
// full-scan connect picks the strongest matching SSID; the warm-boot
// fast path remembers which SSID the RTC lease belongs to.
//
// If the list is empty at boot, openCaptivePortal() runs softAP +
// WebServer at 192.168.4.1, serves a form, and APPENDS whatever the user
// submits (existing networks are kept). Block up to 5 minutes; reboot on
// save.
//
// Bypasses every WiFiManager 2.0.17 + arduino-esp32 core 3.x bug
// (tzapu/WiFiManager #1797, #1490) because no third-party lib is in
// the path.
#define MAX_WIFI_NETS 5

Preferences wifiPrefs;
DNSServer dnsServer;
WebServer portal(80);

// Load every saved network into parallel arrays; returns the count.
// Transparently migrates the legacy single-cred schema (no `count` key
// but a `ssid` key present) into slot 0 so old installs keep working.
static int loadNetworks(String* ssids, String* passes, int maxN) {
  wifiPrefs.begin("wifi", true);
  int count = (int)wifiPrefs.getUInt("count", 0xFFFF);
  if (count == 0xFFFF) {
    // Not migrated yet — fall back to the legacy single pair.
    String s = wifiPrefs.getString("ssid", "");
    String p = wifiPrefs.getString("pass", "");
    wifiPrefs.end();
    if (s.length() && maxN > 0) { ssids[0] = s; passes[0] = p; return 1; }
    return 0;
  }
  int n = 0;
  for (int i = 0; i < count && n < maxN; i++) {
    String s = wifiPrefs.getString(("ssid" + String(i)).c_str(), "");
    if (!s.length()) continue;
    ssids[n]  = s;
    passes[n] = wifiPrefs.getString(("pass" + String(i)).c_str(), "");
    n++;
  }
  wifiPrefs.end();
  return n;
}

// Look up the password for a given SSID. Returns true when the SSID is in
// the saved list (passOut may legitimately be "" for an open network).
static bool passForSsid(const String& ssid, String& passOut) {
  String ssids[MAX_WIFI_NETS], passes[MAX_WIFI_NETS];
  int n = loadNetworks(ssids, passes, MAX_WIFI_NETS);
  for (int i = 0; i < n; i++) {
    if (ssids[i] == ssid) { passOut = passes[i]; return true; }
  }
  return false;
}

// Upsert a network: if the SSID already exists its password is updated;
// otherwise it's prepended (most-recent-first). The list is capped at
// MAX_WIFI_NETS, evicting the oldest. Rewrites the whole namespace under
// the new `count` schema and drops the legacy keys.
static void saveNetworkUpsert(const String& ssid, const String& pass) {
  String ssids[MAX_WIFI_NETS], passes[MAX_WIFI_NETS];
  int n = loadNetworks(ssids, passes, MAX_WIFI_NETS);

  // Build the new ordering: incoming network first, then the rest minus
  // any existing copy of this SSID.
  String outS[MAX_WIFI_NETS], outP[MAX_WIFI_NETS];
  int m = 0;
  outS[m] = ssid; outP[m] = pass; m++;
  for (int i = 0; i < n && m < MAX_WIFI_NETS; i++) {
    if (ssids[i] == ssid) continue;       // dedupe
    outS[m] = ssids[i]; outP[m] = passes[i]; m++;
  }

  wifiPrefs.begin("wifi", false);
  wifiPrefs.clear();                       // wipe legacy + stale slots
  wifiPrefs.putUInt("count", m);
  for (int i = 0; i < m; i++) {
    wifiPrefs.putString(("ssid" + String(i)).c_str(), outS[i]);
    wifiPrefs.putString(("pass" + String(i)).c_str(), outP[i]);
  }
  wifiPrefs.end();
  Serial.printf("Saved network '%s' (%d total)\n", ssid.c_str(), m);
}

// Remove a network by SSID and rewrite the namespace.
static void forgetNetwork(const String& ssid) {
  String ssids[MAX_WIFI_NETS], passes[MAX_WIFI_NETS];
  int n = loadNetworks(ssids, passes, MAX_WIFI_NETS);
  wifiPrefs.begin("wifi", false);
  wifiPrefs.clear();
  int m = 0;
  for (int i = 0; i < n; i++) {
    if (ssids[i] == ssid) continue;
    wifiPrefs.putString(("ssid" + String(m)).c_str(), ssids[i]);
    wifiPrefs.putString(("pass" + String(m)).c_str(), passes[i]);
    m++;
  }
  wifiPrefs.putUInt("count", m);
  wifiPrefs.end();
  Serial.printf("Forgot network '%s' (%d left)\n", ssid.c_str(), m);
}

// Percent-encode an SSID for use in the /forget?ssid= query string.
static String urlEncode(const String& in) {
  String o; o.reserve(in.length() * 3);
  const char* hex = "0123456789ABCDEF";
  for (size_t i = 0; i < in.length(); i++) {
    char c = in[i];
    if (isalnum((unsigned char)c) || c == '-' || c == '_' || c == '.' || c == '~') {
      o += c;
    } else {
      o += '%'; o += hex[(c >> 4) & 0xF]; o += hex[c & 0xF];
    }
  }
  return o;
}

// Minimal HTML-escape for SSIDs shown in the saved list.
static String htmlEscape(const String& in) {
  String o; o.reserve(in.length() + 8);
  for (size_t i = 0; i < in.length(); i++) {
    char c = in[i];
    if      (c == '&') o += "&amp;";
    else if (c == '<') o += "&lt;";
    else if (c == '>') o += "&gt;";
    else if (c == '"') o += "&quot;";
    else o += c;
  }
  return o;
}

// Editorial-styled page head (newsprint bg, serif masthead, mono labels).
// No webfonts — the AP has no internet, so system stacks stand in.
static const char PORTAL_HEAD[] PROGMEM =
  "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
  "<title>E-Ink Dashboard · Setup</title>"
  "<style>body{font-family:Georgia,serif;background:#faf8f3;color:#111;max-width:420px;margin:24px auto;padding:0 16px}"
  "h1{font-size:26px;font-weight:400;letter-spacing:-0.5px;margin:0 0 2px;border-bottom:3px solid #111;padding-bottom:10px;position:relative}"
  "h1:after{content:'';position:absolute;left:0;right:0;bottom:-6px;height:1px;background:#111}"
  ".sub{font-family:ui-monospace,monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6b6960;margin:14px 0 6px}"
  "label{display:block;font-family:ui-monospace,monospace;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#6b6960;margin:18px 0 6px}"
  "input{width:100%;box-sizing:border-box;padding:10px 12px;font-size:16px;font-family:inherit;background:#fff;border:1.5px solid #111;border-radius:0;outline-offset:-1px}"
  "input:focus{outline:2px solid #111}"
  "ul.nets{list-style:none;padding:0;margin:6px 0;font-family:ui-monospace,monospace;font-size:13px}"
  "ul.nets li{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #ddd}"
  "ul.nets a{color:#111;font-size:11px;letter-spacing:1px;text-transform:uppercase}"
  "button{margin-top:22px;padding:12px 18px;font-family:ui-monospace,monospace;font-size:13px;font-weight:700;letter-spacing:3px;text-transform:uppercase;border:2px solid #111;background:#111;color:#fff;width:100%;cursor:pointer}"
  "</style></head><body><h1>E-Ink Dashboard</h1>";

// Build the portal page: saved networks (with forget links) + add form.
static String buildPortalPage() {
  String h = FPSTR(PORTAL_HEAD);
  String ssids[MAX_WIFI_NETS], passes[MAX_WIFI_NETS];
  int n = loadNetworks(ssids, passes, MAX_WIFI_NETS);
  if (n) {
    h += "<div class='sub'>Saved networks</div><ul class='nets'>";
    for (int i = 0; i < n; i++) {
      h += "<li><span>" + htmlEscape(ssids[i]) + "</span>"
           "<a href='/forget?ssid=" + urlEncode(ssids[i]) + "'>Forget</a></li>";
    }
    h += "</ul>";
  }
  h += "<div class='sub'>Add a network</div>"
       "<form action='/save' method='POST'>"
       "<label>WiFi network (SSID)</label><input name='ssid' required>"
       "<label>Password</label><input id='pw' name='pass' type='password'>"
       "<label style='display:flex;gap:6px;align-items:center;margin-top:8px;"
       "text-transform:none;font-weight:400;letter-spacing:0;font-size:13px'>"
       "<input type='checkbox' style='width:auto' "
       "onchange=\"document.getElementById('pw').type=this.checked?'text':'password'\">"
       "Show password</label>"
       "<button>Save network</button></form>";
  // Finish only matters once at least one network is saved — restart so
  // the device leaves AP mode and connects.
  if (n) {
    h += "<form action='/done' method='POST'>"
         "<button style='background:#fff;color:#111'>Finish &amp; restart</button></form>";
  }
  h += "</body></html>";
  return h;
}

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
    portal.send(200, "text/html", buildPortalPage());
  });
  portal.on("/save", HTTP_POST, []() {
    String ssid = portal.arg("ssid");
    String pass = portal.arg("pass");
    if (!ssid.length()) {
      portal.send(400, "text/plain", "SSID required");
      return;
    }
    saveNetworkUpsert(ssid, pass);
    // Return to the list so the user can add more networks before
    // finishing — no restart here (that's what /done is for).
    portal.sendHeader("Location", "/", true);
    portal.send(302, "text/plain", "");
  });
  // Remove a saved network (forget link). WebServer URL-decodes the arg.
  portal.on("/forget", HTTP_GET, []() {
    String ssid = portal.arg("ssid");
    if (ssid.length()) forgetNetwork(ssid);
    portal.sendHeader("Location", "/", true);
    portal.send(302, "text/plain", "");
  });
  // Done — leave the portal and reboot into normal (STA) operation.
  portal.on("/done", HTTP_POST, []() {
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

// True when at least one network is saved.
static bool hasSavedNetworks() {
  String ssids[MAX_WIFI_NETS], passes[MAX_WIFI_NETS];
  return loadNetworks(ssids, passes, MAX_WIFI_NETS) > 0;
}

// Fast-path connect using the RTC cache. Skips the SSID scan by passing
// the saved BSSID + channel into WiFi.begin and skips DHCP by feeding
// the prior lease into WiFi.config. ~600-900 ms warm-boot association.
// Uses the cached SSID (g_cachedSsid) to find the right password — if
// that network was forgotten since the last boot, the lookup fails and
// we fall through to the full scan.
bool connectWiFiFast(unsigned long timeoutMs = 4000) {
  if (!g_wifiCacheValid || g_cachedSsid[0] == '\0') return false;
  String ssid = String(g_cachedSsid);
  String pass;
  if (!passForSsid(ssid, pass)) {
    Serial.printf("Fast: cached SSID '%s' no longer saved\n", ssid.c_str());
    invalidateWifiCache();
    return false;
  }

  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.config(IPAddress(g_cachedLocalIp),
              IPAddress(g_cachedGateway),
              IPAddress(g_cachedSubnet),
              IPAddress(g_cachedDns));
  Serial.printf("WiFi fast: %s ch=%d BSSID=%02X:%02X:%02X:%02X:%02X:%02X\n",
                ssid.c_str(), g_cachedChannel,
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
// roamed channels, or when the fast path failed. With multiple saved
// networks it scans the air and connects to the saved SSID with the
// strongest signal that's actually present — so moving between locations
// "just works" without re-running setup. Falls back to a blind attempt
// at the first saved network if the scan finds no match (covers hidden
// SSIDs).
bool connectWiFiFull(unsigned long timeoutMs = 15000) {
  String ssids[MAX_WIFI_NETS], passes[MAX_WIFI_NETS];
  int n = loadNetworks(ssids, passes, MAX_WIFI_NETS);
  if (!n) {
    Serial.println("connectWiFiFull: no saved networks");
    return false;
  }
  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.config((uint32_t)0, (uint32_t)0, (uint32_t)0);  // DHCP
  WiFi.disconnect();
  delay(100);

  // Pick the strongest in-range saved network.
  int pick = -1, bestRssi = -999;
  int found = WiFi.scanNetworks();
  for (int i = 0; i < found; i++) {
    String scanned = WiFi.SSID(i);
    int rssi = WiFi.RSSI(i);
    for (int j = 0; j < n; j++) {
      if (scanned == ssids[j] && rssi > bestRssi) { bestRssi = rssi; pick = j; }
    }
  }
  WiFi.scanDelete();
  if (pick < 0) {
    Serial.println("No saved network in range — blind try of slot 0");
    pick = 0;
  } else {
    Serial.printf("Scan picked '%s' (RSSI=%d)\n", ssids[pick].c_str(), bestRssi);
  }

  WiFi.begin(ssids[pick].c_str(), passes[pick].c_str());
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
  if (!hasSavedNetworks()) {
    Serial.println("No saved WiFi networks — launching portal");
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
  // addToken so the server can gate enrollment behind DEVICE_TOKEN.
  String url = addToken(String(activeServerBase) + "/api/setup");
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

// Download the two-plane 96000-byte image (black plane + red plane) into

// Sink that lets HTTPClient::writeToStream() decode a response straight into
// the image buffer. HTTPClient strips chunk framing; reading the raw socket
// through getStreamPtr() does NOT — which is how HTTP chunk-size headers
// ("17700\r\n" and friends) once got copied in as pixels and slid the whole
// picture sideways. Bounds-checked so a longer-than-expected body can't run
// past the allocation.
class ImageBufferSink : public Stream {
 public:
  ImageBufferSink(uint8_t* dst, size_t cap) : _dst(dst), _cap(cap) {}
  size_t write(uint8_t b) override {
    if (_len >= _cap) { _over = true; return 0; }
    _dst[_len++] = b;
    return 1;
  }
  size_t write(const uint8_t* data, size_t size) override {
    if (_len + size > _cap) { size = _cap - _len; _over = true; }
    if (size) { memcpy(_dst + _len, data, size); _len += size; }
    return size;
  }
  // Write-only sink; the read half of Stream is unused.
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
  void flush() override {}
  size_t length() const { return _len; }
  bool overflowed() const { return _over; }

 private:
  uint8_t* _dst;
  size_t _cap;
  size_t _len = 0;
  bool _over = false;
};
// Read `compLen` DEFLATE'd bytes off the socket and inflate them into `out`.
//
// The whole compressed body is buffered first and inflated in one shot rather
// than streamed. It is a few KB, and this is the code path that draws to the
// panel off a raw socket — the same path that cost two sessions to gotcha 10.
// A single call with all the input present has no partial-input state machine
// to get wrong.
//
// TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF is what keeps this cheap: the
// output buffer is 96000, comfortably larger than DEFLATE's 32 KB window, so
// tinfl back-references directly into it and needs no separate dictionary.
// The decompressor struct itself is ~11 KB and goes on the HEAP — the Arduino
// loop task stack is 8 KB, so tinfl_decompress_mem_to_mem(), which puts it on
// the stack, would smash it.
//
// Returns true only on a complete inflate that filled `outCap` exactly.
bool inflateImage(WiFiClient* stream, int compLen,
                  uint8_t* out, size_t outCap, bool* timedOut) {
  *timedOut = false;
  if (compLen <= 0 || compLen > DEFLATE_MAX_BYTES) {
    Serial.printf("inflate: bad compressed length %d\n", compLen);
    return false;
  }

  uint8_t* comp = (uint8_t*)malloc((size_t)compLen);
  if (!comp) { Serial.println("inflate: compressed-buffer malloc FAILED"); return false; }

  int read = 0;
  unsigned long lastData = millis();
  while (read < compLen) {
    size_t avail = stream->available();
    if (avail) {
      int n = stream->readBytes(comp + read, min((int)avail, compLen - read));
      read += n;
      lastData = millis();
    } else {
      if (millis() - lastData > 10000) {
        Serial.println("inflate: stream timeout");
        *timedOut = true;
        free(comp);
        return false;
      }
      delay(5);
    }
  }

  tinfl_decompressor* dec = (tinfl_decompressor*)malloc(sizeof(tinfl_decompressor));
  if (!dec) {
    Serial.println("inflate: decompressor malloc FAILED");
    free(comp);
    return false;
  }
  tinfl_init(dec);

  size_t inSize = (size_t)compLen;
  size_t outSize = outCap;
  tinfl_status st = tinfl_decompress(dec, comp, &inSize, out, out, &outSize,
                                     TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF);
  free(dec);
  free(comp);

  if (st != TINFL_STATUS_DONE) {
    Serial.printf("inflate: tinfl status %d after %u bytes\n", (int)st, (unsigned)outSize);
    return false;
  }
  if (outSize != outCap) {
    Serial.printf("inflate: got %u bytes, expected %u\n", (unsigned)outSize, (unsigned)outCap);
    return false;
  }
  Serial.printf("inflate: %d -> %u bytes\n", compLen, (unsigned)outSize);
  return true;
}

// one heap buffer. black = buf, red = buf + IMG_BYTES. Returns nullptr on
// failure (caller frees on success).
uint8_t* downloadImage() {
  g_imageUnchanged = false;

  // Reserve the 96000-byte image buffer BEFORE opening the TLS connection.
  // The handshake allocates ~40 KB, so a 96000 contiguous malloc AFTER it
  // often fails on the no-PSRAM ESP32-WROOM (heap fragments). Allocating
  // while the heap is still fresh fixes the intermittent "malloc FAILED".
  // ps_malloc uses PSRAM when the board has it; falls back to heap.
  const int WANT = 2 * IMG_BYTES;   // black plane + red plane = 96000
  uint8_t* buf = (uint8_t*)ps_malloc(WANT);
  if (!buf) buf = (uint8_t*)malloc(WANT);
  if (!buf) { Serial.println("malloc FAILED"); return nullptr; }

  String url = addToken(String(activeServerBase) + "/display-3c.bin");
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
  // Ask for the DEFLATE'd body. A server that does not know this header sends
  // the raw 96000 bytes and the path below is unchanged, so this is safe to
  // send at all times — except once the decode has failed enough that it is
  // clearly not working here, at which point we stop asking rather than
  // losing a refresh every wake.
  const bool wantDeflate = (g_deflateFails < DEFLATE_MAX_FAILS);
  if (wantDeflate) http.addHeader("X-Accept-Deflate", "1");
  // Conditional GET — if the last image's ETag still matches, the server
  // returns 304 and we skip the slow color refresh.
  if (g_lastEtag[0]) http.addHeader("If-None-Match", g_lastEtag);
  // Retain the response headers we care about: refresh hint + ETag +
  // stale-enrollment flag.
  const char* keepHeaders[] = { "X-Refresh-Rate", "ETag", "X-Refresh-Seconds",
                                "X-Enroll-Stale", "X-Firmware-Latest",
                                "X-Body-Deflate", "X-Raw-Length" };
  http.collectHeaders(keepHeaders, 7);

  int code = http.GET();
  // Server didn't recognize our api_key (roster lost / re-provisioned
  // server). Clear the NVS identity so the next cycle re-enrolls via
  // /api/setup — otherwise we'd ride the fleet token forever and never
  // reappear in the device roster.
  if (http.hasHeader("X-Enroll-Stale") && g_apiKey.length() > 0) {
    Serial.println("Server flagged stale enrollment — clearing api_key, re-enroll next cycle");
    saveAuthToNVS("", "");
  }
  captureFirmwareHint(http);
  // 304 Not Modified — image identical to what's already on the panel.
  // Skip the redraw entirely; caller leaves the screen as-is and sleeps.
  if (code == 304) {
    Serial.println("304 Not Modified — image unchanged, skipping refresh");
    g_imageUnchanged = true;
    // Still honour an updated refresh-rate hint if present.
    if (http.hasHeader("X-Refresh-Rate")) {
      int rr = http.header("X-Refresh-Rate").toInt();
      if (rr > 0 && rr <= 1440) g_serverRefreshMin = rr;
    }
    if (http.hasHeader("X-Refresh-Seconds")) {
      int rs = http.header("X-Refresh-Seconds").toInt();
      if (rs >= 10 && rs <= 86400) g_serverRefreshSec = rs;
    }
    http.end();
    free(buf);
    return nullptr;
  }
  if (code != 200) {
    Serial.printf("HTTP %d\n", code);
    g_lastHttpCode = code;
    http.end();
    free(buf);
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
  if (http.hasHeader("X-Refresh-Seconds")) {
    int rs = http.header("X-Refresh-Seconds").toInt();
    if (rs >= 10 && rs <= 86400) g_serverRefreshSec = rs;
  }

  int len = http.getSize();

  // DEFLATE'd body. Content-Length is the COMPRESSED size here, so the
  // identity-path size check below does not apply; X-Raw-Length is what it
  // must inflate to.
  const bool deflated = http.hasHeader("X-Body-Deflate")
                        && http.header("X-Body-Deflate") == "1";
  if (deflated) {
    int rawLen = http.hasHeader("X-Raw-Length")
                 ? http.header("X-Raw-Length").toInt() : 0;
    bool to = false;
    if (rawLen != WANT) {
      Serial.printf("Deflate: X-Raw-Length %d, expected %d\n", rawLen, WANT);
    } else if (inflateImage(http.getStreamPtr(), len, buf, WANT, &to)) {
      String etagD = http.hasHeader("ETag") ? http.header("ETag") : "";
      http.end();
      g_deflateFails = 0;
      if (etagD.length() && etagD.length() < sizeof(g_lastEtag)) {
        strncpy(g_lastEtag, etagD.c_str(), sizeof(g_lastEtag) - 1);
        g_lastEtag[sizeof(g_lastEtag) - 1] = '\0';
      }
      return buf;
    }
    // Any failure here falls back to the raw path on a later attempt rather
    // than drawing something we are not sure of.
    if (g_deflateFails < 255) g_deflateFails++;
    Serial.printf("Deflate path failed (%u/%d) — will retry uncompressed\n",
                  (unsigned)g_deflateFails, DEFLATE_MAX_FAILS);
    g_lastHttpCode = to ? HTTPC_ERROR_READ_TIMEOUT : HTTPC_ERROR_CONNECTION_LOST;
    http.end();
    free(buf);
    return nullptr;
  }

  // len < 0 means no usable Content-Length, i.e. the response is chunked (or
  // the length is unknown). The raw-socket read below would copy the chunk
  // framing in as image data, so that case takes the decoding path instead.
  const bool needsDecode = (len != WANT);
  if (len > 0 && len != WANT) {
    Serial.printf("Unexpected size %d (expected %d)\n", len, WANT);
    http.end();
    free(buf);
    return nullptr;
  }

  int read = 0;
  bool streamTimedOut = false;
  if (needsDecode) {
    // No usable Content-Length. Let HTTPClient do the reading so chunk
    // framing is stripped rather than landing in the image as pixels. Slower
    // and less instrumented than the loop below, which is why it is the
    // fallback and not the default — a correctly configured server always
    // sends Content-Length and takes the fast path.
    Serial.println("No Content-Length — decoding response (chunked?)");
    ImageBufferSink sink(buf, WANT);
    int written = http.writeToStream(&sink);
    read = (int)sink.length();
    if (written < 0) {
      Serial.printf("writeToStream failed: %d\n", written);
      streamTimedOut = true;
    }
    if (sink.overflowed()) {
      Serial.println("Body longer than expected — refusing to draw");
      read = -1;
    }
  } else {
    WiFiClient* stream = http.getStreamPtr();
    unsigned long lastData = millis();
    while (read < WANT) {
      size_t avail = stream->available();
      if (avail) {
        int n = stream->readBytes(buf + read, min((int)avail, WANT - read));
        read += n;
        lastData = millis();
      } else {
        if (millis() - lastData > 10000) {
          Serial.println("stream timeout");
          streamTimedOut = true;
          break;
        }
        delay(5);
      }
    }
  }
  // Grab the ETag before tearing down the client — stored only once the
  // read is confirmed complete so a partial read can't poison the cache.
  String etag = http.hasHeader("ETag") ? http.header("ETag") : "";
  http.end();

  if (read != WANT) {
    Serial.printf("Short read: %d / %d\n", read, WANT);
    // Surface a code so drawFailScreen's hint line still fires on
    // mid-stream failures (previously left 0 — no tip exactly when
    // the failure is most confusing). Reuse HTTPClient's own
    // constants: -11 read timeout, -3 connection lost.
    g_lastHttpCode = streamTimedOut ? HTTPC_ERROR_READ_TIMEOUT
                                    : HTTPC_ERROR_CONNECTION_LOST;
    free(buf);
    return nullptr;
  }
  // Remember the ETag of the image we're about to draw so the next wake
  // can send If-None-Match and skip an unchanged refresh.
  if (etag.length() && etag.length() < sizeof(g_lastEtag)) {
    strncpy(g_lastEtag, etag.c_str(), sizeof(g_lastEtag) - 1);
    g_lastEtag[sizeof(g_lastEtag) - 1] = '\0';
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

// =================== DEVICE EVENT LOG ===================
//
// A failed cycle can't report itself (that's what failing means), so the
// failure is buffered in RTC memory — it survives deep sleep — and POSTed
// to /api/log on the next cycle that gets a connection. One slot, latest
// failure wins; a repeat counter records how many failures the slot ate so
// a long outage shows up as "... (x12)" instead of 12 entries. This makes
// outages debuggable from the server (GET /api/logs) without a serial
// cable or panel photos.
RTC_DATA_ATTR char     g_pendingLogMsg[120] = {0};
RTC_DATA_ATTR int32_t  g_pendingLogCode  = 0;
RTC_DATA_ATTR uint16_t g_pendingLogCount = 0;

void queueDeviceLog(const char* msg, int code) {
  strncpy(g_pendingLogMsg, msg, sizeof(g_pendingLogMsg) - 1);
  g_pendingLogMsg[sizeof(g_pendingLogMsg) - 1] = '\0';
  g_pendingLogCode = code;
  if (g_pendingLogCount < 65535) g_pendingLogCount++;
  Serial.printf("Log queued: \"%s\" code=%d (x%u)\n", msg, code, g_pendingLogCount);
}

// Fire-and-forget like postBattery — a lost log POST just stays queued for
// the next cycle (only cleared on HTTP 200).
void flushDeviceLog() {
  if (!g_pendingLogMsg[0]) return;
  String url = addToken(String(activeServerBase) + "/api/log");
  HTTPClient http;
  WiFiClientSecure tls;
  http.setTimeout(5000);
  httpBegin(http, tls, url);
  addAuth(http);
  http.addHeader("Content-Type", "application/json");
  char msg[140];
  if (g_pendingLogCount > 1) {
    snprintf(msg, sizeof(msg), "%s (x%u)", g_pendingLogMsg, g_pendingLogCount);
  } else {
    snprintf(msg, sizeof(msg), "%s", g_pendingLogMsg);
  }
  StaticJsonDocument<256> doc;
  doc["level"] = "error";
  doc["msg"]   = msg;
  if (g_pendingLogCode != 0) doc["code"] = g_pendingLogCode;
  String body;
  serializeJson(doc, body);
  int rc = http.POST(body);
  http.end();
  Serial.printf("Log flush: HTTP %d\n", rc);
  if (rc == 200) {
    g_pendingLogMsg[0]  = '\0';
    g_pendingLogCode    = 0;
    g_pendingLogCount   = 0;
  }
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
// Runs at the END of a cycle, AFTER the panel has been drawn, and does NOT
// reboot. Both of those are deliberate.
//
// This used to run before the draw and reboot on success, so finding an
// update cost the user a ~33 s flash + reboot BEFORE the ~26 s redraw they
// were waiting on — which is why button wakes skipped it entirely. Draw
// first, then flash, and the wait disappears: the panel is already correct
// before a byte is downloaded.
//
// It reboots as soon as the flash lands, but AFTER the draw, which is the
// part that matters.
//
// 1.24.0 tried to avoid the reboot entirely: stage the slot, deep sleep, and
// let the next wake boot it. That DOES NOT WORK and the device told us so —
// it downloaded b-1.25.0.bin at 03:36, woke at 04:17 still running 1.24.0,
// and downloaded it again. ESP-IDF's bootloader caches the boot partition in
// RTC retain memory and on a deep-sleep wake boots that directly without
// consulting otadata, so a slot staged before sleeping is never selected and
// the device re-downloads forever.
//
// So: restart explicitly once the write succeeds. The cost is not the second
// 26 s refresh it looks like — the post-reboot cycle sends If-None-Match with
// the ETag we just drew (g_lastEtag is RTC_DATA_ATTR and survives a software
// reset), gets a 304, and skips the colour refresh entirely. It is a boot plus
// a WiFi connect plus three small requests, a few seconds, with the correct
// image already on glass throughout.
//
// A flash interrupted by power loss never gets marked bootable, so the old
// slot keeps booting.
//
// Because the panel is already correct before any of this starts, button
// wakes check too. The
// only cost on a button press is a manifest round trip (~0.9 s), and usually
// not even that: /display-3c.bin already told us the newest version via
// X-Firmware-Latest, so we skip the request unless it is actually newer.
//
// Still skipped on low battery — brick risk if the LiPo dies mid-flash.
// setInsecure() skips TLS cert validation; DEVICE_TOKEN in the URL is the
// auth, and cert pinning isn't worth the rotation pain.
void checkForUpdate(int battPct) {
  if (battPct < OTA_MIN_BATT_PCT) {
    Serial.printf("OTA: skip, battery %d%% < %d%%\n", battPct, OTA_MIN_BATT_PCT);
    return;
  }
  // Free path: the image fetch already told us what the newest build is.
  if (g_latestFw.length() > 0 && cmpFwVersion(g_latestFw, FW_VERSION) <= 0) {
    Serial.printf("OTA: up-to-date via header (%s)\n", g_latestFw.c_str());
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

  // false so the restart is ours to make, in the HTTP_UPDATE_OK case below,
  // after the result has been logged and flushed. See the note above for why
  // there has to be a restart at all rather than staging and sleeping.
  httpUpdate.rebootOnUpdate(false);
  t_httpUpdate_return result = isHttps
    ? httpUpdate.update(secureClient, binUrl)
    : httpUpdate.update(plainClient, binUrl);

  switch (result) {
    case HTTP_UPDATE_FAILED:
      // Queue it for the server. This used to be Serial-only, which is why the
      // 1.25.0 staging failure was invisible for two cycles — the only way to
      // see it was to notice the same binary being downloaded twice in the
      // HTTP log. An OTA that cannot apply is exactly the kind of thing you
      // want reported by the device that is stuck.
      Serial.printf("OTA FAILED (%d): %s\n",
                    httpUpdate.getLastError(),
                    httpUpdate.getLastErrorString().c_str());
      queueDeviceLog("OTA failed", httpUpdate.getLastError());
      break;
    case HTTP_UPDATE_NO_UPDATES:
      Serial.println("OTA: no updates");
      break;
    case HTTP_UPDATE_OK:
      // Reboot HERE rather than via rebootOnUpdate(true), so the log line and
      // the flush happen first and the restart is visible in this function
      // instead of disappearing inside httpUpdate.
      Serial.println("OTA: written — restarting into the new build");
      Serial.flush();
      delay(50);
      ESP.restart();
      break;   // not reached
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

// =================== TIME ===================

// Sync the ESP32's internal RTC against NTP. The scheduled-alarm feature
// this was originally for is gone, but time(nullptr) still stamps
// g_lastGoodAt — the "last successful render" the fail screen reports —
// and that reads as 1970 without a sync.
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

// Full-screen WiFi-setup instructions, shown when the user long-presses
// the button to re-provision. No code/password gate — physical button
// access is the trust boundary, and reflashing is the recovery path.
void drawSetupScreen() {
  g_lastEtag[0] = '\0';   // overwrites dashboard — invalidate cached ETag
  display.setRotation(0);
  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    display.fillRect(0, 0, SW, 80, GxEPD_BLACK);
    display.setTextColor(GxEPD_WHITE);
    display.setCursor(40, 56);
    display.setTextSize(4);
    display.print("WIFI SETUP");

    display.setTextColor(GxEPD_BLACK);
    display.setTextSize(3);
    display.setCursor(40, 170);
    display.print("1. Join WiFi:");
    display.setCursor(40, 215);
    display.print("   eink-setup");
    display.setCursor(40, 285);
    display.print("2. Open in browser:");
    display.setCursor(40, 330);
    display.print("   192.168.4.1");

    display.setTextSize(2);
    display.setCursor(40, 420);
    display.print("Window open 5 min, then restarts.");
  } while (display.nextPage());
  display.hibernate();
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
  g_lastEtag[0] = '\0';   // overwrites dashboard — invalidate cached ETag
                          // so recovery can't be skipped by a 304
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

// Direct-write path for the 3-color panel. The server ships two stacked
// 1-bit planes in one buffer: black = buf, red = buf + IMG_BYTES. Paint
// both, one full refresh, hibernate.
//
// Unlike the BW panel (UC8179), the Z08 3-color controller always runs a
// full multi-pass refresh with its own LUT, so it does NOT suffer the
// old→new "fades paler" problem — no double-write needed here.
//
// Bit convention for GxEPD2 3-color writeImage (invert=false):
//   black plane: 0 = black, 1 = white
//   red   plane: 0 = red,   1 = white   (0xFF everywhere = no red)
void pushImage(const uint8_t* buf) {
  const uint8_t* blackPlane = buf;
  const uint8_t* redPlane   = buf + IMG_BYTES;
  display.setRotation(0);
  display.setFullWindow();
  // If the previous render was the fail screen, its big banner leaves
  // stubborn particles a single refresh can't fully scrub. Pay one extra
  // clearScreen() (full-update white wipe) before painting.
  if (g_lastRenderWasFail) {
    Serial.println("Pre-wipe (previous render was fail screen)");
    display.clearScreen();
    g_lastRenderWasFail = false;
  }
  display.epd2.writeImage(blackPlane, redPlane, 0, 0, SW, SH, false, false, false);
  display.refresh(false);  // full refresh
  display.hibernate();
}

// =================== MAIN ===================

// Run one full refresh cycle: read battery → ensure WiFi → check
// OTA → download + paint image → reschedule. Returns the
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

  // Press-ack beep already fired at the top of setup() (instant feedback),
  // so no beep here — doing it again would double-beep on a button wake.
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
  // assumption of open-circuit voltage. Consumed once: USB-powered
  // active sessions loop without re-running setup(), and re-using the
  // boot-time snapshot forever froze the reported battery level for
  // the whole session. Later cycles take a fresh (WiFi-idle) read.
  float battV   = isfinite(g_idleBattV)   ? g_idleBattV   : readBatteryVoltage();
  int   battPct = (g_idleBattPct >= 0)    ? g_idleBattPct : batteryPctFromVoltage(battV);
  g_idleBattV   = NAN;
  g_idleBattPct = -1;
  g_battV   = battV;
  g_battPct = battPct;
  Serial.printf("Battery: %.2fV (%d%%)\n", battV, battPct);
  if (battPct < LOW_BATT_PCT) beepLowBattery();

  int sleepSec = DEFAULT_SLEEP_MIN * 60;

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
    queueDeviceLog("WiFi connection failed", 0);
    if (g_consecFails < 255) g_consecFails++;
    // Buttonless recovery. The portal normally opens via a button hold, but
    // on hardware without the button a changed router SSID/password would
    // otherwise brick WiFi until a USB reflash. After the 3rd consecutive
    // failure (~15+ min of outage, past the transient-blip window) open the
    // portal for one 5-minute window, then roughly once a day at the 60-min
    // backoff cap (every 12th failure) so a plain power outage doesn't burn
    // battery running an AP nobody is joining.
    if (g_consecFails == 3 || (g_consecFails > 3 && (g_consecFails - 3) % 12 == 0)) {
      Serial.printf("WiFi fail #%u — opening recovery portal\n", g_consecFails);
      drawSetupScreen();
      openCaptivePortal();   // blocks up to 5 min
      ESP.restart();         // retry immediately with whatever was saved
    }
    drawFailScreen("WiFi connection failed");
    return failBackoffSec();
  }

  warmServer();
  // First-boot enrollment. enrollDevice() is a no-op when g_apiKey is
  // already populated, so this is cheap on every cycle. If the server
  // is unreachable on cold boot the device falls back to the legacy
  // ?token= fleet credential until enrollment succeeds.
  if (g_apiKey.length() == 0) enrollDevice();
  postBattery(battV, battPct);
  flushDeviceLog();   // report any failure buffered from a previous cycle
  syncTime();

  // A manual button press means "refresh now" — drop the cached ETag so
  // the server can't 304 us, forcing a real redraw even if unchanged.
  if (buttonWake) g_lastEtag[0] = '\0';

  do {
    refreshRequested = false;
    uint8_t* img = downloadImage();
    // 304 (unchanged) is a success, not a failure — don't retry it.
    if (!img && !g_imageUnchanged) {
      Serial.println("Retry download once after 2s");
      delay(2000);
      img = downloadImage();
    }
    // Last-chance attempt after a long backoff. The dominant remaining
    // failure mode is a Railway cold start that outlasts the first two
    // tries — 10 s of breathing room costs little and saves a 5-minute
    // fail-screen cycle. (The old "re-probe LAN vs cloud" logic here
    // was a no-op once the base became cloud-only.)
    if (!img && !g_imageUnchanged) {
      Serial.println("Both attempts failed — backing off 10 s, final try");
      delay(10000);
      img = downloadImage();
    }
    if (g_imageUnchanged) {
      // Image identical to what's on the panel — skip the ~15-26 s color
      // refresh entirely, just refresh the clock-keeping state.
      Serial.println("Unchanged — leaving panel as-is");
      g_lastGoodAt = time(nullptr);
      g_consecFails = 0;
      if (buttonWake) beepChime();
      sleepSec = fetchSleepSeconds();
      Serial.printf("Sleep %d s\n", sleepSec);
    } else if (img) {
      pushImage(img);
      free(img);
      g_lastGoodAt = time(nullptr);
      g_consecFails = 0;
      if (buttonWake) beepChime();
      sleepSec = fetchSleepSeconds();
      Serial.printf("Sleep %d s\n", sleepSec);
    } else {
      queueDeviceLog("Could not fetch image", g_lastHttpCode);
      drawFailScreen("Could not fetch image");
      if (g_consecFails < 255) g_consecFails++;
      sleepSec = failBackoffSec();
    }
    if (refreshRequested) {
      Serial.println("Press during cycle — re-refreshing");
      beep(30);   // press ack (ISR no longer drives the buzzer)
    }
  } while (refreshRequested);

  // Panel is already up to date, so a flash from here costs the user nothing.
  // Stages into the inactive slot and returns; the next wake boots it.
  // Runs even when the draw failed — a device that cannot render is exactly
  // the one that most needs to be able to update itself.
  checkForUpdate(battPct);

  return sleepSec;
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

  // Instant press feedback. The old ack beep lived in runCycle, which
  // only runs after display.init + battery + WiFi connect (~1-3 s) — long
  // enough that the click felt unacknowledged. Beeping here, right after
  // the buzzer is attached and before any of that work, makes the press
  // feel immediate. Battery (deep-sleep) wakes arrive as EXT1.
  if (esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_EXT1) beep(40);

  hspi.begin(EPD_SCK, -1, EPD_MOSI, EPD_CS);
  display.epd2.selectSPI(hspi, SPISettings(4000000, MSBFIRST, SPI_MODE0));
  // Deep sleep fully powers the EPD controller down between cycles, so
  // every wake — cold POR, timer, button — has to run the full panel
  // init (reset pulse + `_initial_write/_refresh` flags). Skipping it
  // with initial=false on timer/button wakes leaves the controller in
  // a half-configured state and the next writeImage silently no-ops.
  //
  // Reset duration bumped from 2 ms → 50 ms to match GxEPD2's README
  // recommendation for this panel. The shorter pulse left the
  // controller in an indeterminate state coming out of hibernate, which
  // showed up as "Busy Timeout!" on every _PowerOn / _Update_Full call
  // — the panel was never registering the reset edge so BUSY never
  // transitioned to ready.
  display.init(115200, true, 50, false);

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
  // esp_sleep_get_wakeup_cause() reports the cause of the LAST sleep —
  // it never changes while we stay awake. USB-powered sessions loop
  // here without sleeping, so only the FIRST iteration may trust it;
  // re-reading it every pass made a button-initiated USB session beep
  // on every cycle. (It also skipped OTA indefinitely back when
  // checkForUpdate ignored button wakes; it no longer does.) Later
  // iterations are timer-equivalent, except when
  // the previous pass ended on a button press (early-refresh break in
  // the USB wait loop below).
  static bool s_firstLoop = true;
  static bool s_buttonCycle = false;
  esp_sleep_wakeup_cause_t wakeCause;
  if (s_firstLoop) {
    s_firstLoop = false;
    wakeCause = esp_sleep_get_wakeup_cause();
  } else {
    wakeCause = s_buttonCycle ? ESP_SLEEP_WAKEUP_EXT1 : ESP_SLEEP_WAKEUP_TIMER;
  }
  s_buttonCycle = false;
  bool buttonWake = (wakeCause == ESP_SLEEP_WAKEUP_EXT1);

  // runCycle runs FIRST so a button press refreshes the display as fast
  // as possible. The factory-reset hold check used to block here for up
  // to 5 s before runCycle could start, which left the user staring at
  // a stale screen and forced the WiFi reconnect to start after the AP
  // had already aged the association out of its table. Now the dashboard
  // refresh starts the moment we wake — the hold check happens after
  // the cycle returns.
  unsigned long wakeAtMs = millis();
  int sleepSec = runCycle(wakeCause);
  uint64_t sleepUs = (uint64_t)sleepSec * 1000000ULL;   // already seconds

  // Staged button hold, measured from when the refresh finished (so the
  // screen updates fast regardless). Keep holding after the refresh:
  //   ≥2 s, release before 7 s  → open WiFi portal, KEEPING saved networks
  //                               (add a network for a new location).
  //   7–10 s                    → CONTINUOUS warning beep ("hold to reset").
  //                               Releasing during the beep CANCELS — does
  //                               nothing (no portal, no reset).
  //   ≥10 s (hold through beep) → factory reset, WIPES everything.
  // A quick tap (released during/right after the cycle) does neither.
  // THREE quick beeps at the 2 s mark mean "release now for WiFi setup".
  // The long 3 s beep is the deliberate, hard-to-trigger reset confirm.
  if (buttonWake && digitalRead(BTN_REFRESH) == LOW) {
    unsigned long holdStart = millis();
    bool armedPortal = false;
    bool warning = false;        // true once the 7 s reset-warning beep starts
    while (digitalRead(BTN_REFRESH) == LOW) {
      unsigned long held = millis() - holdStart;
      if (held >= 10000) {
        buzzerOff();
        factoryReset();          // never returns
      }
      if (held >= 2000 && !armedPortal) {
        armedPortal = true;
        // Three quick beeps — distinct from the single refresh chime —
        // mean "release now for WiFi setup".
        beep(50); delay(60); beep(50); delay(60); beep(50);
      }
      if (held >= 7000 && !warning) {
        warning = true;
        buzzerOn();              // continuous beep until 10 s or release
      }
      delay(50);
    }
    // Button released. A continuous beep means we were in the 7–10 s reset
    // window → cancel the reset entirely (and skip the portal — the user
    // was reaching past it).
    buzzerOff();
    if (warning) {
      Serial.println("Factory reset CANCELLED — released during warning beep");
    } else if (armedPortal) {
      Serial.println("Button hold 2-7s → opening WiFi portal (networks kept)");
      drawSetupScreen();         // on-screen join instructions
      openCaptivePortal();       // blocks up to 5 min
      ESP.restart();             // re-provision with whatever was saved
    }
  }
  // Belt-and-braces: small grace window so a quick double-tap doesn't
  // immediately re-wake from ALL_LOW with the button still pressed.
  unsigned long t0 = millis();
  while (digitalRead(BTN_REFRESH) == LOW && millis() - t0 < 1000) {
    delay(10);
  }
  buzzerOff();

  // Idle between cycles. Deep sleep unless DEV_STAY_AWAKE is set.
  //
  // Deep sleep tears WiFi down completely, but the warm-boot fast-
  // reconnect path (cached BSSID + channel + static IP) brings the
  // radio back in ~700 ms — well under the cost of trying to keep the
  // association alive across light sleep, which proved unreliable
  // through `WiFi.setSleep(false)` + `esp_light_sleep_start()`. Deep
  // sleep also draws ~10 µA vs light sleep's ~800 µA, so battery life
  // jumps from weeks to months.
  //
  // The button is NOT lost while deep asleep — ext1 ALL_LOW on GPIO32 wakes
  // the board on a press. It costs a full boot + refresh instead of being
  // instant, which is the right trade for a panel that redraws in 26 s anyway.
  float vbat = readBatteryVoltage();

#if DEV_STAY_AWAKE
  Serial.printf("DEV_STAY_AWAKE (%.2fV) — active wait %d s\n", vbat, sleepSec);
  unsigned long until = millis() + (unsigned long)(sleepUs / 1000ULL);
  while ((long)(until - millis()) > 0) {
    if (refreshRequested) {
      Serial.println("Button pressed — early refresh");
      s_buttonCycle = true;   // next loop() pass counts as a button cycle
      beep(30);               // press ack (ISR no longer drives the buzzer)
      break;
    }
    delay(200);
  }
#else
  Serial.printf("Battery (%.2fV) — deep sleep %d s\n", vbat, sleepSec);
  rtc_gpio_pulldown_dis((gpio_num_t)BTN_REFRESH);
  rtc_gpio_pullup_en((gpio_num_t)BTN_REFRESH);
  esp_sleep_enable_timer_wakeup(sleepUs);
  esp_sleep_enable_ext1_wakeup(WAKE_PIN_MASK, ESP_EXT1_WAKEUP_ALL_LOW);
  Serial.flush();
  esp_deep_sleep_start();   // does not return
#endif
}
