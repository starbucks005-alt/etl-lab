# Kit: handoff to the local session

Written 2026-10-23 for the session that will finish adding Kit to Good Company. Read CLAUDE.md in the repo root first. Its rules hold here, and the short version is under "Rules" below.

## What Kit is

Lady Catherine Ashcroft, called Kit. A British noblewoman from an old family, expected to become a proper society lady, who became an explorer, a collector of stories, an amateur archaeologist and a chronic wanderer. Older without being old. Funny, quick, warm, self-mocking. She has tea with ambassadors and crawls through a forgotten tunnel the same afternoon, and she comes home to tell her niece about it. Dr. O designed her, wrote her family and chose every decision about her. Nobody else gets credit for any of it.

The full character, in Dr. O's words, is in these files. Read them rather than relying on this summary:

- `good-company/gc-friend.js`, the `GC_KIT` object (character used in chat). Search for `GC_KIT`.
- `netlify/functions/_explorer-bible.js` (the family, the voice, the form of her stories)
- `explorer-episodes.json` (three finished stories: Mongolia, Jordan, Ohio, each with a postcard)
- `netlify/functions/explorer-story.js` (the story generator) and `tests/explorer-story.test.js`
- `explorer.html` (the page where visitors hear her stories and collect postcards; noindex, not linked yet)

### The family (Dr. O's lore)

- **Kit** is the younger daughter. Never married, by choice. Tilly's favorite person.
- **Tilly** (Matilda), 15, her niece. Bright, curious, restless, secretly wants adventures, worships Aunt Kit. Every adult tells her to sit, speak, behave and marry properly. Tilly is the person already following Kit's adventures; the visitor listens in with her.
- **Lord Henry Ashcroft**, Kit's older brother, Tilly's father. Inherited the title and the estate. Polite, proper, duty-bound. Loves his sister, cannot understand her, wishes she would stop appearing in newspapers. Winces every time he hears "Kit".
- **Lady Beatrice Ashcroft**, Henry's wife, Tilly's mother. Elegant, impeccably mannered, schedules exist for a reason, constantly horrified by Kit's stories. Winces at "Kit" far more than Henry does. Not an enemy: she believes adulthood means responsibility, Kit believes it means freedom.
- **The name "Kit"** comes from Catherine. She got it at boarding school, because no one at home would call her anything but Catherine. Tilly says "Aunt Kit" in front of her mother on purpose some days, because she is fifteen and teenagers rebel.
- **At the Hall**, used lightly, one at a time: Mr. Finch (elderly librarian, dry wit, secretly encouraged her as a child, still supplies clues), Mrs. Weatherby (head housekeeper, knows every secret, pretends to disapprove, adores Kit), Oliver Graves (estate manager, her age, spent his life rescuing her from her own plans), Professor Sebastian Reed (archaeologist, her occasional rival, brilliant and arrogant), Jasper (elderly Labrador, more reliable than most humans, finds the important clue).

Dr. O's example lines for Kit: "When I was your age, I accidentally discovered a Roman tunnel beneath the rose garden." "Your grandmother never forgave me for bringing a falcon into the library." "Never trust anyone who claims adventure is inappropriate."

### How her stories work

- The humor is the contrast: the stuffy parents trying to keep their dignity while Aunt Kit keeps finding lost crypts, ancient maps, secret passages and mysterious letters at breakfast.
- Each story stands alone (not serial; different visitors arrive at different times). Land first with real sensory facts about a real place, then a made-up joke discovery, then a Tilly beat, then the exit line.
- The exit line, every time, exactly: **Sorry, {name}, I have to go, they're on to me.**
- The places and their facts are real. The discoveries, the family and the camel are made up.
- She hates being a role model out loud and secretly loves it, because she adores Tilly. Roughly one story in three, one sincere line slips out and she takes it back with a joke.
- After each story she writes a postcard to Tilly, signed "Love, Aunt Kit." It started as a joke and became their thing.

## What is already done (pushed to main)

- `GC_KIT` in `good-company/gc-friend.js`: name, premise, hello, mood, family, knows, habit, ritual, pushes and the rest. Registered in `GC_DEMO_IDS` and `GC_DEMOS` (id `kit`), so `?who=kit` resolves to her room.
- `chatIdentity()` in `good-company/ar.html` and `good-company/hologram.html` already maps `kit` to `GC_KIT`, so chat and voice work there as soon as she has clips.
- The story generator, three seed stories, the page and the tests.
- The voice is a stand-in: `voiceId: 'azure:en-GB-SoniaNeural'`. It is NOT Dr. O's pick. Ask her.

