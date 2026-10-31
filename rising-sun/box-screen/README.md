# Screen for the cover of the box

A small screen on the lid shows the companion's picture, so you know who is in the box, and with two boxes you can tell them apart (Dr. O, 2026-10-31).

Board: Waveshare ESP32-C6-LCD-1.47 (1.47 inch, 172 by 320). It has its own chip and Wi-Fi, so it shares no pins with the audio board.

1. Arduino IDE, esp32 board package 3.2.0, board ESP32C6 Dev Module, USB CDC On Boot Enabled.
2. Libraries: GFX Library for Arduino 1.6.9 and JPEGDEC 1.8.5.
3. Copy `secrets.h.example` to `secrets.h`. Use the same Wi-Fi (2.4 GHz), the same home access code, and the same BOX_NAME as the box this screen belongs to.
4. Upload. At power on it flashes red, green and blue, says "Screen ok", joins Wi-Fi, then shows the picture of the companion chosen on the panel (`rising-sun/box-panel.html`). It asks every five seconds.

The pictures are `rising-sun/box-faces/<name>_v1.jpg`, 172 by 320. A new picture gets a new filename.

NOT TRIED on the board. The pin numbers (MOSI 6, SCLK 7, CS 14, DC 15, RST 21, backlight 22) came from a search summary of Waveshare's wiki, not from the wiki, and have not been checked against it. If the screen stays black, check them first (the PINS block in the sketch). The screen offsets (34 columns) are also unchecked. It compiles with esp32 3.2.0 and uses about 89 percent of the default program space.
