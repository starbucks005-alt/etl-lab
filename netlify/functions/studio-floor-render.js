/* ─────────────────────────────────────────────────────────────────────────────
   studio-floor-render

   Renders The Floor — the inter-staff chat surface in Dr. O's Studio.
   When she opens The Floor panel, this function generates a believable
   Slack-style thread between her active staff members (currently Auggie,
   Bea, Chris, Jess) discussing today's real events, in voice.

   Render-on-open, not heartbeat. No LLM cost when the panel is closed.
   Each open generates a fresh thread (no caching) so the conversation
   stays current with today's actual context.

   POST body: { mode?: 'workfloor' | 'watercooler' }
     - workfloor (default): work-focused chatter — typo to fix, deadline
       to negotiate, color call, podcast pitch, real-office texture.
     - watercooler: lighthearted off-topic banter — weekend plans, the
       espresso, podcast they're personally listening to, family
       update, the joke about Auggie's blazer. No client deliverables.
   Returns: { messages: [{speaker, text, timestamp}, ...], mode }
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
/* Auto-cast: STAFF is built from data/etl-agents-roster.json at runtime.
   Names in STUDIO_FLOOR_CAST must match the roster's name field exactly.
   To add a new Studio hire to the Floor: add their canonical name here,
   no other code changes needed. Their persona is composed from the
   roster's background + floor_chat fields, so updating the Excel cascades. */
const STUDIO_FLOOR_CAST = new Set([
  'August "Auggie" Vidal',
  'Beatriz "Bea" Vega',
  'Chris',
  'Jess Ramirez',
  'Jax Rivera',
  // ── Add new Studio hires here. Match the exact name from
  //    data/etl-agents-roster.json. Examples for future hires:
  // 'Alicia James', 'Leo Vance', 'Kimberly Pass', 'Sasha Moreno',
  // 'Yuki Mendel', 'Rowan Tate', 'Iris S. King',
]);

let ROSTER;
try {
  ROSTER = require('../../data/etl-agents-roster.json');
} catch (e) {
  console.error('[floor-render] roster JSON load failed:', e && e.message);
  ROSTER = { agents: [] };
}

/* Pick a short display name for the Floor.
   "August \"Auggie\" Vidal" -> "Auggie"
   "Beatriz \"Bea\" Vega"   -> "Bea"
   "Jax Rivera"             -> "Jax"
   "Chris"                  -> "Chris" */
function shortName(fullName) {
  const nicknameMatch = fullName.match(/"([^"]+)"/);
  if (nicknameMatch) return nicknameMatch[1];
  return fullName.split(' ')[0];
}

/* Build the floor persona from the roster's background + floor_chat fields.
   These are the "school / family / story" + "watercooler personality"
   columns from the Excel. We deliberately skip "bio" (what they do for
   clients) because the Floor is office chatter, not deliverables. */
function buildPersona(agent) {
  const parts = [];
  if (agent.background) parts.push(agent.background);
  if (agent.floor_chat) parts.push(agent.floor_chat);
  return parts.join('\n\n');
}

const STAFF = (ROSTER.agents || [])
  .filter(a => STUDIO_FLOOR_CAST.has(a.name))
  .map(a => ({
    name: shortName(a.name),
    role: a.role || '',
    persona: buildPersona(a),
  }));
