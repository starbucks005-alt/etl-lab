# First prototype: the light only (for David)

Dr. O designed this and decided it. This sheet is the shortest way to see the sun light up. Nothing in it needs her voice, a speaker or the website.

Written 2026-10-18. Not one step has been tried on real parts yet, so the first thing anyone learns is a real result. If something below is wrong, that is useful: tell Dr. O what happened.

## What you need
- The ESP32-S3 N16R8 board (the same kind as the Holopod buttons).
- A WS2812B LED strip. For a first look, a short piece is enough (30 to 60 LEDs). Use the same type the acrylic will use.
- A 5V power supply for the strip, sized by this rule: each LED at full white can draw up to 60 milliamps, so 60 LEDs need up to 3.6 amps. A supply with some room above that is safer.
- A 330 ohm resistor, and a 1000 microfarad capacitor across the strip's power wires if there is one in the parts bin.
- Jumper wires, a USB cable for the board, and a computer with the Arduino IDE.

## Wiring
1. Strip data wire to board pin 5, through the 330 ohm resistor. (The pin number is `LED_PIN` at the top of `sunrise.ino`. Check it against the labels printed on the board.)
2. Strip ground, supply ground and board ground all joined together.
3. Strip plus to the supply's 5V. Do not power the strip from the board's 5V pin.
4. Power the strip on after the board, and off before it.

## Loading the program
1. In the Arduino IDE: Tools, Board, "ESP32S3 Dev Module". The other menu settings are listed in `good-company/box-buttons/halo_buttons.ino`. The USB mode setting there is for the buttons and does not matter here.
2. Library Manager: install "Adafruit NeoPixel" and "ArduinoJson" (version 7). The program needs both even in demo mode, because it is one file.
3. Open `rising-sun/sunrise.ino`. Set `LED_COUNT` to how many LEDs the strip has.
4. Leave `DEMO_MODE` true. Upload.

## What you should see
A short test (up and down once), then the sunrise: dark, a dim red glow, deep orange, amber, warm white, then daylight, over 90 seconds. Ten seconds of dark, then it starts again.

## What to tell Dr. O
- Does the strip light at all? If the first LED flickers or the colors are wrong, say so. A level shifter (74AHCT125) may be needed.
- Do the colors look like dawn? She decides what to change. The color table is the `STEPS` list in `sunrise.ino`, and `python3 rising-sun/sunrise.py` prints the same numbers.
- Behind the acrylic, does it look like a sun or like a lamp? Photos help.

## Not in this prototype, on purpose
Her voice, listening, the Rising Sun panel connection (set `DEMO_MODE` false and fill in Wi-Fi and the key when that is wanted), the news, the calendar. The panel and "Talk to her" already work on a computer at `/rising-sun/` once the site has the key set.
