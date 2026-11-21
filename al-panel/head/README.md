# Robot head on the round Waveshare board (2026-11-19)

Dr. O's design, 2026-11-19: no more eye stack and no servo board for Astri. Her head carries the round Waveshare ESP32-S3 audio board, a speaker and two cabochon eyes, and the thinking is on the website. One USB cable from the EcoFlow to the board.

**Status: RUN ON THE BOARD by Dr. O, 2026-11-20.** It compiled in her Arduino IDE with no errors (1,071,638 bytes, 81% of program space, default Partition Scheme), loaded onto the round board (it showed up as COM11), and Astri talked. Dr. O: *"omg, she is sooo perfect!"* The eye strip, the cabochons, the speaker on the MX1.25 lead and the fireside chat were not part of this first run and are still to be tried. The website side (`netlify/functions/head-talk.js`) has its own test with stand-ins (`node tests/head-talk.test.js`).

## What it does

- Listens all the time. When somebody speaks, it records until they stop, sends it to the website, and plays her answer in her own voice (Astri: Azure, Ana).
- No wake word and no name needed. She answers whoever talks to her. She does not listen while she speaks.
- **KEY1, hold:** talk while holding it, the backup way.
- **KEY2, tap:** her quiet switch. She stops listening and her eyes go dim. Tap again to listen.
- Her eyes change color with what she is doing: waiting, listening, thinking, talking. The colors are at the top of `robot-head.ino` under "Dr. O's choices", and the ones there now are placeholders until she picks.
- What she heard and what she said print in the Serial Monitor as `Heard:` and `Said:` lines, so they can be read.
- Who she is and how she talks come from the same file her Pi uses (`al-panel/pi/personalities.json`). Her voice comes from `al-panel/robots.json`.
- **The fireside chat:** she asks the website every 20 seconds whether a chat is on (every second while one is). During a chat she does not listen to the room. The director on the website hands her the others' words as text, and when it is her turn the website sends her answer and she plays it. She joins as "Astri" on the host page. The host's Stop cuts a Pi off mid sentence; a head finishes its two or three sentences first.
- At most 400 turns a day for each robot. After two quiet minutes she forgets the last conversation, so the next visitor starts fresh.

## Parts (all on hand or ordered 2026-11-19)

- The round board (ESP32-S3 AI smart speaker board).
- Speaker: one of the loose 8 ohm speakers (or two, wired side by side, for 4 ohms), joined to a 2-pin MX1.25 lead with solder seal connectors, plugged into the board's SPK socket.
- Eyes: a piece cut from the BTF WS2812B 5V strip at its plug end, 4 lights (eyes about 5 cm apart) or 5 lights (about 6.7 cm). Lights 1 and 4 (or 1 and 5) are the eyes; the ones between stay dark. Clear glass cabochons over a diffuser in front of each.
- USB-A to USB-C cable, data capable, from the EcoFlow to the board.

## Wiring the eyes

From the strip's plug: **green (data) to header pin 2** (GPIO7), **red (5V) to header pin 18**, **white (ground) to header pin 16**. Check pin 18 with the meter first: it should read about 5 V to pin 16 with the board on USB.

## Wiring the head turn (2026-11-20)

