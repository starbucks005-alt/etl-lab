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

## The panel and the companion (2026-10-30)

The box asks the website every four seconds who is in it and whether a button was pushed from the panel, `rising-sun/box-panel.html` at emerging-tech-lab.com/rising-sun/box-panel.html. Enter the home access code once. Pick the box and the companion. The three buttons on the page do what the lid buttons do. A companion with no recorded story has that button greyed out.

Each box has a name, `BOX_NAME` in `secrets.h` (kitchen, desk), so two boxes in one home can be told apart. Without it the box is called `main`.

In the first build: Tansy, Meera (Breathing, her own AR starter line, spoken once and kept), Marcus (chat and soundscape; his News is not built), Reggie and A.L.I.C.E. (Story time greyed out until stories are recorded). The Grimms and Explorer Kit are not in yet: the Grimms need chosen tales, and no voice id was found for Kit.

Checked: the website functions and the panel page against stand-ins, and the sketch compiles. NOT tried on the live site or the board.

## Verified on the board (2026-10-30)

Dr. O heard Tansy answer out loud from the box. Before that the board restarted at the moment her reply should start. A decoded backtrace put the stop inside the ring light library's lock, in the green ring command at the start of her reply. The ring is now written directly in `ringColor`. Why that lock timed out is not known. Not yet tried on the board: the wake word with the fix, Story time, Gardenscape, Meera's Breathing, and the panel buttons.

## Charging and programming port (2026-10-31)

Dr. O has a panel-mount USB-C extension cable (QINJOOELC, USB C 3.0, male to female, threaded, with a rubber cap). From its listing: cut a **21.5 mm hole**, panel thickness **8 mm or less**, it comes with its own nut, it carries data (5 Gbps, backwards compatible with USB 2.0) and charges at 5V 2A. The plug end goes into the audio board's USB-C port inside the box, so the battery can be charged, and sketches uploaded, from outside. If an upload fails through it, try plugging straight into the board once, to tell a cable problem from a board problem. Not tried yet. The box wall thickness and the lead length against the distance to the board's port are not measured.

## Chat mode: two boxes talking to each other (2026-10-31)

Dr. O bought two black boxes so she can show people how the companions talk to each other. On the panel (`rising-sun/box-panel.html`), the Chat mode card picks two boxes (each has its own name and its own companion), an optional topic and how many lines, then starts. The website runs the conversation and alternates turns; each box plays only its own companion's lines in her own voice, then says done so the other box gets its turn. Each line is written from the companion's written life and the line before it. While it runs, each box stops listening for the wake word so the other box's voice cannot wake it. At most 20 lines in a run and 80 lines a day. A line that cannot be made ends the run.

Checked: the website side with stand-ins (`node tests/box-duet.test.js`) and the sketch compiles. NOT tried with two boxes, the live site or real voices. The pause between lines is not measured: each line is written and voiced when its turn comes, so expect a few seconds.

## Talking without saying the wake word every time (2026-10-31)

Dr. O: "I have to say Hi ESP before I say each sentence, this is not efficient." Now the wake word starts a conversation. After each answer the box listens for the next sentence for eight seconds. After eight quiet seconds, or ten turns, it goes back to waiting for the wake word. The panel's Chat button does the same. The hold-to-talk lid button is still one sentence per press. Compiles; NOT tried on the board. The eight seconds and the ten turns are guesses to adjust once she has tried it (`FOLLOW_UP_WAIT_MS` and `FOLLOW_UPS`).
