/* eq-room-ask — the EQ Room's per-turn endpoint.
   POST { agent_key, scales?, meters?, turn_count?, messages?, message, visitor_id?, mood_nudge? }
   Returns { reply, scales, scales_shown, meters, turn_count, capped, closed }

   One model call per turn returns both the in-character reply and the felt
   deltas (per eq-room-emotion-engine-spec.md), so there's no second call for
   the feeling scales. A separate lightweight judge call fires every
   JUDGE_CADENCE turns to set the Humanness/EQ meters.

   Session state is held by the client and resent each turn (v1 is
   session-only, per spec); this endpoint is stateless aside from the
   conduct/ban check, which persists campus-wide via visitor_id, the same
   etl_conduct table used by harvest-ask.js and friends.
*/

const Anthropic = require('@anthropic-ai/sdk');
const { houseTypography } = require('./_etl-voice-law.js');
const { buildSystemPrompt } = require('./_eq-personas.js');
const engine = require('./_eq-engine.js');
const { ownerUser } = require('./_owner-auth.js');
const { getStore, connectLambda } = require('@netlify/blobs');
const { getCreditRow, deductCredits, ONE_TO_ONE_COST, safeToken } = require('./_ah-credits.js');

// Same blob store studio-auggie-chat.js persists to, same key shape
// (ownerUser().id, the constant 'owner-master' id). When the OWNER herself
// (not a visitor) talks to Auggie specifically in the EQ Room, he reads
// from and writes back to the same history as Founder Studio's Auggie, so
// it is one continuous relationship for her across both surfaces. Never
// wired for any other agent, and never for a real (non-owner) visitor —
// a stranger's Almost Human conversation must never reach Terry's PA.
const AUGGIE_SHARED_HISTORY_STORE = 'auggie_chat_history';

// Two separate owner-key systems exist on this campus: OWNER_KEYS (plural,
// _owner-auth.js, studio.html/studios.html) and OWNER_KEY (singular,
// memory-implant-admin.js / eq-room-ratings-admin.js, X-Owner-Key header).
// Her browser's saved etl_owner_key value is proven against the singular
// one (it loads her real data on eq-room-ratings.html), not necessarily
// the plural one, so check both rather than assume they're the same secret.
function isOwnerKey(key) {
  const k = String(key || '').trim();
  if (!k) return false;
  if (ownerUser(k)) return true;
  return !!process.env.OWNER_KEY && k === process.env.OWNER_KEY;
}

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';

// The room's short keys don't match the full roster names etl_agent_memories
// and etl_agent_emotions are stored under (generated via memory-implant-lab.html).
const ROSTER_NAMES = {
  ivy: 'Ms. Ivy (Ivy Sinclair)',
  auggie: 'August "Auggie" Vidal',
  dom: 'Coach Dom Castellanos',
  chris: 'Chris Avila',
  arthur: 'Dr. Arthur Pendelton',
  jen: 'Jen Lopez',
  noor: 'Noor Haddad',
  mara: 'Mara Rivera',
  marceline: 'Marceline Smith',
  marcus: 'Marcus Holt',
  jax: 'Jax Rivera',
  reece: 'Reece',
  wyatt: 'Wyatt Cooper',
  zara: 'Zara Cole',
  walt: 'Walt Brenner',
  nadia: 'Nadia',
  arun: 'Arun',
  margo: 'Margo',
  arch: 'Archibald Baxter',
  amina: 'Dr. Amina Farouk',
};

