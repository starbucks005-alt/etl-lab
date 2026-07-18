/* ─────────────────────────────────────────────────────────────────────────────
   ptx4990-group-ask -- the PTX 4990 classroom's group table: several historical
   scientist agents in one shared room, actually talking to each other and to
   the student, not just answering one at a time.

   Same director+cascade mechanic as Almost Human's eq-room-group-ask.js (a
   cheap director call picks who speaks next, up to a small cascade cap, only
   the first beat is guaranteed), stripped down for a free, ungated classroom
   tool: no paywall, no credit ledger, no conduct-strike system, no emotion
   engine. This is a self-contained file, adapted from that pattern rather
   than importing it, so nothing here can put the paid Almost Human room at
   risk. Roster and real backpack tools (Wikipedia + arXiv) come from
   ptx4990-chat.js, so adding a scientist there automatically makes them
   available here too.

   POST {
     active_agents: string[]              -- 2+ keys from SCIENTISTS
     transcript: [{speaker, name, content}]  -- shared room log so far
                    (speaker is a scientist key, or "student")
     message: string                       -- the student's new message
     student_name?: string
   }
   Returns {
     replies: [{agent_key, agent_name, reply}],
     transcript_append: [{speaker, name, content}],
     active_agents: string[]
   }

   Env: ANTHROPIC_API_KEY
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { SCIENTISTS, TOOLS, executeTool, cleanDashes, MODEL, safeVisitorId, fetchVisitorMemory, saveVisitorMemory } = require('./ptx4990-chat.js');

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

// Formats the shared transcript from ONE scientist's point of view: their
// own past lines stay role:'assistant' (unprefixed), everyone else's lines
// (the student's and every other scientist's) become role:'user', prefixed
// with who said it. Same pattern as eq-room-group-ask.js's buildMessagesFor.
function buildMessagesFor(agentKey, transcript) {
  return transcript.map((entry) => {
    if (entry.speaker === agentKey) return { role: 'assistant', content: entry.content };
    return { role: 'user', content: `${entry.name}: ${entry.content}` };
  });
}

// One cheap Haiku call: who should speak next. Only beat 0 is forced (someone
// should always answer the student); every beat after that is genuine
// discretion, so the room doesn't lock into the same reply count every turn.
async function pickNextSpeaker(client, activeAgents, transcript, beatIndex, forced) {
  const roster = activeAgents.map((k) => `${k}: ${SCIENTISTS[k].name}. ${SCIENTISTS[k].tagline}`).join('\n');
  const transcriptText = transcript.slice(-16).map((e) => `${e.name}: ${e.content}`).join('\n');
  const instruction = beatIndex === 0
    ? 'The student just said something new. Pick whoever at the table would naturally respond first.'
    : 'Judge this moment honestly, the way a real seminar table works: often one reply is plenty and the room naturally pauses there, sometimes another scientist can\'t help adding to or disputing what was just said, especially if it touches their own work or era. Only pick a name if that scientist would genuinely, naturally have something to say about what the LAST person just said.';
  const prompt = `You're directing a small academic roundtable: a few historical scientists and one student, actually talking to each other, not taking turns answering the student one at a time. People at the table:\n${roster}\n\n` +
    `Recent conversation:\n${transcriptText}\n\n${instruction}` +
    (forced ? ' Pick exactly one agent key from the roster above.' : ' Pick exactly one agent key from the roster above, or "none" if nobody would genuinely add anything right now.');

  const enumValues = forced ? [...activeAgents] : [...activeAgents, 'none'];
  const tool = {
    name: 'pick_speaker',
    description: forced ? 'Choose who speaks next at the table.' : 'Choose who speaks next at the table, or none.',
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
    console.error('[ptx4990-group-ask] director failed (non-fatal):', err.message);
    return forced ? activeAgents[0] : null;
  }
}

// Bounded tool-use turn: same agentic loop as ptx4990-chat.js's
// runAgentLoop, but capped lower (TURN_TOOL_LOOP) since a single group
// request can cascade through several scientists' turns already.
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
    ? [...new Set(body.active_agents.map((a) => String(a || '').trim().toLowerCase()))].filter((a) => SCIENTISTS[a])
    : [];
  if (activeAgents.length < 2) return json(400, { error: 'need_at_least_two_agents' });
  if (activeAgents.length > MAX_ROOM_AGENTS) return json(400, { error: 'too_many_agents', max: MAX_ROOM_AGENTS });

  const message = String(body.message || '').trim().slice(0, 2000);
  if (!message) return json(400, { error: 'message required' });

  const studentName = String(body.student_name || '').trim().slice(0, 40) || 'the student';
  const visitorId = safeVisitorId(body.visitor_id);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const rawTranscript = Array.isArray(body.transcript) ? body.transcript : [];
  const transcript = rawTranscript
    .filter((e) => e && typeof e.content === 'string' && e.content.trim() && typeof e.name === 'string')
    .map((e) => ({ speaker: String(e.speaker || 'student'), name: e.name, content: e.content.trim() }))
    .slice(-MAX_TRANSCRIPT_ENTRIES);
  transcript.push({ speaker: 'student', name: studentName, content: message });

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

    const scientist = SCIENTISTS[speaker];
    const roommates = activeAgents.filter((k) => k !== speaker).map((k) => `${SCIENTISTS[k].name} (${SCIENTISTS[k].tagline})`);
    let turnPrompt = scientist.system +
      `\n\nROOM CONTEXT\nYou are seated at a roundtable in the PTX 4990 classroom with ${studentName} and, also at the table: ${roommates.join('; ')}. This is a group conversation, not a private one-on-one.`;

    const visitorMemory = await fetchVisitorMemory(speaker, visitorId, serviceKey);
    if (visitorMemory) {
      turnPrompt += `\n\nWHAT YOU REMEMBER ABOUT ${studentName.toUpperCase()}\n${visitorMemory}\nYou've spoken with them before, one on one or at this table; let that show naturally, without making a show of it.`;
    }

    if (beat > 0) {
      const lastEntry = transcript[transcript.length - 1];
      if (lastEntry && lastEntry.speaker !== 'student') {
        turnPrompt += `\n\n${lastEntry.name} just spoke, not the student, and this reply is to them, not to the student. React only to ${lastEntry.name}, the way you actually would if a colleague sitting right next to you just said that out loud: agree, disagree, correct them, build on it, whatever is true to your actual views and era. Do not turn back to address the student this beat, save that for your next real turn.`;
      }
    }

    const messages = buildMessagesFor(speaker, transcript);
    let replyText;
    try {
      replyText = await runTurn(client, turnPrompt, messages);
    } catch (err) {
      console.error('[ptx4990-group-ask] turn error for', speaker, err.message);
      continue;
    }
    if (!replyText) continue;
    replyText = cleanDashes(replyText);

    const entry = { speaker, name: scientist.name, content: replyText };
    transcript.push(entry);
    transcriptAppend.push(entry);
    replies.push({ agent_key: speaker, agent_name: scientist.name, reply: replyText });

    await saveVisitorMemory(client, speaker, scientist.name, visitorId, serviceKey, [...messages, { role: 'assistant', content: replyText }]);
  }

  return json(200, {
    replies,
    transcript_append: transcriptAppend,
    active_agents: activeAgents,
  });
};
