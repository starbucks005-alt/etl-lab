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

## Waking the box by the companion's name (2026-10-31)

Dr. O: "give the companion box the voice recognition for the companions the robots have", then "the first one, name of whoever is in the box". The robots wake when they hear their own name (it is picked out of what speech to text writes, with its common misspellings). The box does it differently so no sound leaves the box until the name is heard: the chip's command mode listens for the name itself ("Tansy", "Hey Tansy", "Hello Tansy"), with no wake word. In `box-lines.json` each companion has a `wake` entry: her name and `phoneme`, how the chip hears it. The panel's Listening card switches a box between Hi ESP (the default) and the companion's name. The chip's own library code was read to confirm command mode runs without a wake word.

NOT tried. The sound spellings were written by hand from standard pronunciations and the examples in the library's header, not made with Espressif's tool, so the chip may not recognise a name until its spelling is adjusted. If she does not answer to her name, switch the box back to Hi ESP on the panel. Other things to watch: whether the chip hears the name from across a room, and whether ordinary talk sets it off by mistake.

## Verified on the board (2026-10-31)

Dr. O reported that the conversation continued after the wake word: she did not have to say it again for the next sentence. Still not tried on the board: waking by the companion's name, Story time, Gardenscape, Meera's Breathing, chat mode with two boxes, the battery and charging line on the panel, and the make-box script.

## Verified on the board (2026-11-01)

Dr. O said "Hi ALICE" with the box set to wake by the companion's name, and it woke. The sound spelling for Alice (`aLcS`) was written by hand and is the first one tried on the real chip; "Hi Alice" worked although only "Alice", "Hey Alice" and "Hello Alice" were taught. Not yet tried: the spellings for Tansy, Meera, Marcus and Reggie, how far away it hears the name, and whether ordinary talk sets it off by mistake.

## Music and Soundscape (2026-11-01)

Dr. O: music and sound are one list, called "Music and Soundscape". The panel has one button for the next scene in turn, and a list to pick one. Scenes are in `rising-sun/box-lines.json` for every companion.
- **Generated** scenes (jungle, waterfall, rain, night woods) have a description and are made once on the website.
- **kind "sound" files** (campfire, creek, gentle rain, medieval Irish tavern, mountain flute, nature, party with happy people, sunny beach waves, Tibetan singing bowl, winter holiday): Dr. O made these in ElevenLabs on her paid plan, 30 seconds each. They are 8 bit mu-law at 16 kHz in `rising-sun/box-sounds`, made into seamless loops at an even loudness by `rising-sun/tools/make-sound.py --loop`. The box loads one whole, and repeats it.
- **kind "music" files** (library, rooftop, fire escape): from the party music in `good-company/audio` (Dr. O owns it), 6 minutes, about 5.5 MB each. The box streams one through a large buffer and plays it once.
The decoding of the 8 bit format on the box was checked against a reference tool: the samples are identical. NOT tried on the board: the streaming, the loading, and how any of it sounds on the speaker (16 kHz mono through a small speaker will sound small).

## Stories, the library and the episodes (2026-11-01)

Dr. O: Tansy, Kit and Reggie all have stories, or have them coming, and a user can set them up to play in their companion box. She asked for the library to pop up, and for the user to see which episode they are on.

- The panel's story button opens the story library. It lists every serial in `good-company/stories.json` (the Good Company library, told as numbered episodes), not only the companion in the box, because any of them can be set up in any box. "Set this up in this box" picks the serial for that box.
- Each episode shows its number, title, minutes, and "recorded" or "recording soon". A tap on an episode marks where the listener is up to ("You are here"; earlier ones say "Heard", later ones "Next"). The line under the Talk buttons says the same: serial, episode number of how many, and its title.
- Kept per box in `box-control` (`set_story`, `set_episode`); the panel gets it in each companion's `library`. Checked by `tests/box-story-library.test.js`.
- NOT built: playing an episode from the box. No episode is recorded yet (every `file` in `stories.json` is empty), and the box program has no episode player. The marker moves only when she taps an episode. The button that plays today's story fragments (Tansy's `hs-` lines) is still inside the library as "Tell the box: Story time".
- Kit (Explorer Kit: Postcards) has a serial in the library but is not yet a companion the box can be set to, so her serial can be set up but her voice is not in the box. NOT tried on the live site or the board.

## Kit is in the box (2026-11-01)

Dr. O: "add Kit to the box". Kit (Lady Catherine Ashcroft) is now one of the companions the panel can put in a box, with her story serial, her lid picture (`box-faces/kit_v1.jpg`) and the sounds and music list the others have.

