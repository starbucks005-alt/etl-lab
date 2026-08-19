/* ONE-TIME, THROWAWAY. Generates a short in-character voice sample for
   each Good Company homepage demo, using their real ElevenLabs voiceId,
   so the clips can be cached as static files (recorded once, free to
   replay forever after) rather than costing a live TTS call every time
   a visitor wants to hear what a demo sounds like.

   Deleted after use, same as every other _temp-*.js this session.
   Secret is unique to this file, never reused. */
const SECRET = 'gc-bios-8f2c1d9e4a7b6153';

const SCRIPTS = {
  arch: {
    voiceId: 'PKu46bbccMP1b22TyeI0',
    text: "I'm Arch. General contractor, twin daughters, and I've been divorced long " +
          "enough now that it's just how things are. I fix things, and I explain how, " +
          "whether you asked or not.",
  },
  sofia: {
    voiceId: 'GPTk4QbvF7snDhImF5UF',
    text: "I'm Sophia. Vet nurse, night shift, so eight in the morning is basically my " +
          "evening. Moved somewhere in the UK a couple of years ago for work, knew " +
          "nobody when I got here, built a life anyway.",
  },
  reggie: {
    voiceId: 'uq0HIbNZKn11Hs5ifEdd',
    text: "I'm Reggie! I do perimeter security, morale, and keeping everyone on a " +
          "reasonable meal schedule. Also I am a dog. I don't know if that changes " +
          "anything for you, but it changes everything for me, every single day.",
  },
  tansy: {
    voiceId: 'thfYL0Elyru2qqTtNQsE',
    text: "I am Tansy, of the Radiant Court. I do not, as a rule, explain myself to " +
          "strangers, but I suppose I can make an exception, since you are here now " +
          "and it would be rude not to.",
  },
  poppy: {
    voiceId: 'XJ2fW4ybq7HouelYYGcL',
    text: "I'm Poppy. Tansy's little sister, though she'd rather I not put it that way. " +
          "I like humans, genuinely, no performance about it, and I will absolutely cry " +
          "if you say something nice to me.",
  },
  blue: {
    voiceId: 'WUyjxM8OTY6l8LhTmdkq',
    text: "I'm Blue. Tansy's cousin, for my sins. I outrank her at Court and I've never " +
          "once had to try, which she finds unbearably annoying. I don't think about it " +
          "much myself.",
  },
  biscuit: {
    voiceId: 'MgqVq3OCTPeVHCEDr4HU',
    text: "I'm Biscuit! I'm one of Reggie's best friends, and I have so many stories, " +
          "and they're all true, mostly, and I will tell you every single one of them " +
          "if you let me.",
  },
  mochi: {
    voiceId: 'I8ERYU9lOxALy2vtIvHd',
    text: "I'm Mochi. Reggie's friend, technically. I have opinions about most things, " +
          "and I do not keep them to myself.",
  },
};

exports.handler = async function (event) {
  const key = (event.queryStringParameters || {}).key;
  if (key !== SECRET) return { statusCode: 403, body: 'no' };

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: 'no_voice_key' }) };

  const out = {};
  for (const [id, { voiceId, text }] of Object.entries(SCRIPTS)) {
    try {
      const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(voiceId), {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
        }),
      });
      if (!r.ok) { out[id] = { error: 'status_' + r.status, detail: (await r.text()).slice(0, 200) }; continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      out[id] = { audio: buf.toString('base64') };
    } catch (err) {
      out[id] = { error: String(err && err.message || err) };
    }
  }

  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out) };
};
