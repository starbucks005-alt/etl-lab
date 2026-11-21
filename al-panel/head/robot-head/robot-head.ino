/* Robot head on the round Waveshare ESP32-S3 audio board, 2026-11-19. Dr. O: Astri's head carries the round board, a speaker and cabochon eyes, and the thinking is on the website.
   No eye stack, no servo board, no Pi, no amp, no 5V supply: one USB cable into the board.

   WHAT IT DOES: it listens all the time. When somebody speaks, it records until they stop, sends it to the website (head-talk), and plays her answer in her own voice.
   No wake word and no name needed: she answers whoever talks to her. While she speaks she does not listen, so she cannot answer herself.
   KEY1 (hold) is the backup: hold it, speak, let go.
   KEY2 (tap) is her quiet switch: she stops listening and her eyes go dim. Tap again and she listens again.
   KEY3 is her volume (2026-11-21, Dr. O: "K3 to volume up and down in increments"): TAP for one step louder, HOLD for one step quieter
   (and another step every second it is held). Seven steps; the board's ring lights one light per step for a moment, and the Serial Monitor
   prints "Volume: 5 of 7". The board remembers it when switched off. It works between turns, not while she is talking.
   What she heard and what she said are printed in the Serial Monitor as "Heard:" and "Said:" lines, so they can be read, not only heard.

   HER HEAD TURN (2026-11-20, Dr. O: "what do we need to operate the servo so their heads still turn?"): the round board runs the MG996R itself, no servo board.
   While she talks, the head turns slowly to five spots across the room, holds each as if talking to those people, never the same spot twice in a row,
   wide turns more likely than small ones, then eases back to the middle and lets go. The same as al_neck.py's sway on the Pi.
   Wiring: servo ORANGE (signal) to header pin 6 (GPIO5). Servo BROWN to the servo's own power minus AND to the board's GND (header pin 15 or 16): the grounds
   must be joined. Servo RED to the servo's own 5V plus. Never power the servo from the board: a servo starting to move can restart the board.
   No soldering (Dr. O's rule): jumper wires onto the header pins and into the servo's plug, a USB to screw terminal adapter for its power, a WAGO for the grounds.

   THE TABLET GAME (2026-11-20 night, Dr. O's design): an SD card in each twin's board holds that twin's game lines in their own voice, fetched once
   from the website. Each board answers the tablet on the Wi-Fi at port 8000, as the Pis did: /api/robot (who it is), /api/game/line (say a line from
   the card, answer when said), and Astri's board serves the game page itself at http://<her address>:8000/ and tells the tablet where Astro is
   (/api/peer, from the address each board reports to the website). For a minute after a game line she does not listen to the room.

   THE FIRESIDE CHAT: she asks the website every 20 seconds whether a chat is on (every second while one is). While it is on she does not listen to the room:
   the director hands her the others' words as text, and when it is her turn the website sends her answer and she plays it. Nobody has to hear anybody.
   The host's Stop cuts a Pi off mid sentence; the head finishes its two or three sentences first.

   HER EYES: a piece cut from the BTF WS2812B 5V strip, with its factory plug. Light EYE_A and light EYE_B are the eyes; the lights between them stay dark.
   Wiring, from the strip's plug: green (data) to header pin 2 (GPIO7), red (5V) to header pin 18, white (ground) to header pin 16.
   The eye colors are at the top, under "Dr. O's choices", one color for each thing she is doing.

   WHO SHE IS: ROBOT_ID in secrets.h (astri). Her words and her voice are on the website, from the same files her Pi uses.
   Same board, pins and Arduino settings as rising-sun/board-test (ESP32S3 Dev Module, USB CDC On Boot Enabled, Flash Size 16MB, PSRAM OPI PSRAM, core 3.2.0).
   The Partition Scheme can stay the default: this program has no wake word model.
   Needs secrets.h next to it, copied from secrets.h.example. secrets.h is never put on GitHub.

   WHAT SHE HEARS GOES OUT: the sound goes to ElevenLabs (words), the words to Anthropic or Amazon (her answer), her answer to Azure (her voice).
   TEST ONLY: it does not check the website's certificate (setInsecure). That has to be fixed before a head is sold.
   RUN ON THE BOARD by Dr. O, 2026-11-20: compiled in her Arduino IDE (core 3.2.0), loaded, and Astri talked. The eyes, the speaker lead and the fireside chat are still to be tried. */
#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include "ESP_I2S.h"
#include "driver/i2c.h"
#include "es8311.h"
#include "es7210.h"
#include "soc/gpio_reg.h"
#include "soc/soc.h"
#include "esp_cpu.h"
#include "driver/rmt_tx.h"
#include <WebServer.h>
#include <ESPmDNS.h>
#include "FS.h"
#include "SD_MMC.h"
#include "secrets.h"
#include <Preferences.h>