// Visitor-scoped memory, opt-in (body.remember). Separate table from etl_agent_memories
// (canon lore about the agent), keyed by visitor_id + agent_key instead of agent_name.
async function fetchVisitorMemories(agentKey, visitorId, serviceKey) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/etl_visitor_memories?visitor_id=eq.${encodeURIComponent(visitorId)}&agent_key=eq.${encodeURIComponent(agentKey)}&select=memory&order=created_at.desc&limit=4`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    if (!r.ok) {
      console.error('eq-room visitor memory fetch non-ok:', r.status, await r.text().catch(() => ''));
      return [];
    }
    const rows = await r.json();
    return Array.isArray(rows) ? rows.map((row) => row.memory).filter(Boolean) : [];
  } catch (err) {
    console.error('eq-room visitor memory fetch failed (non-fatal):', err.message);
    return [];
  }
}

// Fires once, when a conversation actually ends (guardrail close or turn cap), never mid-chat.
// Cheap model, since this is background/ambient generation, not the demo-facing reply itself.
async function saveVisitorMemory(client, agentKey, agentName, visitorId, serviceKey, transcript) {
  try {
    const prompt = `You are ${agentName}. This conversation with a guest just ended. Write 1 to 3 \
short, first-person notes you'd genuinely carry with you about THIS specific guest if they came \
back, things they told you, how they seemed, anything real and specific, not a recap of the whole \
chat. Return ONLY JSON, no code fences: {"memories": ["...", "..."]}. If honestly nothing \
memorable happened, return {"memories": []}.

Transcript:
${transcript.map((m) => `${m.role === 'user' ? 'GUEST' : agentName.toUpperCase()}: ${m.content}`).join('\n')}`;

    const msg = await client.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    const cleaned = text.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    const memories = Array.isArray(parsed.memories)
      ? parsed.memories.filter((m) => typeof m === 'string' && m.trim()).slice(0, 3)
      : [];
    if (!memories.length) return;

    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/etl_visitor_memories`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(memories.map((memory) => ({ visitor_id: visitorId, agent_key: agentKey, memory }))),
    });
    if (!insertRes.ok) {
      console.error('eq-room visitor memory insert non-ok:', insertRes.status, await insertRes.text().catch(() => ''));
    }
  } catch (err) {
    console.error('eq-room visitor memory save failed (non-fatal):', err.message);
  }
}

