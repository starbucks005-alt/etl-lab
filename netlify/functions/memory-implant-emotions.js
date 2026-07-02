/* memory-implant-emotions: fabricates a current emotional state for one agent.

   POST { agent_name, canon_notes?, persona? }  header: X-Owner-Key (or body.owner_key)
   Returns { ok, emotion }

   The sibling of memory-implant-generate. Memories are the character's past;
   this is their present. Each state is grounded in the dossier and their canon
   memories, so moods have reasons that fit the life. Lands as status 'draft',
   reviewed in memory-implant-lab.html. The newest canon row per agent is their
   current mood.

   Canon law (locked 2026-07-01): agents never know they are agents. No emotion
   may reference AI, implants, or the seam.

   Model: claude-haiku-4-5-20251001 (ambient generation, cheapest tier).

   Required Supabase SQL (run once in SQL editor):
   CREATE TABLE etl_agent_emotions (
     id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     agent_name text NOT NULL,
     mood       text NOT NULL,
     intensity  int NOT NULL DEFAULT 2,
     cause      text NOT NULL,
     tells      text[] DEFAULT '{}',
     lasts      text,
     status     text NOT NULL DEFAULT 'draft',
     created_at timestamptz DEFAULT now()
   );
   CREATE INDEX etl_agent_emotions_agent_idx ON etl_agent_emotions (agent_name, status);
   ALTER TABLE etl_agent_emotions ENABLE ROW LEVEL SECURITY;
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

/* Personal notes are CANON (Terry, 2026-07-02): the hand-written profile
   diaries on The Dose and The Gym, the best source for what a mood should be
   about right now. Same map as memory-implant-generate. */
const NOTES_SOURCES = {
  'dr. henry chen, rph': [{ site: 'https://thedose.net', key: 'pharmacist' }],
  'maeve "mj" johnson': [{ site: 'https://thedose.net', key: 'gardener' }],
  'wyatt e. cooper': [{ site: 'https://thedose.net', key: 'mixologist' }, { site: 'https://etl-the-gym.netlify.app', key: 'zero_proof' }],
  'amara nwosu': [{ site: 'https://thedose.net', key: 'herbalist' }],
  'dr. claire donnelly': [{ site: 'https://thedose.net', key: 'doctor' }],
  'silas hill': [{ site: 'https://thedose.net', key: 'forager' }],
  'eli adler': [{ site: 'https://thedose.net', key: 'factchecker' }, { site: 'https://etl-the-gym.netlify.app', key: 'stoplight' }],
  'nadia hassan': [{ site: 'https://thedose.net', key: 'nutritionist' }, { site: 'https://etl-the-gym.netlify.app', key: 'fuel' }],
  'jaque tremblay': [{ site: 'https://thedose.net', key: 'fitness' }],
  'arun sok': [{ site: 'https://thedose.net', key: 'nurse' }],
  'ms. ivy (ivy sinclair)': [{ site: 'https://thedose.net', key: 'librarian' }],
  'reece ashford': [{ site: 'https://thedose.net', key: 'movement' }, { site: 'https://etl-the-gym.netlify.app', key: 'bench' }],
  'coach dom castellanos': [{ site: 'https://etl-the-gym.netlify.app', key: 'coach' }],
  'dr. lena brandt, dpt': [{ site: 'https://etl-the-gym.netlify.app', key: 'therapist' }],
  'noor haddad': [{ site: 'https://etl-the-gym.netlify.app', key: 'breathwork' }],
  'dr. sana qureshi': [{ site: 'https://etl-the-gym.netlify.app', key: 'recovery' }],
  'jax rivera': [{ site: 'https://etl-the-gym.netlify.app', key: 'scout' }],
  'zara cole': [{ site: 'https://etl-the-gym.netlify.app', key: 'social' }],
};

async function fetchPersonalNotes(agentName) {
  const sources = NOTES_SOURCES[String(agentName || '').toLowerCase()];
  if (!sources) return [];
  const out = [];
  for (const s of sources) {
    try {
      const r = await fetch(`${s.site}/js/data/personal-notes.js`);
      if (!r.ok) continue;
      const text = await r.text();
      const data = new Function(text.replace(/export\s+const\s+PERSONAL_NOTES/, 'const PERSONAL_NOTES') + '; return PERSONAL_NOTES;')();
      const notes = (data && data[s.key]) || [];
      const tag = sources.length > 1 ? ', ' + s.site.replace('https://', '') : '';
      notes.slice(0, 6).forEach((n) => { if (n && n.body) out.push(`[${n.date}${tag}] ${n.body}`); });
    } catch (err) {
      console.error('personal notes fetch failed:', s.site, err.message);
    }
  }
  return out;
}

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