The round board runs the MG996R itself, with no servo board. Servo **orange** (signal) to **header pin 6** (GPIO5). Servo **brown** to the servo's own power minus **and** to the board's **GND** (header pin 15 or 16): the grounds must be joined. Servo **red** to the servo's own 5V plus. The servo never takes power from the board. On a battery twin, the servo's power is a USB power bank in the backpack, through a USB to screw terminal adapter plugged into the power bank. No soldering anywhere (Dr. O's rule): jumper wires onto the header pins and the servo's plug, and a WAGO where the grounds join.

While she talks, the head turns slowly to five spots across the room and holds each, the same as the Pi's room sweep, then eases back to the middle and lets go. The numbers are under "Dr. O's choices": `NECK_MIDDLE` (straight ahead, 90), `NECK_SWAY` (how far each way, 14) and `NECK_SPEED_MS` (40, higher is slower). `NECK_ON 0` turns it off for a head with no servo. NOT TRIED on a board yet.

## Turning a head on and off (from Dr. O's photo, 2026-11-20)

The round boards came in a case with the battery **inside**. The on/off switch is a small slide switch at the edge of the board, next to the USB-C port and the **CHG** light, marked **ON** (toward the USB port) and **OFF**. With the switch on **OFF** and no USB cable in, the board is off. The buttons along the edge are labeled **K1, K2/SET, K3, BOOT, RESET**. The 18 pins are two rows of 9, under the clear top cover, which comes off with its screws.

## The 18 pins, as printed on Dr. O's board (from her photo, 2026-11-20)

Two rows of 9, read with the IO7 end on the left:

| Column | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|
| Row A | IO7 | IO6 | IO5 | IO4 | IO3 | IO20 | IO19 | GND | 5V |
| Row B | EX3 | EX2 | EX1 | IO9 | IO8 | SDA | SCL | GND | 3V3 |

This agrees with the Rising Sun notes (header pin 2 is IO7, pin 18 is 5V, pins 15 and 16 are GND). Which physical row is Row A is found with the meter, not by eye: board ON, black probe on a column 8 pin, red probe on each column 9 pin; about 5 V is Row A, about 3.3 V is Row B.

- Eye strip: green (data) on IO7, red on 5V, white on GND, all Row A.
- Servo: orange (signal) on IO5, Row A column 3. Its ground joins a GND pin through the WAGO; its red goes to its own 5V, never the board.
- The microphones are marked MIC1 (near the right edge) and MIC2 (lower left). Inside a head, both need an opening in front of them.

## Helping her hear (2026-11-20)

- Openings of 2 to 3 mm in the head right in front of MIC1 and MIC2; turn the board so the two microphones face the ears. Keep the speaker facing the front, with foam between it and the microphones, never over them.
- `MIC_GAIN_DB` under "Dr. O's choices" (30 now; 33, 34, 36 or 37) turns the microphones up, and the room's noise with them.
- The Serial Monitor prints `Room level: ...` every 5 seconds while she waits, and `Your voice: ... times the room` each time someone speaks. A bigger "times the room" number means she hears voices more clearly over the room, so a new hole or a higher gain can be checked by the number, not by ear.

## Head turn, 2026-11-20 evening: it works

On build 2026-11-20e on Astri's board, with the servo's own power from a wall charger (5.10 V), the board printed `Head turn: ok` and her head turned while she answered (Dr. O made her talk with K1, hold to talk). Dr. O: "her head moved, but not much", at `NECK_SWAY 14`, the Pi's starting value; raise it under "Dr. O's choices" (up to 55). **Astri's is 49** (Dr. O, 2026-11-20). The servo did not move at start up, likely because it was already at the middle. Her power cable read 0 on the power station's USB port with no device on it, so on the bench the servo runs from a wall charger, and at events from the power bank.

## Next, from Dr. O, 2026-11-20 night: the eyes, and Astro

- **The eyes, Astri first.** On build 2026-11-20e and later the board printed `Lights: eyes REFUSED, board ring REFUSED`, though the ring lit that morning on build 2026-11-19b. Cause not known. First check: the esp32 board package version in Tools > Board > Boards Manager (the program was written for 3.2.0). Then the 4-light piece of the BTF strip on IO7, 5V and GND, Row A, behind the cabochons and a diffuser.
- **Astro.** The newest robot-head.ino in his robot-head-astro folder, renamed robot-head-astro.ino, keeping his secrets.h. His servo wired like Astri's (orange to IO5, its own USB power cable checked with the meter, WAGOs, the board's GND joined). Then his numbers under "Dr. O's choices".
- Astri's numbers so far: `NECK_SWAY 49`, `NECK_SPEED_MS 10`, and the head moving with her words (`NECK_BEATS 1`, `NECK_BEAT_DEG 10`, build 2026-11-20i, not yet seen).

## The lights work again, 2026-11-20 (Friday)

The board package's light driver (arduino-esp32 3.2.0, the version installed) refused to start on builds 2026-11-20d to 20i ("rmt_new_tx_channel(269): not able to power down in light sleep", the same message reported in arduino-esp32 issues 11223 and 11225). Build 2026-11-20j sends the light signal directly, timed from the processor's clock, with no light driver, and on Astri's board the ring lit (Dr. O, 2026-11-20). The eye strip on IO7 uses the same code and is still to be tried. Do not update the esp32 board package (the IDE offers 4.0.0) without testing first.

Uploading notes from the same morning: the IDE saves what is in its window over the file when Upload is pressed, so close the IDE before putting a new file in the folder; Sketch > Show Sketch Folder shows which folder the IDE uses; "exit status 2" was the Serial Monitor holding the port, fixed by closing that tab before Upload.

## Astri's pink, 2026-11-20

