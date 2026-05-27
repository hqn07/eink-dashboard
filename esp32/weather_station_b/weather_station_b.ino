// weather_station_b.ino — 7.5" V2 B (3-color: black / white / red)
// Variant of weather_station.ino for the Waveshare 7.5" B-version panel
// (driver IC GDEY075Z08). Server still serves a single 48000-byte 1-bit
// image; this firmware paints it on the BLACK plane and leaves the RED
// plane blank (all-white). All other behavior (WiFi → battery → image →
// sleep, GPIO32 refresh button) is identical to the BW version.

#define USE_HSPI_FOR_EPD

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <ArduinoJson.h>
#include <GxEPD2_3C.h>
#include <SPI.h>
#include <driver/rtc_io.h>

// =================== CONFIG ===================
#include "secrets.h"

// OTA: bump on every release. Server returns 204 unless its newest
// matching `b-X.Y.Z.bin` is strictly greater than this.
#define FW_VERSION "1.0.0"
#define FW_BOARD   "b"
#define OTA_MIN_BATT_PCT 50

#define DEFAULT_SLEEP_MIN 30

#define BATTERY_PIN  34
#define BATT_FULL_V  4.2f
#define BATT_EMPTY_V 3.3f
#define DIVIDER_RATIO 2.0f

#define SW 800
#define SH 480
#define IMG_BYTES (SW * SH / 8)   // 48000

static const int EPD_BUSY = 25, EPD_RST = 26, EPD_DC = 27;
static const int EPD_CS = 15, EPD_SCK = 13, EPD_MOSI = 14;

#define BTN_REFRESH  32
#define WAKE_PIN_MASK (1ULL << BTN_REFRESH)

SPIClass hspi(HSPI);
// 3-color driver class. GDEY075Z08 = Waveshare 7.5" V2 B (800×480, B/W/R).
GxEPD2_3C<GxEPD2_750_GDEY075Z08, GxEPD2_750_GDEY075Z08::HEIGHT>
  display(GxEPD2_750_GDEY075Z08(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));

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

