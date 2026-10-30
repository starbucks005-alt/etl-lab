/* Portable Companion box, first voice test, 2026-10-30. Dr. O: the companion for this box is Tansy.

   Joins Wi-Fi, asks the website for one fixed spoken line (netlify/functions/box-line.js) and plays it on the board's own speaker.
     KEY1 = the greeting, KEY2 = the goodnight line, KEY3 = the greeting again.   The words are in rising-sun/box-lines.json.
   It also asks for the greeting once when it starts.

   Same board, same pins and same Arduino settings as board-test (see rising-sun/board-test/README.md). It needs a secrets.h next to it, copied from secrets.h.example.
   Compiled by Claude against ESP32 Arduino core 3.2.0; NOT run on the board and NOT run against the real website yet.

   TEST ONLY: it does not check the website's certificate (setInsecure), so on a network someone else controls, the access code could be read. That has to be fixed before a box is sold. */
#include <Arduino.h>
#include <Wire.h>
#include <math.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Adafruit_NeoPixel.h>
#include "ESP_I2S.h"
#include "driver/i2c.h"
#include "es8311.h"
#include "secrets.h"

#define I2C_SDA        11
#define I2C_SCL        10
#define I2S_MCLK       12
#define I2S_BCLK       13
#define I2S_LRCK       14
#define I2S_DOUT       16
#define I2S_DIN        15
#define RING_PIN       38
#define RING_COUNT     7

#define TCA_ADDR       0x20
#define ES8311_ADDR    0x18

#define SAMPLE_RATE    16000
#define SPEAKER_VOLUME 55    // 0 to 100. Raise slowly.

const char *LINE_URL = "https://emerging-tech-lab.com/.netlify/functions/box-line";

Adafruit_NeoPixel ring(RING_COUNT, RING_PIN, NEO_GRB + NEO_KHZ800);
I2SClass i2s;
es8311_handle_t codec = NULL;

bool speakerOn(bool on) {
  Wire.beginTransmission(TCA_ADDR); Wire.write(0x07); Wire.write(0xFE);
  if (Wire.endTransmission() != 0) return false;
  Wire.beginTransmission(TCA_ADDR); Wire.write(0x03); Wire.write(on ? 0xFF : 0xFE);
  return Wire.endTransmission() == 0;
}

uint8_t keysPressed() {
  Wire.beginTransmission(TCA_ADDR); Wire.write(0x01);
  if (Wire.endTransmission(false) != 0) return 0;
  if (Wire.requestFrom((uint8_t)TCA_ADDR, (uint8_t)1) != 1) return 0;
  uint8_t v = Wire.read();
  uint8_t out = 0;
  if (!(v & 0x02)) out |= 1;
  if (!(v & 0x04)) out |= 2;
  if (!(v & 0x08)) out |= 4;
  return out;
}

bool codecStart() {
  codec = es8311_create(I2C_NUM_0, ES8311_ADDR);
  if (!codec) return false;
  es8311_clock_config_t clk = {};
  clk.mclk_from_mclk_pin = true;
  clk.mclk_frequency = SAMPLE_RATE * 256;
  clk.sample_frequency = SAMPLE_RATE;
  if (es8311_init(codec, &clk, ES8311_RESOLUTION_16, ES8311_RESOLUTION_16) != ESP_OK) return false;
  es8311_voice_volume_set(codec, SPEAKER_VOLUME, NULL);
  es8311_microphone_config(codec, false);
  return true;
}

void ringColor(uint8_t r, uint8_t g, uint8_t b) {
  for (int i = 0; i < RING_COUNT; i++) ring.setPixelColor(i, ring.Color(r, g, b));
  ring.show();
}

bool joinWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  Serial.printf("Joining Wi-Fi '%s'...\n", WIFI_NAME);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_NAME, WIFI_PASSWORD);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) { delay(500); }
  if (WiFi.status() != WL_CONNECTED) { Serial.println("Wi-Fi: could not join (check the name and password in secrets.h)"); return false; }
  Serial.printf("Wi-Fi: joined, address %s\n", WiFi.localIP().toString().c_str());
  return true;
}

