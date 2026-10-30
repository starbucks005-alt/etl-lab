/* Portable Companion box with Tansy, 2026-10-30. Dr. O: the three buttons are Gardenscape, Story time and Chat with Tansy.

   CHAT:       SAY THE WAKE WORD "Hi ESP" (a short beep means she is listening), then speak, and Tansy answers out loud. The box finds the end of what you say by itself.
               The button is the backup: HOLD the chat button and speak (up to 8 seconds), LET GO.   (board KEY1, or a lid button on GPIO4)
               "Hi ESP" is the wake word that comes with the Arduino board support. A word of its own, like "Hey Tansy", needs a custom model from Espressif, which this does not have.
   STORY TIME: one tap, and Tansy tells the next fragment of the Human Summer, in turn.                (board KEY2, or a lid button on GPIO5)
   GARDENSCAPE: one tap, and Tansy introduces a nature scene, then it plays on and on (jungle, waterfall, rain, the woods at night, in turn) until a button is pressed or three minutes pass.
               (board KEY3, or a lid button on GPIO6)
   Ring colors: blue breathing = waiting, orange = it is listening, yellow = it is thinking, green = she is speaking or the garden is playing, red = something went wrong (read the Serial Monitor).
   Wiring for lid buttons: each button between its pin and GND. GPIO4 is header pin 8, GPIO5 is pin 6, GPIO6 is pin 4. GND is pin 16 (and pin 15).
   It uses the website's box-talk.js, box-line.js and box-sound.js.

   What you say in a chat is sent to the website. It goes to ElevenLabs (to turn it into words) and the words go to Anthropic or Amazon (for her reply). Tell anyone who talks to it before they do.
   The website allows 60 chat turns a day in total, so a demo cannot run up a bill.

   Same board, pins and Arduino settings as board-test (rising-sun/board-test/README.md), EXCEPT the Partition Scheme, which must be "ESP SR 16M (3MB APP/7MB SPIFFS/2.9MB MODEL)" so the wake word model is loaded. It needs a secrets.h next to it, copied from secrets.h.example.
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
#include "ESP_SR.h"
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

// Buttons on the box lid, for when the board's own three buttons are hidden inside the box (Dr. O, 2026-10-30).
// A push button between the pin and GND. GPIO4 is header pin 8 and GPIO5 is header pin 6, GND is header pin 16.
#define LID_TALK_PIN   4    // chat, hold to talk, the same as KEY1
#define LID_STORY_PIN  5    // story time, the same as KEY2
#define LID_GARDEN_PIN 6    // gardenscape, the same as KEY3

#define SAMPLE_RATE    16000
#define SPEAKER_VOLUME 70    // 0 to 100, as in box-voice
#define MAX_RECORD_BYTES 256000   // 8 seconds of 16 bit mono at 16000 a second
#define MIN_RECORD_BYTES 16000    // half a second, the website refuses less
#define GARDEN_MAX_BYTES 700000   // one nature loop, about 20 seconds
#define GARDEN_MAX_MS    180000   // the garden plays for at most three minutes

// One command is needed to start the speech engine; it is not used (taken from Waveshare's sample). Only the wake word matters here.
static const sr_cmd_t sr_commands[] = {
  {0, "play music", "PLd MYoZgK"},
};
volatile bool wokeUp = false;
void onSrEvent(sr_event_t event, int command_id, int phrase_id) {
  if (event == SR_EVENT_WAKEWORD) wokeUp = true;     // handled in loop(), not here
}

const char *TALK_URL = "https://emerging-tech-lab.com/.netlify/functions/box-talk?companion=tansy";
const char *LINE_URL = "https://emerging-tech-lab.com/.netlify/functions/box-line?companion=tansy&line=";
const char *SOUND_URL = "https://emerging-tech-lab.com/.netlify/functions/box-sound?companion=tansy&name=";

Adafruit_NeoPixel ring(RING_COUNT, RING_PIN, NEO_GRB + NEO_KHZ800);
I2SClass i2s;
es8311_handle_t codec = NULL;
es7210_dev_handle_t micChip = NULL;
uint8_t *recordBuf = NULL;
uint8_t *gardenBuf = NULL;

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
  if (digitalRead(LID_TALK_PIN) == LOW) out |= 1;
  if (digitalRead(LID_STORY_PIN) == LOW) out |= 2;
  if (digitalRead(LID_GARDEN_PIN) == LOW) out |= 4;
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

// Asks for a line and plays it. For the garden, the website names the scene in the X-Scene header (and may have no introduction to say, answering 204).
bool playLine(const char *line, String *scene = NULL) {
  if (!joinWifi()) return false;
  WiFiClientSecure client; client.setInsecure();   // TEST ONLY, see the note at the top
  HTTPClient http;
  if (!http.begin(client, String(LINE_URL) + line)) return false;
  http.addHeader("x-sun-key", BOX_KEY);
  const char *keep[] = {"X-Said", "X-Scene"}; http.collectHeaders(keep, 2);
  http.setTimeout(20000);
  int code = http.GET();
  Serial.printf("Website answered: %d\n", code);
  if (scene) *scene = http.header("X-Scene");
  if (code == 204) { http.end(); return true; }
  if (code != 200) { explain(code); Serial.println(http.getString()); http.end(); return false; }
  playResponse(http);
  http.end();
  return true;
}

// Downloads one nature loop into gardenBuf. Returns how many bytes it got.
size_t fetchGarden(const String &scene) {
  if (!joinWifi() || !gardenBuf) return 0;
  WiFiClientSecure client; client.setInsecure();   // TEST ONLY
  HTTPClient http;
  if (!http.begin(client, String(SOUND_URL) + scene)) return 0;
  http.addHeader("x-sun-key", BOX_KEY);
  http.setTimeout(30000);
  int code = http.GET();
  Serial.printf("Sound '%s': website answered %d\n", scene.c_str(), code);
  if (code != 200) { explain(code); Serial.println(http.getString()); http.end(); return 0; }
  WiFiClient *stream = http.getStreamPtr();
  size_t have = 0;
  int total = http.getSize();
  uint32_t lastData = millis();
  while (http.connected() && (total > 0 || total == -1) && have < GARDEN_MAX_BYTES) {
    size_t avail = stream->available();
    if (!avail) { if (millis() - lastData > 8000) break; delay(2); continue; }
    lastData = millis();
    int n = stream->readBytes(gardenBuf + have, min(avail, (size_t)(GARDEN_MAX_BYTES - have)));
    if (n <= 0) break;
    have += n;
    if (total > 0) total -= n;
  }
  http.end();
  Serial.printf("Got %u bytes (about %.1f seconds)\n", (unsigned)have, have / 32000.0f);
  return have;
}

// Plays the nature loop again and again until a button is pressed (after it was let go first) or three minutes pass.
void playGarden(size_t bytes) {
  ringColor(0, 120, 40);
  while (keysPressed()) delay(20);                 // let the button go before listening for the next press
  int16_t out[512];
  uint32_t start = millis();
  while (millis() - start < GARDEN_MAX_MS) {
    for (size_t pos = 0; pos + 1 < bytes; ) {
      if (keysPressed()) { Serial.println("Garden stopped"); while (keysPressed()) delay(20); return; }
      int o = 0;
      for (; o < 512 && pos + 1 < bytes; o += 2, pos += 2) { int16_t s16 = (int16_t)(gardenBuf[pos] | (gardenBuf[pos + 1] << 8)); out[o] = s16; out[o + 1] = s16; }
      i2s.write((uint8_t *)out, o * sizeof(int16_t));
    }
  }
}

void gardenscape() {
  String scene;
  if (!playLine("garden", &scene)) { ringColor(255, 0, 0); delay(1500); return; }
  if (!scene.length()) { Serial.println("The website named no scene"); return; }
  size_t n = fetchGarden(scene);
  if (n < 32000) { ringColor(255, 0, 0); delay(1500); return; }
  playGarden(n);
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

void beep(int hz, int ms) {
  const int frames = SAMPLE_RATE * ms / 1000;
  int16_t pair[2];
  for (int i = 0; i < frames; i++) {
    float fade = 1.0f;
    if (i < 300) fade = i / 300.0f;
    if (i > frames - 300) fade = (frames - i) / 300.0f;
    pair[0] = pair[1] = (int16_t)(6000 * fade * sinf(2.0f * PI * hz * i / SAMPLE_RATE));
    i2s.write((uint8_t *)pair, sizeof(pair));
  }
}

// Reads some stereo frames and averages the two microphones to mono samples. Returns how many mono samples.
int readMono(int16_t *mono) {
  int16_t frames[512];                 // 256 stereo frames
  size_t n = i2s.readBytes((char *)frames, sizeof(frames));
  int pairs = n / 4;
  for (int i = 0; i < pairs; i++) mono[i] = (int16_t)(((int)frames[2 * i] + (int)frames[2 * i + 1]) / 2);
  return pairs;
}

// Records while the chat button is held (the backup way).
size_t record() {
  size_t have = 0;
  int16_t scratch[256];
  ringColor(255, 90, 0);
  uint32_t t0 = millis();
  while (millis() - t0 < 250) readMono(scratch);                 // throw away what piled up before the key went down
  while ((keysPressed() & 1) && have + 512 <= MAX_RECORD_BYTES) {
    int pairs = readMono((int16_t *)(recordBuf + have));
    have += pairs * 2;
  }
  return have;
}

// Records after the wake word, and stops when you stop talking: it waits for speech to start (up to 4 seconds), then ends after about 1 second of quiet, or at 8 seconds.
size_t recordSpeech() {
  size_t have = 0;
  int16_t scratch[256];
  ringColor(255, 90, 0);
  uint32_t t0 = millis();
  while (millis() - t0 < 200) readMono(scratch);                 // let the beep die away
  // the room's own level, from a quarter of a second
  long sum = 0; int cnt = 0;
  t0 = millis();
  while (millis() - t0 < 250) { int p = readMono(scratch); for (int i = 0; i < p; i++) { sum += abs(scratch[i]); cnt++; } }
  long floorLevel = cnt ? sum / cnt : 100;
  long threshold = floorLevel * 3 + 250;
  bool spoke = false; uint32_t quietSince = 0, started = millis();
  while (have + 512 <= MAX_RECORD_BYTES) {
    int16_t *mono = (int16_t *)(recordBuf + have);
    int pairs = readMono(mono);
    long e = 0; for (int i = 0; i < pairs; i++) e += abs(mono[i]);
    e = pairs ? e / pairs : 0;
    have += pairs * 2;
    if (e > threshold) { spoke = true; quietSince = 0; }
    else if (spoke) { if (!quietSince) quietSince = millis(); else if (millis() - quietSince > 1000) break; }
    else if (millis() - started > 4000) { Serial.println("Nothing was said."); return 0; }
  }
  return have;
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println("\nPortable Companion box with Tansy: chat (hold), story time, gardenscape");
  ring.begin();
  ring.setBrightness(20);
  ringColor(0, 0, 255);

  recordBuf = (uint8_t *)ps_malloc(MAX_RECORD_BYTES);
  gardenBuf = (uint8_t *)ps_malloc(GARDEN_MAX_BYTES);
  Serial.printf("Recording memory: %s, garden memory: %s\n", recordBuf ? "ok" : "FAILED", gardenBuf ? "ok" : "FAILED (PSRAM must be OPI PSRAM in the Tools menu)");

  pinMode(LID_TALK_PIN, INPUT_PULLUP);
  pinMode(LID_STORY_PIN, INPUT_PULLUP);
  pinMode(LID_GARDEN_PIN, INPUT_PULLUP);
  Wire.begin(I2C_SDA, I2C_SCL);
  bool c = codecStart();
  bool a = speakerOn(true);
  i2s.setPins(I2S_BCLK, I2S_LRCK, I2S_DOUT, I2S_DIN, I2S_MCLK);
  i2s.setTimeout(1000);
  bool s = i2s.begin(I2S_MODE_STD, SAMPLE_RATE, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO, I2S_STD_SLOT_BOTH);
  bool m = micStart();
  bool w = ESP_SR.begin(i2s, sr_commands, sizeof(sr_commands) / sizeof(sr_cmd_t), SR_CHANNELS_STEREO, SR_MODE_WAKEWORD);
  ESP_SR.onEvent(onSrEvent);
  Serial.printf("Wake word engine: %s\n", w ? "ok (say Hi ESP)" : "FAILED (the Partition Scheme must be ESP SR 16M)");
  Serial.printf("Speaker chip: %s, amplifier: %s, sound: %s, microphone chip: %s\n", c ? "ok" : "FAILED", a ? "ok" : "FAILED", s ? "ok" : "FAILED", m ? "ok" : "FAILED");
  joinWifi();
}

void chatTurn(bool byButton) {
  Serial.println(byButton ? "Listening (button)..." : "Listening (wake word)...");
  size_t n = byButton ? record() : recordSpeech();
  Serial.printf("Recorded %u bytes\n", (unsigned)n);
  if (n < MIN_RECORD_BYTES) { Serial.println(byButton ? "Too short, hold the key while you speak." : "Too short."); ringColor(255, 0, 0); delay(600); }
  else if (!talk(n)) { ringColor(255, 0, 0); delay(1500); }
  ringColor(0, 0, 255);
}

void loop() {
  uint8_t keys = keysPressed();
  if (wokeUp && !keys) {
    wokeUp = false;
    ESP_SR.pause();                       // the speech engine stops reading the microphones while the box records them itself
    ringColor(255, 90, 0);
    beep(880, 120);
    chatTurn(false);
    wokeUp = false;
    ESP_SR.resume();
    delay(300);
  } else if (keys & 1) {
    ESP_SR.pause();
    chatTurn(true);
    wokeUp = false;
    ESP_SR.resume();
    delay(300);
  } else if (keys & 2) {
    Serial.println("Story time");
    ESP_SR.pause();                       // so her own voice cannot wake the box
    if (!playLine("story")) { ringColor(255, 0, 0); delay(1500); }
    ringColor(0, 0, 255);
    wokeUp = false;
    ESP_SR.resume();
    delay(400);
  } else if (keys & 4) {
    Serial.println("Gardenscape");
    ESP_SR.pause();
    gardenscape();
    ringColor(0, 0, 255);
    wokeUp = false;
    ESP_SR.resume();
    delay(400);
  }
  float level = (sinf(millis() / 1000.0f * 2.0f) + 1.0f) / 2.0f;
  ringColor((uint8_t)(10 + 90 * level), 0, (uint8_t)(40 + 160 * level));
  delay(40);
}
