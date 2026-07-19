/* ─────────────────────────────────────────────────────────────────────────────
   bespoke-quote-infer -- reads a free-text description of a prospective
   bespoke build ("I want students to interview historical figures from...")
   and infers reasonable starting parameters for bespoke-quote.html's
   calculator: agent count, classroom tier, and which bespoke systems the
   description implies. The user can still hand-adjust every field after;
   this just removes the "I don't know what to even ask for" barrier for
   someone like Paul, who described a project, not a spec.

   POST { description: string } -> {
     agents, tier: "teaching_assistants"|"etl_faculty"|"living_legends",
     systems: { emotion: bool, room: bool, curriculum: bool },
     reasoning: string
   }

   Env: ANTHROPIC_API_KEY
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;

const MODEL = 'claude-sonnet-4-6';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

const INFER_TOOL = {
  name: 'suggest_build',
  description: 'Suggest bespoke-quote calculator parameters based on a free-text project description.',
  input_schema: {
    type: 'object',
    properties: {
      agents: { type: 'integer', minimum: 1, maximum: 50, description: 'Best estimate of how many distinct agent personas this project needs. Count named characters/roles if given; otherwise use a reasonable default for the scale described (a focused pair or trio is small, a full cast or ensemble is larger).' },
      tier: { type: 'string', enum: ['teaching_assistants', 'etl_faculty', 'living_legends'], description: 'teaching_assistants: generic helper/tutor bots with no real persona. etl_faculty: named staff-style agents with a role but not a deep individual character. living_legends: real or richly-imagined individual personas (historical figures, specific named characters), the premium tier.' },
      emotion: { type: 'boolean', description: 'True if the description implies agents should have moods, feelings, memory of the visitor, or change based on how they are treated.' },
      room: { type: 'boolean', description: 'True if the description implies multiple agents should talk to each other or to the visitor together in a shared conversation, not just one-on-one.' },
      curriculum: { type: 'boolean', description: 'True if the description implies this is for a class, course, or instructor-led use, needing objectives, session plans, or assignments.' },
      reasoning: { type: 'string', description: 'Two to four plain sentences explaining the suggested numbers in terms of what was actually described, written to the person who wrote the description, so they can tell what to correct if a guess is off.' },
    },
    required: ['agents', 'tier', 'emotion', 'room', 'curriculum', 'reasoning'],
  },
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'invalid json' }); }

  const description = String(body.description || '').trim().slice(0, 3000);
  if (!description) return json(400, { error: 'description required' });

  const client = new Anthropic({ apiKey });

  const prompt = `A prospective client for ETL Classrooms (a platform that builds custom AI agent classrooms/experiences for universities and institutions) wrote this description of what they want to build:

"${description}"

Based ONLY on what they actually described, suggest calculator parameters using the suggest_build tool. Do not invent scope they did not describe or imply. If the description is vague about agent count, pick a reasonable, defensible default for the scale implied and say so plainly in your reasoning rather than guessing wildly high or low.`;

  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
      tools: [INFER_TOOL],
      tool_choice: { type: 'tool', name: 'suggest_build' },
    });
    const toolBlock = (msg.content || []).find((b) => b.type === 'tool_use' && b.name === 'suggest_build');
    if (!toolBlock || !toolBlock.input) return json(502, { error: 'model returned no suggestion' });

    const out = toolBlock.input;
    const agents = Math.max(1, Math.min(50, Math.round(Number(out.agents) || 5)));
    const tier = ['teaching_assistants', 'etl_faculty', 'living_legends'].includes(out.tier) ? out.tier : 'living_legends';

    return json(200, {
      agents,
      tier,
      systems: {
        emotion: !!out.emotion,
        room: !!out.room,
        curriculum: !!out.curriculum,
      },
      reasoning: String(out.reasoning || '').trim().slice(0, 800),
    });
  } catch (err) {
    console.error('[bespoke-quote-infer] error', err && err.message);
    return json(502, { error: 'inference failed', detail: err && err.message });
  }
};
