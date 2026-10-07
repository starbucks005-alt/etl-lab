# gc-listen: the site's own ears for the hologram and AR pages (2026-10-07)

Dr. O asked for an always-on microphone for the hologram (Alice) and AR pages, to use with a speakerphone. The first
version used the browser's own speech recognition. On an Android phone or tablet that plays the system "listening"
chime every time it starts, which with always-on is a constant beep, and a page cannot turn it off.

This adds a way to listen that does not use the browser's speech recognition, so there is no chime, and it also works
on iPhones and Firefox, which have no browser speech recognition.

## What it is

- `netlify/functions/gc-listen.js`: takes one short recording (16 kHz mono WAV), sends it to ElevenLabs speech-to-text
  (Scribe), returns `{ text }`. A GET returns `{ enabled }` so a page knows which way to listen.
- `good-company/gc-handsfree.js`: the pages' microphone helper. With the endpoint switched on it records the microphone
  itself, decides when someone is speaking (a bar that follows the room, judged on the average of three tenths of a
  second), and sends each sentence. With the endpoint off it uses the browser's listening, exactly as before.
- `good-company/hologram.html` and `good-company/ar.html`: a "Mic: tap to talk / always on" switch and a status line.

## It is OFF until you switch it on

`GC_LISTEN_ENABLED` must be `1` in the Netlify environment. Anything else, or not set at all, and every call answers
`listening_off`; the pages quietly keep using the browser's own listening.

1. Netlify, Site configuration, Environment variables, add `GC_LISTEN_ENABLED` with the value `1`.
2. Trigger a new deploy (functions read the variable when they are deployed).
3. To switch it off again: change it to `0` (or delete it) and deploy again.

`ELEVENLABS_API_KEY` is already set for gc-voice and is the same key used here.

## Who pays, and the limits

- The owner key, the tester key and a lab key are recognised the same way gc-voice recognises them, and are free here.
  (The hologram and AR pages do not load gc-lab-key.js today, so a lab key is not sent from them yet.)
- Everyone else: 100 sentences a day per visitor and 300 a day per address (the `gc_listen_usage` store), checked
  before ElevenLabs is called and counted only after it succeeds. With neither a visitor id nor an address to count
  against, there is no free listening.
- One recording is limited to about 15 seconds and 500 KB.
- ElevenLabs lists Scribe at about $0.22 an hour of audio on its API price list (checked 2026-10-07). A three second
  sentence is about a fiftieth of a cent. Whether it counts in dollars or in subscription credits depends on the
  plan: check the ElevenLabs usage page after the first test.

## Trying it

`good-company/hologram.html?who=alice&mic=on` turns the switch on for that browser. `&listen=site` or `&listen=browser`
forces one way of listening, for testing. The line next to the switch says what the microphone is doing.

## What was tested

Browser tests with a pretend microphone playing a recording (speech, a click, 14 seconds of steady noise, more speech):
two sentences sent, the click ignored, the steady noise not sent as speech, the sentence after it heard, valid WAV
files, the guard while the character is talking, the fall back to the browser's listening when the endpoint is off or
says it is off, and the daily cap. The endpoint's rules were tested with stand-ins for its helpers. **Not tested:** a real
Android phone or tablet, a real speakerphone, and a real ElevenLabs call from this endpoint.
