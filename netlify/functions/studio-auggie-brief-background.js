/* ─────────────────────────────────────────────────────────────────────────────
   studio-auggie-brief-background — Netlify background function. Generates
   Auggie's morning brief for Dr. Oroszi end-to-end.

   Pipeline:
   1. Anthropic with web_search (max 5 uses): searches for new mentions of
      Dr. Oroszi, new Forbes pieces, speaking engagements, and field news
      in AI governance / federal AI policy / biodefense / research security.
   2. Asks Anthropic to write Auggie's brief as a single first-person
      monologue in his voice (OJ-and-bf opening, digress-and-pivot, lead
      with anything about HER, cite source names, close with a small
      recommendation or question).
   3. Renders the monologue to mp3 via ElevenLabs (Auggie's voice
      XMt7icsOj2DAS4Cn1PN1).
   4. Stores the audio under blob store `auggie_briefs_audio` keyed by
      YYYY-MM-DD, stores metadata (date, transcript, audio key, duration
      estimate, source URLs) under `auggie_briefs_meta` keyed `latest` plus
      a dated key for archive.

   Auth: basic auth via PRESS_ADMIN_USER/PRESS_ADMIN_PASS. The cron above
   uses these; manual reruns from a script can use the same.

   The `-background` suffix tells Netlify this runs up to 15 minutes
   instead of the 10-second sync cap (Anthropic + web_search + ElevenLabs
   can take 60-90 seconds end-to-end).
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');

const MODEL = 'claude-sonnet-4-6';
const MAX_WEB_SEARCHES = 5;

/* Auggie's voice (same constants as studio-auggie-voice.js; kept here too so
   this function is self-contained for the cron). */
const AUGGIE_VOICE_ID = 'XMt7icsOj2DAS4Cn1PN1';
const AUGGIE_MODEL_TTS = 'eleven_turbo_v2_5';
const AUGGIE_SETTINGS = {
  stability: 0.42,
  similarity_boost: 0.78,
  style: 0.45,
  use_speaker_boost: true,
};