// ---------------- Dr. O's choices ----------------
// Eye colors, red, green, blue, each 0 to 255. Astri's are all pink, chosen by Dr. O, 2026-11-20. Keep green and blue low: pale pinks such as
// 255,182,193 look bluish white on these lights. These deep pinks show pink on her ring (with the ring sent red first, build 2026-11-20o).
const uint8_t EYE_IDLE[3]   = {255, 10, 60};   // waiting, breathing slowly
const uint8_t EYE_LISTEN[3] = {255, 30, 90};     // she hears someone and is recording
const uint8_t EYE_THINK[3]  = {255, 10, 60};     // waiting for the website
const uint8_t EYE_SPEAK[3]  = {255, 0, 40};     // she is talking
const uint8_t EYE_QUIET[3]  = {255, 10, 60};       // KEY2: not listening
const uint8_t EYE_TROUBLE[3]= {255, 10, 60};       // something went wrong (read the Serial Monitor)
#define RING_BRIGHTNESS 100 // the board's own ring of 7 lights, as a percent of the eyes. 100 = as bright as the eyes, for when the ring lights her eyes.
#define EYE_BRIGHTNESS 255   // 0 to 255, the brightest the eyes ever get. Kept low: two lights behind a diffuser need little, and stay cool.
#define STRIP_COUNT 4        // how many lights are on the cut piece
#define EYE_A 0              // the first eye, counting from the plug end, starting at 0
#define EYE_B 3              // the second eye. A 4-light piece puts the eyes about 5 cm apart; a 5-light piece (EYE_B 4) about 6.7 cm.
#define SPEAKER_VOLUME 85
#define MIC_GAIN_DB  36     // how much the microphones are turned up: 30, 33, 34, 36 or 37 (34 means 34.5 and 37 means 37.5). Higher hears quieter voices,
                            // and the room's noise too. Raise one step at a time and compare the "Room level" and "Your voice" numbers in the Serial Monitor.
#define SPEECH_TIMES 3      // a voice counts when it is this many times the room's level...
#define SPEECH_OVER  40     // ...plus this much. 2026-11-20 evening, Astri's board on the bench with music playing: the room read 16 and Dr. O's voice reached 118, under the old 2x + 150 = 182.
#define NECK_ON      1      // 1 = her head turns while she talks, 0 = no servo on this head
#define NECK_MIDDLE  90     // the servo angle that faces straight ahead. If her head looks off to one side at rest, change this a few degrees at a time.
#define NECK_SWAY    49     // how far she turns to the far left and far right while talking, in degrees (4 to 55). Astri: 49, Dr. O, 2026-11-20 (14 was "not much")
#define NECK_BEATS   1      // 1 = her head moves with her words: a small quick turn on each stressed beat of her voice (Dr. O, 2026-11-20: "like it is part of her talking")
#define NECK_BEAT_DEG 10    // how big those small turns are, in degrees
#define NECK_SPEED_MS 10  // milliseconds per degree: lower is faster, not under 5 (the MG996R strains). Dr. O, 2026-11-20: 40 "too slow", then "faster" again.
// --------------------------------------------------

#define I2C_SDA        11
#define I2C_SCL        10
#define I2S_MCLK       12
#define I2S_BCLK       13
#define I2S_LRCK       14
#define I2S_DOUT       16   // to the speaker
#define I2S_DIN        15   // from the microphones
#define RING_PIN       38   // the board's own ring of 7 lights, hidden in the head; it copies the eyes, dimly, for the bench
#define RING_COUNT     7
#define EYE_PIN        7    // header pin 2
#define NECK_PIN       5    // header pin 6
#define NECK_LIMIT     60   // the most the head may ever turn from the middle, as on the Pi
#define TCA_ADDR       0x20
#define ES8311_ADDR    0x18
#define ES7210_ADDR    0x40

#define SAMPLE_RATE      16000
#define MAX_RECORD_BYTES 256000   // 8 seconds
#define MIN_SPEECH_MS    250      // shorter than this is a cough or a bump, not words, and nothing is sent
#define END_QUIET_MS     900      // she waits this long after the last word before answering
#define PREROLL_SAMPLES  4800     // 0.3 seconds kept from before the speech started, so the first word is not cut

#ifndef ROBOT_ID
#define ROBOT_ID "astri"
#endif

I2SClass i2s;
es8311_handle_t codec = NULL;
es7210_dev_handle_t micChip = NULL;
uint8_t *recordBuf = NULL;
static uint8_t eyeBytes[STRIP_COUNT * 3];
static uint8_t ringBytes[RING_COUNT * 3];
static bool eyeReady = false, ringReady = false, lightsTried = false;
bool quietMode = false;
// KEY3 volume steps, quietest to loudest. Step 5 (85) is SPEAKER_VOLUME, where she started.
const uint8_t VOLUME_STEPS[7] = {45, 55, 65, 75, 85, 93, 100};
int volumeStep = 4;
Preferences volumeMemory;
bool firesideOn = false;
uint32_t gameUntil = 0;           // the tablet game: until then, she plays game lines and does not listen to the room
bool cardOk = false;
WebServer web(8000);          // a fireside chat is on: she waits for her turn and does not listen to the room
uint32_t nextAsk = 0;             // when to ask the director again
long roomFloor = 200;             // the room's own level, learned while nobody is talking

// ---- lights ----
// 2026-11-20 (Friday morning): the board package's light driver, version 3.2.0, refuses to start on this board with "rmt_new_tx_channel(269): not able
// to power down in light sleep". Others reported the same message on ESP32-S3 boards after 3.2.0 (arduino-esp32 issues 11223 and 11225); the one reported
// workaround turns off USB CDC On Boot, which the Serial Monitor lines need. So the lights are sent their signal directly, by timing the pin from the
// processor's own clock, with no light driver at all. The signal is the WS2812 one: each bit 1.25 microseconds, high 0.35 for a 0 and 0.8 for a 1.
// Interrupts are paused for the few hundred microseconds it takes, so the timing holds; the sound keeps playing, because it is fed by the chip on its own.
// 2026-11-20: IRAM_ATTR keeps this in the chip's own fast memory. Dr. O set every color to pink and the board showed pink, then blue; one possible cause, not
// confirmed, is a pause while reading the program from flash stretching the timing. Running from fast memory removes that pause.
static void IRAM_ATTR wsSend(uint8_t pin, const uint8_t *grb, int count) {
  uint32_t setReg = pin < 32 ? GPIO_OUT_W1TS_REG : GPIO_OUT1_W1TS_REG;
  uint32_t clrReg = pin < 32 ? GPIO_OUT_W1TC_REG : GPIO_OUT1_W1TC_REG;
  uint32_t mask = 1UL << (pin < 32 ? pin : pin - 32);
  uint32_t mhz = ESP.getCpuFreqMHz();
  uint32_t t0h = mhz * 35 / 100, t1h = mhz * 80 / 100, period = mhz * 125 / 100;   // in processor clock ticks
  portDISABLE_INTERRUPTS();
  uint32_t start = esp_cpu_get_cycle_count();
  for (int i = 0; i < count; i++) {
    uint8_t v = grb[i];
    for (int bit = 7; bit >= 0; bit--) {
      while (esp_cpu_get_cycle_count() - start < period) {}
      start = esp_cpu_get_cycle_count();
      REG_WRITE(setReg, mask);
      uint32_t high = (v & (1 << bit)) ? t1h : t0h;
      while (esp_cpu_get_cycle_count() - start < high) {}
      REG_WRITE(clrReg, mask);
    }
  }
  portENABLE_INTERRUPTS();
  delayMicroseconds(80);                          // a pause this long tells the lights the colors are complete
}

