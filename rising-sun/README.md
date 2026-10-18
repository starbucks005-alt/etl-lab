# The Rising Sun

An artificial sunrise made of acrylic and LED strips, with a light fairy inside who talks to you. Started 2026-10-18, Dr. O's design.

## What it does
1. At the wake time the strip climbs from dark red to amber to full daylight over about 30 minutes (`sunrise.ino`, on an ESP32-S3 board, no Pi).
2. When the sun is up the fairy greets you. The default one says "Good morning, human." The arrogant one, chosen from the Rising Sun panel, says "Are you ready to basque in my glory?" (`personas.json`).
3. She asks: "Good morning sunshine. Do you want to hear the news, check your calendar, or something else?" (`morning.py`)

## What exists, and what does not
- Built and checked here with a stand-in for the strip and the speaker: the color ramp, the greeting and the three-way choice. Run `python3 test_rising_sun.py`.
- NOT TRIED ON THE REAL BOARD OR LEDS. The color steps are a first guess. Run `python3 sunrise.py` to see them, then look at the real strip and tell Claude what is wrong. `sunrise.ino` holds the same table and the wake time.
- The panel: `rising-sun/index.html`, at emerging-tech-lab.com/rising-sun/ once deployed. Modelled on the Astra-9 Lite panel. Enter the key once. It sets the wake time, sunrise length and time zone, picks the fairy, lets you change a fairy's greeting, question, manner, backstory and voice or make new ones, previews the sunrise, lets you talk to her, and saves your calendar link. Settings are saved by `netlify/functions/sun-settings.js` and read by the brain and by the board.
- Checked: the panel in a real browser against the real handlers with a stand-in store (`node tests/sun-settings.test.js`). NOT tried on the live site or the board.
- NOT BUILT: her voice and her listening on the board itself. With no Pi these go through the website, the way the Holopod page does. `morning.py` is the flow written out so it can be checked; it is the plan for that page, not code that runs on the board.
- News is not connected. She says so out loud.
- Calendar: the link is saved on the website and never shown again, the way AL keeps hers. Nothing reads it yet. AL's calendar reader is Python and has not been ported.
- Her backstory is empty until Dr. O writes it. Anything not written there gets a short "I don't know that one".
- The acrylic and strip layout (how many LEDs, rings or a disc) is not decided, so `LED_COUNT` in `sunrise.ino` is a placeholder.

## The brain is in the cloud (2026-10-18)
Dr. O: "can be a brain in the cloud like the figurines." The board only runs the light, and asks the website what the fairy says.
- `netlify/functions/sun-morning.js` is that brain. `step: "wake"` returns the greeting and the question. `step: "answer"` with `heard` returns her reply. With `audio: true` it also returns her voice as base64 mp3 from Azure.
- Every call needs the header `x-sun-key` to match `SUN_DEVICE_KEY` in the site's settings, because each answer can spend Azure and Anthropic credits. With no key set it answers 503. The key is not in the repository: set it in Netlify and put the same value on the board.
- News and calendar are not connected, and she says so. "Something else" goes to Claude with the fairy's own lines. Her written backstory is empty, so the prompt tells her to say she does not know that one.
- The voices in `personas.json` are placeholders, not chosen and not listened to.
- Checked with stand-ins: `node tests/sun-morning.test.js`. NOT tried against the real services or from the board.
- Still open: how the board hears you and plays her voice. It needs a microphone and a speaker amplifier on the ESP32-S3, and a way to turn mp3 into sound. Until that is built the page route (a tablet) is the way to hear her.

## Parts
ESP32-S3 N16R8 (as in the Holopod box), WS2812B strip, its own 5V supply sized for the strip, a speaker and a microphone for her voice. Wiring is at the top of `sunrise.ino`.
