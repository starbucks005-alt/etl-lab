# Board test for the Waveshare ESP32-S3 AUDIO Board (2026-10-30)

A first program for the round board. It does not use the internet. It checks that the board's chips answer, plays one beep, glows the ring of 7 lights, sees the three keys and reads the battery voltage.

Status: compiled by Claude against the ESP32 Arduino core 3.2.0 (it builds with no errors). NOT run on a board yet. The pins and addresses come from Waveshare's own sample code (see the Rising Sun README).

Loading it ERASES the program that is on the board now (the one that speaks Japanese about Wi-Fi). Waveshare's own demo can be loaded back from their zip, but that Japanese program may not be recoverable. Dr. O decides before anyone loads it.

## Sheet for the person loading it (to be handed over by Dr. O)

Dr. O fills in before handing over:
- The computer to use: ______________
- Arduino IDE already installed: yes / no
- Photo to send back goes to: ______________

Steps, one at a time:
1. Install the Arduino IDE from arduino.cc if it is not on the computer. Open it.
2. Open Boards Manager (the board icon on the left). Search `esp32`. Install "esp32 by Espressif Systems", version **3.2.0** exactly. (Not a newer version.)
3. Open Library Manager (the books icon). Search `Adafruit NeoPixel`. Install it.
4. Open the file `board-test.ino` from this folder. The three files named `es8311` must be in the same folder. **STOP if they are missing. Call Dr. O.**
5. Choose the board: Tools, Board, esp32, "ESP32S3 Dev Module".
6. Set these in the Tools menu exactly:
   - USB CDC On Boot: Enabled
   - Flash Size: 16MB (128Mb)
   - Partition Scheme: 16M Flash (3MB APP/9.9MB FATFS)
   - PSRAM: OPI PSRAM
7. Plug the board into the computer with its USB-C cable. Choose its port in Tools, Port. **STOP if no port appears. Call Dr. O.** (If asked: hold the BOOT button on the board while plugging in the cable, then let go.)
8. Press the Upload button (the right arrow). Wait for "Done uploading". **STOP if there is a red error. Take a photo of the screen and call Dr. O.**
9. Unplug the cable and plug it back in. The ring of lights should glow blue, there should be one short beep, and the lights should breathe slowly.
10. Open Tools, Serial Monitor. Set the speed at the bottom to 115200. Take a photo of what it says.
11. Press each of the three buttons on the board one at a time. Each should beep. Take a photo of the Serial Monitor again.
12. Stop. Do nothing else.

His only report is the photos from steps 10 and 11, and whether there was a beep and a blue glow.

## What the lines it prints mean
- "answers" for the three chips: the board's wiring matches Waveshare's sample.
- "NO ANSWER" for any chip: tell Dr. O which one.
- "Speaker chip start: FAILED" or "Sound output: FAILED": tell Dr. O. The speaker will be silent.
- No beep but everything says ok: the speaker may need a different volume or the amplifier pin may differ. Tell Dr. O.

The beep volume is set low on purpose (`SPEAKER_VOLUME` 55; Waveshare's sample uses 98). The ring brightness is low on purpose (20 of 255).

## Files
- `board-test.ino`: the program.
- `es8311.cpp`, `es8311.h`, `es8311_reg.h`: Espressif's speaker chip driver, copied unchanged from Waveshare's demo (Apache 2.0).