// 2026-11-20, build 2026-11-20l: with Wi-Fi running, the signal timed by the program came out wrong (Dr. O: pink at start, then blue). So the chip's own
// light-signal part (RMT) is set up here directly, every setting written, which the package's setup in 3.2.0 does not do. Its timing is the chip's own,
// so Wi-Fi cannot disturb it. If setting it up fails, the program falls back to timing the signal itself (wsSend above).
static rmt_channel_handle_t rmtCh[2] = {NULL, NULL};
static rmt_encoder_handle_t rmtEnc[2] = {NULL, NULL};

static bool rmtOpen(int k, uint8_t pin) {
  rmt_tx_channel_config_t cfg = {};
  cfg.gpio_num = (gpio_num_t)pin;
  cfg.clk_src = RMT_CLK_SRC_DEFAULT;
  cfg.resolution_hz = 10000000;                   // 0.1 microsecond a tick
  cfg.mem_block_symbols = 48;
  cfg.trans_queue_depth = 4;
  if (rmt_new_tx_channel(&cfg, &rmtCh[k]) != ESP_OK) { rmtCh[k] = NULL; return false; }
  rmt_bytes_encoder_config_t bc = {};
  bc.bit0.duration0 = 4; bc.bit0.level0 = 1; bc.bit0.duration1 = 8; bc.bit0.level1 = 0;   // a 0: high 0.4, low 0.8 microseconds
  bc.bit1.duration0 = 8; bc.bit1.level0 = 1; bc.bit1.duration1 = 4; bc.bit1.level1 = 0;   // a 1: high 0.8, low 0.4 microseconds
  bc.flags.msb_first = 1;
  if (rmt_new_bytes_encoder(&bc, &rmtEnc[k]) != ESP_OK) { rmt_del_channel(rmtCh[k]); rmtCh[k] = NULL; return false; }
  if (rmt_enable(rmtCh[k]) != ESP_OK) { rmt_del_encoder(rmtEnc[k]); rmt_del_channel(rmtCh[k]); rmtCh[k] = NULL; rmtEnc[k] = NULL; return false; }
  return true;
}

static void lightSend(int k, uint8_t pin, const uint8_t *grb, int count) {
  if (rmtCh[k]) {
    rmt_transmit_config_t tc = {};
    if (rmt_transmit(rmtCh[k], rmtEnc[k], grb, count, &tc) == ESP_OK) { rmt_tx_wait_all_done(rmtCh[k], 50); delayMicroseconds(80); return; }
  }
  wsSend(pin, grb, count);
}

void lightsStart() {
  lightsTried = true;
  bool a = rmtOpen(0, EYE_PIN), b = rmtOpen(1, RING_PIN);
  if (!a) { pinMode(EYE_PIN, OUTPUT); digitalWrite(EYE_PIN, LOW); }
  if (!b) { pinMode(RING_PIN, OUTPUT); digitalWrite(RING_PIN, LOW); }
  eyeReady = ringReady = true;
  Serial.printf("Lights: eyes %s, board ring %s\n", a ? "on the chip's light part" : "sent directly", b ? "on the chip's light part" : "sent directly");
}

static void putColor(uint8_t *d, int i, uint8_t r, uint8_t g, uint8_t b) { d[i * 3] = g; d[i * 3 + 1] = r; d[i * 3 + 2] = b; }   // the eye strip (WS2812B) wants green, red, blue
// 2026-11-20, Dr. O's test: the board's own ring reads the first number as RED. Her colors showed pink on the ring only when she swapped the first two
// numbers by hand ({10, 255, 60} sent as green, red, blue arrives as 255, 10, 60), so the ring is sent red, green, blue and the color lines read normally.
static void putColorRing(uint8_t *d, int i, uint8_t r, uint8_t g, uint8_t b) { d[i * 3] = r; d[i * 3 + 1] = g; d[i * 3 + 2] = b; }

// level is 0.0 to 1.0, for breathing and fades
void eyes(const uint8_t c[3], float level = 1.0f) {
  uint8_t r = (uint8_t)(c[0] * EYE_BRIGHTNESS / 255 * level), g = (uint8_t)(c[1] * EYE_BRIGHTNESS / 255 * level), b = (uint8_t)(c[2] * EYE_BRIGHTNESS / 255 * level);
  if (!lightsTried) lightsStart();
  for (int i = 0; i < STRIP_COUNT; i++) { bool lit = (i == EYE_A || i == EYE_B); putColor(eyeBytes, i, lit ? r : 0, lit ? g : 0, lit ? b : 0); }
  lightSend(0, EYE_PIN, eyeBytes, sizeof(eyeBytes));
  for (int i = 0; i < RING_COUNT; i++) putColorRing(ringBytes, i, r * RING_BRIGHTNESS / 100, g * RING_BRIGHTNESS / 100, b * RING_BRIGHTNESS / 100);
  lightSend(1, RING_PIN, ringBytes, sizeof(ringBytes));
}

