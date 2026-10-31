/* Portable Companion box, 2026-10-30. Dr. O: the three buttons are Gardenscape, Story time and Chat.
   WHO IS IN THE BOX: every four seconds the box asks the website (box-control) who is in it and whether a button was pushed from the panel (rising-sun/box-panel.html).
   It starts as Tansy until the website answers. Each box has a name (BOX_NAME in secrets.h) so two boxes in one home can be told apart. NOT TRIED on the board yet.

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
#include "ESP_I2S.h"
#include "ESP_SR.h"
#include "esp_partition.h"
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
#define WAKE_WORD 1                      // 1 = listen for "Hi ESP", 0 = buttons only (a test: if her voice plays with 0, the wake word engine is the cause)
String duetState = "";                  // chat mode: a turn number when it is this box's turn, "wait", or empty
uint32_t lastAsk = 0;                    // when the box last asked the website
bool srOn = false;                        // true while the wake word engine is running
bool srCan = false;                       // true when the model is on the board and WAKE_WORD is 1
bool listenWanted = true;                 // the panel's Listening switch
void onSrEvent(sr_event_t event, int command_id, int phrase_id) {
  if (event == SR_EVENT_WAKEWORD) wokeUp = true;     // handled in loop(), not here
}

#ifndef BOX_NAME
#define BOX_NAME "main"                  // this box's name, so two boxes in one home can be told apart (set it in secrets.h)
#endif
String companion = "tansy";               // who is in the box, from the website (the panel picks), Tansy until it answers
String secondKind = "story";              // what the second button does for her: story, starter:<id>, or none
String webBase(const char *fn) { return String("https://emerging-tech-lab.com/.netlify/functions/") + fn + "?companion=" + companion; }

static rmt_data_t ringData[RING_COUNT * 24];   // the ring is written directly, with no lock (the light library timed out on its lock while she was playing her reply)
static bool ringReady = false;
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
  if (!ringReady) {
    ringReady = rmtInit(RING_PIN, RMT_TX_MODE, RMT_MEM_NUM_BLOCKS_1, 10000000);
    if (!ringReady) return;
  }
  r = r * 20 / 255; g = g * 20 / 255; b = b * 20 / 255;   // the ring stays dim, as before
  int n = 0;
  for (int i = 0; i < RING_COUNT; i++) {
    uint8_t px[3] = {g, r, b};                       // the ring wants green, red, blue
    for (int k = 0; k < 3; k++) for (int bit = 7; bit >= 0; bit--) {
      bool one = px[k] & (1 << bit);
      ringData[n].level0 = 1; ringData[n].duration0 = one ? 8 : 4;
      ringData[n].level1 = 0; ringData[n].duration1 = one ? 4 : 8;
      n++;
    }
  }
  rmtWrite(RING_PIN, ringData, n, 100);              // gives up after a tenth of a second instead of waiting forever
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
  uint32_t played = 0;
  Serial.println("Starting to play her voice...");
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
    if (o) { i2s.write((uint8_t *)out, o * sizeof(int16_t)); played += o / 2; if (played == o / 2) Serial.println("First piece of her voice written to the speaker."); }
  }
  Serial.printf("Played %u samples (%.1f seconds of her voice)\n", (unsigned)played, played / 16000.0f);
  return played > 0;
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
  http.useHTTP10(true);
  if (!http.begin(client, webBase("box-line") + "&line=" + line)) return false;
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
  http.useHTTP10(true);
  if (!http.begin(client, webBase("box-sound") + "&name=" + scene)) return 0;
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
  http.useHTTP10(true);                    // no chunked reply, so the stream is only audio
  if (!http.begin(client, webBase("box-talk"))) return false;
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
  long threshold = floorLevel * 2 + 120;
  long peak = 0;
  Serial.printf("Room level %ld, speech must pass %ld. Speak now.\n", floorLevel, threshold);
  bool spoke = false; uint32_t quietSince = 0, started = millis();
  while (have + 512 <= MAX_RECORD_BYTES) {
    int16_t *mono = (int16_t *)(recordBuf + have);
    int pairs = readMono(mono);
    long e = 0; for (int i = 0; i < pairs; i++) e += abs(mono[i]);
    e = pairs ? e / pairs : 0;
    have += pairs * 2;
    if (e > peak) peak = e;
    if (e > threshold) { spoke = true; quietSince = 0; }
    else if (spoke) { if (!quietSince) quietSince = millis(); else if (millis() - quietSince > 1000) break; }
    else if (millis() - started > 6000) { Serial.printf("Nothing was said. Loudest moment was %ld, it needed to pass %ld.\n", peak, threshold); return 0; }
  }
  return have;
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println("\nPortable Companion box: chat, story time, gardenscape (who is in the box comes from the panel)");
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
  // The engine crashes the board if its model is not in flash, so look for the model first.
  const esp_partition_t *model = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_ANY, "model");
  bool w = false;
  if (model && WAKE_WORD) {
    w = ESP_SR.begin(i2s, sr_commands, sizeof(sr_commands) / sizeof(sr_cmd_t), SR_CHANNELS_STEREO, SR_MODE_WAKEWORD);
    if (w) ESP_SR.onEvent(onSrEvent);
  }
  srOn = w; srCan = w;
  Serial.printf("Version: WAKE_WORD %d, stop and restart around each turn, markers around her voice\n", WAKE_WORD);
  Serial.printf("Wake word engine: %s\n", w ? "ok (say Hi ESP)" : (!WAKE_WORD ? "OFF (WAKE_WORD is 0)" : model ? "FAILED" : "NOT STARTED, no model on the board. Set Partition Scheme to ESP SR 16M and upload again. The three buttons still work."));
  Serial.printf("Speaker chip: %s, amplifier: %s, sound: %s, microphone chip: %s\n", c ? "ok" : "FAILED", a ? "ok" : "FAILED", s ? "ok" : "FAILED", m ? "ok" : "FAILED");
  joinWifi();
}

// The library's pause stops the engine only after its current read, and the engine sets the sound timeout to "forever".
// The box crashed while playing her voice with it paused, so it is stopped and started again around each turn. The cause is not confirmed.
void srPause() {
  if (!srOn) return;
  ESP_SR.end();                           // stopped completely, not just paused, so it cannot share the sound connection
  srOn = false;
  wokeUp = false;
  i2s.setTimeout(1000);
}
void srResume() {
  if (!srCan || !listenWanted || srOn || duetState.length()) return;
  if (ESP_SR.begin(i2s, sr_commands, sizeof(sr_commands) / sizeof(sr_cmd_t), SR_CHANNELS_STEREO, SR_MODE_WAKEWORD)) { ESP_SR.onEvent(onSrEvent); srOn = true; }
  else { srCan = false; Serial.println("Wake word engine did not restart. The buttons still work."); }
}

// A fixed opening line she answers in her own voice, made once on the website and kept (Meera's Breathing).
bool playStarter(const String &id) {
  if (!joinWifi()) return false;
  ringColor(255, 170, 0);
  WiFiClientSecure client; client.setInsecure();   // TEST ONLY
  HTTPClient http;
  http.useHTTP10(true);
  if (!http.begin(client, webBase("box-talk") + "&starter=" + id)) return false;
  http.addHeader("x-sun-key", BOX_KEY);
  http.addHeader("Content-Type", "application/octet-stream");
  const char *keep[] = {"X-Said"}; http.collectHeaders(keep, 1);
  http.setTimeout(60000);
  int code = http.POST((uint8_t *)"", 0);
  Serial.printf("Website answered: %d\n", code);
  if (code != 200) { explain(code); Serial.println(http.getString()); http.end(); return false; }
  playResponse(http);
  http.end();
  return true;
}

// The second button: the next story, or her own session, or nothing for a companion that has none.
void secondButton() {
  Serial.printf("Second button (%s): %s\n", companion.c_str(), secondKind.c_str());
  bool ok = false;
  if (secondKind == "story") ok = playLine("story");
  else if (secondKind.startsWith("starter:")) ok = playStarter(secondKind.substring(8));
  if (!ok) { ringColor(255, 0, 0); delay(1500); }
  ringColor(0, 0, 255);
}

// Asks the website who is in the box and whether a button was pushed from the panel. Returns the pushed button, or "".
#define BATTERY_ADC 8
// The battery voltage in millivolts, read the way Waveshare's own sample does (the board's board-test sketch used the same). 0 if it reads nothing sensible.
int batteryMillivolts() {
  long sum = 0;
  for (int i = 0; i < 8; i++) { sum += analogReadMilliVolts(BATTERY_ADC); delay(2); }
  float mv = (sum / 8.0f) * 3.0f / 0.990476f;
  return (mv > 2500 && mv < 4500) ? (int)mv : 0;
}

// Chat mode: this box's companion speaks her line, then says done so the other box gets its turn.
void playDuetTurn(const String &turn) {
  if (!joinWifi()) return;
  WiFiClientSecure client; client.setInsecure();   // TEST ONLY
  HTTPClient http;
  http.useHTTP10(true);
  if (!http.begin(client, String("https://emerging-tech-lab.com/.netlify/functions/box-duet?id=") + BOX_NAME + "&turn=" + turn)) return;
  http.addHeader("x-sun-key", BOX_KEY);
  const char *keep[] = {"X-Said"}; http.collectHeaders(keep, 1);
  http.setTimeout(40000);
  int code = http.GET();
  Serial.printf("Chat mode turn %s: website answered %d\n", turn.c_str(), code);
  if (code == 200) {
    playResponse(http);
    http.end();
    WiFiClientSecure c2; c2.setInsecure();
    HTTPClient done; done.useHTTP10(true);
    if (done.begin(c2, "https://emerging-tech-lab.com/.netlify/functions/box-duet")) {
      done.addHeader("x-sun-key", BOX_KEY);
      done.addHeader("Content-Type", "application/json");
      done.POST(String("{\"action\":\"done\",\"id\":\"") + BOX_NAME + "\",\"turn\":" + turn + "}");
      done.end();
    }
  } else { http.end(); if (code != 204) { ringColor(255, 0, 0); delay(1000); } }
  ringColor(0, 0, 255);
}

String askWebsite() {
  if (WiFi.status() != WL_CONNECTED) return "";
  WiFiClientSecure client; client.setInsecure();   // TEST ONLY
  HTTPClient http;
  http.useHTTP10(true);
  if (!http.begin(client, String("https://emerging-tech-lab.com/.netlify/functions/box-control?box=1&id=") + BOX_NAME + "&batt=" + batteryMillivolts())) return "";
  http.addHeader("x-sun-key", BOX_KEY);
  http.setTimeout(8000);
  int code = http.GET();
  if (code != 200) { http.end(); return ""; }
  String body = http.getString();
  http.end();
  String command = "";
  int pos = 0;
  while (pos < (int)body.length()) {
    int nl = body.indexOf('\n', pos); if (nl < 0) nl = body.length();
    String line = body.substring(pos, nl); line.trim(); pos = nl + 1;
    if (line.startsWith("companion=")) {
      String c = line.substring(10);
      if (c.length() && c != companion) { companion = c; Serial.printf("Companion is now %s\n", companion.c_str()); ringColor(0, 255, 0); delay(400); }
    } else if (line.startsWith("second=")) secondKind = line.substring(7);
    else if (line.startsWith("command=")) command = line.substring(8);
    else if (line.startsWith("duet=")) duetState = line.substring(5);
    else if (line.startsWith("listen=")) { bool on = line.substring(7) != "off"; if (on != listenWanted) { listenWanted = on; Serial.println(on ? "Listening for the wake word" : "Not listening for the wake word"); } }
  }
  return command;
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
    srPause();                       // the speech engine stops reading the microphones while the box records them itself
    ringColor(255, 90, 0);
    beep(880, 120);
    chatTurn(false);
    wokeUp = false;
    srResume();
    delay(300);
  } else if (keys & 1) {
    srPause();
    chatTurn(true);
    wokeUp = false;
    srResume();
    delay(300);
  } else if (keys & 2) {
    srPause();                            // so her own voice cannot wake the box
    secondButton();
    wokeUp = false;
    srResume();
    delay(400);
  } else if (keys & 4) {
    Serial.println("Gardenscape");
    srPause();
    gardenscape();
    ringColor(0, 0, 255);
    wokeUp = false;
    srResume();
    delay(400);
  } else if (millis() - lastAsk > (duetState.length() ? 1500UL : 4000UL)) {
    lastAsk = millis();
    String cmd = askWebsite();
    if (!listenWanted && srOn) srPause();          // the panel turned listening off
    if (listenWanted && !srOn && !duetState.length()) srResume();   // and back on, but not during chat mode
    if (duetState.length() && srOn) srPause();     // the other box's voice must not wake this one
    if (duetState.length() && duetState != "wait") {
      Serial.printf("Chat mode: my turn, %s\n", duetState.c_str());
      playDuetTurn(duetState);
      lastAsk = millis() - 1200;                   // ask again soon, the other box is next
      return;
    }
    if (cmd.length()) {
      Serial.printf("Pushed from the panel: %s\n", cmd.c_str());
      srPause();
      if (cmd == "chat") chatTurn(false);
      else if (cmd == "second") secondButton();
      else if (cmd == "soundscape") { gardenscape(); ringColor(0, 0, 255); }
      wokeUp = false;
      srResume();
      delay(400);
    }
  }
  float level = (sinf(millis() / 1000.0f * 2.0f) + 1.0f) / 2.0f;
  if (listenWanted || !srCan) ringColor((uint8_t)(10 + 90 * level), 0, (uint8_t)(40 + 160 * level));
  else ringColor((uint8_t)(60 + 120 * level), (uint8_t)(20 + 50 * level), 0);   // amber: not listening
  delay(40);
}
