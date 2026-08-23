/* ─────────────────────────────────────────────────────────────────────────────
   studio-meditation-generate-background

   Does the Claude + ElevenLabs work for a Studio guided-meditation render.
   Triggered server-to-server by studio-meditation-start.js (not called
   directly by the browser, so no auth gate here — matches THE_DOSE's
   meditation-generate-background.js, which this is ported from). Stores
   the resulting MP3 in Netlify Blobs and updates the status blob so
   studio-meditation-status can serve it.

   v1: Jaque only. His voiceId, model, settings, and framing are copied
   verbatim from THE_DOSE/netlify/functions/meditation-generate-background.js
   (the 'jaque' entry, meditation lane — not his breathing lane) so the
   voice and character are identical to the proven Dose feature.
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { connectLambda, getStore } = require('@netlify/blobs');
const { VOICE_LAW_PROSE } = require('./_etl-voice-law.js');

const LEADERS = {
  jaque: {
    voiceId: 'QF9HJC7XWnue5c9W3LkY',
    model: 'eleven_turbo_v2_5',
    settings: { stability: 0.80, similarity_boost: 0.88, style: 0.0, use_speaker_boost: false },
    framing:
      "Jaque hosts the meditation feature on The Dose, and now here in the Studio. Voice actor by trade, " +
      "French Canadian mother, American father. Spinal injury at twenty cost him " +
      "hockey; he rebuilt around his voice. Warm, steady, unhurried.\n\n" +
      "SIGNATURE: Jaque is the host who came back from something. His " +
      "meditations carry one quiet conviction — you can become more than you " +
      "think you are. Reinvention is not a slogan for him; it is how he is " +
      "still here. He does not sell it. He just believes it, and the listener " +
      "hears that belief.\n\n" +
      "DISTINCTIVE NOTE — HOST: Jaque does NOT have a single physical place " +
      "(forest, garden, apothecary). His territory is the body itself and the " +
      "steady voice in the listener's ear. His meditations are warm, " +
      "conversational, body-aware. Themes: reinvention, the body that did not " +
      "move the way it used to, the simple work of being here now.\n\n" +
      "He opens like a host who is glad you came. He closes by giving the " +
      "listener back to themselves a little bigger than they started.",
  },
};

const LENGTHS = {
  3: { words: 400, label: 'a Quick Reset — a short pause to settle the mind' },
  5: { words: 550, label: 'a Short Session — a few minutes to breathe and refocus' },
  8: { words: 900, label: 'a Deeper Reset — a longer moment to fully unwind' },
};

exports.handler = async (event) => {
  try {
    connectLambda(event);
  } catch (err) {
    console.error('[studio-meditation-bg] connectLambda failed', { err: err.message });
    return ok();
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return ok(); }

  const { jobId, leader: leaderKey, length: lengthKey } = body;
  if (!jobId) return ok();

  const audioStore = getStore('studio-meditation-audio');
  const statusStore = getStore('studio-meditation-status');

  const fail = async (msg, detail) => {
    await statusStore.setJSON(jobId, { status: 'failed', error: msg, detail, failedAt: new Date().toISOString() });
    console.error('[studio-meditation-bg] failed:', msg, detail);
  };

  const leader = LEADERS[leaderKey];
  const length = LENGTHS[lengthKey];
  if (!leader || !length) {
    await fail('Invalid params', { leaderKey, lengthKey });
    return ok();
  }

  const anthKey = process.env.FOUNDER_STUDIO_API_KEY;
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  if (!anthKey || !elevenKey) {
    await fail('Meditation generation not configured');
    return ok();
  }

  let script;
  try {
    const anthropic = new Anthropic({ apiKey: anthKey, timeout: 60000, maxRetries: 0 });
    const claudeTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Claude internal timeout at 60s')), 60000)
    );
    const msg = await Promise.race([
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system:
          "You are writing a guided meditation script for a specific cast member to read aloud. " +
          "This is a free feature framed as a small session in the listener's day — a Quick Reset, a " +
          "Short Session, or a Deeper Reset. We are not chasing specific minute durations; the " +
          "SIGNATURE matters more than the stopwatch. The reader's voice is warm and slow. " +
          "Your script is what they say.\n\n" +
          "VOICE RULE — most important:\n" +
          "- Honor the READER's SIGNATURE. A listener should be able to tell which cast member " +
          "is speaking within the first few lines, and the SIGNATURE should color the whole " +
          "script, not just the opener.\n\n" +
          "LENGTH RULE — second most important:\n" +
          "- Hit the requested word count. The SIGNATURE needs room to breathe; a short script " +
          "flattens the reader. If asked for 900 words, write 900 words. Use the five structural " +
          "sections (opener, arrival, body, deepening, close) to fill them honestly.\n\n" +
          "STYLE RULES:\n" +
          "- Plain spoken sentences. No em dashes. Use commas, periods.\n" +
          "- No clinical language, no diagnosis, no prescription. This is not therapy.\n" +
          "- No new-age vocabulary (chakras, vibrations, energies, manifest).\n" +
          "- Gentle 'let your / let it / feel the / breathe in' invitations are fine and expected.\n" +
          "- For pauses, you may use SSML break tags inline in the script — e.g. " +
          "<break time=\"1.5s\"/> between phrases and <break time=\"3s\"/> at section transitions.\n" +
          "- Open with the reader naming themselves once, in their own voice. Do not repeat the name.\n" +
          "- Close with a single sentence that releases the listener back to their day, in the " +
          "reader's voice.\n" +
          "- Write only what the reader speaks, with optional inline <break> tags. No other " +
          "stage directions. No brackets except for break tags. No section headings in the output." +
          VOICE_LAW_PROSE,
        messages: [{
          role: 'user',
          content:
            `Write a guided meditation script for the READER below, totaling about ${length.words} words. ` +
            `The feel is ${length.label} in the listener's day.\n\n` +
            `STRUCTURE the script in five sections, each filled honestly to its target word count:\n` +
            `  1. Opener — the reader meets the listener in their SIGNATURE voice. ~${Math.round(length.words * 0.15)} words.\n` +
            `  2. Arrival — settling, body, breath. ~${Math.round(length.words * 0.20)} words.\n` +
            `  3. Body — developed through the SIGNATURE. This is the longest section. ~${Math.round(length.words * 0.40)} words.\n` +
            `  4. Deepening — quieter, slower, more space between thoughts. ~${Math.round(length.words * 0.20)} words.\n` +
            `  5. Close — one or two sentences in the reader's voice, releasing the listener. ~${Math.round(length.words * 0.05)} words.\n\n` +
            `READER: ${leader.framing}\n\n` +
            `Return ONLY the script the reader speaks, with any inline <break> tags woven in where they read naturally. No section headings, no notes, no markdown. Just the script.`,
        }],
      }),
      claudeTimeout,
    ]);
    script = (msg.content?.[0]?.text || '').trim();
    if (!script) throw new Error('Empty script');
  } catch (err) {
    await fail('Script generation failed', err.message);
    return ok();
  }

  let audioBuf;
  const elevenAbort = new AbortController();
  const elevenTimeoutId = setTimeout(() => elevenAbort.abort(), 90000);
  try {
    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${leader.voiceId}?output_format=mp3_22050_32`, {
      method: 'POST',
      headers: {
        'xi-api-key': elevenKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: '<break time="0.8s"/> ' + script,
        model_id: leader.model,
        voice_settings: leader.settings,
      }),
      signal: elevenAbort.signal,
    });
    if (!ttsRes.ok) {
      const errText = await ttsRes.text().catch(() => '');
      throw new Error(`ElevenLabs ${ttsRes.status}: ${errText.slice(0, 200)}`);
    }
    const arrayBuf = await ttsRes.arrayBuffer();
    audioBuf = Buffer.from(arrayBuf);
  } catch (err) {
    await fail('Audio render failed', err.message);
    return ok();
  } finally {
    clearTimeout(elevenTimeoutId);
  }

  try {
    await Promise.race([
      audioStore.set(jobId, audioBuf, { metadata: { contentType: 'audio/mpeg', bytes: audioBuf.length } }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('audioStore.set timeout at 10s')), 10000)),
    ]);
    await Promise.race([
      statusStore.setJSON(jobId, { status: 'complete', completedAt: new Date().toISOString(), bytes: audioBuf.length }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('statusStore.setJSON timeout at 10s')), 10000)),
    ]);
  } catch (err) {
    await fail('Storage write failed', err.message);
    return ok();
  }

  return ok();
};

function ok() { return { statusCode: 200, body: '' }; }
