# Astra-9 Lite and the characters: memory, mood and what else changed, 2026-10-08

Dr. O, 2026-10-08: someone at the event asked why not just ask ChatGPT. *"We have to make sure each personality, especially Astra-9 Lite,
has memory and emotion. Almost human."*

## What each character has now (all on the Pi, none of it tried on the real robot yet)

1. **Memory for every character, Astra-9 Lite herself too.** Short notes in her own words, written after every fourth exchange, kept in
   `~/al_panel/memory_<character>.json` (Astra is `memory_astra.json`), never sent to the website, never mixed with the website's Alice.
   Each character keeps her own file. The panel's Forget buttons clear one character's notes. `touch ~/al_panel/no_memory` turns all of it off.
   She cannot tell visitors apart (she hears voices), so the notes are about what was talked about, not about named people.
2. **A mood that moves.** `moods.json` holds a ladder of moods for Astra, Tansy and A.L.I.C.E., written from their own files. Every other
   character gets a general ladder built around the mood and habit in her own file. The mood climbs with a laugh, a kind word and time,
   falls back with a brush-off, a repeated question or a long silence, and always has a reason. At the top she falls back a step, in character.
   The log prints `MOOD ...` lines. Delete `moods.json` for the general ladder only.
3. **Private characters.** `personalities_private.json` next to the server, kept out of git (the repository is public), shows in the panel
   under Private. David Ellis's Echo is the first.

## Earlier today, same release

Listen now button, Crowd mode, a watchdog for a stuck microphone read, waiting for the microphone after the welcome, a curious Astra (a
question after the hello and after her answers), the lab and her family written into her instructions from `roster.json` and
`gc-friend.js`, a clearer spoken address.

## What is NOT known

- Whether the moods feel right on the real robot. The stages are drafts for Dr. O to change.
- How the moods and the notes feel together over a whole event. The first real test is the one that matters.
- Memory notes are written by a second call to the model, so they cost a little speech credit and a little time in the background.

## Why not just ask ChatGPT

Not written as a claim about other products. What these have that a chat window does not: a body in the room, a voice, a written life that
stays the same, a mood with a reason, and notes she keeps from one visit to the next.
