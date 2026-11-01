/* screen-test: the smallest possible test of the lid screen (Waveshare ESP32-C6-LCD-1.47), 2026-11-01. No Wi-Fi, no card, no pictures.
   It lights the backlight, then cycles red, green, blue, white, black every second and writes a counter, and prints what it is doing to the Serial Monitor (115200).
   If this lights the screen and box-screen does not, the problem is in box-screen (the shared SPI with the card slot). If this stays black, the pin numbers below are wrong.
   Board: ESP32C6 Dev Module, USB CDC On Boot Enabled. Library: GFX Library for Arduino. The pins are the same unchecked ones as box-screen. NOT TRIED on the board. */
#include <Arduino_GFX_Library.h>

#define LCD_MOSI 6
#define LCD_SCLK 7
#define LCD_CS   14
#define LCD_DC   15
#define LCD_RST  21
#define LCD_BL   22

Arduino_DataBus *bus = new Arduino_ESP32SPI(LCD_DC, LCD_CS, LCD_SCLK, LCD_MOSI, GFX_NOT_DEFINED);
Arduino_GFX *gfx = new Arduino_ST7789(bus, LCD_RST, 0 /* portrait */, true /* ips */, 172, 320, 34, 0, 34, 0);

void setup() {
  Serial.begin(115200);
  delay(1500);                       // give the Serial Monitor time to open
  Serial.println("\nscreen-test: starting");
  pinMode(LCD_BL, OUTPUT);
  digitalWrite(LCD_BL, HIGH);
  Serial.println("backlight pin set high");
  bool ok = gfx->begin();
  Serial.printf("gfx->begin(): %s\n", ok ? "ok" : "FAILED");
}

void loop() {
  static const uint16_t cols[] = {RGB565_RED, RGB565_GREEN, RGB565_BLUE, RGB565_WHITE, RGB565_BLACK};
  static const char *names[] = {"red", "green", "blue", "white", "black"};
  static int n = 0, count = 0;
  gfx->fillScreen(cols[n]);
  gfx->setTextColor(n == 3 ? RGB565_BLACK : RGB565_WHITE);
  gfx->setTextSize(3);
  gfx->setCursor(10, 140);
  gfx->printf("%d", count);
  Serial.printf("%d: %s\n", count, names[n]);
  n = (n + 1) % 5; count++;
  delay(1000);
}
