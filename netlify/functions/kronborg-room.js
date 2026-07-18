/* ─────────────────────────────────────────────────────────────────────────────
   kronborg-room -- the Kronborg 1588 classroom's group table: any mix of the
   royal court and the townspeople of Helsingør, actually talking to each
   other and to the visitor, not just answering one at a time.

   Same director+cascade mechanic as ptx4990-group-ask.js (itself adapted
   from Almost Human's eq-room-group-ask.js): a cheap director call picks who
   speaks next, up to a small cascade cap, only the first beat is guaranteed.
   Free, ungated, self-contained -- imports the roster and tools from
   kronborg-chat.js, but duplicates nothing else, so this file can't put that
   one at risk.

   POST {
     active_agents: string[]              -- 2+ keys from AGENTS
     transcript: [{speaker, name, content}]  -- shared room log so far
                    (speaker is an agent key, or "visitor")
     message: string                       -- the visitor's new message
     visitor_name?: string
   }
   Returns {
     replies: [{agent_key, agent_name, reply, audio_script}],
     transcript_append: [{speaker, name, content}],
     active_agents: string[]
   }

   Env: ANTHROPIC_API_KEY
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { AGENTS, TOOLS, executeTool, cleanDashes, MODEL, phoneticVoiceScript, safeVisitorId, fetchVisitorMemory, saveVisitorMemory } = require('./kronborg-chat.js');

const DIRECTOR_MODEL = 'claude-haiku-4-5-20251001';
const CASCADE_CAP = 3;
const TURN_MAX_TOKENS = 500;
const TURN_TOOL_LOOP = 3;
const MAX_TRANSCRIPT_ENTRIES = 40;
const MAX_ROOM_AGENTS = 6;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

// Formats the shared transcript from ONE agent's point of view: their own
// past lines stay role:'assistant' (unprefixed), everyone else's lines
// (the visitor's and every other agent's) become role:'user', prefixed with
// who said it. Same pattern as ptx4990-group-ask.js's buildMessagesFor.
function buildMessagesFor(agentKey, transcript) {
  return transcript.map((entry) => {
    if (entry.speaker === agentKey) return { role: 'assistant', content: entry.content };
    return { role: 'user', content: `${entry.name}: ${entry.content}` };
  });
}

// One cheap Haiku call: who should speak next. Only beat 0 is forced (someone
// should always answer the visitor); every beat after that is genuine
// discretion, so the room doesn't lock into the same reply count every turn.
async function pickNextSpeaker(client, activeAgents, transcript, beatIndex, forced) {
  const roster = activeAgents.map((k) => `${k}: ${AGENTS[k].name}, ${AGENTS[k].title}. ${AGENTS[k].tagline}`).join('\n');
  const transcriptText = transcript.slice(-16).map((e) => `${e.name}: ${e.content}`).join('\n');
  const instruction = beatIndex === 0
    ? 'The visitor just said something new. Pick whoever at the table would naturally respond first, given the rigid social hierarchy of 1600s Denmark: royals are rarely interrupted, commoners generally defer unless the moment calls for bluntness.'
    : 'Judge this moment honestly, the way this specific social world actually works: often one reply is plenty and the room naturally pauses there, sometimes someone can\'t help reacting to what was just said, especially across the class divide between the castle and the town. Only pick a name if that person would genuinely, naturally have something to say about what the LAST person just said.';
  const prompt = `You're directing a real conversation in and around Kronborg Castle, Helsingør, in the age of Christian IV: a mix of royals and townspeople, and one visitor, actually talking to each other, not taking turns answering the visitor one at a time. People at the table:\n${roster}\n\n` +
    `Recent conversation:\n${transcriptText}\n\n${instruction}` +
    (forced ? ' Pick exactly one agent key from the roster above.' : ' Pick exactly one agent key from the roster above, or "none" if nobody would genuinely add anything right now.');

  const enumValues = forced ? [...activeAgents] : [...activeAgents, 'none'];
  const tool = {
    name: 'pick_speaker',
    description: forced ? 'Choose who speaks next.' : 'Choose who speaks next, or none.',
    input_schema: { type: 'object', properties: { speaker: { type: 'string', enum: enumValues } }, required: ['speaker'] },
  };

  try {
    const msg = await client.messages.create({
      model: DIRECTOR_MODEL,
      max_tokens: 50,
      messages: [{ role: 'user', content: prompt }],
      tools: [tool],
      tool_choice: { type: 'tool', name: 'pick_speaker' },
    });
    const toolBlock = (msg.content || []).find((b) => b.type === 'tool_use' && b.name === 'pick_speaker');
    const speaker = toolBlock && toolBlock.input && toolBlock.input.speaker;
    if (speaker && activeAgents.includes(speaker)) return speaker;
    return forced ? activeAgents[0] : null;
  } catch (err) {
    console.error('[kronborg-room] director failed (non-fatal):', err.message);
    return forced ? activeAgents[0] : null;
  }
}

// Bounded tool-use turn: same agentic loop as kronborg-chat.js's
// runAgentLoop, but capped lower (TURN_TOOL_LOOP) since a single group
// request can cascade through several agents' turns already.
async function runTurn(client, system, messages) {
  let current = [...messages];
  for (let i = 0; i < TURN_TOOL_LOOP; i++) {
    const resp = await client.messages.create({ model: MODEL, max_tokens: TURN_MAX_TOKENS, system, tools: TOOLS, messages: current });
    if (resp.stop_reason !== 'tool_use') {
      return resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    }
    current.push({ role: 'assistant', content: resp.content });
    const results = await Promise.all(
      resp.content.filter((b) => b.type === 'tool_use').map(async (b) => ({
        type: 'tool_result',
        tool_use_id: b.id,
        content: String(await executeTool(b.name, b.input)),
      }))
    );
    current.push({ role: 'user', content: results });
  }
  const fallback = await client.messages.create({ model: MODEL, max_tokens: TURN_MAX_TOKENS, system, messages: current });
  return fallback.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'invalid json' }); }

  const activeAgents = Array.isArray(body.active_agents)
    ? [...new Set(body.active_agents.map((a) => String(a || '').trim().toLowerCase()))].filter((a) => AGENTS[a])
    : [];
  if (activeAgents.length < 2) return json(400, { error: 'need_at_least_two_agents' });
  if (activeAgents.length > MAX_ROOM_AGENTS) return json(400, { error: 'too_many_agents', max: MAX_ROOM_AGENTS });

  const message = String(body.message || '').trim().slice(0, 2000);
  if (!message) return json(400, { error: 'message required' });

  const visitorName = String(body.visitor_name || '').trim().slice(0, 40) || 'the visitor';
  const visitorId = safeVisitorId(body.visitor_id);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const rawTranscript = Array.isArray(body.transcript) ? body.transcript : [];
  const transcript = rawTranscript
    .filter((e) => e && typeof e.content === 'string' && e.content.trim() && typeof e.name === 'string')
    .map((e) => ({ speaker: String(e.speaker || 'visitor'), name: e.name, content: e.content.trim() }))
    .slice(-MAX_TRANSCRIPT_ENTRIES);
  transcript.push({ speaker: 'visitor', name: visitorName, content: message });

  const client = new Anthropic({ apiKey });
  const replies = [];
  const transcriptAppend = [];
  let usedThisBeat = [];

  for (let beat = 0; beat < CASCADE_CAP; beat++) {
    const candidates = activeAgents.filter((a) => !usedThisBeat.includes(a));
    if (!candidates.length) break;
    const forced = beat === 0;
    let speaker;
    try {
      speaker = await pickNextSpeaker(client, candidates, transcript, beat, forced);
    } catch (_) { speaker = forced ? candidates[0] : null; }
    if (!speaker) break;
    usedThisBeat.push(speaker);

    const agent = AGENTS[speaker];
    const roommates = activeAgents.filter((k) => k !== speaker).map((k) => `${AGENTS[k].name} (${AGENTS[k].title})`);
    let turnPrompt = agent.system +
      `\n\nROOM CONTEXT\nYou are in a shared room in and around Kronborg with ${visitorName} and, also present: ${roommates.join('; ')}. This is a group conversation, not a private one-on-one.`;

    const visitorMemory = await fetchVisitorMemory(speaker, visitorId, serviceKey);
    if (visitorMemory) {
      turnPrompt += `\n\nWHAT YOU REMEMBER ABOUT ${visitorName.toUpperCase()}\n${visitorMemory}\nYou've spoken with them before; let that show naturally, without making a show of it.`;
    }

    if (beat > 0) {
      const lastEntry = transcript[transcript.length - 1];
      if (lastEntry && lastEntry.speaker !== 'visitor') {
        turnPrompt += `\n\n${lastEntry.name} just spoke, not the visitor, and this reply is to them, not to the visitor. React only to ${lastEntry.name}, the way you actually would given your real relationship and station relative to them (see ROOM DYNAMICS above): agree, disagree, correct them, defer, mock, whatever is true to your character. Do not turn back to address the visitor this beat, save that for your next real turn.`;
      }
    }

    const messages = buildMessagesFor(speaker, transcript);
    let replyText;
    try {
      replyText = await runTurn(client, turnPrompt, messages);
    } catch (err) {
      console.error('[kronborg-room] turn error for', speaker, err.message);
      continue;
    }
    if (!replyText) continue;
    replyText = cleanDashes(replyText);

    const entry = { speaker, name: agent.name, content: replyText };
    transcript.push(entry);
    transcriptAppend.push(entry);
    replies.push({ agent_key: speaker, agent_name: agent.name, reply: replyText, audio_script: phoneticVoiceScript(replyText) });

    await saveVisitorMemory(client, speaker, agent.name, visitorId, serviceKey, [...messages, { role: 'assistant', content: replyText }]);
  }

  return json(200, {
    replies,
    transcript_append: transcriptAppend,
    active_agents: activeAgents,
  });
};
