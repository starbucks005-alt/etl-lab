/* Board test for the Waveshare ESP32-S3 AUDIO Board (the AI smart speaker board), 2026-10-30.
   It does not talk to the internet. It only checks the board: the chips answer, the speaker plays a short beep,
   the ring of 7 lights glows, the three keys are seen, and the battery voltage is read.

   Pins and addresses come from Waveshare's own Arduino sample (ESP32-S3-AUDIO-Board-Demo). Compiled by this session
   against the ESP32 Arduino core 3.2.0; NOT yet run on the board.

   Arduino IDE settings: Board "ESP32S3 Dev Module", USB CDC On Boot "Enabled", Flash Size 16MB, Partition Scheme
   "16M Flash (3MB APP/9.9MB FATFS)", PSRAM "OPI PSRAM". Library: Adafruit NeoPixel (Library Manager). The three
   es8311 files beside this sketch are Espressif's speaker chip driver, copied unchanged from Waveshare's demo
   (Apache 2.0 licence, see the header of es8311.cpp).
   Open the Serial Monitor at 115200 to read what it prints. */

#include <Arduino.h>
#include <Wire.h>
#include <math.h>
#include <Adafruit_NeoPixel.h>
#include "ESP_I2S.h"
#include "driver/i2c.h"
#include "es8311.h"

// Pins, as in Waveshare's sample
#define I2C_SDA        11
#define I2C_SCL        10
#define I2S_MCLK       12
#define I2S_BCLK       13
#define I2S_LRCK       14
#define I2S_DOUT       16   // the board sends sound to the speaker on this pin
#define I2S_DIN        15   // the microphones send sound to the board on this pin
#define RING_PIN       38
#define RING_COUNT     7
#define BATTERY_ADC    8

#define TCA_ADDR       0x20  // the extra pin chip
#define ES8311_ADDR    0x18  // the speaker chip
#define ES7210_ADDR    0x40  // the microphone chip

#define SAMPLE_RATE    16000
#define SPEAKER_VOLUME 55    // 0 to 100. Waveshare's sample uses 98, which is much louder. Raise slowly.
#define BEEP_AMPLITUDE 6000  // out of 32767

Adafruit_NeoPixel ring(RING_COUNT, RING_PIN, NEO_GRB + NEO_KHZ800);
I2SClass i2s;
es8311_handle_t codec = NULL;