The board's own ring reads its first color number as **red**; the eye strip (WS2812B) reads green first. Dr. O found it: her deep pinks showed pink on the ring only with the first two numbers swapped by hand ({10, 255, 60} in the program's green-first order arrives as red 255, green 10, blue 60). From build 2026-11-20o the ring is sent red first, so the color lines read normally: waiting, thinking, quiet and trouble 255,10,60; listening 255,30,90; talking 255,0,40. Pale pinks (255,182,193) look bluish white on these lights, so keep green and blue low. Astro's color is blue (Dr. O, 2026-11-20): 0,60,255 waiting, thinking, quiet and trouble; 0,120,255 listening; 0,30,255 talking, with EYE_BRIGHTNESS 255, in his own copy of the program (robot-head-astro.ino). (An earlier note that day said the green-first order was right; that was wrong: the build that showed pink carried her swapped numbers.) The IDE uses the folder Desktop\robot-head_v1\robot-head on Dr. O's computer.

## Astri's eyes glow, 2026-11-20

Dr. O lit both of Astri's eyes from the board's own ring, shining through the eye domes left from her eye stack: no eye strip and no wiring. Both eyes glow about evenly (her photo, 2026-11-20, 11:37). In that photo they read a little purple; lowering the blue number of her waiting color (60 to about 30) would make them pinker, her call.

## Astro on his round board, 2026-11-20 (Friday night)

Dr. O loaded Astro's copy (robot-head-astro.ino, build 2026-11-20o: blue eyes, the head turn moving with his words, the hearing fixes and the lights sent directly) onto his board: "It's all good." Both twins now run on round boards with no Pi and no eye stack, the night before Science Saturday at the Joe Clark Innovation Lab.

## Open, after the event

- **The tablet game (twins.html) with the round boards.** On 2026-11-20 it works as a game with the twins' lines shown as words; the twins do not speak them, because the game was built to ask each twin's Pi (POST /api/game/line on port 8000). Dr. O's design: an **SD card in each twin's board** (she has them) holding that twin's game lines in their own voice, and one twin's board serving the game page itself, as Astri's Pi did, so each move tells the right twin which line to play from its card, with no website in the middle. To build: record the lines (al-panel/twins-lines.json) once per twin onto the cards, a small web server and the game page on the board, and play from the card.
- **K3 is the volume (build 2026-11-21a, Dr. O: "K3 to volume up and down in increments").** Tap for one step louder, hold for one step quieter (another step each second it is held). Seven steps (45, 55, 65, 75, 85, 93, 100), starting at 85. The ring lights one light per step for a moment and the Serial Monitor prints "Volume: 5 of 7". Remembered when switched off. Not yet tried on a board; if K3 does nothing, it is the same open question as K2 below.
- **K2, the quiet switch, did not work** while charging (Dr. O, 2026-11-20 night: "a minor issue"). Cause not known: the program does not watch the button while a twin is talking or waiting on the website, or the button marked K2/SET may not be the one the program reads (it reads the pin expander bits KEY1 0x02, KEY2 0x04, KEY3 0x08, copied from the Companion box). To settle it: Serial Monitor open, tap K2, look for "Quiet: not listening"; if it never shows, try K3.
- **Quiet on their own while charging**, asked for by Dr. O: first find whether the board can tell a USB cable is in.
- **Astri's answer "I don't know that one!"** to something that was not a question about her (2026-11-20): her line for unknown facts used where it was not needed.

## Loading it

1. Copy `secrets.h.example` to `secrets.h` in the same folder and fill in the Wi-Fi (or phone hotspot) name and password, and the home access code the Companion box uses.
2. Open `robot-head.ino` in the Arduino IDE. Tools: the same settings as the board test (`rising-sun/board-test/README.md`): ESP32S3 Dev Module, USB CDC On Boot Enabled, Flash Size 16MB, **PSRAM: OPI PSRAM**, ESP32 core 3.2.0. The Partition Scheme can stay the default.
3. Upload, then open the Serial Monitor at 115200.

## What to look for

- `Speaker chip: ok, amplifier: ok, sound: ok, microphone chip: ok`
- The eyes show each color once at start.
- `Wi-Fi: joined`
- `Listening. Talk to her.` Then speak, and look for `Heard:` and `Said:` lines.
- If a line says a number like 401 or 404, the line under it says what it means.

## Not known yet

- Whether the microphones hear people well from inside a closed head (the first test in the head).
- How loud she is: check with the phone sound meter app where a visitor would stand, and raise `SPEAKER_VOLUME` until the number stops rising or the sound crackles.
- How well the start and end of speech are found in a noisy room.
- The website's certificate is not checked (test only). That has to be fixed before a head is sold.
