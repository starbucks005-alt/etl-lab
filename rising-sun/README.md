# The Rising Sun

An artificial sunrise made of acrylic and LED strips, with a light fairy inside who talks to you. Started 2026-10-18, Dr. O's design.

## What it does
1. At the wake time the strip climbs from dark red to amber to full daylight over about 30 minutes (`sunrise.ino`, on an ESP32-S3 board, no Pi).
2. When the sun is up the fairy greets you: "Good morning, human." (`personas.json`). One fairy for now (Dr. O, 2026-10-18: keep it simple, build up as interest happens). Her voice is an ElevenLabs voice id that Dr. O picks and pastes on the panel. Until she does, she shows words and makes no sound. The code can still hold more fairies later.
3. She asks: "Good morning sunshine. Do you want to hear the news, check your calendar, or something else?" (`morning.py`)

## What exists, and what does not
- Built and checked here with a stand-in for the strip and the speaker: the color ramp, the greeting and the three-way choice. Run `python3 test_rising_sun.py`.
- NOT TRIED ON THE REAL BOARD OR LEDS. The color steps are a first guess. Run `python3 sunrise.py` to see them, then look at the real strip and tell Claude what is wrong. `sunrise.ino` holds the same table and the wake time.
- The panel: `rising-sun/index.html`, at emerging-tech-lab.com/rising-sun/ once deployed. Modelled on the Astra-9 Lite panel. Enter the key once. It sets the wake time, sunrise length and time zone, picks the fairy, lets you change a fairy's greeting, question, manner, backstory and voice or make new ones, previews the sunrise, lets you talk to her, and saves your calendar link. Settings are saved by `netlify/functions/sun-settings.js` and read by the brain and by the board.
- Checked: the panel in a real browser against the real handlers with a stand-in store (`node tests/sun-settings.test.js`). NOT tried on the live site or the board.
- NOT BUILT: her voice and her listening on the board itself. With no Pi these go through the website, the way the Holopod page does. `morning.py` is the flow written out so it can be checked; it is the plan for that page, not code that runs on the board.
- The news is Above the Fold from ETL Newswire (Dr. O, 2026-10-18). Asked for the news, she says one line and the brain returns the recorded briefing's address, its headlines and its length; the panel and the board play the briefing itself. If today's has not come out she says so and offers the last one. Read from `newswire_briefings_meta/latest`, the same record the home page player uses. Checked with stand-ins only; not tried against the live record.
- Calendar: the link is saved on the website and never shown again, the way AL keeps hers. Nothing reads it yet. AL's calendar reader is Python and has not been ported.
- Her backstory is empty until Dr. O writes it. Anything not written there gets a short "I don't know that one".
- The acrylic and strip layout (how many LEDs, rings or a disc) is not decided, so `LED_COUNT` in `sunrise.ino` is a placeholder.

## The brain is in the cloud (2026-10-18)
Dr. O: "can be a brain in the cloud like the figurines." The board only runs the light, and asks the website what the fairy says.
- `netlify/functions/sun-morning.js` is that brain. `step: "wake"` returns the greeting and the question. `step: "answer"` with `heard` returns her reply. With `audio: true` it also returns her voice as base64 mp3 from Azure.
- Every call needs the header `x-sun-key` to match `SUN_DEVICE_KEY`, the one new environment variable, because each answer can spend Azure and Anthropic credits. With no key set it answers 503. The key is not in the repository: set it in Netlify and put the same value on the board.
- The calendar is not connected, and she says so. The news plays Above the Fold. "Something else" goes to Claude with the fairy's own lines. Her written backstory is empty, so the prompt tells her to say she does not know that one.
- Her voice: ElevenLabs, with the key the site already has (`_eleven.js`, the same call `gc-voice.js` makes). Not chosen yet, and not tried against the real service.
- Credits (Dr. O, 2026-10-18: use the AWS and Azure startup credits when possible): her voice is Azure, so the Azure credits pay (the site's existing Azure key, read the way gc-voice reads it). Her thinking tries Claude on Amazon Bedrock first, so the AWS credits pay (`_bedrock.js`), and falls back to Anthropic's own API (the key the site already has). The Bedrock key is pasted once on the panel's Connections card and kept in the sun's private record, because the site is at its limit of environment variables. The only new environment variable is `SUN_DEVICE_KEY`. The Bedrock model id and the account's access to the model are not checked: make one call and see.
- Her settings sit in Netlify's own small store, which is free at this size. Moving them to Azure Storage would count toward the Azure milestone only if that workload needs the spend, which is not worth doing for one small record.
- Checked with stand-ins: `node tests/sun-morning.test.js`. NOT tried against the real services or from the board.
- Still open: how the board hears you and plays her voice. It needs a microphone and a speaker amplifier on the ESP32-S3, and a way to turn mp3 into sound. Until that is built the page route (a tablet) is the way to hear her.

## Music (Dr. O, 2026-10-18)
- The panel plays Apple Music with Apple's web player (MusicKit JS). The listener signs in with their own Apple Music subscription, so ETL pays nothing for the music. Without a subscription only short previews play. It plays on the device that has the panel open, such as a tablet beside the sun. A browser needs a tap first, so music cannot start by itself at wake time.
- Setup: the Team ID, the Key ID and the private key (.p8) from Dr. O's Apple developer account, pasted once under Connections. They are kept in the sun's private record and never shown again. `netlify/functions/sun-music-token.js` signs a short-lived token with them (`_apple.js`, Node's own crypto, no new packages and no new environment variable). The sheet "Rising-Sun_Apple-Music-Key" says how to make the key.
- Checked: the signing against a key made for the test, and the player in a real browser against a stand-in for MusicKit (`node tests/sun-apple.test.js`). NOT tried against Apple. Whether Apple accepts the token depends on the real key and its Media ID.
- Spotify (Dr. O, 2026-10-18): the panel signs in with Spotify's PKCE flow, so no secret exists anywhere; only the public Client ID is saved (`spotify.js`, `tests/sun-spotify.test.js`). The listener needs Premium. The panel can play on itself in a computer browser (Spotify's web player; from memory it does not run in phone or tablet browsers) or act as a remote for any other Spotify device, so a phone works. The tokens stay in the signing-in browser. A new Spotify app is in development mode, where only people added by hand can sign in, and from memory the limit is small and wider access is hard to get, so check Spotify's current rules before selling it. The sheet is "Rising-Sun_Spotify-App". NOT tried against Spotify; the stand-in test covers sign-in, devices, search, play, pause, next and playlists.
- Not built: music coming out of the sun's own speaker (it could appear as a Spotify device later). Amazon Music has no open player that I know of.

## Parts
ESP32-S3 N16R8 (as in the Holopod box), WS2812B strip, its own 5V supply sized for the strip, a speaker and a microphone for her voice. Wiring is at the top of `sunrise.ino`.