bool seen(uint8_t addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

// The speaker amplifier is switched on by pin EXIO8 of the TCA9555 chip (port 1, bit 0).
bool speakerOn(bool on) {
  Wire.beginTransmission(TCA_ADDR); Wire.write(0x07); Wire.write(0xFE);            // only EXIO8 as an output
  if (Wire.endTransmission() != 0) return false;
  Wire.beginTransmission(TCA_ADDR); Wire.write(0x03); Wire.write(on ? 0xFF : 0xFE); // EXIO8 high = amplifier on
  return Wire.endTransmission() == 0;
}

// Reads the three keys. They sit on EXIO9, 10 and 11 (port 1, bits 1 to 3) and read 0 when pressed.
uint8_t keysPressed() {
  Wire.beginTransmission(TCA_ADDR); Wire.write(0x01);
  if (Wire.endTransmission(false) != 0) return 0;
  if (Wire.requestFrom((uint8_t)TCA_ADDR, (uint8_t)1) != 1) return 0;
  uint8_t v = Wire.read();
  uint8_t out = 0;
  if (!(v & 0x02)) out |= 1;  // KEY1
  if (!(v & 0x04)) out |= 2;  // KEY2
  if (!(v & 0x08)) out |= 4;  // KEY3
  return out;
}

float batteryVolts() {
  return analogReadMilliVolts(BATTERY_ADC) * 3.0f / 1000.0f / 0.990476f;  // as in Waveshare's sample
}

bool codecStart() {
  codec = es8311_create(I2C_NUM_0, ES8311_ADDR);
  if (!codec) return false;
  es8311_clock_config_t clk = {};
  clk.mclk_inverted = false;
  clk.sclk_inverted = false;
  clk.mclk_from_mclk_pin = true;
  clk.mclk_frequency = SAMPLE_RATE * 256;
  clk.sample_frequency = SAMPLE_RATE;
  if (es8311_init(codec, &clk, ES8311_RESOLUTION_16, ES8311_RESOLUTION_16) != ESP_OK) return false;
  es8311_voice_volume_set(codec, SPEAKER_VOLUME, NULL);
  es8311_microphone_config(codec, false);
  return true;
}

void beep(int hz, int ms) {
  const int frames = SAMPLE_RATE * ms / 1000;
  int16_t pair[2];
  for (int i = 0; i < frames; i++) {
    float t = (float)i / SAMPLE_RATE;
    float fade = 1.0f;                       // short fade in and out so there is no click
    if (i < 400) fade = i / 400.0f;
    if (i > frames - 400) fade = (frames - i) / 400.0f;
    pair[0] = pair[1] = (int16_t)(BEEP_AMPLITUDE * fade * sinf(2.0f * PI * hz * t));
    i2s.write((uint8_t *)pair, sizeof(pair));
  }
}

void ringColor(uint8_t r, uint8_t g, uint8_t b) {
  for (int i = 0; i < RING_COUNT; i++) ring.setPixelColor(i, ring.Color(r, g, b));
  ring.show();
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println("\nBoard test: Waveshare ESP32-S3 AUDIO Board");

  ring.begin();
  ring.setBrightness(20);          // low on purpose, the demo's blue was too bright
  ringColor(0, 0, 255);

  Wire.begin(I2C_SDA, I2C_SCL);
  Serial.printf("Pin chip (0x20): %s\n", seen(TCA_ADDR) ? "answers" : "NO ANSWER");
  Serial.printf("Speaker chip (0x18): %s\n", seen(ES8311_ADDR) ? "answers" : "NO ANSWER");
  Serial.printf("Microphone chip (0x40): %s\n", seen(ES7210_ADDR) ? "answers" : "NO ANSWER");

  analogReadResolution(12);
  Serial.printf("Battery reading: %.2f V (about 0 if no battery is connected)\n", batteryVolts());

  bool ok = codecStart();
  Serial.printf("Speaker chip start: %s\n", ok ? "ok" : "FAILED");
  Serial.printf("Speaker amplifier on: %s\n", speakerOn(true) ? "ok" : "FAILED");

  i2s.setPins(I2S_BCLK, I2S_LRCK, I2S_DOUT, I2S_DIN, I2S_MCLK);
  if (!i2s.begin(I2S_MODE_STD, SAMPLE_RATE, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO, I2S_STD_SLOT_BOTH)) {
    Serial.println("Sound output: FAILED to start");
  } else {
    Serial.println("Playing a short beep...");
    ringColor(0, 255, 0);
    beep(440, 700);
    ringColor(0, 0, 255);
  }
}

void loop() {
  static uint32_t last = 0, n = 0;
  uint8_t keys = keysPressed();
  if (keys) {
    Serial.printf("Key pressed: %s%s%s\n", (keys & 1) ? "KEY1 " : "", (keys & 2) ? "KEY2 " : "", (keys & 4) ? "KEY3" : "");
    ringColor(255, 120, 0);
    beep((keys & 1) ? 660 : (keys & 2) ? 880 : 520, 150);
    ringColor(0, 0, 255);
    delay(250);
  }

  // slow breathing glow on the ring
  float level = (sinf(millis() / 1000.0f * 2.0f) + 1.0f) / 2.0f;
  ringColor((uint8_t)(10 + 90 * level), 0, (uint8_t)(40 + 160 * level));

  if (millis() - last > 5000) {
    last = millis();
    Serial.printf("Still running (%lu). Battery %.2f V\n", ++n, batteryVolts());
  }
  delay(40);
}
