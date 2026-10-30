# Portable Companion box with Tansy: chat, story time, gardenscape (2026-10-30)

Compiled by Claude against the ESP32 Arduino core 3.2.0 (it builds with no errors). NOT run on a board and NOT run against the real website yet.

## What it does (Dr. O's three buttons)
- Chat with Tansy: say the wake word, wait for the short beep, speak. She answers out loud. Backup: hold the chat button and speak.
- Story time: one tap, she tells the next fragment of the Human Summer, in turn (lines named `hs-...` or `story-...` in `rising-sun/box-lines.json`).
- Gardenscape: one tap, she introduces a nature scene, then it plays on and on (jungle, waterfall, rain, night woods, in turn) until a button is pressed or three minutes pass.

The wake word is "Hi ESP". It is the one that comes with the Arduino board support. "Hey Tansy" would need a custom model made by Espressif (the maker of the chip); how long that takes and what it costs was not looked up. The wake word is found on the board itself; nothing is sent anywhere until it hears it.

## Settings that differ from board-test
Tools menu, Partition Scheme: **ESP SR 16M (3MB APP/7MB SPIFFS/2.9MB MODEL)**. The other settings are the same as board-test (ESP32S3 Dev Module, USB CDC On Boot Enabled, Flash Size 16MB, PSRAM OPI PSRAM, core 3.2.0). Without that partition the wake word engine will not start; the Serial Monitor says so. PSRAM must be **OPI PSRAM** (not QSPI): with QSPI the board prints "quad_psram: PSRAM ID read error" at startup.

## Files and secrets
Folder name `box-chat`. Files: `box-chat.ino`, `es8311.cpp`, `es8311.h`, `es8311_reg.h`, `es7210.c`, `es7210.h`, `es7210_reg.h`, `es7210_wire.cpp`, and your own `secrets.h`. `es7210.c` was changed from Waveshare's original in one place (it writes with Wire, see `es7210_wire.cpp`), because the original's old I2C driver stops the board at startup with "CONFLICT! driver_ng is not allowed to be used with this old driver" (seen on Dr. O's board, 2026-10-30). Needs `secrets.h` copied from `secrets.h.example` (Wi-Fi name, password, the home access code). secrets.h is never put on GitHub.

## Lid buttons (the board's own keys are hidden inside the box)
A push button between a pin and GND. GND is header pin 16 (and 15).
- Chat: GPIO4, header pin 8.
- Story time: GPIO5, header pin 6.
- Gardenscape: GPIO6, header pin 4.
The board's own KEY1, KEY2 and KEY3 do the same three things.

## What was not checked
- Everything on the board: the wake word, the microphones' format with the speech engine, end-of-speech detection, the buttons.
- Every call to ElevenLabs (speech to text, voice, sound effects) and to Claude. The website functions pass their tests with stand-ins only.
- ElevenLabs' Service-Specific Terms for sound effects.
- A false wake (the box waking when nobody said the word) and a missed wake in a noisy room.
- The website certificate is not checked (test only).