void warmServer() {
  String url = String(serverBase) + "/health";
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

uint8_t* downloadImage() {
  String url = addToken(String(serverBase) + "/display.bin");
  Serial.printf("GET %s\n", url.c_str());

  HTTPClient http;
  http.setTimeout(60000);
  http.begin(url);
  int code = http.GET();
  if (code != 200) {
    Serial.printf("HTTP %d\n", code);
    http.end();
    return nullptr;
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

void postBattery(float v, int pct) {
  String url = addToken(String(serverBase) + "/api/battery");
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
// See OTA notes in weather_station.ino (BW build) — same flow, only the
// FW_BOARD differs so the server resolves to the 3-color binary.
void checkForUpdate(int battPct, bool buttonWake) {
  if (buttonWake) {
    Serial.println("OTA: skip on button wake");
    return;
  }
  if (battPct < OTA_MIN_BATT_PCT) {
    Serial.printf("OTA: skip, battery %d%% < %d%%\n", battPct, OTA_MIN_BATT_PCT);
    return;
  }

  String url = String(serverBase) + "/api/firmware/manifest?board=" + FW_BOARD + "&from=" + FW_VERSION;
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
      Serial.println("OTA: applied (rebooting)");
      break;
  }
}

int fetchSleepMinutes() {
  String url = addToken(String(serverBase) + "/sleep");
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

void drawFailScreen(const char* reason) {
  display.setRotation(0);
  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    // Red banner on the B-version panel — only place we use the second color.
    display.fillRect(0, 0, SW, 60, GxEPD_RED);
    display.setTextColor(GxEPD_WHITE);
    display.setCursor(20, 38);
    display.setTextSize(3);
    display.print("CONNECTION ERROR");
    display.setTextColor(GxEPD_BLACK);
    display.setTextSize(2);
    display.setCursor(20, 120);
    display.print(reason);
    display.setCursor(20, 160);
    display.print("Server: ");
    display.print(serverBase);
    display.setCursor(20, 200);
    display.print("Retrying in 5 min");
  } while (display.nextPage());
  display.hibernate();
}

// Direct-write path for the 3-color panel. We have one 1-bit image from the
// server — paint it on the BLACK plane and feed the RED plane a blank (all
// 0xFF = "white, no red"). One write, one refresh, hibernate.
//
// Bit convention for GxEPD2 3-color writeImage (invert=false):
//   black plane: 0 = black,  1 = white
//   red   plane: 0 = red,    1 = white
// So 0xFF on the red plane means "no red anywhere".
void pushImage(const uint8_t* buf) {
  display.setRotation(0);
  display.setFullWindow();
  display.fillScreen(GxEPD_WHITE);

  uint8_t* redPlane = (uint8_t*)ps_malloc(IMG_BYTES);
  if (!redPlane) redPlane = (uint8_t*)malloc(IMG_BYTES);
  if (redPlane) {
    memset(redPlane, 0xFF, IMG_BYTES);
    display.epd2.writeImage(buf, redPlane, 0, 0, SW, SH, false, false, false);
    free(redPlane);
  } else {
    // Fallback: black-only write. Some 3C drivers leave the red plane in an
    // undefined state if we never write it, so try not to hit this path.
    Serial.println("red plane malloc failed — black-only write");
    display.epd2.writeImage(buf, 0, 0, SW, SH, false, false, false);
  }
  display.refresh(false);
  display.hibernate();
}

// =================== MAIN ===================

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n=== E-Ink Dashboard Client (7.5\" B / 3-color) ===");
  Serial.printf("Firmware: %s board=%s\n", FW_VERSION, FW_BOARD);

  esp_sleep_wakeup_cause_t wakeCause = esp_sleep_get_wakeup_cause();
  bool coldBoot = (wakeCause == ESP_SLEEP_WAKEUP_UNDEFINED);
  bool buttonWake = (wakeCause == ESP_SLEEP_WAKEUP_EXT1);
  const char* wakeLabel = coldBoot ? "cold/POR"
                        : buttonWake ? "BTN_REFRESH"
                        : "timer";
  Serial.printf("Wake cause: %d (%s)\n", wakeCause, wakeLabel);

  hspi.begin(EPD_SCK, -1, EPD_MOSI, EPD_CS);
  display.epd2.selectSPI(hspi, SPISettings(4000000, MSBFIRST, SPI_MODE0));
  display.init(115200, coldBoot, 2, false);

  setupBattery();
  float battV   = readBatteryVoltage();
  int   battPct = batteryPctFromVoltage(battV);
  Serial.printf("Battery: %.2fV (%d%%)\n", battV, battPct);

  int sleepMin = DEFAULT_SLEEP_MIN;

  if (!connectWiFi()) {
    drawFailScreen("WiFi connection failed");
    sleepMin = 5;
  } else {
    warmServer();
    postBattery(battV, battPct);
    checkForUpdate(battPct, buttonWake);   // may not return (reboots on success)
    uint8_t* img = downloadImage();
    if (!img) {
      Serial.println("Retry download once after 2s");
      delay(2000);
      img = downloadImage();
    }
    if (img) {
      pushImage(img);
      free(img);
      sleepMin = fetchSleepMinutes();
      Serial.printf("Sleep %d min\n", sleepMin);
    } else {
      drawFailScreen("Could not fetch image");
      sleepMin = 5;
    }
  }

  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);

  pinMode(BTN_REFRESH, INPUT_PULLUP);
  unsigned long t0 = millis();
  while (digitalRead(BTN_REFRESH) == LOW && millis() - t0 < 5000) {
    delay(10);
  }
  rtc_gpio_pulldown_dis((gpio_num_t)BTN_REFRESH);
  rtc_gpio_pullup_en((gpio_num_t)BTN_REFRESH);

  esp_sleep_enable_timer_wakeup((uint64_t)sleepMin * 60ULL * 1000000ULL);
  esp_sleep_enable_ext1_wakeup(WAKE_PIN_MASK, ESP_EXT1_WAKEUP_ALL_LOW);
  Serial.flush();
  esp_deep_sleep_start();
}

void loop() {}