// ---- her head turn ----
// The servo is told where to be 50 times a second. The pulse runs from 750 to 2250 microseconds for 0 to 180 degrees, as the Pi's servo board did.
bool neckReady = false, neckTalking = false, neckLoose = true;
int neckHere = NECK_MIDDLE, neckTarget = NECK_MIDDLE, neckSpot = 2, neckBase = NECK_MIDDLE;   // neckBase: the part of the room she is looking at
bool neckBeating = false, beatSide = false;
uint32_t lastBeat = 0;
uint32_t neckNextStep = 0, neckHoldUntil = 0, neckStillSince = 0;
const float NECK_SPOTS[5] = {-1.0f, -0.5f, 0.0f, 0.5f, 1.0f};

void neckWrite(int angle) {
  if (!neckReady) return;
  angle = max(max(0, NECK_MIDDLE - NECK_LIMIT), min(min(180, NECK_MIDDLE + NECK_LIMIT), angle));
  uint32_t us = 750 + (uint32_t)angle * 1500 / 180;
  ledcWrite(NECK_PIN, us * 16384 / 20000);
  neckLoose = false;
}

void neckLetGo() { if (neckReady) ledcWrite(NECK_PIN, 0); neckLoose = true; }   // no pulses: the servo rests and does not buzz

void neckStart() {
  if (!NECK_ON) return;
  neckReady = ledcAttach(NECK_PIN, 50, 14);
  Serial.printf("Head turn: %s (servo signal on header pin 6)\n", neckReady ? "ok" : "FAILED");
  neckWrite(NECK_MIDDLE);
  delay(600);
  neckLetGo();
}

void neckTalk(bool on) {
  neckTalking = on;
  neckBeating = false;
  neckHoldUntil = on ? 1 : 0;        // 1 = already due: she turns the moment she starts talking, with no wait at the middle first
  if (!on) neckTarget = NECK_MIDDLE;
  else { neckBase = neckHere; if (neckLoose) neckWrite(neckHere); }
}

int neckClamp(int a) { return max(max(0, NECK_MIDDLE - NECK_LIMIT), min(min(180, NECK_MIDDLE + NECK_LIMIT), a)); }

// A stressed beat in her voice: a small quick turn away from where she is looking, then back, alternating sides, never closer than 0.28 s apart.
void neckBeat() {
  if (!NECK_BEATS || !neckReady || !neckTalking || neckBeating || millis() - lastBeat < 280) return;
  beatSide = !beatSide;
  neckTarget = neckClamp(neckBase + (int)random(NECK_BEAT_DEG / 2, NECK_BEAT_DEG + 1) * (beatSide ? 1 : -1));
  neckBeating = true;
  lastBeat = millis();
  neckNextStep = 0;
}

// Called often. Moves one degree at a time toward where she is looking, picks the next spot while she talks, and goes back to the middle when she stops.
void neckUpdate() {
  if (!neckReady) return;
  uint32_t now = millis();
  if (now < neckNextStep) return;
  if (neckHere != neckTarget) {
    neckHere += (neckTarget > neckHere) ? 1 : -1;
    neckWrite(neckHere);
    neckNextStep = now + NECK_SPEED_MS;
    neckStillSince = now;
    return;
  }
  if (neckTalking) {
    if (neckBeating) { neckBeating = false; neckTarget = neckBase; return; }    // the beat is done: back to where she was looking
    if (!neckHoldUntil) { neckHoldUntil = now + random(700, 1800); return; }    // long enough to look at that part of the room (shorter since 2026-11-20: her answers are short)
    if (now < neckHoldUntil) return;
    int weights[5], total = 0;
    for (int i = 0; i < 5; i++) { weights[i] = (i == neckSpot) ? 0 : 1 + abs(i - neckSpot); total += weights[i]; }
    int r = random(total);
    for (int i = 0; i < 5; i++) { if (r < weights[i]) { neckSpot = i; break; } r -= weights[i]; }
    int reach = max(4, min(55, min(NECK_LIMIT, NECK_SWAY)));
    neckBase = neckClamp(NECK_MIDDLE + (int)lroundf(NECK_SPOTS[neckSpot] * reach));
    neckTarget = neckBase;
    neckHoldUntil = 0;
  } else if (!neckLoose && now - neckStillSince > 300) {
    neckLetGo();
    neckSpot = 2;
  }
}

// ---- the board's sound chips, as in rising-sun/box-chat ----
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

void volumeSet(int step) {
  volumeStep = max(0, min(6, step));
  if (codec) es8311_voice_volume_set(codec, VOLUME_STEPS[volumeStep], NULL);
  volumeMemory.putUChar("vol", (uint8_t)volumeStep);
  Serial.printf("Volume: %d of 7 (%d)\n", volumeStep + 1, VOLUME_STEPS[volumeStep]);
  for (int i = 0; i < RING_COUNT; i++) putColorRing(ringBytes, i, i <= volumeStep ? 255 : 0, i <= volumeStep ? 255 : 0, i <= volumeStep ? 255 : 0);
  lightSend(1, RING_PIN, ringBytes, sizeof(ringBytes));
  delay(600);
}

