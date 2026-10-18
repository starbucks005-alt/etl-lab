/* The Rising Sun, 2026-10-18, Dr. O. An ESP32-S3 drives the LED strips behind the acrylic and brings the sun up slowly.
   NOT TRIED ON THE REAL BOARD OR STRIPS YET. The color steps match sunrise.py, which prints them without any hardware.
   Check the pin against the board's printed labels before wiring.

   Board: ESP32-S3 N16R8, the same as the Holopod buttons. Arduino IDE: Board "ESP32S3 Dev Module". Library: Adafruit NeoPixel (Library Manager).
   Wiring:
     Strip data wire to LED_PIN through a 330 ohm resistor. Strip GND to the board GND and to the power supply GND.
     Strip + to its own 5V supply, sized for the strip (a full white LED draws up to 60 milliamps, so 60 LEDs can need 3.6 amps).
     Do not power a long strip from the board's 5V pin.
     A 3.3V data signal can be unreliable on some strips. If the first LED flickers, add a 74AHCT125 level shifter.
   Wi-Fi and the wake time: fill in WIFI_NAME, WIFI_PASS, WAKE_HOUR and WAKE_MIN below. The clock comes from the internet.
   NOT BUILT: her voice, her listening, the choice of fairy. This program only runs the light. */

#include <Adafruit_NeoPixel.h>
#include <WiFi.h>
#include <time.h>

const int LED_PIN = 5;
const int LED_COUNT = 60;                 // placeholder until the acrylic layout is decided
const int SUNRISE_MINUTES = 30;
const int WAKE_HOUR = 7, WAKE_MIN = 0;    // the sun is at full strength at this time
const char* WIFI_NAME = "";
const char* WIFI_PASS = "";
const char* TIMEZONE = "EST5EDT,M3.2.0,M11.1.0";   // change for where you live

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

void setup() {
  strip.begin();
  strip.clear();
  strip.show();
  WiFi.begin(WIFI_NAME, WIFI_PASS);
  configTzTime(TIMEZONE, "pool.ntp.org");
  // a short test so you can see the strip is alive: one slow pass up and down
  for (int i = 0; i <= 20; i++) { paint(i / 20.0); delay(50); }
  for (int i = 20; i >= 0; i--) { paint(i / 20.0); delay(50); }
}

void loop() {
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
