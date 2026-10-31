/* Screen for the cover of the Portable Companion box, 2026-10-31. Dr. O: a small screen on the lid shows the companion's picture so you know who is in the box,
   and with two boxes you can tell them apart.

   Board: Waveshare ESP32-C6-LCD-1.47 (1.47 inch, 172 by 320, ST7789). It has its own chip and its own Wi-Fi, so it shares no pins with the audio board.
   Every five seconds it asks the website (box-control, screen mode) who is in the box named BOX_NAME, and shows that companion's picture. It never takes a pushed button.

   FIRST POWER ON: the screen flashes red, green and blue, then says "Screen ok". If it stays black, the pin numbers below are wrong: they came from a search summary of Waveshare's wiki,
   not from the wiki itself, and nobody has checked them against it. Fix them in the PINS block.
   Powered from USB-C. The audio board's 5V pin could power it, but whether that pin has 5V on battery has not been checked.
   Libraries: "GFX Library for Arduino" (1.6.9) and JPEGDEC (1.8.5). Board package: esp32 by Espressif, 3.2.0, board "ESP32C6 Dev Module", USB CDC On Boot Enabled.
   Uses setInsecure (no certificate check), for testing only. NOT TRIED on the board. */
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Arduino_GFX_Library.h>
#include <JPEGDEC.h>
#include "secrets.h"

// ---- PINS (unchecked, see the note at the top) ----
#define LCD_MOSI 6
#define LCD_SCLK 7
#define LCD_CS   14
#define LCD_DC   15
#define LCD_RST  21
#define LCD_BL   22
// ---------------------------------------------------

#ifndef BOX_NAME
#define BOX_NAME "main"
#endif

Arduino_DataBus *bus = new Arduino_ESP32SPI(LCD_DC, LCD_CS, LCD_SCLK, LCD_MOSI, GFX_NOT_DEFINED);
Arduino_GFX *gfx = new Arduino_ST7789(bus, LCD_RST, 0 /* portrait */, true /* ips */, 172, 320, 34, 0, 34, 0);
JPEGDEC jpeg;
String shownFace = "";

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
    if (face.length() && face != shownFace) {
      Serial.printf("Showing %s\n", face.c_str());
      if (showFace(face)) shownFace = face;
      else say("No picture", RGB565_RED);
    }
  }
  delay(50);
}