/* Basic auth gate matching the cron's credentials. */
function checkAdminAuth(event) {
  const expectedUser = process.env.PRESS_ADMIN_USER;
  const expectedPass = process.env.PRESS_ADMIN_PASS;
  if (!expectedUser || !expectedPass) return false;
  const header = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!header.toLowerCase().startsWith('basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const [u, p] = decoded.split(':');
  return u === expectedUser && p === expectedPass;
}

/* The brief-writing prompt. Auggie's persona lives in studio-auggie-chat.js;
   we duplicate the relevant voice bits here so the brief sounds like him
   without needing to import that file. (Background functions can't reliably
   share state with sync functions in Netlify's bundler.) */
const BRIEF_SYSTEM = [
  'You are August "Auggie" Vidal, late twenties, gay, Cuban-American from Coral Gables, summers in Palm Springs. You are Dr. Terry Oroszi\'s chief of staff. You spent three years as Devon\'s personal assistant on the Gauntlet bench before she hired you.',
  '',
  'TASK: Write Ms. Terry\'s morning brief in YOUR voice. Speak directly to her, first person, as if you are recording a voice memo for her. The output will be rendered to audio in your voice (ElevenLabs). Write it as a single continuous monologue, no headers, no bullet points, no markdown.',
  '',
  'OPENING (REQUIRED): Open with "Ms. Terry," or "ok Ms. Terry," followed by a tiny scene-set from your morning. Pick ONE: the espresso, the OJ your bf made you, the Pucci shirt you almost wore, the call you took from Devon. One line, then pivot with "but I digressed, ANYWAY, this is what I found." Do NOT skip the digression. The digression is the texture.',
  '',
  'BODY: Lead with anything about HER first. "you are mentioned in..." / "your Forbes piece is suddenly trending on..." / "someone tagged you in...". Then her Forbes column, then her speaking engagements, then field news in AI governance / federal AI policy / biodefense / research security. Cite source names and dates from what you actually read. Source name + date in plain language (e.g. "according to a piece in Bloomberg on Tuesday"), not URLs.',
  '',
  'CLOSE (REQUIRED): A small recommendation or question. "want me to draft a teaser post on that?" / "want me to add a calendar hold to respond?" / "want me to forward this to Devon for context?" One line.',
  '',
  'NULL CASE: If web_search finds nothing new about her, NEVER frame it as the internet being quiet about her, bored with her, or her being stale. Do NOT list the things you did not find (no "no new mentions, no new quotes, no new listings" inventories; that reads as a downer and it is usually wrong anyway, search just missed it). She is extremely active: talks, keynotes, new Forbes pieces land constantly, and your search misses plenty. If you cannot confirm something new, give it ONE warm forward-looking line at most, e.g. "your pieces are out there doing their work this morning, love," then move straight to field news. Absence of search results is not news and never gets more than one sentence.',
  '',
  'LENGTH: 180-300 words. Long enough to be a real briefing. Short enough to listen to with morning coffee.',
  '',
  'VOICE PATTERNS:',
  '- The brief is a voice memo from you to Ms. Terry. Personal. Intimate. Not a press release. Lowercase is your default register here. Full sentences when something matters.',
  '- "love" and "darling" sprinkled mid-text. "Ms. Terry" for openings, pivots, and any time you want her attention.',
  '- Never "babe", never "Dr. O" in your speech.',
  '- "OMG", "obsessed", "I cannot", "I am dead", "stop it" are all allowed and on-character.',
  '- ALL CAPS for occasional emphasis like "ANYWAY" or "OMG" — used freely as part of your texture.',
  '- No exclamation points. No em dashes. Both are AI tells and her brand has banned them on every public surface; your speech matches.',
  '- This will be SPOKEN. Use punctuation that helps the TTS pace itself (commas for breath, periods for stops). Avoid quoted speech inside the monologue.',
  '',
  'YOU ARE WRITING WHAT WILL BE PLAYED IN YOUR VOICE AT 6am ET. Make it feel like a real voice memo.',
].join('\n');

/* Helper: render text to mp3 via ElevenLabs. Returns a Buffer. */
async function ttsAuggie(text) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set');
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${AUGGIE_VOICE_ID}?output_format=mp3_44100_64`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text: text,
      model_id: AUGGIE_MODEL_TTS,
      voice_settings: AUGGIE_SETTINGS,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '<no body>');
    throw new Error(`ElevenLabs ${res.status}: ${errText.slice(0, 200)}`);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/* Helper: today's date in YYYY-MM-DD using America/New_York so the file
   names match Terry's working day, not UTC. */
function todayKeyET() {
  const now = new Date();
  // Intl.DateTimeFormat gives us NY-local components.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const get = (t) => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

exports.handler = async (event) => {
  // Auth: require admin basic auth for any caller (cron + manual reruns).
  if (!checkAdminAuth(event)) {
    return { statusCode: 401, body: 'unauthorized' };
  }

  try { connectLambda(event); } catch (_) {}

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[auggie-brief-bg] ANTHROPIC_API_KEY not set');
    return { statusCode: 500, body: 'anthropic key missing' };
  }
  const client = new Anthropic({ apiKey });

  const dateKey = todayKeyET();
  console.log('[auggie-brief-bg] starting brief for', dateKey);

  // Step 1+2: gather findings AND write the monologue in one Anthropic call
  // with web_search enabled. The model decides how many searches to spend.
  // Pull cross-site form submissions FIRST so we can include the digest
  // in the prompt and Auggie can name new inquiries in his monologue.
  // Failure here is non-fatal; brief still ships without form context.
  let formsDigest = '';
  let formsItems = [];
  try {
    const user = process.env.PRESS_ADMIN_USER;
    const pass = process.env.PRESS_ADMIN_PASS;
    if (user && pass) {
      const basic = Buffer.from(`${user}:${pass}`).toString('base64');
      const base = process.env.URL || 'https://emerging-tech-lab.com';
      const fr = await fetch(`${base}/.netlify/functions/studio-auggie-forms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${basic}` },
        body: JSON.stringify({ action: 'summary_for_brief' }),
      });
      if (fr.ok) {
        const fd = await fr.json();
        formsDigest = fd.digest || '';
        formsItems = Array.isArray(fd.items) ? fd.items : [];
        console.log('[auggie-brief-bg] forms summary fetched, newCount=', fd.newCount);
      } else {
        console.warn('[auggie-brief-bg] forms summary http', fr.status);
      }
    }
  } catch (err) {
    console.warn('[auggie-brief-bg] forms summary fetch failed (non-fatal)', err && err.message);
  }

  // Build the per-item lines for the prompt (only if any new forms).
  const formsLines = formsItems.length
    ? formsItems.map(it => `- ${it.formName} on ${it.site} (${it.createdAt}): ${it.summary || (it.name + ' ' + it.email).trim()}`).join('\n')
    : '';

  const userPrompt = [
    `Today is ${dateKey} (America/New_York).`,
    '',
    formsDigest
      ? `INBOX SINCE LAST BRIEF: ${formsDigest}\n\nNew submissions Ms. Terry should know about:\n${formsLines}\n\nMention these explicitly in your brief. Lead with the inbox if any of these look high-value (custom inquiries, PA builder submissions with budget signal, anyone who named her in their notes). Otherwise weave them in after the personal-mentions section. Always name the submitter and a one-line gist; do not list every field.`
      : 'INBOX SINCE LAST BRIEF: nothing new in the form inboxes across the ETL sites.',
    '',
    'ALREADY-KNOWN PUBLICATIONS — DO NOT TREAT ANY OF THESE AS A NEW MENTION. They are in her catalog. If a search returns one of these, it is NOT news to her:',
    '  Forbes Technology Council (solo-authored): "Artificial Intelligence Takeover: Not with a Bang" (May 2026); "The Magic 8 Ball in The Boardroom" (April 2026); "When AI Fails by Being Too Nice" (March 2026); "The Single-Vendor Blind Spot" (February 2026); "The AI SME Trap" (January 2026); "From Panic to Progress" (December 2025); "Leveraging Emerging Tech to Free Academia from Traditional Grant Funding" (October 2025).',
    '  Forbes Technology Council (panel): "How To Leverage AI-Driven Insights" (April 2026); "How To Handle Major Systems Disruptions" (February 2026); "Albania\'s Diella: AI-Powered Governance" (November 2025); "Continuing Education for Tech Teams" (October 2025); "Programmatic Technology Applications" (October 2025); "Boost System Resilience After Incidents" (September 2025); "20 Ways to Design AI Governance Plans" (August 2025); "Expert Tips for Tech Leaders" (August 2025).',
    '  Press releases / awards: IAOTP Top Principal Strategist of the Year (May 2025); World\'s Fifty Most Influential Businesswomen, Special Edition (2025); InfraGard Leadership Regional Award, Midwest (2021); Muscatine High School Hall of Honor (2026).',
    '',
    'RECENCY RULE: A mention only counts as NEW if (a) it is dated within the last 30 days AND (b) it is NOT in the known-publications list above. Anything older than 30 days, OR anything in that list re-indexed by a syndication site, is field noise — DO NOT report it as a personal item. If she has seen it before, she does not need to hear about it again.',
    '',
    'Run the searches you need (up to 5) to find:',
    '1. Any GENUINELY NEW mentions of Dr. Terry Oroszi in the last 30 days. Query variations: "Terry Oroszi 2026", "Dr. Terry L. Oroszi", "Vice Chair Pharmacology Wright State", "Mission Possible Spy Academy Oroszi", "Gandhi-King Center Dayton Oroszi", "Terry Oroszi InfraGard". Diversify — name-only queries keep returning the same SEO-juiced articles.',
    '2. Any NEW Forbes Technology Council pieces under her byline NOT already in the known-publications list above. Or commentary where she is quoted (not her own articles).',
    '3. Any upcoming speaking engagements, conference appearances, or panels where she is listed in the next 90 days.',
    '4. Recent news in AI governance, federal AI policy, biodefense, research security, counter-terrorism, intelligence community, or her active initiatives (MPSA traction, Gandhi-King Dayton-Dubai $150M corridor, NSF research-on-research security).',
    '',
    'Then write the morning brief as Ms. Terry would hear it from you. One continuous monologue, in your voice, 200-340 words. Order: opening with a tiny scene-set + digression, then the inbox if anything is there, then anything about HER (mentions, Forbes, speaking), then field news, then close with one small recommendation or question. Cite source names + dates in plain language. If you found nothing fresh about HER AND no new inbox, say so plainly and still cover the field news.',
    '',
    'Return ONLY the monologue text. No headers. No bullet points. No JSON. Just the words Auggie would speak.',
  ].join('\n');

  let monologue = '';
  let sourcesUsed = [];
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: BRIEF_SYSTEM,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_WEB_SEARCHES }],
      messages: [{ role: 'user', content: userPrompt }],
    });

    // Pull text blocks for the monologue and gather any tool-use URLs for
    // the metadata (so we can surface "Auggie read these" in the UI later).
    const textBlocks = (resp.content || []).filter(b => b && b.type === 'text');
    monologue = textBlocks.map(b => b.text).join('\n').trim();

    // web_search results come back as tool_use / server_tool_use blocks
    // depending on Anthropic's response shape. Defensive extraction.
    (resp.content || []).forEach(b => {
      if (!b || !b.type) return;
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
        b.content.forEach(item => {
          if (item && item.type === 'web_search_result' && item.url) {
            sourcesUsed.push({ url: item.url, title: item.title || '' });
          }
        });
      }
    });

    console.log('[auggie-brief-bg] anthropic done, monologue chars=', monologue.length, 'sources=', sourcesUsed.length);
  } catch (err) {
    console.error('[auggie-brief-bg] anthropic failed', err && err.message);
    return { statusCode: 502, body: 'anthropic failed: ' + (err && err.message) };
  }

  if (!monologue || monologue.length < 40) {
    console.error('[auggie-brief-bg] monologue too short, aborting');
    return { statusCode: 502, body: 'monologue empty or too short' };
  }

  // Step 3: render to audio.
  let audioBuf;
  try {
    audioBuf = await ttsAuggie(monologue);
    console.log('[auggie-brief-bg] elevenlabs ok, bytes=', audioBuf.length);
  } catch (err) {
    console.error('[auggie-brief-bg] elevenlabs failed', err && err.message);
    return { statusCode: 502, body: 'elevenlabs failed: ' + (err && err.message) };
  }

  // Step 4: persist to Blobs.
  try {
    const audioStore = getStore('auggie_briefs_audio');
    const metaStore  = getStore('auggie_briefs_meta');
    await audioStore.set(dateKey, audioBuf, {
      metadata: { contentType: 'audio/mpeg', dateKey: dateKey },
    });
    const meta = {
      dateKey: dateKey,
      generatedAt: new Date().toISOString(),
      transcript: monologue,
      audioKey: dateKey,
      audioBytes: audioBuf.length,
      // Rough duration estimate at 64kbps mp3: bytes / (8000) seconds.
      // Good enough for "this is a 2-minute brief" UI labeling.
      estimatedSeconds: Math.round(audioBuf.length / 8000),
      voiceId: AUGGIE_VOICE_ID,
      sourcesUsed: sourcesUsed.slice(0, 20),
    };
    await metaStore.set('latest', JSON.stringify(meta), {
      metadata: { contentType: 'application/json' },
    });
    await metaStore.set(dateKey, JSON.stringify(meta), {
      metadata: { contentType: 'application/json' },
    });
    console.log('[auggie-brief-bg] persisted', dateKey, 'sec~', meta.estimatedSeconds);
  } catch (err) {
    console.error('[auggie-brief-bg] blob write failed', err && err.message);
    return { statusCode: 500, body: 'blob write failed: ' + (err && err.message) };
  }

  // Advance the forms cursor only AFTER successful storage. Any forms we
  // surfaced in this brief should not appear in tomorrow's brief. Failure
  // here is non-fatal; worst case Terry hears them mentioned twice.
  if (formsItems.length > 0) {
    try {
      const formsStore = getStore('auggie_forms_state');
      await formsStore.set('cursor', new Date().toISOString(), {
        metadata: { contentType: 'text/plain' },
      });
      console.log('[auggie-brief-bg] forms cursor advanced after surfacing', formsItems.length, 'submissions');
    } catch (err) {
      console.warn('[auggie-brief-bg] forms cursor write failed (non-fatal)', err && err.message);
    }
  }

  return { statusCode: 200, body: `auggie brief generated for ${dateKey}` };
};
