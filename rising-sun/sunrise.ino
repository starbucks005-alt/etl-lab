/* The Rising Sun, 2026-10-18, Dr. O. An ESP32-S3 drives the LED strips behind the acrylic and brings the sun up slowly.
   NOT TRIED ON THE REAL BOARD OR STRIPS YET. The color steps match sunrise.py, which prints them without any hardware.
   Check the pin against the board's printed labels before wiring.

   Board: ESP32-S3 N16R8, the same as the Holopod buttons. Arduino IDE: Board "ESP32S3 Dev Module". Library: Adafruit NeoPixel (Library Manager).
   Wiring:
     Strip data wire to LED_PIN through a 330 ohm resistor. Strip GND to the board GND and to the power supply GND.
     Strip + to its own 5V supply, sized for the strip (a full white LED draws up to 60 milliamps, so 60 LEDs can need 3.6 amps).
     Do not power a long strip from the board's 5V pin.
     A 3.3V data signal can be unreliable on some strips. If the first LED flickers, add a 74AHCT125 level shifter.
   FIRST TRY: leave DEMO_MODE true. It needs no Wi-Fi and no key, and plays the whole sunrise in 90 seconds on a loop so you can see the colors.
   REAL USE: set DEMO_MODE false, then fill in WIFI_NAME, WIFI_PASS, SUN_KEY (the same SUN_DEVICE_KEY the site holds) and SITE below. The clock comes from the internet.
   Wake time, sunrise length and time zone are read from the website every 10 minutes (set them on the Rising Sun panel). The numbers below are only used until the first read works.
   Library: also ArduinoJson (Library Manager).
   NOT BUILT: her voice, her listening, the choice of fairy. This program only runs the light. */

#include <Adafruit_NeoPixel.h>
#include <WiFi.h>
#include <time.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>

const int LED_PIN = 5;
const int LED_COUNT = 88;                 // 144 LEDs per meter, for the 24 inch bar: 0.61 m is about 88. 18 inch is 66, 30 inch is 110. Dr. O's strip choice, 2026-10-23
const int MAX_BRIGHTNESS = 180;           // of 255. Keeps 88 LEDs under the 5 amp supply (88 x 60 mA is 5.3 A at full white). Raise it only with a bigger supply
const bool DEMO_MODE = true;              // true: skip Wi-Fi and the clock and play the whole sunrise in DEMO_SECONDS, over and over. Set false for the real thing.
const int DEMO_SECONDS = 90;
int SUNRISE_MINUTES = 30;
int WAKE_HOUR = 7, WAKE_MIN = 0;          // the sun is at full strength at this time
const char* WIFI_NAME = "";
const char* WIFI_PASS = "";
const char* SITE = "https://emerging-tech-lab.com";
const char* SUN_KEY = "";
String TIMEZONE = "EST5EDT,M3.2.0,M11.1.0";   // replaced by the panel's choice
unsigned long lastRead = 0;
bool haveRead = false;

struct Step { float f; uint8_t r, g, b; };
const Step STEPS[] = {
  { 0.00,   0,   0,   0 },
  { 0.10,  40,   2,   0 },
  { 0.35, 200,  40,   0 },
  { 0.65, 255, 120,  20 },
  { 0.85, 255, 190, 110 },
  { 1.00, 255, 235, 200 },
};
const int NSTEPS = sizeof(STEPS) / sizeof(STEPS[0]);

Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);

uint32_t colorAt(float f) {
  if (f < 0) f = 0;
  if (f > 1) f = 1;
  for (int i = 1; i < NSTEPS; i++) {
    if (f <= STEPS[i].f) {
      const Step& a = STEPS[i - 1];
      const Step& b = STEPS[i];
      float k = (f - a.f) / (b.f - a.f);
      return strip.Color(a.r + (b.r - a.r) * k, a.g + (b.g - a.g) * k, a.b + (b.b - a.b) * k);
    }
  }
  return strip.Color(255, 235, 200);
}

void paint(float f) {
  strip.fill(colorAt(f));
  strip.show();
}

void readSettings() {
  if (WiFi.status() != WL_CONNECTED) return;
  WiFiClientSecure net;
  net.setInsecure();      // the key is the protection here; add the site's certificate to do better
  HTTPClient http;
  http.begin(net, String(SITE) + "/.netlify/functions/sun-settings");
  http.addHeader("x-sun-key", SUN_KEY);
  if (http.GET() == 200) {
    JsonDocument doc;
    if (!deserializeJson(doc, http.getString())) {
      JsonObject st = doc["settings"];
      WAKE_HOUR = st["wake_hour"] | WAKE_HOUR;
      WAKE_MIN = st["wake_min"] | WAKE_MIN;
      SUNRISE_MINUTES = st["sunrise_minutes"] | SUNRISE_MINUTES;
      String tz = st["tz"] | "";
      if (tz.length() && tz != TIMEZONE) { TIMEZONE = tz; configTzTime(TIMEZONE.c_str(), "pool.ntp.org"); }
      haveRead = true;
    }
  }
  http.end();
}

void setup() {
  strip.begin();
  strip.setBrightness(MAX_BRIGHTNESS);
  strip.clear();
  strip.show();
  WiFi.begin(WIFI_NAME, WIFI_PASS);
  configTzTime(TIMEZONE.c_str(), "pool.ntp.org");
  // a short test so you can see the strip is alive: one slow pass up and down
  for (int i = 0; i <= 20; i++) { paint(i / 20.0); delay(50); }
  for (int i = 20; i >= 0; i--) { paint(i / 20.0); delay(50); }
}

void demo() {
  unsigned long cycle = (unsigned long)(DEMO_SECONDS + 10) * 1000UL;     // the sunrise, then 10 seconds of dark before it starts again
  unsigned long at = millis() % cycle;
  paint(at < (unsigned long)DEMO_SECONDS * 1000UL ? (float)at / ((float)DEMO_SECONDS * 1000.0) : 0.0);
  delay(50);
}

void loop() {
  if (DEMO_MODE) { demo(); return; }
  if (lastRead == 0 || millis() - lastRead > (haveRead ? 600000UL : 30000UL)) { lastRead = millis(); readSettings(); }
  struct tm t;
  if (getLocalTime(&t, 200)) {
    int now = t.tm_hour * 3600 + t.tm_min * 60 + t.tm_sec;
    int wake = WAKE_HOUR * 3600 + WAKE_MIN * 60;
    int start = wake - SUNRISE_MINUTES * 60;
    if (now >= start && now <= wake + 30 * 60) {
      paint((float)(now - start) / (SUNRISE_MINUTES * 60));   // stays at full for 30 minutes after the wake time
    } else {
      paint(0);
    }
  }
  delay(1000);
}
