/* Portable Companion box, push to talk chat with Tansy, 2026-10-30. Dr. O: for the demo I want to be able to chat with her.

   HOLD KEY1 and speak (up to 8 seconds), LET GO, and Tansy answers out loud. KEY2 plays her goodnight line. It uses the website's box-talk.js and box-line.js.
   Ring colors: blue breathing = waiting, orange = it is listening, yellow = it is thinking, green = she is speaking, red = something went wrong (read the Serial Monitor).

   What you say is sent to the website. It goes to ElevenLabs (to turn it into words) and the words go to Anthropic or Amazon (for her reply). Tell anyone who talks to it before they do.
   The website allows 60 turns a day in total, so a demo cannot run up a bill.

   Same board, pins and Arduino settings as board-test (rising-sun/board-test/README.md). It needs a secrets.h next to it, copied from secrets.h.example.
   Compiled by Claude against ESP32 Arduino core 3.2.0; NOT run on the board and NOT run against the real website yet. The microphone part follows Waveshare's sample (ES7210, 16 kHz, two channels).

   TEST ONLY: it does not check the website's certificate (setInsecure), so on a network someone else controls, the access code and what you say could be read. That has to be fixed before a box is sold. */
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
#include "es7210.h"
#include "secrets.h"

#define I2C_SDA        11
#define I2C_SCL        10
#define I2S_MCLK       12
#define I2S_BCLK       13
#define I2S_LRCK       14
#define I2S_DOUT       16   // the board sends sound to the speaker on this pin
#define I2S_DIN        15   // the microphones send sound to the board on this pin
#define RING_PIN       38
#define RING_COUNT     7

#define TCA_ADDR       0x20
#define ES8311_ADDR    0x18
#define ES7210_ADDR    0x40

#define SAMPLE_RATE    16000
#define SPEAKER_VOLUME 70    // 0 to 100, as in box-voice
#define MAX_RECORD_BYTES 256000   // 8 seconds of 16 bit mono at 16000 a second
#define MIN_RECORD_BYTES 16000    // half a second, the website refuses less

const char *TALK_URL = "https://emerging-tech-lab.com/.netlify/functions/box-talk?companion=tansy";
const char *LINE_URL = "https://emerging-tech-lab.com/.netlify/functions/box-line?companion=tansy&line=";

Adafruit_NeoPixel ring(RING_COUNT, RING_PIN, NEO_GRB + NEO_KHZ800);
I2SClass i2s;
es8311_handle_t codec = NULL;
es7210_dev_handle_t micChip = NULL;
uint8_t *recordBuf = NULL;

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

// The microphone chip, set up as in Waveshare's sample (MIC_MSM.cpp): 16 kHz, I2S format, 16 bit, 30 dB gain, TDM on.
bool micStart() {
  es7210_i2c_config_t conf = {};
  conf.i2c_port = I2C_NUM_0;
  conf.i2c_addr = ES7210_ADDR;
  if (es7210_new_codec(&conf, &micChip) != ESP_OK) return false;
  es7210_codec_config_t cc = {};
  cc.sample_rate_hz = SAMPLE_RATE;
  cc.mclk_ratio = 256;
  cc.i2s_format = ES7210_I2S_FMT_I2S;
  cc.bit_width = ES7210_I2S_BITS_16B;
  cc.mic_bias = ES7210_MIC_BIAS_2V87;
  cc.mic_gain = ES7210_MIC_GAIN_30DB;
  cc.flags.tdm_enable = true;
  if (es7210_config_codec(micChip, &cc) != ESP_OK) return false;
  es7210_config_volume(micChip, 0);
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
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(500);
  if (WiFi.status() != WL_CONNECTED) { Serial.println("Wi-Fi: could not join (check the name and password in secrets.h)"); return false; }
  Serial.printf("Wi-Fi: joined, address %s\n", WiFi.localIP().toString().c_str());
  return true;
}

String unpercent(String s) {
  String out;
  for (unsigned i = 0; i < s.length(); i++) {
    if (s[i] == '%' && i + 2 < s.length()) { out += (char)strtol(s.substring(i + 1, i + 3).c_str(), NULL, 16); i += 2; }
    else out += s[i];
  }
  return out;
}

// Plays the sound that comes back as it arrives. It is 16 bit mono at 16000 a second, so each sample is written twice (left and right).
bool playResponse(HTTPClient &http) {
  int total = http.getSize();
  Serial.printf("She says (%d bytes): %s\n", total, unpercent(http.header("X-Said")).c_str());
  ringColor(0, 255, 0);
  WiFiClient *stream = http.getStreamPtr();
  uint8_t in[512];
  int16_t out[512];
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
    if (leftover >= 0) { int16_t s = (int16_t)(leftover | (in[0] << 8)); out[o++] = s; out[o++] = s; k = 1; leftover = -1; }
    for (; k + 1 < n; k += 2) { int16_t s = (int16_t)(in[k] | (in[k + 1] << 8)); out[o++] = s; out[o++] = s; }
    if (k < n) leftover = in[k];
    if (o) i2s.write((uint8_t *)out, o * sizeof(int16_t));
  }
  return true;
}