// Asks the website for a line and plays it as it arrives. The sound is 16 bit, mono, 16000 a second, so each sample is written twice (left and right).
bool playLine(const char *companion, const char *line) {
  if (!joinWifi()) return false;
  WiFiClientSecure client;
  client.setInsecure();                       // TEST ONLY, see the note at the top
  HTTPClient http;
  String url = String(LINE_URL) + "?companion=" + companion + "&line=" + line;
  if (!http.begin(client, url)) { Serial.println("Could not start the request"); return false; }
  http.addHeader("x-sun-key", BOX_KEY);
  http.setTimeout(20000);
  Serial.printf("Asking for %s / %s ...\n", companion, line);
  int code = http.GET();
  Serial.printf("Website answered: %d\n", code);
  if (code != 200) {
    if (code == 401) Serial.println("  401: the access code in secrets.h is not the one the website has.");
    if (code == 503) Serial.println("  503: no home access code is set on the website yet.");
    if (code == 404) Serial.println("  404: that line is not in box-lines.json.");
    if (code == 502) Serial.println("  502: the voice service could not make the line.");
    Serial.println(http.getString());
    http.end();
    return false;
  }
  int total = http.getSize();
  Serial.printf("Playing %d bytes (about %.1f seconds)\n", total, total / 32000.0f);
  ringColor(0, 255, 0);
  WiFiClient *stream = http.getStreamPtr();
  uint8_t in[512];
  int16_t out[512];                           // 256 samples become 512 values (left, right)
  uint32_t lastData = millis();
  int leftover = -1;
  while (http.connected() && (total > 0 || total == -1)) {
    size_t avail = stream->available();
    if (!avail) { if (millis() - lastData > 8000) break; delay(2); continue; }
    lastData = millis();
    int n = stream->readBytes(in, min(avail, sizeof(in)));
    if (n <= 0) break;
    if (total > 0) total -= n;
    int k = 0, o = 0;
    if (leftover >= 0 && n > 0) { int16_t s = (int16_t)(leftover | (in[0] << 8)); out[o++] = s; out[o++] = s; k = 1; leftover = -1; }
    for (; k + 1 < n; k += 2) { int16_t s = (int16_t)(in[k] | (in[k + 1] << 8)); out[o++] = s; out[o++] = s; }
    if (k < n) leftover = in[k];
    if (o) i2s.write((uint8_t *)out, o * sizeof(int16_t));
  }
  http.end();
  ringColor(0, 0, 255);
  Serial.println("Done");
  return true;
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println("\nPortable Companion box: voice test (Tansy)");
  ring.begin();
  ring.setBrightness(20);
  ringColor(0, 0, 255);

  Wire.begin(I2C_SDA, I2C_SCL);
  bool c = codecStart();
  bool a = speakerOn(true);
  i2s.setPins(I2S_BCLK, I2S_LRCK, I2S_DOUT, I2S_DIN, I2S_MCLK);
  bool s = i2s.begin(I2S_MODE_STD, SAMPLE_RATE, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO, I2S_STD_SLOT_BOTH);
  Serial.printf("Speaker chip: %s, amplifier: %s, sound output: %s\n", c ? "ok" : "FAILED", a ? "ok" : "FAILED", s ? "ok" : "FAILED");

  if (!playLine("tansy", "greeting")) ringColor(255, 0, 0);
}

void loop() {
  uint8_t keys = keysPressed();
  if (keys) {
    const char *line = (keys & 2) ? "goodnight" : "greeting";
    if (!playLine("tansy", line)) { ringColor(255, 0, 0); delay(1500); ringColor(0, 0, 255); }
    delay(400);
  }
  float level = (sinf(millis() / 1000.0f * 2.0f) + 1.0f) / 2.0f;
  ringColor((uint8_t)(10 + 90 * level), 0, (uint8_t)(40 + 160 * level));
  delay(40);
}