// KEY3: tap for louder, hold for quieter.
void volumeKey() {
  uint32_t down = millis();
  while ((keysPressed() & 4) && millis() - down < 700) delay(20);
  if (!(keysPressed() & 4)) { volumeSet(volumeStep + 1); return; }
  while (keysPressed() & 4) { volumeSet(volumeStep - 1); uint32_t t = millis(); while ((keysPressed() & 4) && millis() - t < 1000) delay(20); }
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
  cc.mic_gain = MIC_GAIN_DB >= 37 ? ES7210_MIC_GAIN_37_5DB : MIC_GAIN_DB >= 36 ? ES7210_MIC_GAIN_36DB : MIC_GAIN_DB >= 34 ? ES7210_MIC_GAIN_34_5DB
              : MIC_GAIN_DB >= 33 ? ES7210_MIC_GAIN_33DB : ES7210_MIC_GAIN_30DB;
  cc.flags.tdm_enable = true;
  if (es7210_config_codec(micChip, &cc) != ESP_OK) return false;
  es7210_config_volume(micChip, 0);
  return true;
}

int readMono(int16_t *mono) {
  int16_t frames[512];
  size_t n = i2s.readBytes((char *)frames, sizeof(frames));
  int pairs = n / 4;
  for (int i = 0; i < pairs; i++) mono[i] = (int16_t)(((int)frames[2 * i] + (int)frames[2 * i + 1]) / 2);
  return pairs;
}

long levelOf(const int16_t *s, int n) { long e = 0; for (int i = 0; i < n; i++) e += abs(s[i]); return n ? e / n : 0; }

// Throws away what the microphones picked up while she was speaking, so her own voice is never sent.
void flushMic(int ms) { int16_t scratch[256]; uint32_t t0 = millis(); while (millis() - t0 < (uint32_t)ms) readMono(scratch); }

// ---- the network ----
bool joinWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  Serial.printf("Joining Wi-Fi '%s'...\n", WIFI_NAME);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_NAME, WIFI_PASSWORD);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(500);
  if (WiFi.status() != WL_CONNECTED) { Serial.println("Wi-Fi: could not join (check the name and password in secrets.h, and that the hotspot is on)"); return false; }
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

// Plays her answer as it arrives. 16 bit mono at 16000 a second, each sample written twice (left and right). The eyes pulse with her voice.
bool playResponse(HTTPClient &http) {
  int total = http.getSize();
  WiFiClient *stream = http.getStreamPtr();
  uint8_t in[512];
  int16_t out[512];
  uint32_t lastData = millis(), played = 0;
  int leftover = -1;
  float voiceAvg = 0;
  neckTalk(true);
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
    if (o) {
      long e = 0; for (int i = 0; i < o; i += 2) e += abs(out[i]);
      long raw = e / (o / 2 + 1);
      float lv = 0.45f + 0.55f * min(1.0f, (float)raw / 3000.0f);
      eyes(EYE_SPEAK, lv);
      voiceAvg = voiceAvg * 0.9f + raw * 0.1f;
      if (raw > voiceAvg * 1.5f && raw > 600) neckBeat();          // a stressed beat: louder than her voice has been just now
      i2s.write((uint8_t *)out, o * sizeof(int16_t));
      played += o / 2;
    }
    neckUpdate();
  }
  neckTalk(false);
  Serial.printf("Played %.1f seconds of her voice\n", played / 16000.0f);
  return played > 0;
}

void explain(int code) {
  if (code == 401) Serial.println("  401: the access code in secrets.h is not the one the website has.");
  if (code == 503) Serial.println("  503: no access code is set on the website yet.");
  if (code == 404) Serial.println("  404: the website does not know ROBOT_ID, or her voice is not set in robots.json.");
  if (code == 400) Serial.println("  400: the recording was too short.");
  if (code == 413) Serial.println("  413: the recording was too long.");
  if (code == 502) Serial.println("  502: a step on the website failed (speech to text, her answer or her voice).");
}

// Sends what was recorded and plays her answer. Returns true when she spoke.
bool talk(size_t bytes) {
  if (!joinWifi()) return false;
  eyes(EYE_THINK);
  WiFiClientSecure client; client.setInsecure();   // TEST ONLY
  HTTPClient http;
  http.useHTTP10(true);
  if (!http.begin(client, String("https://emerging-tech-lab.com/.netlify/functions/head-talk?robot=") + ROBOT_ID)) return false;
  http.addHeader("x-sun-key", BOX_KEY);
  http.addHeader("Content-Type", "application/octet-stream");
  const char *keep[] = {"X-Heard", "X-Said", "X-Why"}; http.collectHeaders(keep, 3);
  http.setTimeout(30000);
  int code = http.POST(recordBuf, bytes);
  if (code == 204) {
    Serial.printf("Heard: %s   (nothing to say: %s)\n", unpercent(http.header("X-Heard")).c_str(), http.header("X-Why").c_str());
    http.end();
    return false;
  }
  if (code != 200) { Serial.printf("Website answered %d\n", code); explain(code); http.end(); eyes(EYE_TROUBLE); delay(1200); return false; }
  Serial.printf("Heard: %s\n", unpercent(http.header("X-Heard")).c_str());
  Serial.printf("Said:  %s\n", unpercent(http.header("X-Said")).c_str());
  bool ok = playResponse(http);
  http.end();
  return ok;
}