- Her written life in `box-lines.json` is copied word for word from `GC_KIT` in `good-company/gc-friend.js` (Dr. O's lore: Tilly, Lord Henry, Lady Beatrice, the people at the Hall, the boss in-joke, the postcard ritual, the limits). Anything not written there gets "I don't know that one". Her two fixed lines ("say that again" and "enough for today") are new short wording in her manner, not lore: change them if they are wrong.
- Her voice is the Azure voice Dr. O picked for her (Ada, British, HD). The box asks Azure for raw 16 kHz sound, the same shape the ElevenLabs voices give. The Azure key is read the way the website reads it. NOT tried against the real Azure service. If it fails she is silent: she has no ElevenLabs voice to fall back on.
- Her wake name is "Kit", spelled for the chip as `KcT`, worked out by hand from the letters in the other names (Alice `aLcS`, Reggie `Rfqm`). NOT tried on the board. A name this short may be heard poorly; Hi ESP is the safe way to wake her until it is tried.
- The box has no episodes to play for her yet, same as the others. Checked by `tests/box-kit.test.js`.

## Pictures for the scenes (2026-11-01)

Dr. O sent pictures for the scenes. The first five reached this session through the chat and are in `rising-sun/box-vibes/` as `campfire_v1`, `creek_v1`, `gentle-rain_v1`, `medieval-irish-tavern_v1` and `mountain-flute_v1` (960 wide). They show on the panel when that scene is picked, in place of the drawn animation. She named her own files like the sounds (`campfire_30.jpg`, `creek_30.jpg`, `gentle_rain_30.jpg`, `medieval_irish_tavern_30.jpg`, `mountain_flute_30.jpg`, `nature_30.jpg`, `party_happy_people_30.jpg`, `sunny_beach_waves_30.jpg`, `tibetan_singing_bowl-15.jpg`, `winter_holiday.jpg`). The other five (nature, party with happy people, sunny beach waves, Tibetan singing bowl, winter holiday) arrived in a second message and are `nature_v1`, `party-happy-people_v1`, `sunny-beach-waves_v1`, `tibetan-singing-bowl_v1` and `winter-holiday_v1`. All ten are in. They came through the chat, not from her uploaded files, so they have my names, not her `_30` names. Scenes still drawn rather than pictured: the generated ones (jungle, waterfall, rain, night woods) and the three music tracks, which already have photographs.

## Jungle, Waterfall, Rain and Night woods removed (2026-11-01)

Dr. O: "delete Jungle, Waterfall, Rain and Night woods". The four generated scenes are gone from every companion in `box-lines.json`, so each now has 13: ten sounds and three music tracks. The notes above that name them (the Gardenscape line and the Generated scenes bullet) describe how it was before. The unused Tansy intro lines for them sit only in `box-lines-DRAFT-tansy.json`, which is not live. The code that can make a scene from a description is still there; nothing uses it now.

## Fixed lines were always Tansy's (2026-11-01)

Dr. O heard Tansy from a box that had A.L.I.C.E. in it ("Tansy is STILL on too"). Found in `netlify/functions/box-talk.js`: the two fixed lines ("say that again" when nothing is heard, "enough for today" at the daily limit) were read from Tansy's entry for every companion, so any quiet turn, and a follow-up turn with nobody speaking is one, came out in Tansy's voice. They now use the companion in the box (`tests/box-talk.test.js`). This is one cause found in the code. Whether it is the only one on the board is not known: if Tansy is still heard after this is on the site, the Serial Monitor lines from that moment are what would settle it.

## Recording the episodes on the site (2026-11-01)

Dr. O: make the episodes in Reggie, Biscuit and Mochi's voices. The site's environment variables are full, so no new key can be added, and the ElevenLabs key already on the site is used. Nothing has to be pasted anywhere: the key stays on the site. (Dr. O pointed to a key file on her own computer. This session cannot open files there and does not need to.)

- `netlify/functions/story-record-background.js` voices one written story (from `pack-episodes.json`) beat by beat, Reggie, Biscuit and Mochi each in their own voice, joins the pieces, and keeps the mp3 in the site's store (Netlify Blobs, `box_stories`), not in the repository. It runs for up to 15 minutes in the background. It will not record a story that already exists unless asked again (then it keeps the old one and makes `_v2`), and will not start one that is already running.
- `netlify/functions/story-audio.js` reports what is recorded and plays it back.
- `netlify/functions/_story-plan.js` is how a story is split into voiced parts. `tools/record-pack-stories.js` now uses it too, so the two never read a story differently.
- On the panel, in the story library, each of the six Reggie, Biscuit and Mochi episodes has a button: Record (tap twice, because a recording spends a little ElevenLabs credit; the tool guides about $0.36 for all six, a guide and not a quote), then "Recording 3 of 19", then Listen.
- Only the three dogs are done this way so far. Tansy's Human Summer (fragments) and Kit's stories (an Azure voice) are not. Episode 7, Reggie's tennis ball, has no written story in `pack-episodes.json`, so it has nothing to record.
- NOT TRIED against the real ElevenLabs service or the live site. The pieces are joined end to end with no added pause, and the sound is 64 kbps mp3 so a five minute story fits in what a function may send back. Nobody has heard these voices read a story. The box still cannot play an episode: that needs a player in the box program.

## The music pause, build 2026-11-01i (2026-11-01)

Dr. O: "the music is still doing the 6 second gap", and the song is 6 minutes. In build h one loop did the downloading, the playing and the panel check. The panel check, every 15 seconds, opens a new secure connection to the website, and while it waits nothing is played, however much sound is buffered. A check that takes about six seconds would be a six second silence. That fits what Dr. O hears, but it is a reading of the code, not something measured on the board.

- Build i plays the music from its own task, fed from the buffer, so the loop can wait on the network without stopping the sound. The buffer holds up to about 110 seconds.
- The box now prints what happened, so it can be read and not only heard: `Panel check took N ms`, `Music stall: the sound waited N ms at S seconds in` (up to five, for any wait over a quarter of a second), and at the end `Music played N seconds, N stalls over a quarter of a second, longest N ms`.
- If stalls still show, the cause is not only the panel check. An earlier try with a background panel check on the sound loops also made gaps, so the network work itself may be starving something. Those printed lines would say.
- Compiles (1,422,450 bytes). NOT TRIED on the board. The sound loops (campfire and the others) still play as before; only the music tracks changed.

## Two boards under one name, build 2026-11-01j (2026-11-01)

Odd things were reported that one board does not explain: Tansy "still on" after Reggie was picked, ALICE answering after Reggie was picked, and a pushed button that never arrived. If two boards check in under the same box name (both `main`), each press is taken by whichever asks first, and neither knows about the other. This is a suspicion, not something found.

- Build j sends the board's own short id with every check-in (`deviceId()`, from the chip) and prints `This board is XXXXXX, box name "main"` at start-up.
- The website remembers which ids checked in under a name in the last 90 seconds. The panel shows a line under the status when more than one does: "N boards are checking in under the name main (...). Each press goes to only one of them." A board running an older program shows as `old`.
- Compiles (1,423,918 bytes). NOT TRIED on the board.

## The music did not start, build 2026-11-01k (2026-11-01)

After build i, Dr. O pressed Library: the panel said "The box has it. Library (music) is starting", and two minutes later "Box not heard for 2 minutes (it may be off)". So the box took the press and then went silent, or restarted. The cause is not known. The Serial Monitor was not captured for it, so the lines that would settle it are missing. The battery read 3.83 V "running on the battery" at the time, which is a guess from voltage and may or may not matter.

Build k changes only what could be a mistake in build i and what would show it:
- The sound task's work area is not on its small stack any more (the stack is also 12 KB, up from 6 KB). A task that runs out of stack stops the whole box.
- The box prints `Music: filling the buffer, N of 160000 bytes` every two seconds while it waits to start, then `Music sound task: started` (or `COULD NOT START`), then `Music: playing`.
- The next lines to read: `Music stall`, `Panel check took`, and the last line with the stall count. Whether any of that is the real fault is not known.
- Compiles (1,424,130 bytes). NOT TRIED on the board.

## What the music files hold, and build 2026-11-01l (2026-11-01)

Dr. O: music started on build k, "gaps still there", then "music stopped at the gap". Checked from the files, with no listening: the three tracks are 360 seconds each, and none has a silent stretch of more than 1.1 seconds in the middle (library has 1.1 s at 4.9 s; rooftop opens with 2.4 s of quiet and fire escape with 0.5 s). Each ends in quiet: library from 353.9 s (6.1 s of it), rooftop from 356.9 s (3.1 s), fire escape from 356.4 s (3.6 s). So a six second silence in the middle is not in the files. A silence at the very end is, and the track then finishes by itself. Which one Dr. O heard is not known: the last Serial line (`Music played N seconds, N stalls ...`) would say, because a track that plays to the end reports about 354 to 360 seconds, and one that was cut short reports fewer.

Build l is build k with the sound task's work area back on its own stack (a static array raised the memory the wake word engine needs at start-up and may have delayed the start-up), and a `Free memory` line at start-up. Compiles. NOT TRIED on the board.

## Build 2026-11-01m, written but held back (2026-11-01)

Dr. O reported the six second gap on every sound and every song, then "music stopped at the gap", then "tried a different song, nothing", then, after she put it back to Library, "it played again" and "no gap". Build k was the one on the board. What changed between the gaps and "no gap" is not known.

Build m is written and compiles (1,427,402 bytes) but is NOT TRIED on the board and Dr. O is not being asked to upload it unless the gap comes back. It adds:
- The box sends how long it has been running (`up`) and why it last started (`boot`: power on, reset button, crash, brownout, watchdog). The panel shows it in words under the status line. A box that restarts in the middle of a sound would show a short running time there. That is the idea behind it: a six second gap for every sound is about the length of a restart, and this would show it without listening.
- The box sends how the last track ended and how many stalls it had, and the panel shows it ("Last music: played 354 s, 0 stalls, ended because the track finished").
- The music is downloaded whole into the extra memory first and the connection is closed, then played from memory, so a panel check later does not need a second secure connection open at the same time. This is a change of method and the part least tried.
The website and panel parts are live and harmless without it: they show nothing until a box sends the new information.

## Result on the board (2026-11-01)

Dr. O, on build k: Library played again with no gap, and Rooftop played with no gap. Earlier the gap was reported on every sound and song, and a different song once did not start. What fixed it is not known: it could be the music playing from its own task (build i onward), the bigger stack, the rest of the changes, or something about power or the network that day. More tries are the way to find out. Not yet tried since: Fire escape and the sound loops (campfire and the others) on build k. Build m is held back, for the case where the gap returns.

## Fire escape is a sound, not music (2026-11-01)

Dr. O: Fire escape is just city noises, so it is listed under Sounds and its name is "Fire escape" (no "(music)"). It is still the long file the box plays through once (six minutes), because it is too big to be loaded whole and repeated the way the short sounds are. A scene may carry `group` in `box-lines.json` to say which list the panel puts it in; without one it follows `kind`. Dr. O reports no gaps on it either (build k).

## The gap is at the end of each loop, build 2026-11-01n (2026-11-01)

Dr. O: the gap is the end of the loop. The music is six minutes and she did not listen to all of it, so she never reached a gap there; the sounds are 30 seconds each, so she hears the gap every time one ends. That is what the code does. At the end of every pass of a sound the box stopped playing, asked the website whether a button was pushed on the panel (a new secure connection, a few seconds), and only then started the loop again. Those seconds are the gap. Earlier fixes moved or thinned out the checks but never took them off the player.

Build n plays each sound loop from its own task that goes round and round and never waits for the network, and the panel check happens every ten seconds on the side. The music already worked this way from build i, and its check was every 15 seconds, so a gap there would have been later than Dr. O listened for.
- Serial lines: `Sound loop task: started`, `Panel check took N ms`.
- Build n is build k's music (it played with no gaps for Dr. O) plus the sound loop task plus the reporting from build m (the running time, why it last started, how a track ended, shown on the panel). The method of downloading the whole track first is written but switched off.
- Compiles (1,426,514 bytes). NOT TRIED on the board.

## Four six minute tracks (2026-11-01)

Dr. O made four six minute tracks and sent them (`Creekside_Fable_6_min`, `Mist_and_Heather_6_min`, `Sunlit_Shoreline_6_min`, `Winter_Hearth_6_min`), as a fallback in case the end-of-loop gap on the 30 second sounds did not go away: a six minute track plays once, so there is no loop end to hear. They are converted the same way as the music (`tools/make-sound.py`, 16 kHz, 8 bit, 5.76 MB each, levelled) as `creekside-fable_v1.ulaw`, `mist-and-heather_v1.ulaw`, `sunlit-shoreline_v1.ulaw` and `winter-hearth_v1.ulaw` in `rising-sun/box-sounds/`, and added to every companion as scenes (`kind` music so the box streams them once, `group` sound so the panel lists them under Sounds). They have no photograph yet, so they show a drawn animation: ripples, fireflies, waves and embers. Dr. O can send pictures. NOT heard or tried on the board.
