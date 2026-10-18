# The Rising Sun

An artificial sunrise made of acrylic and LED strips, with a light fairy inside who talks to you. Started 2026-10-18, Dr. O's design.

## What it does
1. At the wake time the strip climbs from dark red to amber to full daylight over about 30 minutes (`sunrise.py`).
2. When the sun is up the fairy greets you. The default one says "Good morning, human." The arrogant one, chosen from the Rising Sun panel, says "Are you ready to basque in my glory?" (`personas.json`).
3. She asks: "Good morning sunshine. Do you want to hear the news, check your calendar, or something else?" (`morning.py`)

## What exists, and what does not
- Built and checked here with a stand-in for the strip and the speaker: the color ramp, the greeting and the three-way choice. Run `python3 test_rising_sun.py`.
- NOT TRIED ON REAL LEDS. The color steps are a first guess. Run `python3 sunrise.py --dry-run` to see them, then look at the real strip and tell Claude what is wrong.
- NOT BUILT: her voice and her listening (reuse `azure_speak` and `azure_transcribe` from `al-panel/pi/al_panel_server.py`), the Rising Sun panel page, the wake time setting, and the "something else" answer.
- News is not connected. She says so out loud.
- Calendar: copy `al-panel/pi/al_calendar.py` next to these files. It is the same read-only feed Auggie and AL use.
- Her backstory is empty until Dr. O writes it. Anything not written there gets a short "I don't know that one".
- The acrylic and strip layout (how many LEDs, rings or a disc) is not decided, so `LED_COUNT` in `sunrise.py` is a placeholder.

## Parts to settle with the Holopod and Astra 9 Lite builds
Pi, LED strip (WS2812B type, same as AL's eye rings), a 5V supply sized for the strip, and a speaker and microphone. The strip's data pin is GPIO18, which shares the Pi's own audio, so the sound has to come from USB or a HAT like AL's.
