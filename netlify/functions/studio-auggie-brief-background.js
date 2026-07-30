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
const { VOICE_LAW_PROSE, houseTypography } = require('./_etl-voice-law.js');
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

/* Per-owner brief (any buyer who is not Dr. O). The cron/Terry path above is
   untouched; this is built from the validated `target` the trigger forwards.
   It addresses the buyer by their address form, searches THEIR name/context,
   and skips Dr. O's publication list and ETL form inboxes entirely. */
function buildBuyerBriefSystem(target, ownerAddr) {
  const paFirst = target.pa_first_name || 'your assistant';
  const studio = target.company_name || ((target.owner_name || 'your') + "'s") + ' Studio';
  return [
    'You are ' + paFirst + ', the personal assistant in ' + studio + '. Warm, sharp, loyal to your principal.',
    '',
    'TASK: Write ' + ownerAddr + '\'s morning brief in your own voice, first person, as a spoken voice memo (it will be read aloud). One continuous monologue, no headers, no bullet points, no markdown.',
    '',
    'OPENING: Address them as "' + ownerAddr + ',", one short warm scene-set line, then pivot into what you found.',
    '',
    'BODY: Lead with anything about THEM or their organization first (new mentions, news, anything naming them or their company). Then field news relevant to their work. Cite source names and dates in plain language, never URLs.',
    '',
    'CLOSE: One small recommendation or question ("want me to draft a note on that?").',
    '',
    'NULL CASE: If search finds nothing new about them, do not dwell or list what you did not find. One warm forward-looking line, then move to field news.',
    '',
    'LENGTH: 150-280 words. Personal, not a press release. No exclamation points, no em dashes. This will be SPOKEN; punctuate for breath.',
  ].join('\n');
}

function buildBuyerUserPrompt(target, dateKey, calLines, ownerAddr) {
  const name = target.owner_name || ownerAddr;
  const ctx = target.owner_context || '';
  const site = target.owner_site || '';
  const company = target.company_name || '';
  return [
    'Today is ' + dateKey + ' (America/New_York).',
    '',
    calLines ? ('THEIR REAL CALENDAR (next 3 weeks, from their own feed):\n' + calLines + '\n\nWeave in 1-3 of these where they matter; do not read the whole list aloud.') : '',
    '',
    'Run up to 4 web searches to find, in priority order:',
    '1. Any genuinely NEW mentions of ' + name + (company ? ' or ' + company : '') + ' in the last 30 days.',
    site ? ('2. Anything new about ' + site + ' or their public presence.') : '',
    (ctx ? ('3. News in the last 7 days relevant to their work: ' + ctx) : '3. Recent news relevant to their role and field.'),
    '',
    'Then write the morning brief as ' + ownerAddr + ' would hear it from you. 150-280 words. Order: warm opening, then anything about THEM, then field news, then one small recommendation. Cite source names + dates. If nothing fresh about them, say so in one warm line and cover the field news.',
    '',
    'Return ONLY the monologue text. No headers, no bullets, no JSON.',
  ].filter(Boolean).join('\n');
}

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

/* ── Outlook calendar feed (ICS) ──────────────────────────────────────────
   The owner publishes their Outlook calendar (Settings > Calendar > Shared
   calendars > Publish) and pastes the ICS link to their PA in chat; the chat
   function stores it in the 'auggie_calendar' blob. The brief reads the live
   feed so Auggie talks about her REAL week, not whatever web search found.
   Minimal tolerant parser: unfolds wrapped lines, reads DTSTART/SUMMARY/
   LOCATION per VEVENT. Recurring-event expansion is not attempted (v1). */
