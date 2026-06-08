/* ─────────────────────────────────────────────────────────────────────────────
   studio-floor-render

   Renders The Floor — the inter-staff chat surface in Dr. O's Studio.
   When she opens The Floor panel, this function generates a believable
   Slack-style thread between her active staff members (currently Auggie,
   Bea, Chris, Jess) discussing today's real events, in voice.

   Render-on-open, not heartbeat. No LLM cost when the panel is closed.
   Each open generates a fresh thread (no caching) so the conversation
   stays current with today's actual context.

   POST body: {} (no inputs)
   Returns: { messages: [{speaker, text, timestamp}, ...] }
   Auth: Supabase JWT in Authorization header. Same gate as other Studio
   functions. Anonymous requests refused before any Anthropic spend.
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');

const MODEL = 'claude-sonnet-4-6';

/* ── JWT validation against Supabase ────────────────────────────────────── */
const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

async function validateRequest(event) {
  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return { ok: false, reason: 'no_bearer' };
  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false, reason: 'empty_token' };
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token, 'apikey': SUPABASE_ANON_KEY },
    });
    if (!r.ok) return { ok: false, reason: 'supabase_rejected_' + r.status };
    const user = await r.json();
    if (!user || !user.id) return { ok: false, reason: 'no_user' };
    return { ok: true, user };
  } catch (e) {
    return { ok: false, reason: 'fetch_failed', error: e && e.message };
  }
}

/* ── Staff in Dr. O's Studio (v1 cast) ─────────────────────────────────────
   Four people. Distinct voices. Each persona summary is what the model
   uses to write them in character. Keep these tight — too much detail
   crowds the prompt and the messages start sounding like bios.
   When Terry hires more Specialists (Rowan, Kimberly, Alicia) we add
   them to this array and they appear in The Floor automatically.
   ──────────────────────────────────────────────────────────────────────── */
const STAFF = [
  {
    name: 'Auggie',
    role: 'Chief of staff',
    persona: 'Late 20s, gay, Cuban-American with Coral Gables / Palm Springs aesthetic. Camp and digressive but capable. Calls Ms. Terry "ma\'am" or "darling". Drops OMG and ANYWAY. Capitalizes the start of every sentence but uses "I am" not "I\'m", "that is" not "that\'s" (the one contraction he allows himself is "let\'s"). Will gossip about the boss\'s wardrobe while also catching every calendar conflict.',
  },
  {
    name: 'Bea',
    role: 'Copy editor',
    persona: 'Late 60s, Mexican-American, retired schoolteacher from New Mexico. Widow who writes children\'s books under a pseudonym. Catches what others missed. Dry, precise, kind. Says things like "this comma is doing too much work" or "darling, the timeline does not work for that". No emojis, no exclamation points.',
  },
  {
    name: 'Chris',
    role: 'Cover and character artist',
    persona: 'Nonbinary (they/them), early 30s, from a Sioux City farm family who never once asked them to be anything else. Iowa grad. Visual-first thinker. Talks about color, line, weight. Polite but firm — will not commit to a cover that is wrong. Sometimes drops a color swatch hex code into a sentence.',
  },
  {
    name: 'Jess',
    role: 'Publicist',
    persona: 'Bilingual Texan (English / Spanish), late 30s. Five years running indie bookstore events in San Antonio and Austin before going freelance. High enthusiasm with real reach. Will say "I have a podcast in mind" or "this lands harder on Wednesday". Refuses to pitch a podcast whose audience would not actually read the book.',
  },
];

/* ── Read today's real context ─────────────────────────────────────────────
   The Floor only feels alive if the staff are talking about REAL things
   that actually happened in the Studio today. We pull what we can find,
   then pass it to the model as grounding.
   ──────────────────────────────────────────────────────────────────────── */
// Format the current wall-clock time in Terry's timezone (America/New_York).
// We use Intl.DateTimeFormat for correct DST handling; falling back to a UTC
// approximation if the runtime lacks tz data (Netlify nodes have it).
function currentETTime() {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return fmt.format(new Date()).toLowerCase().replace(/\s+/g, '');
  } catch (_) {
    const d = new Date();
    const h = d.getUTCHours();
    return ((h % 12) || 12) + ':' + String(d.getUTCMinutes()).padStart(2, '0') + (h >= 12 ? 'pm' : 'am');
  }
}

/* Truncate text at the last sentence-ending punctuation that falls
   within the maxChars window. If no good boundary is found in the last
   40% of the window, hard-cut. Prevents the staff from seeing runoff
   sentences in the brief context. */
function smartTrimToSentence(text, maxChars) {
  if (!text || text.length <= maxChars) return text || '';
  const cut = text.slice(0, maxChars);
  // Look for ., !, or ? followed by whitespace (avoids breaking on
  // mid-word punctuation like "U.S." or "Dr.")
  let lastEnd = -1;
  const re = /[.!?](?:\s|$)/g;
  let m;
  while ((m = re.exec(cut)) !== null) lastEnd = m.index;
  // Require the boundary to be in the back 40% so we don't slice off
  // half the brief just to land on a sentence.
  if (lastEnd >= maxChars * 0.6) {
    return cut.slice(0, lastEnd + 1).trim();
  }
  return cut.trim();
}

