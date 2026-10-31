/* Screen for the cover of the Portable Companion box, 2026-10-31. Dr. O: a small screen on the lid shows the companion's picture so you know who is in the box,
   and with two boxes you can tell them apart.

   Board: Waveshare ESP32-C6-LCD-1.47 (1.47 inch, 172 by 320, ST7789). It has its own chip and its own Wi-Fi, so it shares no pins with the audio board.
   Every five seconds it asks the website (box-control, screen mode) who is in the box named BOX_NAME, and shows that companion's picture. It never takes a pushed button.

   FIRST POWER ON: the screen flashes red, green and blue, then says "Screen ok". If it stays black, the pin numbers below are wrong: they came from a search summary of Waveshare's wiki,
   not from the wiki itself, and nobody has checked them against it. Fix them in the PINS block.
   Powered from USB-C. The audio board's 5V pin could power it, but whether that pin has 5V on battery has not been checked.
   CLIPS: if the website names a clip for the companion and a FAT32 microSD card is in the slot, the clip is saved to the card the first time and then played in a loop; without a card it shows the still picture.
   Libraries: "GFX Library for Arduino" (1.6.9) and JPEGDEC (1.8.5). The card uses the SD library that comes with the board package. Board package: esp32 by Espressif, 3.2.0, board "ESP32C6 Dev Module", USB CDC On Boot Enabled.
   Uses setInsecure (no certificate check), for testing only. NOT TRIED on the board. */
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Arduino_GFX_Library.h>
#include <JPEGDEC.h>
#include <SPI.h>
#include <SD.h>
#include "secrets.h"

// ---- PINS (unchecked, see the note at the top) ----
#define LCD_MOSI 6
#define LCD_SCLK 7
#define LCD_CS   14
#define LCD_DC   15
#define LCD_RST  21
#define LCD_BL   22
#define SD_CS    4      // the card slot shares the screen's MOSI and SCLK (GPIO6 and 7) and has its own chip select and MISO
#define SD_MISO  5
// ---------------------------------------------------

#ifndef BOX_NAME
#define BOX_NAME "main"
#endif

// One SPI object shared by the screen and the card, so a clip can play from the card. The screen alone would work with Arduino_ESP32SPI instead.
Arduino_DataBus *bus = new Arduino_HWSPI(LCD_DC, LCD_CS, LCD_SCLK, LCD_MOSI, SD_MISO, &SPI, true);
Arduino_GFX *gfx = new Arduino_ST7789(bus, LCD_RST, 0 /* portrait */, true /* ips */, 172, 320, 34, 0, 34, 0);
JPEGDEC jpeg;
String shownFace = "";
String shownClip = "";
String wantClip = "";          // the clip website says to play, empty when there is none
bool sdOk = false;
// Set a path here to play one clip from the card or the website without the panel, for a test on the bench.
// #define TEST_CLIP "/rising-sun/box-clips/ash-full_v1.clp"

int drawBlock(JPEGDRAW *d) {
  gfx->draw16bitRGBBitmap(d->x, d->y, d->pPixels, d->iWidth, d->iHeight);
  return 1;
}

void say(const char *line, uint16_t colour) {
  gfx->fillScreen(RGB565_BLACK);
  gfx->setTextColor(colour);
  gfx->setTextSize(2);
  gfx->setCursor(8, 140);
  gfx->println(line);
}

bool joinWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_NAME, WIFI_PASSWORD);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) delay(200);
  return WiFi.status() == WL_CONNECTED;
}

// Who is in the box, and which picture. Fills face with the picture's path, or leaves it empty.
bool askWebsite(String &face) {
  WiFiClientSecure client; client.setInsecure();   // TEST ONLY
  HTTPClient http;
  if (!http.begin(client, String("https://emerging-tech-lab.com/.netlify/functions/box-control?screen=1&id=") + BOX_NAME)) return false;
  http.addHeader("x-sun-key", BOX_KEY);
  http.setTimeout(8000);
  int code = http.GET();
  if (code != 200) { Serial.printf("Website answered %d\n", code); http.end(); return false; }
  String body = http.getString();
  http.end();
  face = "";
  wantClip = "";
  int cp = body.indexOf("clip=");
  if (cp >= 0) { int nl2 = body.indexOf('\n', cp); wantClip = body.substring(cp + 5, nl2 < 0 ? body.length() : nl2); wantClip.trim(); }
#ifdef TEST_CLIP
  wantClip = TEST_CLIP;
#endif
  int pos = body.indexOf("face=");
  if (pos >= 0) { int nl = body.indexOf('\n', pos); face = body.substring(pos + 5, nl < 0 ? body.length() : nl); face.trim(); }
  return true;
}

// Downloads the picture and draws it.
bool showFace(const String &path) {
  WiFiClientSecure client; client.setInsecure();   // TEST ONLY
  HTTPClient http;
  if (!http.begin(client, String("https://emerging-tech-lab.com") + path)) return false;
  http.setTimeout(10000);
  int code = http.GET();
  int size = http.getSize();
  if (code != 200 || size <= 0 || size > 60000) { Serial.printf("Picture: answer %d, size %d\n", code, size); http.end(); return false; }
  uint8_t *buf = (uint8_t *)malloc(size);
  if (!buf) { http.end(); return false; }
  WiFiClient *s = http.getStreamPtr();
  int got = 0; uint32_t last = millis();
  while (got < size && millis() - last < 8000) {
    int avail = s->available();
    if (avail) { got += s->readBytes(buf + got, min(avail, size - got)); last = millis(); } else delay(5);
  }
  http.end();
  bool ok = false;
  if (got == size && jpeg.openRAM(buf, size, drawBlock)) { ok = jpeg.decode(0, 0, 0) == 1; jpeg.close(); }
  free(buf);
  return ok;
}