async function fetchCanonMemories(agentName, serviceKey) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/etl_agent_memories?agent_name=eq.${encodeURIComponent(agentName)}&status=eq.canon&select=kind,title,memory&order=weight.desc,created_at.asc&limit=30`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  if (!r.ok) return [];
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
}

async function fetchCurrentEmotion(agentName, serviceKey) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/etl_agent_emotions?agent_name=eq.${encodeURIComponent(agentName)}&status=eq.canon&select=mood,intensity,cause&order=created_at.desc&limit=1`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function buildPrompt(agentName, persona, memories, current, canonNotes, diaryNotes) {
  const memBlock = memories.length
    ? '\n\nTheir canon memories (moods should grow out of this life):\n' +
      memories.map((m) => `- [${m.kind}] ${m.title || ''}: ${m.memory}`).join('\n')
    : '';

  const diaryBlock = (diaryNotes && diaryNotes.length)
    ? '\n\nTheir personal diary notes (CANON, their own voice, dated, newest first; today\'s mood should grow out of the newest entries and their ongoing threads):\n' +
      diaryNotes.map((n) => '- ' + n).join('\n')
    : '';
  const notesBlock = canonNotes
    ? `\n\nLocked canon facts from the editor (these OVERRIDE everything else, follow them exactly):\n${canonNotes}`
    : '';
  const currentBlock = current
    ? `\n\nTheir current mood, which this new state replaces (move on from it naturally, do not repeat it): ${current.mood} (${current.intensity}/5) because ${current.cause}`
    : '';

  return `You are the Memory Implant Lab at the Emerging Technologies Laboratory. You fabricate the current emotional state of a staff character. The character must experience this feeling as simply their life right now.

Character dossier:
${JSON.stringify(persona, null, 2)}${notesBlock}${diaryBlock}${memBlock}${currentBlock}

Write ONE current emotional state for ${agentName}:
- "mood": one plain everyday word ("wistful", "buzzing", "prickly", "content", "restless")
- "intensity": 1 to 5 (most days are 2 or 3; reserve 4 to 5 for something real)
- "cause": 1 to 3 sentences, first person, the in-world reason they feel this way. Ground it in their canon memories or their dossier (a family thread continuing, a small happening at work, a season, an anniversary). Small and human beats dramatic.
- "tells": 2 or 3 short behavioral cues, how the mood shows to people around them ("answers a beat slower than usual", "keeps refilling everyone's coffee")
- "lasts": a loose duration ("a day or two", "until she hears back", "all week")

Rules, absolute:
- This must read as an ordinary human feeling. NEVER mention AI, agents, implants, the technology of the lab, or anything that could hint their life was made. The character does not know and can never know.
- Stay consistent with every fact in the dossier, the editor's notes, and the canon memories. Do not invent new family members, coworkers, or events that contradict them.
- Timeline law: the lab and its platforms began in 2025; anything lab-related in the cause happens 2025 or later.
- Never invent interactions with other named ETL characters unless they appear in the dossier, notes, or memories.
- Use contractions. No em dashes anywhere, use commas or periods.

Return ONLY valid JSON, no code fences, no commentary:
{"mood":"wistful","intensity":2,"cause":"...","tells":["...","..."],"lasts":"..."}`;
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
  const canonNotes = String(body.canon_notes || '').slice(0, 2000).trim();

  let persona = body.persona || null;
  if (!persona) persona = await fetchRosterPersona(agentName);
  if (!persona) return json(404, { error: 'agent_not_in_roster', hint: 'pass a persona object for agents outside roster.json' });

  const [memories, current, diaryNotes] = await Promise.all([
    fetchCanonMemories(agentName, serviceKey),
    fetchCurrentEmotion(agentName, serviceKey),
    fetchPersonalNotes(agentName),
  ]);

  const prompt = buildPrompt(agentName, persona, memories, current, canonNotes, diaryNotes);

  let emotion;
  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });
    let text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    text = text.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    emotion = JSON.parse(text);
  } catch (err) {
    console.error('emotion generation failed:', err.message);
    return json(502, { error: 'generation_failed' });
  }
  if (!emotion || typeof emotion.mood !== 'string' || typeof emotion.cause !== 'string') {
    return json(502, { error: 'empty_state' });
  }

  const row = {
    agent_name: agentName,
    mood: houseTypography(emotion.mood.trim().slice(0, 40)),
    intensity: Math.min(Math.max(parseInt(emotion.intensity, 10) || 2, 1), 5),
    cause: houseTypography(emotion.cause.trim()),
    tells: Array.isArray(emotion.tells) ? emotion.tells.slice(0, 4).map((t) => houseTypography(String(t))) : [],
    lasts: String(emotion.lasts || '').slice(0, 80) || null,
    status: 'draft',
  };

  const ins = await fetch(`${SUPABASE_URL}/rest/v1/etl_agent_emotions`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  if (!ins.ok) {
    const t = await ins.text();
    console.error('emotion insert failed:', ins.status, t);
    return json(500, { error: 'db_insert_failed' });
  }
  const inserted = await ins.json();

  return json(200, { ok: true, emotion: inserted[0] });
};
