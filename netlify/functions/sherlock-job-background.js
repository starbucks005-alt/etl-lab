/* ─────────────────────────────────────────────────────────────────────────────
   sherlock-job-background -- the slow half of the "Solve It With Sherlock"
   classroom, moved out of the synchronous sherlock-job.js dispatcher. This is
   a Netlify Background Function (the "-background" filename suffix is what
   grants the extended execution budget; no netlify.toml entry needed).

   Handles both job kinds:

     room     the multi-agent cascade at the Baker Street table. A director
              model picks who speaks next; each speaker takes a real tool-use
              turn. Measured at 15 to 20 seconds for three beats, well past
              the platform's real synchronous ceiling.
     verdict  the case review of a student's submitted solution. One long
              structured call, graded against the solution key and the modern
              standards key in _sherlock-cases.js, neither of which has ever
              been sent to the browser.

   Job state kept in Netlify Blobs, matching the established convention on
   this campus. sherlock-job-status.js reads it back for the frontend to poll.
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');
const {
  AGENTS, TOOLS, DELIVER_REPLY_TOOL, toolsFor, resolveAgent, extractDeliverReply, extractPlainText,
  executeTool, cleanDashes, MODEL, safeVisitorId, fetchVisitorMemory, saveVisitorMemory,
} = require('./sherlock-chat.js');
const { CASES } = require('./_sherlock-cases.js');
const engine = require('./_sherlock-engine.js');

const DIRECTOR_MODEL = 'claude-haiku-4-5-20251001';
const VERDICT_MODEL = 'claude-sonnet-4-6';
const CASCADE_CAP = 3;
const TURN_MAX_TOKENS = 500;
const TURN_TOOL_LOOP = 3;
const VERDICT_MAX_TOKENS = 2200;
const JOB_STORE = 'sherlock_jobs';

/* ═══ ROOM ════════════════════════════════════════════════════════════════ */

// Formats the shared transcript from ONE agent's point of view: their own past
// lines stay role:'assistant' (unprefixed), everyone else's lines (the
// student's and every other agent's) become role:'user', prefixed with who
// said it.
function buildMessagesFor(agentKey, transcript) {
  return transcript.map((entry) => {
    if (entry.speaker === agentKey) return { role: 'assistant', content: entry.content };
    return { role: 'user', content: `${entry.name}: ${entry.content}` };
  });
}

// One cheap Haiku call: who should speak next. Only beat 0 is forced (someone
// should always answer the student); every beat after that is genuine
// discretion, so the room doesn't lock into the same reply count every turn.
async function pickNextSpeaker(client, activeAgents, agentFor, transcript, beatIndex, forced) {
  const roster = activeAgents.map((k) => {
    const a = agentFor(k);
    return `${k}: ${a.name}, ${a.title}. ${a.tagline}`;
  }).join('\n');
  const transcriptText = transcript.slice(-16).map((e) => `${e.name}: ${e.content}`).join('\n');
  const instruction = beatIndex === 0
    ? 'The student just said something new. Pick whoever in the room would naturally respond first, given who they are: the detective takes the reasoning, the doctor takes the body and the record, the inspector takes procedure and pushes back, a witness answers only what touches them.'
    : 'Judge this moment honestly. Often one reply is plenty and the room naturally pauses there. Sometimes someone cannot help reacting to what was just said, especially across the divide between the amateur and the official police, or between an investigator and the person the case happened to. Only pick a name if that person would genuinely have something to say about what the LAST person just said.';
  const prompt = `You are directing a real conversation in a criminal justice classroom set in late Victorian London: investigators, police, and witnesses, and one student, actually talking to each other, not taking turns answering the student one at a time. People in the room:\n${roster}\n\n` +
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
    console.error('[sherlock-job-background] director failed (non-fatal):', err.message);
    return forced ? activeAgents[0] : null;
  }
}

