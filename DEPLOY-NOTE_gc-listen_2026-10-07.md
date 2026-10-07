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

---

# Memory for house characters on the hologram and AR pages (2026-10-07)

Dr. O: "can you make both have memories based on IP browsers like the companions".

`gc-chat.js` has always remembered a visitor for a BUILT friend (one with an `.id`): every 4 turns a cheap model writes
a few notes, stored in `etl_visitor_memories`, keyed by the person (the account token if there is one, else the
browser's visitor id, `etl_visitor_id` in localStorage) and by `agent_key` `gc:<id>`. A house character (Alice, Reggie,
Sophia, Tansy, Arch) has no `.id`, so nothing was ever kept.

- `netlify/functions/_gc-demo-memory.js`: for a character with no `.id`, and only when the request says `remember: true`,
  the key is `gcd:<name>` (Alice is `gcd:a-l-i-c-e`). It cannot collide with a built friend's `gc:` key. Every other caller
  of gc-chat is unchanged.
- `netlify/functions/gc-chat.js`: one line uses it. Memory is read and written exactly as for a built friend.
- `netlify/functions/gc-forget.js`: "Forget me". Deletes this visitor's memories for that character, and only `gcd:` keys,
  so it cannot touch a built friend's memory or anyone else's. The privacy draft promises "You can ask us to delete what
  an agent remembers about you".
- `hologram.html` and `ar.html`: send `remember: true`, show "<name> remembers you in this browser." and a Forget me
  button. `?memory=off` in the address turns it off and hides both, for a shared screen.

## Why the key is the browser, not the IP address

The same visitor id is already how the site recognises a browser. An IP address is shared: a booth on campus Wi-Fi
puts every visitor on one address, so everyone would share one memory and Alice would pass one visitor's words to the
next. The browser id is per device and does not have that problem. A private window gets a new id each time.

## A shared screen, such as the booth

One phone or laptop used by many visitors is ONE browser to the site, so Alice would carry one visitor's words to the
next. For a booth: open the page with `&memory=off`, or press Forget me between visitors, or use a private window and
close it between visitors.

## Not verified

The table `etl_visitor_memories` is defined in Supabase, not in this repository, so I could not check that it accepts a
`gcd:` key. If it has a constraint on `agent_key`, saving fails quietly (the chat carries on) and the log shows
"gc-chat visitor memory insert non-ok". A real conversation of at least 4 turns, then a reload, is the test.
