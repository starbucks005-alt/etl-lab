# Robot Alice's hearing, 2026-10-07

Dr. O, 2026-10-07: robot Alice heard her about 15% of the time. The log showed the room had a steady background of about
1100 to 1500 (earlier in the day about 600), her voice peaked at about 2800 to 3400, and the bar she judged speech against
is a multiple of the room, so a louder room left a thin margin.

## What changed

1. **`al-panel/pi/al_bands.py`** (new file, goes next to `al_panel_server.py`). Watches six bands (150, 300, 600, 1200, 2400,
   4000 Hz). Learns how loud each band normally is when nobody is talking. A tenth of a second counts as a **voice pattern**
   when at least two of the upper bands (600 Hz and up) are 7 dB above their own normal and at least 42 dB in absolute
   terms. A steady hum lives in the low bands and never raises the upper ones, however loud it is.
2. **`al_panel_server.py` `hear_one()`** uses it as an ADDITION. The loudness rule is unchanged. Speech now starts on loudness
   OR on a voice pattern (3 of the last 4 tenths of a second), carries on while the voice pattern is present, and the log
   says which one started it: `started by loudness` or `started by voice pattern`.
3. **`mic_device` file** (optional, next to the server). One line such as `plughw:CARD=Speakerphone,DEV=0` makes her listen
   through that device instead of the audio card's own microphones. Delete the file to go back. List devices with
   `arecord -l`.
4. **`mic_meter.py`** takes a device on the command line, and prints a BAND CHECK: how far the voice stands out above the
   room in each band, and how many tenths of a second the voice check fired during the voice and during the quiet.

## Switching things off

- `touch ~/al_panel/no_bands` turns the voice-pattern check off (back to loudness only). `rm ~/al_panel/no_bands` turns it on.
- If `al_bands.py` is missing, she runs on loudness alone, as before.

## Tried and rejected

The speech detector used in web calls (webrtcvad). On a test with a steady hum it called the hum "speech" in every frame, in
all four strictness settings, because a hum has the same repeating pattern as a voice. It would have made her answer to the
hum.

## What was tested, and what was NOT

Tested with a synthetic voice (a pulse train through vowel resonances, with syllable rhythm and pauses) mixed into synthetic
hum and noise, through the real `hear_one()`:

- voice quieter than the room (about -1.6 dB): against a hum, caught 0% with loudness only, 56% with the voice pattern added;
  against hum plus noise, 3% to 31%; against plain noise, 0% either way.
- voice 2 dB or more above the room: caught 100% either way. So the new check only helps where the voice is BELOW the room's
  loudness. If your room is not like that, it changes nothing.
- room only (hum, noise, and both, 60 seconds each, loudness drifting plus four knocks a minute): old and new produced a clip in
  exactly the same windows (1 of 6, 1 of 6, 2 of 6, all from the knocks), so the new check added no false starts.

A synthetic voice is not a real voice. **Not tested: a real voice in the real room.** Run `mic_meter.py` (the BAND CHECK) with a
real voice to see whether the upper bands really stand out in that room.