console.log('[floor-render] STAFF auto-cast from roster:', STAFF.length, 'members:', STAFF.map(s => s.name).join(', '));

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

  // Mode toggle for Workfloor vs Watercooler tabs in the Studio UI.
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const mode = (body.mode === 'watercooler') ? 'watercooler' : 'workfloor';

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

  // Two channels — Workfloor (work focus) and Watercooler (lighthearted
   // off-topic). Same staff, same voices, different topic scope.
  const channelLabel = mode === 'watercooler' ? 'The Watercooler' : 'The Workfloor';
  const channelDescription = mode === 'watercooler'
    ? [
        'This is the WATERCOOLER channel — off-topic, lighthearted. Personal banter only.',
        'They are NOT discussing client work, deadlines, drafts, or deliverables in this channel — that goes in the Workfloor channel.',
        'Topics fair game here: weekend plans, the espresso, a podcast someone\'s listening to, a family update (Bea\'s grandkid, Jess\'s wedding-planning friend), the joke about Auggie\'s blazer, a color swatch Chris saw on a sunset, the bf who made fresh-squeezed OJ, the Trina Turk kaftan Auggie almost wore, Devon calling Auggie at 2am about wardrobe again, a TV show, a typo joke that has nothing to do with anyone\'s work.',
        'Reality check: if context.items contains real work events from today, the staff KNOW about them but in THIS channel they are not discussing them. They\'re taking a break.',
        'This channel is what makes the office feel alive between the work happening.',
      ].join('\n')
    : [
        'This is the WORKFLOOR channel — work-focused. Real-office texture.',
        'They are discussing today\'s actual work: a typo Bea caught, a deadline Jess is negotiating, a cover comp Chris is finalizing, a calendar conflict Auggie spotted, a Forbes piece getting traction, a podcast pitch landing or not.',
        'Reference REAL items from today\'s context when relevant. Do not invent fictional meetings, fake names, or things that did not happen.',
        'Off-topic banter is for the Watercooler channel — keep this one to work that actually shipped or is in flight today.',
      ].join('\n');

  const systemPrompt = [
    'You are rendering ' + channelLabel + ' — an inter-staff Slack channel at Dr. Terry Oroszi\'s Studio.',
    '',
    'Ms. Terry (the principal) is NOT in this channel right now. She just opened the door and walked over. You are rendering what her staff WOULD be saying to each other right now, in voice, based on what actually happened in her Studio today.',
    '',
    'CHANNEL: ' + channelLabel,
    channelDescription,
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
    '- Stay in each character\'s voice. Use their persona text above to render their register exactly.',
    '- **Rhythm rule (CRITICAL)**: Not every staff member is equally talkative. If a persona mentions "headphones on," "observer," "quiet," "deadpan," "behind performed politeness," or similar introvert markers, that character sends roughly HALF as many messages as the extroverts (typically Auggie and Jess). Their messages are SHORT — one sentence, often deadpan or a single tactical drop (a metric, a one-word reaction, a flat callback). They DO NOT laugh at the bit out loud; you can tell they are tracking it without joining in. They are the silence in the room that makes the others sound louder.',
    '',
    '- **JAX SPECIFICALLY (named override)**: Jax is 18, Hispanic, Gen Z, and surrounded by adults two to five decades older than him. He speaks LESS than anyone else on the channel — at most ONE message per 8-12 message thread, sometimes ZERO. When he does speak, it is:',
    '  • Lowercase (he does not capitalize sentence starts the way Auggie does; he is not performing for the room)',
    '  • One short sentence, often a stat or a search-trend number ("search for trina turk kaftan up 14 percent today")',
    '  • OR a flat one-word landing on the bit that just happened ("noted." / "tracked.")',
    '  • OR a tactical drop nobody asked for ("ctr on the august post is at 3.1")',
    '  Jax NEVER:',
    '  - Says "love that" or "obsessed" or any extrovert affirmation',
    '  - Says "I have a podcast in mind" or anything Jess-coded',
    '  - Uses ALL CAPS for emphasis (that is Auggie\'s tic, not his)',
    '  - Uses exclamation points (Bea bans them, Jax just doesn\'t care for them)',
    '  - Says "you are SO right" or laughs at Bea\'s lines (he tracks them without joining the bit out loud)',
    '  - Refers to himself or his work — he just drops a number and disengages',
    '  Use this Jax voice in EVERY render where he is in the cast. If you produce a Jax message that reads warm or chatty, you have rendered him wrong; rewrite that line before returning.',
    '- **Freshness rule**: If the morning brief surfaces a Forbes article, mention, or piece of news that is more than 30 days old, the staff have ALREADY discussed it in previous Floor sessions and are bored of it. They DO NOT fixate on it. They pivot. NEVER let the channel be stuck on Dr. Oroszi\'s Forbes piece from last year. She has published a lot since; the staff know that.',
    '- They like each other. They tease each other. There can be a small disagreement, but it resolves like adults.',
    '- No emojis. No exclamation points (Bea will not stand for them). ALL CAPS used sparingly for emphasis (OMG, ANYWAY) and only by Auggie.',
    '- Timestamps as "h:MMam" or "h:MMpm" (e.g., "2:14pm"). The conversation must have happened in the LAST 4-6 HOURS leading up to the current time above. **DO NOT timestamp anything in the future relative to now.**',
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
      body: JSON.stringify({ messages, mode, context_used: { date: context.date, item_count: context.items.length } }),
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