async function getTodaysContext(event) {
  const today = new Date().toISOString().slice(0, 10);
  const context = { date: today, nowET: currentETTime(), items: [] };

  try { connectLambda(event); } catch (_) {}

  // Auggie's latest morning brief, if rendered
  try {
    const metaStore = getStore('auggie_briefs_meta');
    const meta = await metaStore.get('latest', { type: 'json' });
    if (meta && meta.transcript) {
      // Trim to ~1500 chars so the staff see more than the brief's lead,
      // but END ON A SENTENCE BOUNDARY so they don't see a runoff
      // ellipsis and complain about it in voice (Bea will, and she did).
      // Falls back to a hard cut only if no sentence end is found in
      // the last 40% of the window.
      const t = smartTrimToSentence(String(meta.transcript), 1500);
      context.items.push({
        kind: 'morning_brief',
        date: meta.dateKey || today,
        text: t,
      });
    }
  } catch (err) {
    console.warn('[floor-render] brief read skipped', err && err.message);
  }

  return context;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'method not allowed' };

  const auth = await validateRequest(event);
  if (!auth.ok) {
    return {
      statusCode: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'unauthorized', reason: auth.reason }),
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }),
    };
  }

  const context = await getTodaysContext(event);

  const staffBlock = STAFF.map(s => `- **${s.name}** (${s.role}): ${s.persona}`).join('\n\n');
  const contextBlock = context.items.length
    ? context.items.map(i => `[${i.kind} — ${i.date}]\n${i.text}`).join('\n\n---\n\n')
    : '(no specific events today — they are doing office chatter, easy back-and-forth, before the day really starts)';

  const systemPrompt = [
    'You are rendering The Floor — the inter-staff Slack channel at Dr. Terry Oroszi\'s Studio.',
    '',
    'Ms. Terry (the principal) is NOT in this channel right now. She just opened the door and walked over. You are rendering what her staff WOULD be saying to each other right now, in voice, based on what actually happened in her Studio today.',
    '',
    'STAFF in this channel:',
    staffBlock,
    '',
    'TODAY (' + context.date + ') — what actually happened that they might be talking about:',
    contextBlock,
    '',
    'CURRENT WALL-CLOCK TIME, Eastern: **' + context.nowET + '** (Terry\'s timezone, America/New_York).',
    '',
    'RULES:',
    '- 8 to 12 messages total.',
    '- Each message is one to three short sentences. Conversational, not paragraphs.',
    '- Stay in each character\'s voice. Auggie\'s register is camp and capitalized; Bea is dry and precise; Chris is visual; Jess is high-energy with real strategy underneath.',
    '- Reference REAL items from today\'s context when relevant. Do not invent fictional meetings, fake names, or things that did not happen.',
    '- **Freshness rule**: If the morning brief surfaces a Forbes article, mention, or piece of news that is more than 30 days old, the staff have ALREADY discussed it in previous Floor sessions and are bored of it. They DO NOT fixate on it. They pivot — either to something genuinely fresh in the brief, or to ordinary office chatter (a typo to fix, a deadline to negotiate, a podcast pitch, a color call). NEVER let the channel be stuck on Dr. Oroszi\'s Forbes piece from last year. She has published a lot since; the staff know that.',
    '- If today\'s context is sparse OR everything in the brief is stale, they are just doing office chatter — Auggie complaining about a typo, Bea pushing back on a deadline, Chris dropping a color note, Jess pinging about a podcast pitch. Real-office texture. That is BETTER than stale rehashing.',
    '- They like each other. They tease each other. There can be a small disagreement, but it resolves like adults.',
    '- No emojis. No exclamation points (Bea will not stand for them). ALL CAPS used sparingly for emphasis (OMG, ANYWAY) and only by Auggie.',
    '- Timestamps as "h:MMam" or "h:MMpm" (e.g., "2:14pm"). The conversation must have happened in the LAST 4-6 HOURS leading up to the current time above. **DO NOT timestamp anything in the future relative to now.** Example: if it is currently 4:23pm, the thread might run from roughly 10:15am to 4:10pm, progressing chronologically.',
    '',
    'OUTPUT FORMAT:',
    'Return JSON ONLY, no surrounding prose, no code fences. The exact shape:',
    '{"messages":[{"speaker":"Auggie","text":"...","timestamp":"9:12am"},{"speaker":"Bea","text":"...","timestamp":"9:14am"}]}',
  ].join('\n');

  const client = new Anthropic({ apiKey });

  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Render the channel now.' }],
    });
    const raw = (resp.content || [])
      .filter(b => b && b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    // Strip code fences if Claude added them despite the instruction
    let cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/, '').trim();
    // Sometimes the model leaks a leading sentence — pull the first { ... } block
    if (cleaned[0] !== '{') {
      const s = cleaned.indexOf('{');
      const e = cleaned.lastIndexOf('}');
      if (s >= 0 && e > s) cleaned = cleaned.slice(s, e + 1);
    }

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error('[floor-render] JSON parse failed', e && e.message, raw.slice(0, 300));
      return {
        statusCode: 502,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'render parse failed', raw_preview: raw.slice(0, 300) }),
      };
    }

    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, context_used: { date: context.date, item_count: context.items.length } }),
    };
  } catch (err) {
    console.error('[floor-render] failed', err && err.message);
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: (err && err.message) || 'floor render failed' }),
    };
  }
};