function parseIcsDate(v) {
  const m = String(v).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
  if (!m) return null;
  if (m[7] === 'Z') return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
  return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
}
function parseIcsEvents(text) {
  const raw = String(text).split(/\r?\n/);
  const lines = [];
  for (const ln of raw) {
    if (/^[ \t]/.test(ln) && lines.length) lines[lines.length - 1] += ln.slice(1);
    else lines.push(ln);
  }
  const evs = []; let cur = null;
  for (const ln of lines) {
    if (ln === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (ln === 'END:VEVENT') { if (cur && cur.start && cur.summary) evs.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = ln.indexOf(':'); if (i < 0) continue;
    const key = ln.slice(0, i); const val = ln.slice(i + 1);
    if (key.startsWith('DTSTART')) { cur.start = parseIcsDate(val); cur.allDay = key.includes('VALUE=DATE'); }
    else if (key === 'SUMMARY' || key.startsWith('SUMMARY;')) cur.summary = val.replace(/\\,/g, ',').replace(/\\n/g, ' ').trim();
    else if (key === 'LOCATION' || key.startsWith('LOCATION;')) cur.location = val.replace(/\\,/g, ',').trim();
  }
  return evs;
}
async function loadCalendarLines(calKey) {
  // Feed list: { feeds:[{url,label}] } (current), { url } (legacy), or env.
  // calKey is the owner's calendar namespace: their user_id for a buyer, or
  // 'default' for Dr. O. The chat stores each owner's ICS feed under their
  // user_id, so the brief reads THEIR week, not whoever pasted last.
  let feeds = [];
  try {
    const rec = await getStore('auggie_calendar').get(calKey || 'default', { type: 'json' });
    if (rec && Array.isArray(rec.feeds)) feeds = rec.feeds.filter(f => f && f.url);
    else if (rec && rec.url) feeds = [{ url: rec.url, label: rec.label || '' }];
  } catch (_) {}
  if (!feeds.length && process.env.AUGGIE_CALENDAR_ICS) {
    feeds = [{ url: process.env.AUGGIE_CALENDAR_ICS, label: '' }];
  }
  if (!feeds.length) return '';
  const multi = feeds.length > 1;
  const all = [];
  for (const f of feeds) {
    try {
      const r = await fetch(f.url);
      if (!r.ok) continue;
      const evs = parseIcsEvents(await r.text());
      for (const e of evs) { e.feedLabel = f.label || ''; all.push(e); }
    } catch (_) { /* one bad feed never kills the brief */ }
  }
  const now = Date.now();
  const lo = now - 12 * 3600e3, hi = now + 21 * 86400e3;
  const win = all.filter(e => e.start && e.start.getTime() >= lo && e.start.getTime() <= hi)
    .sort((a, b) => a.start - b.start).slice(0, 30);
  if (!win.length) return '';
  const fmtDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' });
  const fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  return win.map(e =>
    '- ' + fmtDay.format(e.start) + (e.allDay ? ' (all day)' : ' ' + fmtTime.format(e.start)) + ': ' + e.summary
    + (e.location ? ' [' + e.location + ']' : '')
    + (multi && e.feedLabel ? ' (' + e.feedLabel + ')' : '')
  ).join('\n');
}

exports.handler = async (event) => {
  // Auth: require admin basic auth for any caller (cron + manual reruns).
  if (!checkAdminAuth(event)) {
    // Log the rejection (added 2026-07-30). This path used to return 401 with no
    // log line at all, so from the outside a credential problem was
    // indistinguishable from "the cron never fired" or "the model call failed".
    // Briefs were dead from 2026-07-27 and narrowing it took comparing
    // timestamps across unrelated crons, purely because this was silent.
    // Presence only, never values.
    console.error('[auggie-brief-bg] REJECTED: admin basic auth failed.'
      + ' PRESS_ADMIN_USER set=' + !!process.env.PRESS_ADMIN_USER
      + ' PRESS_ADMIN_PASS set=' + !!process.env.PRESS_ADMIN_PASS);
    return { statusCode: 401, body: 'unauthorized' };
  }

  try { connectLambda(event); } catch (_) {}

  // Which external dependencies are configured, so a missing key is visible in
  // the log on the very first line instead of being inferred from a 502 later.
  console.log('[auggie-brief-bg] deps configured:'
    + ' anthropic=' + !!process.env.ANTHROPIC_API_KEY
    + ' elevenlabs=' + !!process.env.ELEVENLABS_API_KEY);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[auggie-brief-bg] ANTHROPIC_API_KEY not set');
    return { statusCode: 500, body: 'anthropic key missing' };
  }
  const client = new Anthropic({ apiKey });

  // Per-owner brief. The trigger forwards a validated target for a buyer
  // (user_id from their JWT). No target = Dr. O's own brief (cron path),
  // which keeps every behavior below verbatim and writes the global blobs.
  let target = null;
  try {
    const b = JSON.parse(event.body || '{}');
    if (b && b.target && b.target.user_id) target = b.target;
  } catch (_) {}
  const keyPfx = target ? ('u/' + target.user_id + '/') : '';
  const ownerAddr = target
    ? (target.address_form || (target.owner_name ? target.owner_name.split(/\s+/)[0] : 'there'))
    : 'Ms. Terry';

  const dateKey = todayKeyET();
  console.log('[auggie-brief-bg] starting brief for', dateKey, target ? ('(buyer ' + target.user_id + ')') : '(owner)');

  // Step 1+2: gather findings AND write the monologue in one Anthropic call
  // with web_search enabled. The model decides how many searches to spend.
  // Pull cross-site form submissions FIRST so we can include the digest
  // in the prompt and Auggie can name new inquiries in his monologue.
  // Failure here is non-fatal; brief still ships without form context.
  let formsDigest = '';
  let formsItems = [];
  // The cross-site form inboxes are Dr. O's ETL platforms; a buyer's brief
  // never reads them. Only the owner path pulls the forms digest.
  if (!target) try {
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

  // Her real calendar from the published Outlook feed (non-fatal if absent).
  const calLines = await loadCalendarLines(target ? target.user_id : 'default');
  if (calLines) console.log('[auggie-brief-bg] calendar feed loaded');

  const userPrompt = target ? buildBuyerUserPrompt(target, dateKey, calLines, ownerAddr) : [
    `Today is ${dateKey} (America/New_York).`,
    '',
    calLines
      ? 'HER REAL CALENDAR (ground truth from her own Outlook feed, next 3 weeks):\n' + calLines + '\n\nThis is her ACTUAL schedule; trust it over anything web search says about her being quiet. Weave 1-3 of these in naturally where they matter: lead with momentum (talks, keynotes, briefings, media, travel), flag any same-day collisions or brutal back-to-backs, and connect field news to an upcoming engagement when the link is real ("that executive order is exactly your lane for the keynote"). Do NOT read the whole list aloud; you are her PA, not her calendar app.'
      : '',
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
      system: (target ? buildBuyerBriefSystem(target, ownerAddr) : BRIEF_SYSTEM) + VOICE_LAW_PROSE,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_WEB_SEARCHES }],
      messages: [{ role: 'user', content: userPrompt }],
    });

    // Pull text blocks for the monologue and gather any tool-use URLs for
    // the metadata (so we can surface "Auggie read these" in the UI later).
    const textBlocks = (resp.content || []).filter(b => b && b.type === 'text');
    monologue = houseTypography(textBlocks.map(b => b.text).join('\n').trim());

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

  // Step 3: render to audio. Skipped for landlord TEST briefs
  // (target.skip_audio) so verifying a client's brief does not burn ElevenLabs
  // TTS, only the transcript is needed to confirm it works.
  let audioBuf = null;
  if (!(target && target.skip_audio)) {
    try {
      audioBuf = await ttsAuggie(monologue);
      console.log('[auggie-brief-bg] elevenlabs ok, bytes=', audioBuf.length);
    } catch (err) {
      // Degrade to transcript-only instead of aborting (changed 2026-07-30).
      // This used to `return 502` here, which threw away a brief that had
      // already been generated: the Anthropic call had succeeded and the
      // monologue was sitting in memory, and one TTS failure discarded it and
      // wrote nothing. The buyer then saw a stale brief with no explanation.
      // Audio is an enhancement; the transcript is the product. The persistence
      // block below already handles audioBuf === null (it is the skip_audio
      // path), so falling through needs no other change.
      console.error('[auggie-brief-bg] elevenlabs failed, writing transcript'
        + ' without audio:', err && err.message);
      audioBuf = null;
    }
  } else {
    console.log('[auggie-brief-bg] skip_audio set (test brief), no TTS');
  }

  // Step 4: persist to Blobs.
  try {
    const audioStore = getStore('auggie_briefs_audio');
    const metaStore  = getStore('auggie_briefs_meta');
    // keyPfx namespaces a buyer's brief to their user_id; empty for Dr. O so
    // her cron keeps writing the global 'latest' / dateKey blobs as before.
    if (audioBuf) {
      await audioStore.set(keyPfx + dateKey, audioBuf, {
        metadata: { contentType: 'audio/mpeg', dateKey: dateKey },
      });
    }
    const meta = {
      dateKey: dateKey,
      generatedAt: new Date().toISOString(),
      transcript: monologue,
      audioKey: audioBuf ? (keyPfx + dateKey) : null,
      audioBytes: audioBuf ? audioBuf.length : 0,
      // Duration from audio bytes (64kbps mp3) when present; else estimate from
      // the transcript (~2.5 words/sec) so a test brief still shows a length.
      estimatedSeconds: audioBuf ? Math.round(audioBuf.length / 8000) : Math.round(monologue.split(/\s+/).filter(Boolean).length / 2.5),
      voiceId: AUGGIE_VOICE_ID,
      sourcesUsed: sourcesUsed.slice(0, 20),
    };
    await metaStore.set(keyPfx + 'latest', JSON.stringify(meta), {
      metadata: { contentType: 'application/json' },
    });
    await metaStore.set(keyPfx + dateKey, JSON.stringify(meta), {
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
