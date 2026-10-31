# Screen for the cover of the box

A small screen on the lid shows the companion's picture, so you know who is in the box, and with two boxes you can tell them apart (Dr. O, 2026-10-31).

Board: Waveshare ESP32-C6-LCD-1.47 (1.47 inch, 172 by 320). It has its own chip and Wi-Fi, so it shares no pins with the audio board.

1. Arduino IDE, esp32 board package 3.2.0, board ESP32C6 Dev Module, USB CDC On Boot Enabled.
2. Libraries: GFX Library for Arduino 1.6.9 and JPEGDEC 1.8.5.
3. Copy `secrets.h.example` to `secrets.h`. Use the same Wi-Fi (2.4 GHz), the same home access code, and the same BOX_NAME as the box this screen belongs to.
4. Upload. At power on it flashes red, green and blue, says "Screen ok", joins Wi-Fi, then shows the picture of the companion chosen on the panel (`rising-sun/box-panel.html`). It asks every five seconds.

The pictures are `rising-sun/box-faces/<name>_v1.jpg`, 172 by 320. A new picture gets a new filename.

NOT TRIED on the board. The pin numbers (MOSI 6, SCLK 7, CS 14, DC 15, RST 21, backlight 22) came from a search summary of Waveshare's wiki, not from the wiki, and have not been checked against it. If the screen stays black, check them first (the PINS block in the sketch). The screen offsets (34 columns) are also unchecked. It compiles with esp32 3.2.0 and uses about 89 percent of the default program space.

## Video clips (2026-10-31)

The screen can play a short silent loop of the companion instead of a still picture. Dr. O's videos are about 4 MB each; a clip made from one is about 1 MB.

1. Make a clip from a video: `python3 rising-sun/tools/make-clip.py Ash-full.mp4 rising-sun/box-clips/ash-full_v1.clp` (needs ffmpeg). It makes 172 by 320, 10 frames a second, no sound.
2. Put a FAT32 microSD card in the screen board's slot.
3. Either let the screen fetch the clip itself (the website names it, and the screen saves it on the card in a `clips` folder the first time), or copy the `.clp` file into a folder named `clips` on the card by hand.
4. To test one clip without the panel, remove the `//` before `#define TEST_CLIP` in `box-screen.ino`.

The screen prints "Clip played: ... frames were late" in the Serial Monitor. That number is how fast the board really is: no late frames means it keeps up at 10 a second.

NOT TRIED on the board. It compiles (about 92 percent of the default program space, which is tight, so a further feature may need a bigger partition). The card pins (CS 4, MISO 5) and the shared use of the screen's wires come from a search summary of Waveshare's wiki, not from the wiki, and are unchecked. A companion gets a clip by adding `"clip": "/rising-sun/box-clips/<name>.clp"` in `box-lines.json`; none has one yet.