// ---- listening ----
// Waits for someone to speak, then records until they stop. Returns the bytes recorded, or 0 if it was not speech.
size_t listenForSpeech() {
  static int16_t pre[PREROLL_SAMPLES];
  static int preAt = 0;
  int16_t chunk[256];
  uint32_t waitStart = millis();
  // waiting: keep the last 0.3 seconds, and learn the room's level slowly. After a second with nobody talking it returns, so the fireside chat can be checked.
  while (true) {
    if (millis() - waitStart > 1000) return 0;
    neckUpdate();
    web.handleClient();
    if (millis() < gameUntil) return 0;              // a game line was just asked for: the game has her now
    if (keysPressed() & 2) return 0;              // KEY2 is handled in loop()
    if (keysPressed() & 1) return 0;              // so is KEY1
    if (keysPressed() & 4) return 0;              // and KEY3, the volume
    int n = readMono(chunk);
    for (int i = 0; i < n; i++) { pre[preAt] = chunk[i]; preAt = (preAt + 1) % PREROLL_SAMPLES; }
    long e = levelOf(chunk, n);
    long threshold = roomFloor * SPEECH_TIMES + SPEECH_OVER;
    if (e > threshold) break;
    roomFloor = (roomFloor * 63 + e) / 64;          // a crowd's hum raises it, a quiet room lowers it
    static uint32_t lastLevel = 0;
    if (millis() - lastLevel > 5000) { lastLevel = millis(); Serial.printf("Room level: %ld   (a voice must pass %ld)\n", roomFloor, threshold); }
    float breath = (sinf(millis() / 1000.0f * 1.6f) + 1.0f) / 2.0f;
    static uint32_t lastEye = 0;
    if (millis() - lastEye > 40) { lastEye = millis(); eyes(EYE_IDLE, 0.35f + 0.65f * breath); }
  }
  // someone is talking: the 0.3 seconds before, then until a quiet stretch
  eyes(EYE_LISTEN);
  size_t have = 0;
  int16_t *rec = (int16_t *)recordBuf;
  for (int i = 0; i < PREROLL_SAMPLES; i++) rec[i] = pre[(preAt + i) % PREROLL_SAMPLES];
  have = PREROLL_SAMPLES * 2;
  // 2026-11-20 evening: Dr. O's voice passed the start bar but counted as speech for only 32 ms of each sentence, because only the loudest syllables
  // get over it. Once a voice has started, she holds on to it at a lower bar: twice the room plus a little.
  long threshold = roomFloor * 2 + SPEECH_OVER / 2;
  uint32_t loudMs = 0, quietSince = 0;
  long voicePeak = 0;
  while (have + 512 <= MAX_RECORD_BYTES) {
    int n = readMono((int16_t *)(recordBuf + have));
    long e = levelOf((int16_t *)(recordBuf + have), n);
    have += n * 2;
    uint32_t ms = n * 1000 / SAMPLE_RATE;
    if (e > voicePeak) voicePeak = e;
    if (e > threshold) { loudMs += ms; quietSince = 0; }
    else if (!quietSince) quietSince = millis();
    else if (millis() - quietSince > END_QUIET_MS) break;
  }
  Serial.printf("Your voice: %ld at its loudest, %ld times the room   (room %ld, loud for %u ms)\n", voicePeak, roomFloor ? voicePeak / roomFloor : 0, roomFloor, (unsigned)loudMs);
  if (loudMs < MIN_SPEECH_MS) { Serial.printf("A sound, not words (%u ms loud). Not sent.\n", (unsigned)loudMs); return 0; }
  return have;
}

// KEY1: hold to talk, the backup way.
size_t recordHeld() {
  size_t have = 0;
  eyes(EYE_LISTEN);
  flushMic(150);
  while ((keysPressed() & 1) && have + 512 <= MAX_RECORD_BYTES) have += readMono((int16_t *)(recordBuf + have)) * 2;
  return have;
}

// Asks the website whether a fireside chat is on, and plays her turn when it is hers. Returns how long to wait before asking again.
uint32_t firesideCheck() {
  if (!joinWifi()) return 20000;
  WiFiClientSecure client; client.setInsecure();   // TEST ONLY
  HTTPClient http;
  http.useHTTP10(true);
  if (!http.begin(client, String("https://emerging-tech-lab.com/.netlify/functions/head-talk?robot=") + ROBOT_ID + "&fireside=poll&ip=" + WiFi.localIP().toString())) return 20000;
  http.addHeader("x-sun-key", BOX_KEY);
  const char *keep[] = {"X-On", "X-Every", "X-Cue", "X-Said"}; http.collectHeaders(keep, 4);
  http.setTimeout(30000);
  int code = http.POST((uint8_t *)"", 0);
  if (code == 204) {
    bool on = http.header("X-On") == "1";
    if (on != firesideOn) Serial.println(on ? "Fireside chat started: she waits for her turn and does not listen to the room" : "Fireside chat ended: back to listening");
    firesideOn = on;
    uint32_t every = (uint32_t)http.header("X-Every").toInt();
    http.end();
    return (every ? every : (on ? 1 : 20)) * 1000;
  }
  if (code != 200) { http.end(); return firesideOn ? 3000 : 20000; }
  firesideOn = true;
  String cue = http.header("X-Cue");
  Serial.printf("Fireside, her turn. Said: %s\n", unpercent(http.header("X-Said")).c_str());
  playResponse(http);
  http.end();
  HTTPClient done;
  WiFiClientSecure c2; c2.setInsecure();
  if (done.begin(c2, String("https://emerging-tech-lab.com/.netlify/functions/head-talk?robot=") + ROBOT_ID + "&fireside=done&cue=" + cue)) {
    done.addHeader("x-sun-key", BOX_KEY);
    done.POST((uint8_t *)"", 0);
    done.end();
  }
  return 1000;
}

