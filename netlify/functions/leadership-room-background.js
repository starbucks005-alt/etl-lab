/* ─────────────────────────────────────────────────────────────────────────────
   leadership-room-background -- the actual multi-agent cascade for the ETL
   Leadership Classroom's group table. A Netlify Background Function (the
   "-background" filename suffix grants the extended execution budget), same
   pattern as kronborg-room-background.js: director pick -> visitor-memory
   fetch -> agent turn (possibly with a tool call) -> visitor-memory save,
   per beat, up to CASCADE_CAP beats.

   POST { job_id, active_agents, transcript, message, visitor_name?,
          visitor_id?, agent_state? }
   Fired by leadership-room.js via fire-and-forget fetch. Writes the result to
   the `leadership_room_jobs` Blobs store at key `<job_id>`;
   leadership-room-status reads it back for the frontend to poll.
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');
const {
  AGENTS, TOOLS, DELIVER_REPLY_TOOL, extractDeliverReply, extractPlainText,
  executeTool, cleanDashes, MODEL, safeVisitorId, fetchVisitorMemory, saveVisitorMemory,
} = require('./leadership-chat.js');
const engine = require('./_leadership-engine.js');

const DIRECTOR_MODEL = 'claude-haiku-4-5-20251001';
const CASCADE_CAP = 3;
const TURN_MAX_TOKENS = 500;
const TURN_TOOL_LOOP = 3;
const JOB_STORE = 'leadership_room_jobs';

// Formats the shared transcript from ONE agent's point of view: their own
// past lines stay role:'assistant' (unprefixed), everyone else's lines
// (the visitor's and every other agent's) become role:'user', prefixed with
// who said it. Same pattern as kronborg-room-background.js's buildMessagesFor.
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
    ? 'The visitor just said something new. Pick whoever at the table would naturally respond first, given their real personality and the substance of what was just asked.'
    : 'Judge this moment honestly: often one reply is plenty and the room naturally pauses there, sometimes someone can\'t help reacting to what was just said, especially across sharply different leadership philosophies. Only pick a name if that person would genuinely, naturally have something to say about what the LAST person just said.';
  const prompt = `You're directing a real conversation among a small group of historical leaders gathered for a graduate leadership seminar, actually talking to each other and to one visitor, not taking turns answering the visitor one at a time. People at the table:\n${roster}\n\n` +
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
    console.error('[leadership-room-background] director failed (non-fatal):', err.message);
    return forced ? activeAgents[0] : null;
  }
}

// Bounded tool-use turn: same agentic loop as leadership-chat.js's
// runAgentLoop, but capped lower (TURN_TOOL_LOOP) since a single group
// request can cascade through several agents' turns already. Returns
// { text, felt } -- same forced deliver_reply pattern as the 1:1 chat, so
// group-room agents feel things too, not just their 1:1 selves.
async function runTurn(client, system, messages) {
  let current = [...messages];
  for (let i = 0; i < TURN_TOOL_LOOP; i++) {
    const resp = await client.messages.create({ model: MODEL, max_tokens: TURN_MAX_TOKENS, system, tools: TOOLS, messages: current });
    const delivered = extractDeliverReply(resp);
    if (delivered) return delivered;
    if (resp.stop_reason !== 'tool_use') return extractPlainText(resp);
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
  const fallback = await client.messages.create({
    model: MODEL, max_tokens: TURN_MAX_TOKENS, system, messages: current,
    tools: [DELIVER_REPLY_TOOL], tool_choice: { type: 'tool', name: 'deliver_reply' },
  });
  return extractDeliverReply(fallback) || extractPlainText(fallback);
}

async function runCascade(activeAgents, transcript, visitorName, visitorId, serviceKey, rawAgentState) {
  const client = new Anthropic({ apiKey: process.env.ETL_CLASSROOMS_API_KEY });
  const replies = [];
  const transcriptAppend = [];
  const nextAgentState = {};
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
      `\n\nROOM CONTEXT\nYou are at a shared table with ${visitorName} and, also present: ${roommates.join('; ')}. This is a group conversation among leaders from different eras and movements, brought together for a graduate leadership seminar, not a private one-on-one.`;

    const visitorMemory = await fetchVisitorMemory(speaker, visitorId, serviceKey);
    if (visitorMemory) {
      turnPrompt += `\n\nWHAT YOU REMEMBER ABOUT ${visitorName.toUpperCase()}\n${visitorMemory}\nYou've spoken with them before; let that show naturally, without making a show of it. But only reference a specific topic, question, or exchange if it is actually named in the note above; never tell them they are returning to, repeating, or circling back to something unless the note explicitly says so. If what they just asked isn't covered above, treat it as new, even if it feels related.`;
    }

    if (beat > 0) {
      const lastEntry = transcript[transcript.length - 1];
      if (lastEntry && lastEntry.speaker !== 'visitor') {
        turnPrompt += `\n\n${lastEntry.name} just spoke, not the visitor, and this reply is to them, not to the visitor. React only to ${lastEntry.name}, the way you actually would given your real documented temperament and views (see your ROOM DYNAMICS guidance above): agree, disagree, build on it, or push back, whatever is true to your character and record. Do not turn back to address the visitor this beat, save that for your next real turn.`;
      }
    }

    const messages = buildMessagesFor(speaker, transcript);
    let turn;
    try {
      turn = await runTurn(client, turnPrompt, messages);
    } catch (err) {
      console.error('[leadership-room-background] turn error for', speaker, err.message);
      continue;
    }
    if (!turn || !turn.text) continue;
    const replyText = cleanDashes(turn.text);

    const entry = { speaker, name: agent.name, content: replyText };
    transcript.push(entry);
    transcriptAppend.push(entry);

    const decayedScales = engine.decayEmotions(rawAgentState[speaker] && rawAgentState[speaker].scales, speaker);
    const nextScales = engine.applyTurn(decayedScales, turn.felt, speaker, engine.SMOOTHING);
    nextAgentState[speaker] = { scales: nextScales };

    replies.push({
      agent_key: speaker,
      agent_name: agent.name,
      reply: replyText,
      mood: engine.dominantEmotion(nextScales),
    });

    await saveVisitorMemory(client, speaker, agent.name, visitorId, serviceKey, [...messages, { role: 'assistant', content: replyText }]);
  }

  // Carry forward scales for any active agent who didn't speak this turn,
  // so the state a client already has for them isn't dropped.
  activeAgents.forEach((key) => {
    if (!nextAgentState[key]) {
      nextAgentState[key] = { scales: engine.sanitizeScales(rawAgentState[key] && rawAgentState[key].scales, key) };
    }
  });

  return { replies, transcriptAppend, nextAgentState };
}

exports.handler = async (event) => {
  try { connectLambda(event); } catch (_) {}

  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'method_not_allowed' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: JSON.stringify({ error: 'invalid_json' }) }; }

  const jobId = String(body.job_id || '').trim();
  if (!jobId) return { statusCode: 400, body: JSON.stringify({ error: 'job_id_required' }) };

  const store = getStore(JOB_STORE);
  await store.setJSON(jobId, { job_id: jobId, status: 'running', created_at: new Date().toISOString() });

  const apiKey = process.env.ETL_CLASSROOMS_API_KEY;
  if (!apiKey) {
    await store.setJSON(jobId, { job_id: jobId, status: 'error', error: 'ANTHROPIC_API_KEY not configured', finished_at: new Date().toISOString() });
    return { statusCode: 500, body: JSON.stringify({ error: 'no_api_key' }) };
  }

  const activeAgents = Array.isArray(body.active_agents)
    ? [...new Set(body.active_agents.map((a) => String(a || '').trim().toLowerCase()))].filter((a) => AGENTS[a])
    : [];
  const message = String(body.message || '').trim().slice(0, 2000);
  const visitorName = String(body.visitor_name || '').trim().slice(0, 40) || 'the visitor';
  const visitorId = safeVisitorId(body.visitor_id);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const rawTranscript = Array.isArray(body.transcript) ? body.transcript : [];
  const transcript = rawTranscript
    .filter((e) => e && typeof e.content === 'string' && e.content.trim() && typeof e.name === 'string')
    .map((e) => ({ speaker: String(e.speaker || 'visitor'), name: e.name, content: e.content.trim() }))
    .slice(-40);
  transcript.push({ speaker: 'visitor', name: visitorName, content: message });

  const rawAgentState = (body.agent_state && typeof body.agent_state === 'object') ? body.agent_state : {};

  try {
    const { replies, transcriptAppend, nextAgentState } = await runCascade(activeAgents, transcript, visitorName, visitorId, serviceKey, rawAgentState);
    await store.setJSON(jobId, {
      job_id: jobId,
      status: 'done',
      created_at: new Date(Date.now() - 1000).toISOString(),
      finished_at: new Date().toISOString(),
      result: { replies, transcript_append: transcriptAppend, active_agents: activeAgents, agent_state: nextAgentState },
    });
    return { statusCode: 200, body: JSON.stringify({ ok: true, job_id: jobId }) };
  } catch (err) {
    console.error('[leadership-room-background] fatal error:', err && err.message);
    await store.setJSON(jobId, { job_id: jobId, status: 'error', error: (err && err.message) || 'unknown_error', finished_at: new Date().toISOString() });
    return { statusCode: 500, body: JSON.stringify({ error: (err && err.message) || 'unknown_error' }) };
  }
};
