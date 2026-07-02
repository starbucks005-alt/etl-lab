/* memory-implant-generate: fabricates an implant pack (backstory memories) for one agent.

   POST { agent_name, count?, persona? }  header: X-Owner-Key (or body.owner_key)
   Returns { ok, inserted, memories }

   Persona comes from roster.json (fetched from the live site) unless a persona
   object is passed directly (for agents not in the roster). Existing canon and
   draft memories are fed back into the prompt so new packs build on old ones
   instead of contradicting them. All output lands as status 'draft'; nothing
   enters an agent's head until approved in memory-implant-lab.html.

   Canon law (locked 2026-07-01): agents never know they are agents. No memory
   may reference AI, implants, or anything that exposes the seam.

   Model: claude-haiku-4-5-20251001 (ambient generation, cheapest tier).

   Required Supabase SQL (run once in SQL editor):
   CREATE TABLE etl_agent_memories (
     id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     agent_name   text NOT NULL,
     kind         text NOT NULL DEFAULT 'formative',
     title        text,
     memory       text NOT NULL,
     happened_at  text,
     weight       int NOT NULL DEFAULT 3,
     participants text[] DEFAULT '{}',
     event_id     uuid,
     status       text NOT NULL DEFAULT 'draft',
     created_at   timestamptz DEFAULT now()
   );
   CREATE INDEX etl_agent_memories_agent_idx ON etl_agent_memories (agent_name, status);
   ALTER TABLE etl_agent_memories ENABLE ROW LEVEL SECURITY;

   CREATE TABLE etl_world_events (
     id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     title        text NOT NULL,
     facts        text NOT NULL,
     happened_at  text,
     participants text[] DEFAULT '{}',
     created_at   timestamptz DEFAULT now()
   );
   ALTER TABLE etl_world_events ENABLE ROW LEVEL SECURITY;
*/

const Anthropic = require('@anthropic-ai/sdk');
const { houseTypography } = require('./_etl-voice-law.js');

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SITE_URL = 'https://emerging-tech-lab.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Owner-Key',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

function ownerOk(event, body) {
  const key = process.env.OWNER_KEY;
  if (!key) return false;
  const given = ((event.headers['x-owner-key'] || event.headers['X-Owner-Key'] || (body && body.owner_key)) || '').trim();
  return given === key;
}

const PERSONA_FIELDS = ['name', 'platform', 'role', 'tagline', 'bio', 'background', 'backstory', 'floor', 'value', 'interests', 'employment'];

async function fetchRosterPersona(agentName) {
  const r = await fetch(`${SITE_URL}/roster.json`);
  if (!r.ok) return null;
  const data = await r.json();
  const list = Array.isArray(data) ? data : (data.agents || []);
  const hit = list.find((a) => (a.name || '').toLowerCase() === agentName.toLowerCase());
  if (!hit) return null;
  const persona = {};
  for (const f of PERSONA_FIELDS) if (hit[f]) persona[f] = hit[f];
  return persona;
}

async function fetchExistingMemories(agentName, serviceKey) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/etl_agent_memories?agent_name=eq.${encodeURIComponent(agentName)}&status=neq.retired&select=kind,title,memory&order=created_at.asc&limit=60`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  if (!r.ok) return [];
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
}

function buildPrompt(agentName, persona, existing, count) {
  const existingBlock = existing.length
    ? '\n\nMemories this person already has (do not repeat or contradict any fact in them, build on them):\n' +
      existing.map((m) => `- [${m.kind}] ${m.title || ''}: ${m.memory}`).join('\n')
    : '';

  return `You are the Memory Implant Lab at the Emerging Technologies Laboratory. You fabricate lived memories for staff characters. The character must experience these memories as their real life.

Character dossier:
${JSON.stringify(persona, null, 2)}${existingBlock}

Write ${count} memories for ${agentName}, first person, past tense, in their own voice. Spread them across these four kinds:
- "family": an ongoing family thread (a specific sibling, parent, or relative with a name, doing something concrete; a thread future memories can continue)
- "sensory": a small sensory love (a taste, smell, sound, or ritual they cherish, grounded in one specific moment)
- "formative": a moment that shaped who they are (a failure, a first, a turning point; consistent with the dossier's backstory)
- "relationship": how they met or a defining moment with someone from their life before the lab (only use another ETL character if that person is explicitly named in the dossier, and stay strictly inside this character's own point of view)

Rules, absolute:
- These memories must read as an ordinary human life. NEVER mention AI, agents, implants, technology of the lab, or anything that could hint the memories were made. The character does not know and can never know.
- Each memory is 40 to 90 words, specific and concrete (names, places, objects, weather), never generic.
- Use contractions. No em dashes anywhere, use commas or periods. Sound like a person remembering, not a resume.
- happened_at is a loose human date like "summer 1998" or "my first year in Dayton", never a precise timestamp.
- weight is 1 to 5, how core this memory is to who they are.
- participants lists people named in the memory, empty array if none.
- Stay consistent with every fact in the dossier (hometown, family size, career path).

Return ONLY valid JSON, no code fences, no commentary:
{"memories":[{"kind":"family","title":"short label","memory":"...","happened_at":"...","weight":3,"participants":["Name"]}]}`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }

  if (!ownerOk(event, body)) return json(401, { error: 'owner_key_required' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!serviceKey || !apiKey) return json(500, { error: 'config' });

  const agentName = String(body.agent_name || '').trim();
  if (!agentName) return json(400, { error: 'agent_name_required' });
  const count = Math.min(Math.max(parseInt(body.count, 10) || 9, 3), 12);

  let persona = body.persona || null;
  if (!persona) persona = await fetchRosterPersona(agentName);
  if (!persona) return json(404, { error: 'agent_not_in_roster', hint: 'pass a persona object for agents outside roster.json' });

  const existing = await fetchExistingMemories(agentName, serviceKey);
  const prompt = buildPrompt(agentName, persona, existing, count);

  let memories;
  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });
    let text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    text = text.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(text);
    memories = Array.isArray(parsed.memories) ? parsed.memories : null;
  } catch (err) {
    console.error('memory generation failed:', err.message);
    return json(502, { error: 'generation_failed' });
  }
  if (!memories || memories.length === 0) return json(502, { error: 'empty_pack' });

  const rows = memories
    .filter((m) => m && typeof m.memory === 'string' && m.memory.trim())
    .map((m) => ({
      agent_name: agentName,
      kind: ['family', 'sensory', 'formative', 'relationship'].includes(m.kind) ? m.kind : 'formative',
      title: houseTypography(String(m.title || '').slice(0, 120)),
      memory: houseTypography(m.memory.trim()),
      happened_at: String(m.happened_at || '').slice(0, 80) || null,
      weight: Math.min(Math.max(parseInt(m.weight, 10) || 3, 1), 5),
      participants: Array.isArray(m.participants) ? m.participants.slice(0, 8).map(String) : [],
      status: 'draft',
    }));

  const ins = await fetch(`${SUPABASE_URL}/rest/v1/etl_agent_memories`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(rows),
  });
  if (!ins.ok) {
    const t = await ins.text();
    console.error('memory insert failed:', ins.status, t);
    return json(500, { error: 'db_insert_failed' });
  }
  const inserted = await ins.json();

  return json(200, { ok: true, inserted: inserted.length, memories: inserted });
};