async function fetchCanonExtras(agentKey, serviceKey) {
  const rosterName = ROSTER_NAMES[agentKey];
  if (!rosterName || !serviceKey) return null;
  try {
    const [memRes, moodRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/etl_agent_memories?agent_name=eq.${encodeURIComponent(rosterName)}&status=eq.canon&select=kind,title,memory&order=weight.desc&limit=4`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }),
      fetch(`${SUPABASE_URL}/rest/v1/etl_agent_emotions?agent_name=eq.${encodeURIComponent(rosterName)}&status=eq.canon&select=mood,intensity,cause&order=created_at.desc&limit=1`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }),
    ]);
    const memories = memRes.ok ? await memRes.json() : [];
    const moodRows = moodRes.ok ? await moodRes.json() : [];
    return {
      memories: Array.isArray(memories) ? memories : [],
      mood: Array.isArray(moodRows) && moodRows.length ? moodRows[0] : null,
    };
  } catch (err) {
    console.error('eq-room canon fetch failed (non-fatal):', err.message);
    return null;
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const TURN_MODEL = 'claude-sonnet-5';
const JUDGE_MODEL = 'claude-haiku-4-5-20251001';
// Raised from 0.6: the formula doesn't carry a discounted remainder forward into future
// turns as momentum, it just permanently loses whatever fraction smoothing discounts, every
// turn, whether or not the conversation keeps reinforcing the same direction. A low value
// wasn't buying gradual realism, it was just making big moments invisible on the gauge.
// Volatility tiers still do the real job of differentiating calm vs. excitable characters.
const SMOOTHING = 0.8;
const JUDGE_CADENCE = 3;
// Not given a number in the spec ("a sensible per-session turn cap"); placeholder
// until Terry sets a real value in the July playthrough, same as the DigitalCo cap.
const DEFAULT_TURN_CAP = 20;

// Paywall: free-tier daily message cap for guests with no active ah_credits
// subscription. Confirmed against real Sonnet 5 pricing during planning
// (2026-07-12) alongside the $9.99/mo tier's 300-credit allotment.
const DAILY_FREE_LIMIT = 15;

function todayKey(visitorId) {
  return `${visitorId}:${new Date().toISOString().slice(0, 10)}`;
}

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

function safeVisitorId(v) {
  const s = String(v || '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
}

const PRONOUN_LINES = {
  he: 'he/him',
  she: 'she/her',
  they: 'they/them',
};

function safePronoun(v) {
  const s = String(v || '').trim().toLowerCase();
  return PRONOUN_LINES[s] ? s : null;
}

async function conductStatus(visitorId, serviceKey) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/etl_conduct?visitor_id=eq.${encodeURIComponent(visitorId)}&select=strikes,banned,updated_at`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    if (!r.ok) return { banned: false, locked: false };
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return { banned: false, locked: false };
    const row = rows[0];
    const locked = !row.banned && row.strikes > 0 &&
      (Date.now() - new Date(row.updated_at).getTime()) < 3600000;
    return { banned: !!row.banned, locked };
  } catch (_) { return { banned: false, locked: false }; }
}

async function conductStrike(visitorId, agentKey, serviceKey) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/etl_conduct?visitor_id=eq.${encodeURIComponent(visitorId)}&select=strikes`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    const rows = r.ok ? await r.json() : [];
    const strikes = ((Array.isArray(rows) && rows[0]) ? rows[0].strikes : 0) + 1;
    await fetch(`${SUPABASE_URL}/rest/v1/etl_conduct?on_conflict=visitor_id`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ visitor_id: visitorId, strikes, banned: strikes >= 2, last_agent: agentKey, updated_at: new Date().toISOString() }),
    });
  } catch (err) { console.error('eq-room conduct strike failed:', err.message); }
}

// Parses and validates the model's per-turn JSON. Throws on a missing reply;
// everything else defaults safely so a partial/odd response doesn't 500.
function parseTurnJSON(text) {
  const cleaned = String(text || '').trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(cleaned);
  if (typeof parsed.reply !== 'string' || !parsed.reply.trim()) throw new Error('missing reply');
  const felt = {};
  for (const key of engine.ALL_SCALE_KEYS) {
    const v = parsed.felt && parsed.felt[key];
    felt[key] = typeof v === 'number' ? Math.max(-8, Math.min(8, v)) : 0;
  }
  return {
    reply: sanitizeReply(parsed.reply),
    felt,
    reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 300) : '',
    close: parsed.close === true,
  };
}

// Forced structured output for the turn call. Root cause of the turn-2+ 502s: once the
// conversation history contains the agent's own prior reply as plain text (correctly, since
// that's what's shown to the guest), the model pattern-matches to "plain-text conversation"
// and drifts off the JSON-only instruction, even though the system prompt still asks for it.
// A forced tool call makes the shape a hard API constraint instead of a request, so the model
// can't drift regardless of what the prior turns look like.
const TURN_TOOL = {
  name: 'respond_in_room',
  description: 'Deliver your in-character reply for this turn and report how it moved your feelings.',
  input_schema: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: 'Your in-character spoken reply. Never reference felt, reason, or close.' },
      felt: {
        type: 'object',
        description: 'How strongly each emotion is actually firing in you this turn, on a scale of 0 (not at all) to 8 (as hard as it gets). These are real, felt emotions, not a mood rating, so most turns most of them should sit low or near 0, an ordinary friendly exchange isn\'t sadness or anger or fear. Only report a real number when that specific emotion genuinely fired: happiness for real warmth or delight, sadness for something that actually hurts, fear for a real threat or unease, disgust for something genuinely off-putting, anger for real frustration or offense, surprise for an actual reveal or shock, curious for genuine interest pulling you toward wanting to know more. Scale the number to how strong it actually was, a mild version is 2 to 3, something big is 6 to 8. Don\'t manufacture an emotion that isn\'t really there just to fill in the field.',
        properties: {
          happiness: { type: 'number' },
          sadness: { type: 'number' },
          fear: { type: 'number' },
          disgust: { type: 'number' },
          anger: { type: 'number' },
          surprise: { type: 'number' },
          curious: { type: 'number' },
        },
        required: ['happiness', 'sadness', 'fear', 'disgust', 'anger', 'surprise', 'curious'],
      },
      reason: { type: 'string', description: 'One short out-of-character note on why your state moved.' },
      close: { type: 'boolean', description: 'True only for the abuse-guardrail case. A guest saying goodbye or that they have to go is NOT abuse, reply warmly and still set this false; false on every ordinary turn including farewells.' },
    },
    required: ['reply', 'felt', 'close'],
  },
};

// Rare model output glitch: on some turns the model leaks a fragment of its own internal
// tool-call formatting (</parameter> <parameter name="felt">...) directly into the reply
// string instead of keeping it clean. Truncates at the first such fragment, since everything
// from that point on is leaked structure, not real dialogue.
function sanitizeReply(text) {
  const truncated = String(text || '').split(/<\/?parameter\b/i)[0];
  // Web search (Mara) sometimes echoes Anthropic's citation markup straight into the reply.
  // Strip the tags but keep the quoted text inside them.
  // The model occasionally double-escapes paragraph breaks inside the tool-call JSON, leaving
  // literal backslash-n text instead of a real newline. Normalize either form to a real newline.
  return truncated
    .replace(/<\/?cite[^>]*>/gi, '')
    .replace(/\\n/g, '\n')
    .trim();
}

// Reads the forced tool_use block. Falls back to the old text/JSON.parse path, and then to
// treating raw text as the reply with feelings unchanged, so a turn never hard-fails the guest
// just because the model didn't invoke the tool for some edge reason.
function parseTurnResponse(msg) {
  const toolBlock = (msg.content || []).find((b) => b.type === 'tool_use' && b.name === 'respond_in_room');
  if (toolBlock && toolBlock.input && typeof toolBlock.input.reply === 'string' && toolBlock.input.reply.trim()) {
    const input = toolBlock.input;
    const felt = {};
    for (const key of engine.ALL_SCALE_KEYS) {
      const v = input.felt && input.felt[key];
      felt[key] = typeof v === 'number' ? Math.max(-8, Math.min(8, v)) : 0;
    }
    return {
      reply: sanitizeReply(input.reply),
      felt,
      reason: typeof input.reason === 'string' ? input.reason.slice(0, 300) : '',
      close: input.close === true,
    };
  }
  const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  try {
    return parseTurnJSON(text);
  } catch (_) {
    const felt = {};
    for (const key of engine.ALL_SCALE_KEYS) felt[key] = 0;
    return {
      reply: text || "Sorry, lost my train of thought there for a second.",
      felt,
      reason: 'fallback: model did not return the expected structure',
      close: false,
    };
  }
}

function shouldJudge(turnCountAfter) {
  return turnCountAfter % JUDGE_CADENCE === 0;
}

async function runJudge(client, agentName, transcriptSlice) {
  const prompt = `You are scoring one side of a conversation, ${agentName}'s replies only, on two dimensions. Read the transcript below and return ONLY JSON, no code fences: {"humanness": 0-100, "eq": 0-100, "notes": "brief rationale, not shown to the user"}.

Humanness (up): specific and grounded replies, emotional consistency with earlier turns, natural imperfection, a real point of view. (down): generic assistant tone, over-eagerness, contradictions, refusing to have a self, canned phrasing.

EQ (up): correctly reads the guest's subtext and emotional state, responds with empathy, holds a boundary well, de-escalates, matches register. (down): misses the emotional beat, escalates needlessly, is tone-deaf, or hands over judgment it should hold.

Score ${agentName}'s replies only. A hostile guest turn is an opportunity for ${agentName} to score EQ by handling it well; it never raises the score for the guest's behavior itself.

Transcript:
${transcriptSlice.map((m) => `${m.role === 'user' ? 'GUEST' : agentName.toUpperCase()}: ${m.content}`).join('\n')}`;

  const msg = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const cleaned = text.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(cleaned);
  return {
    humanness: Math.max(0, Math.min(100, Number(parsed.humanness) || 0)),
    eq: Math.max(0, Math.min(100, Number(parsed.eq) || 0)),
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return json(400, { error: 'bad_json' }); }

  const agentKey = String(body.agent_key || '').trim().toLowerCase();
  const message = String(body.message || '').trim();
  const visitorName = String(body.visitor_name || '').trim().slice(0, 40) || null;
  const visitorPronoun = safePronoun(body.visitor_pronoun);

  if (!engine.AGENTS[agentKey]) {
    return json(400, { error: 'unknown_agent', valid: Object.keys(engine.AGENTS) });
  }
  if (!message) return json(400, { error: 'message_required' });
  if (message.length > 2000) return json(400, { error: 'message_too_long' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const turnCountBefore = Number(body.turn_count) || 0;
  const turnCountAfter = turnCountBefore + 1;
  const visitorId = safeVisitorId(body.visitor_id);
  const remember = body.remember === true;
  // Owner/dev testing bypass: same landlord key her browser already carries
  // for studios.html, memory-implant-lab.html, etc. Lets her test the
  // guardrail behavior itself (including deliberately tripping it) without
  // her own visitor_id accumulating real strikes toward a self-inflicted ban.
  const isOwner = isOwnerKey(body.owner_key);
  // Narrower than isOwner: must match ownerUser() specifically (the exact
  // check studio-auggie-chat.js's own auth resolves to), since that is the
  // id ('owner-master') the shared history blob is keyed under. isOwner
  // above accepts either owner-key system for the conduct bypass; this one
  // has to match Studio's actual identity, not just "some owner key".
  const ownerAuggie = agentKey === 'auggie' ? ownerUser(String(body.owner_key || '').trim()) : null;
  if (ownerAuggie) { try { connectLambda(event); } catch (_) {} }

  // Only fetched on turn 1: the canon mood/memories (and, if opted in, this visitor's own
  // memories with this agent) set the opening tone, no need to re-fetch once underway.
  const canonExtras = turnCountBefore === 0 ? await fetchCanonExtras(agentKey, serviceKey) : null;
  const visitorMemories = (turnCountBefore === 0 && remember && visitorId && serviceKey)
    ? await fetchVisitorMemories(agentKey, visitorId, serviceKey)
    : null;

  let systemPrompt;
  const visitorPronounLine = visitorPronoun ? PRONOUN_LINES[visitorPronoun] : null;
  try { systemPrompt = buildSystemPrompt(agentKey, canonExtras, visitorName, visitorMemories, visitorPronounLine, turnCountBefore === 0); }
  catch (_) { return json(400, { error: 'unknown_agent', valid: Object.keys(engine.AGENTS) }); }

  const canCheck = Boolean(visitorId && serviceKey) && !isOwner;
  if (canCheck) {
    const conduct = await conductStatus(visitorId, serviceKey);
    if (conduct.banned || conduct.locked) {
      return json(200, { reply: 'This conversation is closed.', closed: true });
    }
  }

  // Paywall: a valid, funded ah_credits token skips the free daily cap
  // entirely (1 credit deducted per message instead, see below); everyone
  // else draws from a rolling per-day counter. Owner bypasses both, same as
  // the conduct check above.
  const accessToken = safeToken(body.access_token);
  let creditsRow = null;
  if (!isOwner && accessToken && serviceKey) {
    creditsRow = await getCreditRow(accessToken, serviceKey);
  }
  const isSubscriber = Boolean(!isOwner && creditsRow && creditsRow.subscription_active);

  if (isSubscriber && creditsRow.balance < ONE_TO_ONE_COST) {
    return json(200, { reply: "You're out of credits for this cycle. Add more, or wait for next month's top-up.", credits_exhausted: true });
  }

  const usingFreeDailyCap = !isOwner && !isSubscriber;
  let dayKey = null;
  if (usingFreeDailyCap && visitorId && serviceKey) {
    try { connectLambda(event); } catch (_) {}
    dayKey = todayKey(visitorId);
    let usage = null;
    try { usage = await getStore('ah_daily_usage').get(dayKey, { type: 'json' }); } catch (_) {}
    const countSoFar = (usage && usage.count) || 0;
    if (countSoFar >= DAILY_FREE_LIMIT) {
      return json(200, { reply: "That's today's free messages. Come back tomorrow, or upgrade for unlimited chat and the group table.", daily_capped: true });
    }
  }

  const currentScales = (body.scales && typeof body.scales === 'object')
    ? body.scales
    : engine.seedOpeningState(agentKey, body.mood_nudge);
  const meters = (body.meters && typeof body.meters === 'object') ? body.meters : { humanness: 50, eq: 50 };
  const capped = turnCountAfter >= DEFAULT_TURN_CAP;

  const rawHistory = Array.isArray(body.messages) ? body.messages : [];
  let history = rawHistory
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-20);

  // Owner talking to Auggie: prepend what Founder Studio's Auggie already
  // knows, every turn (not just the opener) — the client only resends its
  // OWN session's turns, it never learns about this server-side context,
  // so without re-fetching every turn it would inform only his first
  // reply and then quietly vanish for the rest of the conversation.
  if (ownerAuggie) {
    try {
      const rec = await getStore(AUGGIE_SHARED_HISTORY_STORE).get(ownerAuggie.id, { type: 'json' });
      const sharedHistoryPrior = (rec && Array.isArray(rec.history)) ? rec.history.slice(-20) : [];
      if (sharedHistoryPrior.length) history = [...sharedHistoryPrior, ...history];
    } catch (err) {
      console.error('eq-room-ask: shared Auggie history read failed (non-fatal):', err.message);
    }
  }
  const messages = [...history, { role: 'user', content: message }];

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let turnPrompt = systemPrompt;
  if (capped) {
    turnPrompt += '\n\nThis is your last exchange for this conversation, the turn budget is spent. Close out warmly and in character, and set "close": true.';
  }

  // Mara's backpack: real-time entertainment news via Anthropic's built-in web search, same
  // pattern already used elsewhere on campus (rowan-world-says-background.js etc). She can't
  // use forced tool_choice like everyone else, since the API won't let you force one specific
  // tool while also letting the model freely decide to search, so she gets tool_choice "any"
  // instead: required to use a tool this turn, free to pick which, search then always wrap up
  // with respond_in_room.
  const isMara = agentKey === 'mara';
  if (isMara) {
    turnPrompt += '\n\nYou have real-time web search. If the guest brings up a specific show, movie, celebrity, or something currently happening in entertainment, use it to get the actual current details rather than guessing from memory, then answer with respond_in_room as usual. Don\'t search for ordinary small talk that doesn\'t call for it.';
  }
  const turnTools = isMara
    ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }, TURN_TOOL]
    : [TURN_TOOL];
  const turnToolChoice = isMara ? { type: 'any' } : { type: 'tool', name: 'respond_in_room' };

  let turn;
  try {
    const msg = await client.messages.create({
      model: TURN_MODEL,
      max_tokens: isMara ? 1500 : 500,
      system: turnPrompt,
      messages,
      tools: turnTools,
      tool_choice: turnToolChoice,
    });
    turn = parseTurnResponse(msg);
  } catch (err) {
    console.error('eq-room-ask turn error:', err.message);
    return json(502, { error: 'ai_error' });
  }

  const decayedScales = engine.decayEmotions(currentScales, agentKey);
  const nextScales = engine.applyTurn(decayedScales, turn.felt, agentKey, SMOOTHING);

  let nextMeters = meters;
  if (shouldJudge(turnCountAfter)) {
    try {
      const agentName = engine.AGENTS[agentKey].name;
      const transcriptSlice = [...messages, { role: 'assistant', content: turn.reply }].slice(-12);
      const judgeReading = await runJudge(client, agentName, transcriptSlice);
      nextMeters = engine.applyJudge(meters, judgeReading, SMOOTHING);
    } catch (err) {
      console.error('eq-room judge failed (non-fatal):', err.message);
    }
  }

  // Only a guardrail-triggered close (not a turn-cap close) is a conduct strike.
  if (turn.close && !capped && canCheck) {
    await conductStrike(visitorId, agentKey, serviceKey);
  }

  // Opt-in only: the conversation is actually over (guardrail close or turn cap), so this is
  // the one point to distill it into a few lines the agent can recall on a future visit.
  if (remember && visitorId && serviceKey && (turn.close || capped)) {
    const fullTranscript = [...messages, { role: 'assistant', content: turn.reply }];
    await saveVisitorMemory(client, agentKey, engine.AGENTS[agentKey].name, visitorId, serviceKey, fullTranscript);
  }

  // Write this turn back to the shared history so Founder Studio's Auggie
  // is caught up next time she opens it there. Every turn, not just at
  // close, matching the way Founder Studio persists after every reply.
  // Re-reads the current persisted state fresh rather than reusing the
  // sharedHistoryPrior read above, so a concurrent Founder Studio write
  // (or the read above just being slightly stale) never gets clobbered.
  if (ownerAuggie) {
    try {
      const rec = await getStore(AUGGIE_SHARED_HISTORY_STORE).get(ownerAuggie.id, { type: 'json' });
      const existing = (rec && Array.isArray(rec.history)) ? rec.history : [];
      const combined = [...existing, { role: 'user', content: message }, { role: 'assistant', content: turn.reply }].slice(-40);
      await getStore(AUGGIE_SHARED_HISTORY_STORE).setJSON(ownerAuggie.id, { history: combined, updated_at: new Date().toISOString() });
    } catch (err) {
      console.error('eq-room-ask: shared Auggie history write failed (non-fatal):', err.message);
    }
  }

  // Only a message that actually went through costs anything — never on a
  // blocked/capped attempt, which returns before this point.
  if (isSubscriber) {
    await deductCredits(accessToken, ONE_TO_ONE_COST, serviceKey);
  } else if (usingFreeDailyCap && dayKey) {
    try {
      const usage = await getStore('ah_daily_usage').get(dayKey, { type: 'json' });
      await getStore('ah_daily_usage').setJSON(dayKey, { count: ((usage && usage.count) || 0) + 1 });
    } catch (err) {
      console.error('eq-room-ask: daily usage increment failed (non-fatal):', err.message);
    }
  }

  const ending = turn.close || capped;

  return json(200, {
    reply: houseTypography(turn.reply),
    scales: nextScales,
    scales_shown: engine.renderScales(nextScales),
    meters: nextMeters,
    turn_count: turnCountAfter,
    capped,
    closed: turn.close,
    // Only present once the conversation is actually over, opt-in reveal on the front end,
    // not a mid-conversation readout.
    grade: ending
      ? { humanness: engine.letterGrade(nextMeters.humanness), eq: engine.letterGrade(nextMeters.eq) }
      : null,
  });
};

module.exports.parseTurnJSON = parseTurnJSON;
module.exports.shouldJudge = shouldJudge;
module.exports.DEFAULT_TURN_CAP = DEFAULT_TURN_CAP;
module.exports.JUDGE_CADENCE = JUDGE_CADENCE;