void explain(int code) {
  if (code == 401) Serial.println("  401: the access code in secrets.h is not the one the website has.");
  if (code == 503) Serial.println("  503: no home access code is set on the website yet.");
  if (code == 404) Serial.println("  404: the website does not know that companion or line.");
  if (code == 400) Serial.println("  400: the recording was too short.");
  if (code == 413) Serial.println("  413: the recording was too long.");
  if (code == 502) Serial.println("  502: a step on the website failed (speech to text, her reply or her voice).");
}

bool playLine(const char *line) {
  if (!joinWifi()) return false;
  WiFiClientSecure client; client.setInsecure();   // TEST ONLY, see the note at the top
  HTTPClient http;
  if (!http.begin(client, String(LINE_URL) + line)) return false;
  http.addHeader("x-sun-key", BOX_KEY);
  const char *keep[] = {"X-Said"}; http.collectHeaders(keep, 1);
  http.setTimeout(20000);
  int code = http.GET();
  Serial.printf("Website answered: %d\n", code);
  if (code != 200) { explain(code); Serial.println(http.getString()); http.end(); return false; }
  playResponse(http);
  http.end();
  return true;
}

// Sends what was recorded, then plays her answer.
bool talk(size_t bytes) {
  if (!joinWifi()) return false;
  ringColor(255, 170, 0);
  WiFiClientSecure client; client.setInsecure();   // TEST ONLY
  HTTPClient http;
  if (!http.begin(client, TALK_URL)) return false;
  http.addHeader("x-sun-key", BOX_KEY);
  http.addHeader("Content-Type", "application/octet-stream");
  const char *keep[] = {"X-Heard", "X-Said"}; http.collectHeaders(keep, 2);
  http.setTimeout(30000);
  Serial.printf("Sending %u bytes (%.1f seconds)...\n", (unsigned)bytes, bytes / 32000.0f);
  int code = http.POST(recordBuf, bytes);
  Serial.printf("Website answered: %d\n", code);
  if (code != 200) { explain(code); Serial.println(http.getString()); http.end(); return false; }
  Serial.printf("She heard: %s\n", unpercent(http.header("X-Heard")).c_str());
  playResponse(http);
  http.end();
  return true;
}

// Records while KEY1 is held. The two microphones come in as left and right, so each pair is averaged to one mono sample.
size_t record() {
  size_t have = 0;
  int16_t frames[512];                 // 256 stereo frames
  ringColor(255, 90, 0);
  uint32_t t0 = millis();
  while (millis() - t0 < 250) i2s.readBytes((char *)frames, sizeof(frames));   // throw away what piled up before the key went down
  while ((keysPressed() & 1) && have + 512 <= MAX_RECORD_BYTES) {
    size_t n = i2s.readBytes((char *)frames, sizeof(frames));
    int pairs = n / 4;
    int16_t *mono = (int16_t *)(recordBuf + have);
    for (int i = 0; i < pairs; i++) mono[i] = (int16_t)(((int)frames[2 * i] + (int)frames[2 * i + 1]) / 2);
    have += pairs * 2;
  }
  return have;
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println("\nPortable Companion box: chat with Tansy (hold KEY1 and speak)");
  ring.begin();
  ring.setBrightness(20);
  ringColor(0, 0, 255);

  recordBuf = (uint8_t *)ps_malloc(MAX_RECORD_BYTES);
  Serial.printf("Recording memory: %s\n", recordBuf ? "ok" : "FAILED (PSRAM must be OPI PSRAM in the Tools menu)");

  Wire.begin(I2C_SDA, I2C_SCL);
  bool c = codecStart();
  bool a = speakerOn(true);
  i2s.setPins(I2S_BCLK, I2S_LRCK, I2S_DOUT, I2S_DIN, I2S_MCLK);
  i2s.setTimeout(1000);
  bool s = i2s.begin(I2S_MODE_STD, SAMPLE_RATE, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO, I2S_STD_SLOT_BOTH);
  bool m = micStart();
  Serial.printf("Speaker chip: %s, amplifier: %s, sound: %s, microphone chip: %s\n", c ? "ok" : "FAILED", a ? "ok" : "FAILED", s ? "ok" : "FAILED", m ? "ok" : "FAILED");
  joinWifi();
}

void loop() {
  uint8_t keys = keysPressed();
  if (keys & 1) {
    Serial.println("Listening...");
    size_t n = record();
    Serial.printf("Recorded %u bytes\n", (unsigned)n);
    if (n < MIN_RECORD_BYTES) { Serial.println("Too short, hold the key while you speak."); ringColor(255, 0, 0); delay(600); }
    else if (!talk(n)) { ringColor(255, 0, 0); delay(1500); }
    ringColor(0, 0, 255);
    delay(300);
  } else if (keys & 2) {
    if (!playLine("goodnight")) { ringColor(255, 0, 0); delay(1500); }
    ringColor(0, 0, 255);
    delay(400);
  }
  float level = (sinf(millis() / 1000.0f * 2.0f) + 1.0f) / 2.0f;
  ringColor((uint8_t)(10 + 90 * level), 0, (uint8_t)(40 + 160 * level));
  delay(40);
}