// Bounded tool-use turn: same agentic loop as sherlock-chat.js's runAgentLoop,
// capped lower since a single group request already cascades through several
// agents' turns.
async function runTurn(client, system, messages, tools) {
  const toolSet = tools || TOOLS;
  let current = [...messages];
  for (let i = 0; i < TURN_TOOL_LOOP; i++) {
    const resp = await client.messages.create({ model: MODEL, max_tokens: TURN_MAX_TOKENS, system, tools: toolSet, messages: current });
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

async function runCascade(caseId, activeAgents, transcript, visitorName, visitorId, serviceKey, rawAgentState) {
  const client = new Anthropic({ apiKey: process.env.ETL_CLASSROOMS_API_KEY });
  const agentFor = (key) => resolveAgent(key, caseId);
  const replies = [];
  const transcriptAppend = [];
  const nextAgentState = {};
  const usedThisBeat = [];

  for (let beat = 0; beat < CASCADE_CAP; beat++) {
    const candidates = activeAgents.filter((a) => !usedThisBeat.includes(a));
    if (!candidates.length) break;
    const forced = beat === 0;
    let speaker;
    try {
      speaker = await pickNextSpeaker(client, candidates, agentFor, transcript, beat, forced);
    } catch (_) { speaker = forced ? candidates[0] : null; }
    if (!speaker) break;
    usedThisBeat.push(speaker);

    const agent = agentFor(speaker);
    if (!agent) continue;
    const roommates = activeAgents
      .filter((k) => k !== speaker)
      .map((k) => { const a = agentFor(k); return a ? `${a.name} (${a.title})` : null; })
      .filter(Boolean);

    let turnPrompt = agent.system +
      `\n\nROOM CONTEXT\nYou are in a shared room with ${visitorName} and, also present: ${roommates.join('; ')}. This is a group conversation, not a private one to one.`;

    const visitorMemory = agent.isWitness ? null : await fetchVisitorMemory(speaker, visitorId, serviceKey);
    if (visitorMemory) {
      turnPrompt += `\n\nWHAT YOU REMEMBER ABOUT ${visitorName.toUpperCase()}\n${visitorMemory}\nYou have spoken with them before; let that show naturally, without making a show of it. But only reference a specific topic, question, or exchange if it is actually named in the note above; never tell them they are returning to, repeating, or circling back to something unless the note explicitly says so. If what they just asked isn't covered above, treat it as new, even if it feels related.`;
    }

    if (beat > 0) {
      const lastEntry = transcript[transcript.length - 1];
      if (lastEntry && lastEntry.speaker !== 'visitor') {
        turnPrompt += `\n\n${lastEntry.name} just spoke, not the student, and this reply is to them, not to the student. React only to ${lastEntry.name}, the way you actually would given your real relationship to them: agree, disagree, correct them, defer, needle them, whatever is true to your character. Do not turn back to address the student this beat, save that for your next real turn.`;
      }
    }

    const messages = buildMessagesFor(speaker, transcript);
    let turn;
    try {
      turn = await runTurn(client, turnPrompt, messages, toolsFor(agent));
    } catch (err) {
      console.error('[sherlock-job-background] turn error for', speaker, err.message);
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
      audio_script: replyText,
      mood: engine.dominantEmotion(nextScales),
    });

    if (!agent.isWitness) {
      await saveVisitorMemory(client, speaker, agent.name, visitorId, serviceKey, [...messages, { role: 'assistant', content: replyText }]);
    }
  }

  // Carry forward scales for any active agent who did not speak this turn, so
  // the state a client already has for them is not dropped.
  activeAgents.forEach((key) => {
    if (!nextAgentState[key]) {
      nextAgentState[key] = { scales: engine.sanitizeScales(rawAgentState[key] && rawAgentState[key].scales, key) };
    }
  });

  return { replies, transcriptAppend, nextAgentState };
}

/* ═══ VERDICT ═════════════════════════════════════════════════════════════ */

const VERDICT_TOOL = {
  name: 'deliver_verdict',
  description: 'Deliver the completed case review of the student\'s submission. Call this exactly once, at the end.',
  input_schema: {
    type: 'object',
    properties: {
      named_correctly: { type: 'boolean', description: 'True only if the student named the actual culprit. A near miss, an accomplice, or "one of these two" is false.' },
      named_summary: { type: 'string', description: 'One sentence: who the student named, and who it actually was.' },
      deduction_score: { type: 'integer', minimum: 0, maximum: 100, description: 'How much of the real chain of inference the student actually reconstructed and supported. Naming the right person with no supporting chain scores low. Naming the wrong person with mostly sound reasoning scores in the middle, not at zero.' },
      chain_review: {
        type: 'array',
        description: 'One entry for every link in the case\'s real chain of inference, in the same order as the key, whether or not the student reached it.',
        items: {
          type: 'object',
          properties: {
            link: { type: 'string', description: 'The link from the key, restated in one short line.' },
            verdict: { type: 'string', enum: ['reached', 'partial', 'missed'] },
            note: { type: 'string', description: 'One or two sentences. If reached, quote or paraphrase the student\'s own words that got there. If partial or missed, say exactly what was needed.' },
          },
          required: ['link', 'verdict', 'note'],
        },
      },
      unsupported_claims: {
        type: 'array',
        description: 'Statements the student made that the evidence does not actually support, including anything they invented. Empty array if there are none. Do not pad this.',
        items: { type: 'string' },
      },
      procedure_score: { type: 'integer', minimum: 0, maximum: 100, description: 'How well the student identified what a present-day court, crime lab, or defense attorney would do to this case. Score 0 if they submitted nothing on it.' },
      procedure_review: {
        type: 'array',
        description: 'One entry per point in the modern standards key, in the same order.',
        items: {
          type: 'object',
          properties: {
            issue: { type: 'string', description: 'The label from the key.' },
            verdict: { type: 'string', enum: ['caught', 'partial', 'missed'] },
            note: { type: 'string', description: 'One or two sentences on what the student saw or failed to see here.' },
          },
          required: ['issue', 'verdict', 'note'],
        },
      },
      holmes_note: { type: 'string', description: 'Two to four sentences in Sherlock Holmes\'s own voice, addressed to the student, on the quality of their reasoning specifically. Exacting, specific, and capable of real praise when it is earned. Never generic encouragement. No em dashes.' },
      lestrade_note: { type: 'string', description: 'Two to four sentences in Inspector Lestrade\'s own voice, on whether this case would actually survive contact with a court and a caseload. Practical, a little wry. No em dashes.' },
      next_question: { type: 'string', description: 'One question the student should go back into the case and answer next. Specific to what they actually missed, never generic.' },
    },
    required: ['named_correctly', 'named_summary', 'deduction_score', 'chain_review', 'unsupported_claims', 'procedure_score', 'procedure_review', 'holmes_note', 'lestrade_note', 'next_question'],
  },
};

async function runVerdict(caseId, suspect, chain, inadmissible) {
  const c = CASES[caseId];
  const client = new Anthropic({ apiKey: process.env.ETL_CLASSROOMS_API_KEY });

  const system = [
    'You are the case review for a university criminal justice course. You are not in character and you are not a detective; you are an exacting, fair grader who happens to be able to write two short lines in the voices of Holmes and Lestrade at the end.',
    '',
    'You grade two separate things and you never let one bleed into the other:',
    '1. DEDUCTION. Did the student reconstruct the actual chain of inference from the actual evidence? Naming the right person on a hunch is worth very little. Naming the wrong person while reasoning carefully from real evidence is worth a good deal.',
    '2. PROCEDURE. Did the student see what a present-day court, crime lab, or defense attorney does to this case? This is the point of the course and it is graded on its own.',
    '',
    'Rules you hold to:',
    '- Be specific. Every judgement you make must point at something the student actually wrote, or at the exact thing they failed to write.',
    '- Give credit for real reasoning even when the conclusion is wrong, and withhold it for a right conclusion that was never supported.',
    '- Flag anything the student asserted that is not in the evidence, including invented facts. Do not pad that list to look thorough.',
    '- Do not be kind at the cost of being useful, and do not be harsh for its own sake.',
    '- No em dashes anywhere in your output.',
    '- Finish by calling deliver_verdict exactly once.',
    '',
    'THE CASE',
    `${c.title}, ${c.date}. ${c.subtitle}`,
    c.brief.join(' '),
    '',
    'THE EVIDENCE AS IT ACTUALLY STANDS',
    c.scene.map((s) => `- ${s.name}: ${s.visible} On close examination: ${s.close}`).join('\n'),
    '',
    'THE SOLUTION KEY (never shown to the student)',
    `Culprit: ${c.solution.culprit}`,
    `Manner: ${c.solution.manner}`,
    'Chain of inference:',
    c.solution.chain.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    'Deliberate traps in this case:',
    c.solution.redHerrings.map((s) => `- ${s}`).join('\n'),
    '',
    'THE MODERN STANDARDS KEY (the procedure half of the grade)',
    c.modern.headline,
    c.modern.points.map((p) => `- ${p.label}: ${p.body}${p.local ? ' In practice: ' + p.local : ''}`).join('\n'),
    '',
    'A student does not have to name a statute or a case to get credit for a point. They have to identify the failure and say what it does to the evidence. Naming the authority correctly is a bonus; naming one incorrectly is an error you should flag under unsupported claims.',
  ].join('\n');

  const submission = [
    'STUDENT SUBMISSION',
    '',
    'Who did it:',
    suspect,
    '',
    'Their chain of reasoning:',
    chain,
    '',
    'What they say a modern court would exclude or attack:',
    inadmissible || '(the student submitted nothing for this section)',
  ].join('\n');

  const resp = await client.messages.create({
    model: VERDICT_MODEL,
    max_tokens: VERDICT_MAX_TOKENS,
    system,
    messages: [{ role: 'user', content: submission }],
    tools: [VERDICT_TOOL],
    tool_choice: { type: 'tool', name: 'deliver_verdict' },
  });

  const block = (resp.content || []).find((b) => b.type === 'tool_use' && b.name === 'deliver_verdict');
  if (!block || !block.input) throw new Error('verdict_not_returned');

  const v = block.input;
  // The two in-character lines are the only free prose that reaches the page,
  // so they get the same dash cleanup every other agent reply gets.
  v.holmes_note = cleanDashes(v.holmes_note);
  v.lestrade_note = cleanDashes(v.lestrade_note);
  v.named_summary = cleanDashes(v.named_summary);
  v.next_question = cleanDashes(v.next_question);
  return v;
}

/* ═══ HANDLER ═════════════════════════════════════════════════════════════ */

exports.handler = async (event) => {
  try { connectLambda(event); } catch (_) {}

  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'method_not_allowed' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: JSON.stringify({ error: 'invalid_json' }) }; }

  const jobId = String(body.job_id || '').trim();
  if (!jobId) return { statusCode: 400, body: JSON.stringify({ error: 'job_id_required' }) };

  const kind = String(body.kind || 'room').trim().toLowerCase();
  const store = getStore(JOB_STORE);
  await store.setJSON(jobId, { job_id: jobId, kind, status: 'running', created_at: new Date().toISOString() });

  const fail = async (message) => {
    await store.setJSON(jobId, { job_id: jobId, kind, status: 'error', error: message, finished_at: new Date().toISOString() });
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  };

  if (!process.env.ETL_CLASSROOMS_API_KEY) return fail('ANTHROPIC_API_KEY not configured');

  const caseId = String(body.case_id || '').trim().toLowerCase() || null;
  if (caseId && !CASES[caseId]) return fail('unknown_case');

  try {
    if (kind === 'verdict') {
      const verdict = await runVerdict(caseId, String(body.suspect || ''), String(body.chain || ''), String(body.inadmissible || ''));
      await store.setJSON(jobId, {
        job_id: jobId, kind, status: 'done',
        created_at: new Date(Date.now() - 1000).toISOString(),
        finished_at: new Date().toISOString(),
        result: { verdict, case_id: caseId },
      });
      return { statusCode: 200, body: JSON.stringify({ ok: true, job_id: jobId }) };
    }

    const caseWitnesses = caseId ? Object.keys(CASES[caseId].witnesses) : [];
    const known = (a) => Boolean(AGENTS[a]) || caseWitnesses.includes(a);
    const activeAgents = Array.isArray(body.active_agents)
      ? [...new Set(body.active_agents.map((a) => String(a || '').trim().toLowerCase()))].filter(known)
      : [];
    const message = String(body.message || '').trim().slice(0, 2000);
    const visitorName = String(body.visitor_name || '').trim().slice(0, 40) || 'the student';
    const visitorId = safeVisitorId(body.visitor_id);
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const rawTranscript = Array.isArray(body.transcript) ? body.transcript : [];
    const transcript = rawTranscript
      .filter((e) => e && typeof e.content === 'string' && e.content.trim() && typeof e.name === 'string')
      .map((e) => ({ speaker: String(e.speaker || 'visitor'), name: e.name, content: e.content.trim() }))
      .slice(-40);
    transcript.push({ speaker: 'visitor', name: visitorName, content: message });

    const rawAgentState = (body.agent_state && typeof body.agent_state === 'object') ? body.agent_state : {};

    const { replies, transcriptAppend, nextAgentState } =
      await runCascade(caseId, activeAgents, transcript, visitorName, visitorId, serviceKey, rawAgentState);

    await store.setJSON(jobId, {
      job_id: jobId, kind, status: 'done',
      created_at: new Date(Date.now() - 1000).toISOString(),
      finished_at: new Date().toISOString(),
      result: { replies, transcript_append: transcriptAppend, active_agents: activeAgents, agent_state: nextAgentState },
    });
    return { statusCode: 200, body: JSON.stringify({ ok: true, job_id: jobId }) };
  } catch (err) {
    console.error('[sherlock-job-background] fatal error:', err && err.message);
    return fail((err && err.message) || 'unknown_error');
  }
};
