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