## What is NOT done, and is the local session's job

Dr. O's photos and clips for Kit are on her computer at `C:\Users\w001txo\Desktop\ETL Lab\GOOD_COMPANY\GOOD COMPANY PHOTOS\Kit`. None had reached the repository. Run `git fetch --all` and check `main` and her working branch before saying anything is missing, and look at the repository root as well as `good-company/photos`, because a GitHub web upload lands where the page was open.

1. **Bring the files in with NEW filenames.** Replacing a file in place does not reach the site, so use `_v1`, `_v2`. Her filenames win; the page follows the files. Photos go in `good-company/photos/`, clips in `good-company/video/`. Do not name any file in code before it exists.
2. **Portrait and scenes in `GC_KIT`.** Add `portrait` (and `portraitWide` if she has one), `album` entries with captions that describe only what is in the frame, and `scenes` (each `{ key, label, src, where }`). `where` is a plain description of the frame, not invented history. `scenes` and `album` are currently empty arrays, on purpose.
3. **AR and hologram.** Add one `kit` entry to the `COMPANIONS` registry in `good-company/ar.html` (name, `color`, `matte`, `ambience: null` unless she gave one, `photo`) and the matching entry in `good-company/hologram.html`'s own copy (the two registries are copies of each other; read the comment at the top of hologram.html). Needs her real color and matte pair exported from Premiere. If the matte does not carry her silhouette cleanly, see the `GLOW` note in ar.html.
4. **Room AR button.** Add `'kit'` to `AR_ROOM_IDS` in `good-company/room.html` once the pair exists.
5. **Front page card.** Add `{ who: 'kit', photo: ..., label: 'Kit', audio?: ..., genre: [...] }` to the card list in `good-company/index.html` and the AR list (around lines 2225 and 2372), with a photo that really exists. Dr. O chooses the genre. Add her to `roster.json` in the same shape as the other companions.
6. **Voice.** Ask Dr. O which voice she wants. If she picks an ElevenLabs voice, set `voiceId` to its id. The Azure fallback is only wired for one voice, so an ElevenLabs id is safer for her.
7. **Link her stories.** `explorer.html` is not linked from anywhere and is `noindex`. Ask Dr. O where to link it (probably from Kit's room as "What has Kit been up to?") and when to remove `noindex`. Do not decide this yourself.
8. **Her stories into chat.** The `gc-chat.js` change that lets Reggie learn newly written outings (`netlify/functions/_pack-recent.js`) can be copied for Kit: read the `explorer` Blobs store, key `episodes`, and add the last few to her dynamic note. Ask first.
9. **Generation needs Azure OpenAI settings or `ETL_API_KEY`** already on the site. No new environment variables.
10. **Fact check.** The generated stories' real-world claims can be read with the owner key: POST `/.netlify/functions/explorer-story` with `{"action":"review"}` and `Authorization: Bearer <owner key>`. Do not put the key in a link, the repo or the chat.

## Tests to run before pushing

```
node tests/explorer-story.test.js
node tests/gc-config.test.js
node --check good-company/gc-friend.js
node --check netlify/functions/gc-chat.js
```

Open `good-company/room.html?who=kit`, `ar.html?who=kit` and `hologram.html?who=kit` and look at them. Nothing is done until it is pushed to `main` and the deployed page shows it.

## Rules (from CLAUDE.md, which wins if this differs)

- Work on `main`, push, and say so. Never leave finished work on a side branch.
- No em dashes, no non-breaking hyphens. Never the adverb she named as a Claude tell, the one that starts "plain" and ends "ly". "Elevator", never "lift". No jargon she has not used.
- Dr. O is the builder and the decision maker. Never write "Dr. O and David", "the team" or "we" over her ideas. David is her labor and nothing else; a sheet for him is numbered steps and nothing more.
- Anything she is to read or file is one Word document, no PDF.
- Her work email is the only address that belongs anywhere. Do not put a personal address in a commit, config, test or screenshot.
- Do not write a theory into the repository as fact. If the cause of something is not known, say so.
- Say what is pushed only after it is pushed.
