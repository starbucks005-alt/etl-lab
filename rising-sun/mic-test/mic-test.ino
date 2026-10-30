/* Microphone test for the Waveshare ESP32-S3 AUDIO Board, 2026-10-30. Dr. O: "it is not hearing anything".

   No Wi-Fi, no wake word. It only listens and shows how loud it is, twice a second, in the Serial Monitor (115200) and on the ring of lights (the louder, the brighter the green).
   Talk or clap near the box. If the numbers stay near 0 whatever you do, the microphones are not delivering sound, and the wake word could never hear anything either.
   Two numbers per line: the left microphone and the right, each as an average loudness and a peak (the loudest single sample), out of 32767.

   If the numbers stay near 0: change MIC_TDM below to 0 and upload again, and see whether that wakes them up. If one side is always 0 and the other moves, that is fine.
   Same board and Arduino settings as board-test (the 3MB APP partition is fine here). Compiled by Claude against core 3.2.0; NOT run on the board yet. */
#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_NeoPixel.h>
#include "ESP_I2S.h"
#include "driver/i2c.h"
#include "es8311.h"
#include "es7210.h"

#define MIC_TDM        1      // 1 = as in Waveshare's sample. Try 0 if everything stays near 0.
#define MIC_GAIN       ES7210_MIC_GAIN_30DB

#define I2C_SDA 11
#define I2C_SCL 10
#define I2S_MCLK 12
#define I2S_BCLK 13
#define I2S_LRCK 14
#define I2S_DOUT 16
#define I2S_DIN  15
#define RING_PIN 38
#define SAMPLE_RATE 16000
#define TCA_ADDR 0x20
#define ES8311_ADDR 0x18
#define ES7210_ADDR 0x40

Adafruit_NeoPixel ring(7, RING_PIN, NEO_GRB + NEO_KHZ800);
I2SClass i2s;
es8311_handle_t codec = NULL;
es7210_dev_handle_t micChip = NULL;

bool seen(uint8_t a) { Wire.beginTransmission(a); return Wire.endTransmission() == 0; }

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println("\nMicrophone test (talk or clap near the box)");
  ring.begin(); ring.setBrightness(30);
  Wire.begin(I2C_SDA, I2C_SCL);
  Serial.printf("Microphone chip (0x40): %s\n", seen(ES7210_ADDR) ? "answers" : "NO ANSWER");

  // the speaker chip is started too, because the microphone chip takes its clock from the same lines
  codec = es8311_create(I2C_NUM_0, ES8311_ADDR);
  es8311_clock_config_t clk = {};
  clk.mclk_from_mclk_pin = true; clk.mclk_frequency = SAMPLE_RATE * 256; clk.sample_frequency = SAMPLE_RATE;
  if (codec) es8311_init(codec, &clk, ES8311_RESOLUTION_16, ES8311_RESOLUTION_16);

  i2s.setPins(I2S_BCLK, I2S_LRCK, I2S_DOUT, I2S_DIN, I2S_MCLK);
  i2s.setTimeout(1000);
  bool ok = i2s.begin(I2S_MODE_STD, SAMPLE_RATE, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO, I2S_STD_SLOT_BOTH);
  Serial.printf("Sound input started: %s\n", ok ? "ok" : "FAILED");

  es7210_i2c_config_t conf = {};
  conf.i2c_port = I2C_NUM_0; conf.i2c_addr = ES7210_ADDR;
  esp_err_t e1 = es7210_new_codec(&conf, &micChip);
  es7210_codec_config_t cc = {};
  cc.sample_rate_hz = SAMPLE_RATE; cc.mclk_ratio = 256; cc.i2s_format = ES7210_I2S_FMT_I2S;
  cc.bit_width = ES7210_I2S_BITS_16B; cc.mic_bias = ES7210_MIC_BIAS_2V87; cc.mic_gain = MIC_GAIN;
  cc.flags.tdm_enable = MIC_TDM;
  esp_err_t e2 = micChip ? es7210_config_codec(micChip, &cc) : ESP_FAIL;
  if (micChip) es7210_config_volume(micChip, 0);
  Serial.printf("Microphone chip setup: %s (TDM %d)\n", (e1 == ESP_OK && e2 == ESP_OK) ? "ok" : "FAILED", MIC_TDM);
}

void loop() {
  static uint32_t t0 = millis();
  static long sumL = 0, sumR = 0, n = 0; static int pkL = 0, pkR = 0;
  int16_t f[512];
  size_t got = i2s.readBytes((char *)f, sizeof(f));
  int pairs = got / 4;
  for (int i = 0; i < pairs; i++) {
    int l = abs((int)f[2 * i]), r = abs((int)f[2 * i + 1]);
    sumL += l; sumR += r; n++;
    if (l > pkL) pkL = l;
    if (r > pkR) pkR = r;
  }
  if (millis() - t0 > 500) {
    long aL = n ? sumL / n : 0, aR = n ? sumR / n : 0;
    Serial.printf("left avg %5ld peak %5d   |   right avg %5ld peak %5d   %s\n", aL, pkL, aR, pkR, (pkL + pkR) < 20 ? "(almost silent)" : "");
    int level = min(255L, max(aL, aR) / 8);
    for (int i = 0; i < 7; i++) ring.setPixelColor(i, ring.Color(0, level, 20));
    ring.show();
    sumL = sumR = n = 0; pkL = pkR = 0; t0 = millis();
  }
}