// ---- clips: a short silent video kept on the card. Layout: "CLP1", fps, frame count, width, height (2 bytes each), then each frame as a 4 byte length and a JPEG.
// If the card does not have the clip yet, it is downloaded from the website once and kept, so nothing has to be copied by hand.
String clipFileName(const String &path) { int i = path.lastIndexOf('/'); return String("/clips/") + (i >= 0 ? path.substring(i + 1) : path); }

bool fetchClip(const String &path, const String &file) {
  if (!sdOk) return false;
  if (!SD.exists("/clips")) SD.mkdir("/clips");
  WiFiClientSecure client; client.setInsecure();   // TEST ONLY
  HTTPClient http;
  if (!http.begin(client, String("https://emerging-tech-lab.com") + path)) return false;
  http.setTimeout(15000);
  int code = http.GET();
  if (code != 200) { Serial.printf("Clip: website answered %d\n", code); http.end(); return false; }
  int total = http.getSize();
  String tmp = file + ".part";
  File f = SD.open(tmp, FILE_WRITE);
  if (!f) { http.end(); return false; }
  WiFiClient *s = http.getStreamPtr();
  uint8_t buf[1024]; int got = 0; uint32_t last = millis();
  say("Loading clip", RGB565_WHITE);
  while ((total < 0 || got < total) && millis() - last < 10000) {
    int avail = s->available();
    if (avail) { int n = s->readBytes(buf, min(avail, (int)sizeof(buf))); f.write(buf, n); got += n; last = millis(); } else if (!http.connected()) break; else delay(2);
  }
  f.close(); http.end();
  if (total > 0 && got != total) { SD.remove(tmp); Serial.println("Clip: download was cut short"); return false; }
  SD.remove(file); SD.rename(tmp, file);
  Serial.printf("Clip saved: %s, %d bytes\n", file.c_str(), got);
  return true;
}

// Plays the clip once. Returns false if it could not be played at all.
bool playClipOnce(const String &file) {
  File f = SD.open(file, FILE_READ);
  if (!f) return false;
  uint8_t head[12];
  if (f.read(head, 12) != 12 || memcmp(head, "CLP1", 4) != 0) { f.close(); return false; }
  uint16_t fps = head[4] | (head[5] << 8), frames = head[6] | (head[7] << 8);
  if (fps < 1 || fps > 30) fps = 10;
  uint32_t period = 1000 / fps, t0 = millis();
  const size_t MAXJ = 24000;
  uint8_t *jbuf = (uint8_t *)malloc(MAXJ);
  if (!jbuf) { f.close(); return false; }
  uint32_t late = 0;
  for (uint16_t i = 0; i < frames; i++) {
    uint8_t lb[4];
    if (f.read(lb, 4) != 4) break;
    uint32_t len = lb[0] | (lb[1] << 8) | (lb[2] << 16) | ((uint32_t)lb[3] << 24);
    if (len == 0 || len > MAXJ || f.read(jbuf, len) != (int)len) break;
    if (jpeg.openRAM(jbuf, len, drawBlock)) { jpeg.decode(0, 0, 0); jpeg.close(); }
    uint32_t due = t0 + (i + 1) * period, now = millis();
    if (now < due) delay(due - now); else late++;
  }
  free(jbuf); f.close();
  Serial.printf("Clip played: %u frames at %u a second, %u frames were late\n", frames, fps, (unsigned)late);   // "late" tells us how fast the board really is
  return true;
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\nBox screen, name: " BOX_NAME);
  if (!gfx->begin()) Serial.println("Screen did not start");
  pinMode(LCD_BL, OUTPUT); digitalWrite(LCD_BL, HIGH);
  gfx->fillScreen(RGB565_RED);   delay(400);
  gfx->fillScreen(RGB565_GREEN); delay(400);
  gfx->fillScreen(RGB565_BLUE);  delay(400);
  say("Screen ok", RGB565_WHITE);
  delay(600);
  sdOk = SD.begin(SD_CS, SPI, 20000000);
  Serial.printf("microSD card: %s\n", sdOk ? "ok" : "not found (stills only)");
  say("Joining Wi-Fi", RGB565_WHITE);
  if (!joinWifi()) { say("No Wi-Fi", RGB565_RED); Serial.println("Wi-Fi failed"); }
  else Serial.printf("Wi-Fi joined, address %s\n", WiFi.localIP().toString().c_str());
}

void loop() {
  static uint32_t lastAsk = 0;
  if (millis() - lastAsk > 5000 || lastAsk == 0) {
    lastAsk = millis();
    if (!joinWifi()) { delay(500); return; }
    String face;
    if (!askWebsite(face)) { if (shownFace == "") say("No answer", RGB565_RED); return; }
    if (wantClip.length() && sdOk) {
      String file = clipFileName(wantClip);
      if (!SD.exists(file) && !fetchClip(wantClip, file)) wantClip = "";      // no clip: fall back to the still picture
      else shownClip = wantClip;
    } else shownClip = "";
    if (!shownClip.length() && face.length() && face != shownFace) {
      Serial.printf("Showing %s\n", face.c_str());
      if (showFace(face)) shownFace = face;
      else say("No picture", RGB565_RED);
    }
  }
  if (shownClip.length() && sdOk) {              // keep playing the clip until the website says otherwise (it is asked again every five seconds)
    if (!playClipOnce(clipFileName(shownClip))) { shownClip = ""; shownFace = ""; }
    return;
  }
  delay(50);
}
