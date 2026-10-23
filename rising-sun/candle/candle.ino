/* The candle's light, 2026-10-23. A warm, uneven flicker on a 24 LED ring under the tube, and one push button to wake it or put it to sleep.
   Written for the Waveshare ESP32-S3 AI Smart Speaker board. NOT COMPILED and NOT TRIED on the board or the ring. No voice, no Wi-Fi yet.

   Wiring (header pin numbers from Waveshare's interface picture):
     Ring data   to GPIO7 (header pin 2), through a 330 ohm resistor
     Ring power  to the header's 5V (pin 18), ring GND to GND (pin 16). 24 LEDs at this cap draw well under half an amp.
     Button      one leg to GPIO8 (header pin 9), the other leg to GND (pin 15 or 16). No resistor needed.
   The button is a software button: it fades the light, it does not cut power or turn the microphone off. */
#include <Adafruit_NeoPixel.h>

const int RING_PIN = 7;
const int RING_COUNT = 24;
const int BUTTON_PIN = 8;
const int MAX_BRIGHTNESS = 120;          // of 255, kept low for USB power and for a candle that should not glare
const int TINT_R = 0, TINT_G = 0, TINT_B = 0;
const int TINT_PERCENT = 0;              // 0 to 100: how far toward the fairy's color the amber leans (15 is a soft tint)

Adafruit_NeoPixel ring(RING_COUNT, RING_PIN, NEO_GRB + NEO_KHZ800);
float level[RING_COUNT];
float target[RING_COUNT];
float master = 0.0;                       // 0 off, 1 fully lit, moves slowly so a press fades in and out
bool lit = true;
unsigned long lastStep = 0, nextPick = 0, lastChange = 0;
int prevReading = HIGH;

uint32_t flameColor(float f) {
  int r = (255 * (100 - TINT_PERCENT) + TINT_R * TINT_PERCENT) / 100;
  int g = (110 * (100 - TINT_PERCENT) + TINT_G * TINT_PERCENT) / 100;
  int b = (20 * (100 - TINT_PERCENT) + TINT_B * TINT_PERCENT) / 100;
  return ring.Color((uint8_t)(r * f), (uint8_t)(g * f), (uint8_t)(b * f));
}

void setup() {
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  ring.begin();
  ring.setBrightness(MAX_BRIGHTNESS);
  for (int i = 0; i < RING_COUNT; i++) { level[i] = 0.8; target[i] = 0.8; }
  randomSeed(micros());
}

void loop() {
  unsigned long now = millis();

  int reading = digitalRead(BUTTON_PIN);
  if (reading != prevReading && now - lastChange > 40) {   // a press, with a short wait so one touch counts once
    lastChange = now;
    prevReading = reading;
    if (reading == LOW) lit = !lit;
  }

  if (now >= nextPick) {              // every 60 to 140 ms some of the ring picks a new, slightly different brightness
    nextPick = now + 60 + random(0, 80);
    for (int i = 0; i < RING_COUNT; i++) {
      if (random(0, 3) == 0) target[i] = 0.55 + random(0, 45) / 100.0;
    }
  }

  if (now - lastStep >= 20) {
    lastStep = now;
    master += lit ? 0.02 : -0.02;                           // about a second to fade in or out
    if (master > 1.0) master = 1.0;
    if (master < 0.0) master = 0.0;
    for (int i = 0; i < RING_COUNT; i++) {
      level[i] += (target[i] - level[i]) * 0.15;
      ring.setPixelColor(i, flameColor(level[i] * master));
    }
    ring.show();
  }
}
