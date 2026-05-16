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
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <GxEPD2_BW.h>
#include <SPI.h>

// =================== CONFIG ===================
const char* ssid     = "SETUP-755E";
const char* password = "REDACTED";

// Your dashboard server. Change to your Railway URL once deployed.
// Examples:
//   "http://192.168.1.42:3000"   <- local Node dev server during testing
//   "https://your-app.up.railway.app"  <- deployed
const char* serverBase = "http://192.168.1.42:3000";

// Optional shared secret. Set this if you set DEVICE_TOKEN in the server's .env
const char* deviceToken = "";

#define DEFAULT_SLEEP_MIN 30
#define BATTERY_PIN 34

// Display geometry — matches server's render
#define SW 800
#define SH 480
#define IMG_BYTES (SW * SH / 8)   // 48000

// Pins (unchanged from your working setup)
static const int EPD_BUSY = 25, EPD_RST = 26, EPD_DC = 27;
static const int EPD_CS = 15, EPD_SCK = 13, EPD_MOSI = 14;

SPIClass hspi(HSPI);
GxEPD2_BW<GxEPD2_750_GDEY075T7, GxEPD2_750_GDEY075T7::HEIGHT>
  display(GxEPD2_750_GDEY075T7(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));

// =================== WIFI ===================

bool connectWiFi(unsigned long timeoutMs = 20000) {
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  Serial.print("WiFi");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - start) < timeoutMs) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("Connected: %s\n", WiFi.localIP().toString().c_str());
    return true;
  }
  Serial.println("WiFi FAILED");
  return false;
}

// =================== HTTP HELPERS ===================

String addToken(String url) {
  if (strlen(deviceToken) == 0) return url;
  url += (url.indexOf('?') >= 0) ? "&" : "?";
  url += "token=";
  url += deviceToken;
  return url;
}

// Download image into a heap buffer. Returns nullptr on failure.
uint8_t* downloadImage() {
  String url = addToken(String(serverBase) + "/display.bin");
  Serial.printf("GET %s\n", url.c_str());

  HTTPClient http;
  http.setTimeout(20000);
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

// Draw a fallback "couldn't connect" screen so you know what's up
void drawFailScreen(const char* reason) {
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

void pushImage(const uint8_t* buf) {
  display.setRotation(0);
  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    // GxEPD2 drawImage expects MSB-first, 0=black, 1=white — matches our server.
    display.drawImage(buf, 0, 0, SW, SH, false, false, false);
  } while (display.nextPage());
  display.hibernate();
}

// =================== MAIN ===================

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n=== E-Ink Dashboard Client ===");

  hspi.begin(EPD_SCK, -1, EPD_MOSI, EPD_CS);
  display.epd2.selectSPI(hspi, SPISettings(4000000, MSBFIRST, SPI_MODE0));
  display.init(115200, true, 2, false);

  int sleepMin = DEFAULT_SLEEP_MIN;

  if (!connectWiFi()) {
    drawFailScreen("WiFi connection failed");
    sleepMin = 5;
  } else {
    uint8_t* img = downloadImage();
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

  esp_sleep_enable_timer_wakeup((uint64_t)sleepMin * 60ULL * 1000000ULL);
  Serial.flush();
  esp_deep_sleep_start();
}

void loop() {}
