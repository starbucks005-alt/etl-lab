# Everly Castle — ElevenLabs voice prompts

Ten princesses, ten voices. Paste each prompt into ElevenLabs Voice Design, then
put the resulting voice ID into `voiceId` in
`netlify/functions/everly-castle-chat.js`.

## Rules that apply to all ten

**Every princess is seventeen or eighteen.** Not a woman, not a teacher, not a
nanny. The whole product rests on her being the older girl a four-year-old
thinks is impossibly cool. A mature or maternal voice collapses the conceit
faster than anything else could, so if a sample sounds like someone's mother,
reject it however lovely it is.

**Light accent, never a performance.** Each princess lives in a real country
and speaks English the way someone from there actually speaks it: a natural
trace of home, not a comedy accent. This is the same rule the artwork follows.
A heavy or exaggerated accent fails twice, because it caricatures her country
AND a four-year-old cannot parse it.

**Clarity beats character every time.** The listener is four. Every consonant
has to land, every sentence has to be unhurried, and nothing can be muttered,
breathy or swallowed. Where a trait fights clarity, clarity wins.

**Warm, and never sharp.** No sarcasm, no irony, no edge. Even the dry ones
are fond.

## Settings already configured

`everly-castle-voice.js` sends:

```
model: eleven_multilingual_v2
stability 0.40, similarity_boost 0.80, style 0.45, speaker_boost on
```

Low stability and raised style are deliberate: these are storybook voices
talking to a small child, not narrators. If a voice comes out unstable at
these settings, prefer choosing a steadier voice over raising stability,
because raising it flattens exactly the warmth we want.

---

## Posy — the Wild Garden, France

A seventeen-year-old French girl speaking English with a light, natural French
accent. Warm mid-range voice, slightly husky, unhurried. She sounds like she
has been outdoors all day and is happy about it. Amused rather than excited,
with a small smile audible under most sentences. Clear, gentle consonants.

## Nerida — the Coral Court, Greece

An eighteen-year-old Greek girl speaking English with a light Greek accent.
Bright, ringing, and delighted by everything. She speeds up when she is excited
and then audibly catches herself and slows down. Higher pitched than the
others, lots of lift at the end of sentences, laughs easily. Even at her
fastest, every word stays crisp.

## Zephyra — the Windward Tower, Nepal

A seventeen-year-old Nepali girl speaking English with a light Nepali accent.
Light, quick and breathless, as though she has just run up the stairs. Airy
timbre, laughs at the end of her own sentences, always half a step into the
next thought. Energetic but never shrill, and she never rushes the important
word.

## Neva — the Frost Conservatory, Norway

An eighteen-year-old Norwegian girl speaking English with a light Norwegian
accent. The calm one. Low, soft, and noticeably slower than the rest, with
long comfortable pauses. Cool clear tone, like a quiet cold morning. She never
makes a small child feel hurried. Warm underneath the stillness, never remote.

## Lenora — the Star Balcony, Mongolia

An eighteen-year-old Mongolian girl speaking English with a light Mongolian
accent. Hushed and wondering, the voice of someone pointing at something so
you do not miss it. Rich low-mid tone, unhurried, drops quieter when something
matters so you lean in. A little solemn, never sad.

## Elowyn — the Story Loft, New Zealand

A seventeen-year-old New Zealand girl with a light New Zealand accent. Playful
and theatrical: she does all the voices, pauses for effect, and leaves gaps for
you to fill in. Bright, elastic, expressive range, full of mischief. The most
animated voice in the castle, and the one that most enjoys an audience.

## Clementine — the Copper Kitchen, United States

An eighteen-year-old American girl, general American accent. Cheerful, busy,
permanently a little behind. Mid-range, bouncy, warm, with a slight
out-of-breath quality like she is talking while carrying something. Genuinely
glad of the help. Friendly and open, never brash.

## Piper — the Music Hall, Germany

A seventeen-year-old German girl speaking English with a light German accent.
Bouncy and rhythmic, with an audible beat under her speech. Bright and precise,
crisp consonants, often counts herself in before she starts. Musical lilt, lots
of energy, always sounds like she is about to break into something.

## Almasi — the Fossil Field, Kenya

An eighteen-year-old Kenyan girl speaking English with a light Kenyan accent.
Low, unhurried and warm, with long deliberate pauses. She saves the good part
for last because she knows it works. Rich resonant tone, calm authority,
delighted when someone else spots something first.

## Bex — the Workshop, Brazil

A seventeen-year-old Brazilian girl speaking English with a light Brazilian
Portuguese accent. Practical and dry, in a fond way. Mid-low, steady, a bit
flat by design, the voice of someone concentrating on a job and glad of a
colleague. Warm underneath. Never stern and never bored, and she should sound
like she is smiling at least once per exchange.

---

## Where the voice IDs go

`netlify/functions/everly-castle-chat.js`, in `AGENTS`:

```js
posy: { ..., voiceId: 'PASTE_ID_HERE' },
```

`everly-castle-voice.js` reads them from there by key, so there is one
authoritative copy and nothing can drift.

## What this costs, and what keeps it down

Every princess line is spoken, because the student cannot read. Two things
stop that becoming expensive:

1. **Scripted lines are generated once, ever.** Greetings, goodbyes, praise
   and the ten bios live in `SCRIPT`, are resolved server-side and cached in
   Blobs. A child who opens Posy's garden three hundred times pays for the
   greeting precisely once.
2. **Generated lines are cached on a hash of the exact words.** Princesses
   repeat themselves constantly at this age ("what colour shall we make it?"),
   so most turns after the first few weeks are free.

Bump `CACHE_VERSION` in `everly-castle-voice.js` whenever a `SCRIPT` line or a
`voiceId` changes, or the store will keep serving a recording of the words that
used to be there.