// ---- the tablet game ----
const char *GAME_LINES[] = {"start", "c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "win", "cheer", "tie"};
const int GAME_LINE_COUNT = 13;

bool cardStart() {
  SD_MMC.setPins(40, 42, 41);                        // clock, command, data, as the Rising Sun notes read from Waveshare's diagram
  cardOk = SD_MMC.begin("/sdcard", true);            // one data wire
  if (cardOk && !SD_MMC.exists("/game")) SD_MMC.mkdir("/game");
  Serial.printf("SD card: %s\n", cardOk ? "ok" : "NOT FOUND (the game lines need it)");
  return cardOk;
}

// Fetches a web address onto the card. The old copy is kept unless the new one arrived whole.
size_t fetchToCard(const String &url, const String &path, bool keyed) {
  WiFiClientSecure client; client.setInsecure();     // TEST ONLY
  HTTPClient http;
  http.useHTTP10(true);
  http.setTimeout(30000);
  if (!http.begin(client, url)) return 0;
  int code;
  if (keyed) { http.addHeader("x-sun-key", BOX_KEY); code = http.POST((uint8_t *)"", 0); } else code = http.GET();
  if (code != 200) { Serial.printf("  %s: website answered %d\n", path.c_str(), code); http.end(); return 0; }
  String tmp = path + ".part";
  File f = SD_MMC.open(tmp, FILE_WRITE);
  if (!f) { http.end(); return 0; }
  WiFiClient *s = http.getStreamPtr();
  uint8_t buf[1024];
  size_t total = 0;
  int left = http.getSize();
  uint32_t last = millis();
  while (http.connected() && (left > 0 || left == -1)) {
    size_t a = s->available();
    if (!a) { if (millis() - last > 8000) break; delay(2); continue; }
    last = millis();
    int n = s->readBytes(buf, min(a, sizeof(buf)));
    if (n <= 0) break;
    f.write(buf, n);
    total += n;
    if (left > 0) left -= n;
  }
  f.close();
  http.end();
  if (total < 100) { SD_MMC.remove(tmp); return 0; }
  SD_MMC.remove(path);
  SD_MMC.rename(tmp, path);
  return total;
}

bool onCard(const String &path, size_t least) {
  File f = SD_MMC.open(path);
  bool ok = f && f.size() >= least;
  if (f) f.close();
  return ok;
}

// The game page and the lines file every start (small), and her game lines only when they are not on the card yet.
void gameFiles() {
  if (!cardOk || !joinWifi()) return;
  fetchToCard("https://emerging-tech-lab.com/al-panel/twins.html", "/game/twins.html", false);
  fetchToCard("https://emerging-tech-lab.com/al-panel/twins-lines.json", "/game/twins-lines.json", false);
  int have = 0;
  for (int i = 0; i < GAME_LINE_COUNT; i++) {
    String path = String("/game/") + GAME_LINES[i] + ".pcm";
    if (onCard(path, 1000)) { have++; continue; }
    Serial.printf("  fetching game line %s...\n", GAME_LINES[i]);
    if (fetchToCard(String("https://emerging-tech-lab.com/.netlify/functions/head-talk?robot=") + ROBOT_ID + "&line=" + GAME_LINES[i], path, true)) have++;
  }
  Serial.printf("Game lines on the card: %d of %d. Game page: %s\n", have, GAME_LINE_COUNT, onCard("/game/twins.html", 1000) ? "on the card" : "NOT on the card");
}

// Plays a line from the card: 16 bit mono at 16000 a second, written twice for left and right, with her eyes and head moving as when she talks.
bool playFile(const String &path) {
  File f = SD_MMC.open(path);
  if (!f) return false;
  uint8_t in[512];
  int16_t out[512];
  float voiceAvg = 0;
  neckTalk(true);
  while (f.available()) {
    int n = f.read(in, sizeof(in));
    if (n < 2) break;
    int o = 0;
    for (int k = 0; k + 1 < n; k += 2) { int16_t s = (int16_t)(in[k] | (in[k + 1] << 8)); out[o++] = s; out[o++] = s; }
    long e = 0; for (int i = 0; i < o; i += 2) e += abs(out[i]);
    long raw = e / (o / 2 + 1);
    eyes(EYE_SPEAK, 0.45f + 0.55f * min(1.0f, (float)raw / 3000.0f));
    voiceAvg = voiceAvg * 0.9f + raw * 0.1f;
    if (raw > voiceAvg * 1.5f && raw > 600) neckBeat();
    i2s.write((uint8_t *)out, o * sizeof(int16_t));
    neckUpdate();
  }
  f.close();
  neckTalk(false);
  return true;
}

void cors() {
  web.sendHeader("Access-Control-Allow-Origin", "*");
  web.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  web.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  web.sendHeader("Access-Control-Allow-Private-Network", "true");
}

void sendFile(const char *path, const char *type) {
  cors();
  File f = SD_MMC.open(path);
  if (!f) { web.send(404, "text/plain", "Not on the card yet. Restart her with the Wi-Fi on."); return; }
  web.streamFile(f, type);
  f.close();
}

// Where the other twin is, from the address each board reports to the website. Asked at most every 30 seconds.
String peerBase(const String &who) {
  static String cached = "";
  static uint32_t at = 0;
  if (!cached.length() || millis() - at > 30000) {
    WiFiClientSecure client; client.setInsecure();   // TEST ONLY
    HTTPClient http;
    if (http.begin(client, String("https://emerging-tech-lab.com/.netlify/functions/head-talk?robot=") + ROBOT_ID + "&peers=1")) {
      http.addHeader("x-sun-key", BOX_KEY);
      if (http.POST((uint8_t *)"", 0) == 200) { cached = http.getString(); at = millis(); }
      http.end();
    }
  }
  int i = cached.indexOf("\"" + who + "\":\"");
  if (i < 0) return "";
  i += who.length() + 4;
  int j = cached.indexOf("\"", i);
  return j > i ? cached.substring(i, j) : String("");
}

void onPeer() {
  String who = web.arg("who");
  String base = (who == ROBOT_ID) ? ("http://" + WiFi.localIP().toString() + ":8000") : peerBase(who);
  cors();
  web.send(200, "application/json", "{\"base\":\"" + base + "\"}");
}

void onLine() {
  String body = web.arg("plain");
  int i = body.indexOf("\"line\"");
  int a = i < 0 ? -1 : body.indexOf("\"", body.indexOf(":", i) + 1);
  int b = a < 0 ? -1 : body.indexOf("\"", a + 1);
  String key = (a >= 0 && b > a) ? body.substring(a + 1, b) : String("");
  bool known = false;
  for (int k = 0; k < GAME_LINE_COUNT; k++) if (key == GAME_LINES[k]) known = true;
  String path = String("/game/") + key + ".pcm";
  if (!known || !cardOk || !onCard(path, 1000)) { cors(); web.send(404, "application/json", "{\"error\":\"This twin has no game line called that on her card.\"}"); return; }
  gameUntil = millis() + 60000;
  Serial.printf("Game line: %s\n", key.c_str());
  bool ok = playFile(path);
  cors();
  web.send(ok ? 200 : 502, "application/json", ok ? "{\"ok\":true}" : "{\"error\":\"could not play it\"}");
}

void onMissing() {
  if (web.method() == HTTP_OPTIONS) { cors(); web.send(204); return; }
  String u = web.uri();
  web.sendHeader("Location", (u.startsWith("/images/") ? String("https://emerging-tech-lab.com/al-panel") : String("https://emerging-tech-lab.com")) + u);
  web.send(302);
}

void webStart() {
  web.on("/", HTTP_GET, []() { sendFile("/game/twins.html", "text/html"); });
  web.on("/twins.html", HTTP_GET, []() { sendFile("/game/twins.html", "text/html"); });
  web.on("/twins-lines.json", HTTP_GET, []() { sendFile("/game/twins-lines.json", "application/json"); });
  web.on("/api/robot", HTTP_GET, []() { cors(); web.send(200, "application/json", String("{\"ok\":true,\"id\":\"") + ROBOT_ID + "\"}"); });
  web.on("/api/peer", HTTP_GET, onPeer);
  web.on("/api/game/line", HTTP_POST, onLine);
  web.onNotFound(onMissing);
  web.begin();
  MDNS.begin(ROBOT_ID);
  Serial.printf("Game: open http://%s:8000/ on the tablet (the page is served by %s's board)\n", WiFi.localIP().toString().c_str(), ROBOT_ID);
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.printf("\nRobot head: %s (build 2026-11-21a, with the fireside chat, the head turn and the hearing numbers)\n", ROBOT_ID);
  lightsStart();                                   // the lights first, before anything else is set up
  recordBuf = (uint8_t *)ps_malloc(MAX_RECORD_BYTES);
  Serial.printf("Recording memory: %s\n", recordBuf ? "ok" : "FAILED (PSRAM must be OPI PSRAM in the Tools menu)");
  Wire.begin(I2C_SDA, I2C_SCL);
  bool c = codecStart();
  volumeMemory.begin("head", false);
  volumeStep = volumeMemory.getUChar("vol", 4);
  if (volumeStep > 6) volumeStep = 4;
  if (codec) es8311_voice_volume_set(codec, VOLUME_STEPS[volumeStep], NULL);
  Serial.printf("Volume: %d of 7 (tap KEY3 for louder, hold it for quieter)\n", volumeStep + 1);
  bool a = speakerOn(true);
  i2s.setPins(I2S_BCLK, I2S_LRCK, I2S_DOUT, I2S_DIN, I2S_MCLK);
  i2s.setTimeout(1000);
  bool s = i2s.begin(I2S_MODE_STD, SAMPLE_RATE, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO, I2S_STD_SLOT_BOTH);
  bool m = micStart();
  Serial.printf("Speaker chip: %s, amplifier: %s, sound: %s, microphone chip: %s\n", c ? "ok" : "FAILED", a ? "ok" : "FAILED", s ? "ok" : "FAILED", m ? "ok" : "FAILED");
  randomSeed(esp_random());
  neckStart();
  // eye check: each color once, so the eyes can be seen working before anything else
  const uint8_t *all[] = {EYE_IDLE, EYE_LISTEN, EYE_THINK, EYE_SPEAK};
  for (int i = 0; i < 4; i++) { eyes(all[i]); delay(400); }
  joinWifi();
  cardStart();
  gameFiles();
  webStart();
  flushMic(500);
  Serial.printf("Microphones turned up %d dB. Listening. Talk to her.\n", MIC_GAIN_DB);
}

void loop() {
  if (!recordBuf) { eyes(EYE_TROUBLE); delay(1000); return; }
  web.handleClient();
  if (keysPressed() & 4) { volumeKey(); flushMic(300); return; }   // KEY3: volume
  if (millis() < gameUntil) {                         // during the tablet game she plays her lines and does not listen to the room
    float breath = (sinf(millis() / 1000.0f * 1.6f) + 1.0f) / 2.0f;
    eyes(EYE_IDLE, 0.35f + 0.65f * breath);
    neckUpdate();
    delay(20);
    if (millis() >= gameUntil) flushMic(300);
    return;
  }
  uint8_t keys = keysPressed();
  if (keys & 2) {                                   // KEY2: quiet on or off
    quietMode = !quietMode;
    Serial.println(quietMode ? "Quiet: not listening (tap KEY2 to listen again)" : "Listening again");
    while (keysPressed() & 2) delay(20);
    flushMic(300);
    return;
  }
  neckUpdate();
  if (quietMode) { eyes(EYE_QUIET); delay(100); return; }
  if (millis() >= nextAsk) { nextAsk = millis() + firesideCheck(); if (firesideOn) flushMic(300); }
  if (firesideOn) {                                 // during a chat she only waits for her turn
    float breath = (sinf(millis() / 1000.0f * 1.6f) + 1.0f) / 2.0f;
    eyes(EYE_IDLE, 0.35f + 0.65f * breath);
    delay(40);
    return;
  }
  size_t n = (keys & 1) ? recordHeld() : listenForSpeech();
  if (n >= 16000) {
    talk(n);
    flushMic(400);                                  // her own voice, still in the microphones, is thrown away
  }
}
