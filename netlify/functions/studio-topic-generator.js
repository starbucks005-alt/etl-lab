/* ─────────────────────────────────────────────────────────────────────────────
   studio-topic-generator

   Generates a fresh weekly pool of PERSONAL Watercooler kickoff topics for
   each staff member in the Floor cast. Replaces the hardcoded topic
   examples in studio-floor-render.js — those got stale; this stays fresh.

   For each cast member, calls Anthropic once with the agent's roster fields
   (name, role, background, floor_chat, interests, hashtags) and asks for
   20 concrete off-the-clock topics that staff member could open with this
   week. Stores the result in the `watercooler` blob store keyed by week.

   studio-floor-render reads the current week's pool for the lead, picks
   one topic, injects it into the prompt as the kickoff anchor.

   POST (manual trigger from /studio/watercooler-stats.html "regen now"
   button) OR scheduled (Mondays 6am ET via netlify.toml).

   Returns:
     { ok: true, week_key, generated: [{name, topic_count}], skipped: [...] }

   Auth (manual trigger): same Supabase JWT gate.
   Auth (cron):           no Authorization header — accepts cron context.
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');
const fs = require('fs');
const path = require('path');

const MODEL = 'claude-sonnet-4-6';
const TOPICS_PER_AGENT = 20;
const MAX_TOPICS_TOKENS = 1200;

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

// Same cast as studio-floor-render's STUDIO_FLOOR_CAST. Keep in sync.
const CAST_NAMES = [
  'August "Auggie" Vidal',
  'Charles Monroe',
  'Beatriz "Bea" Vega',
  'Ms. Ivy (Ivy Sinclair)',
  'Jules Hartley',
  'Jess Ramirez',
  'Imani Brooks',
  'Reid Callum',
  'Wren Calloway',
  'Carol Haynes',
  'Ayanna Cole',
  'Sneha Desai',
  'Arjun Mehta',
  'Jax Rivera',
  'Chris',
];

async function validateRequest(event) {
  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return { ok: false, reason: 'no_bearer' };
  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false, reason: 'empty_token' }; { const _ok = require('./_owner-auth.js').ownerUser(token); if (_ok) return { ok: true, user: _ok }; }
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

// Week key = YYYYMMDD of the Monday (ET) that starts this week. Stable across
// the whole week, easy to reason about, sorts lexicographically.
function currentWeekKey() {
  const now = new Date();
  // Find Monday in ET
  const etStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(now);
  const get = (type) => (etStr.find(p => p.type === type) || {}).value;
  const y = parseInt(get('year'), 10);
  const m = parseInt(get('month'), 10);
  const d = parseInt(get('day'), 10);
  const weekday = get('weekday'); // Mon, Tue, ...
  const map = { Mon:0, Tue:1, Wed:2, Thu:3, Fri:4, Sat:5, Sun:6 };
  const offset = map[weekday] != null ? map[weekday] : 0;
  // Compute Monday's date by subtracting offset days
  const mondayDate = new Date(Date.UTC(y, m - 1, d - offset, 12, 0, 0));
  const yy = mondayDate.getUTCFullYear();
  const mm = String(mondayDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(mondayDate.getUTCDate()).padStart(2, '0');
  return '' + yy + mm + dd;
}

function normalizeName(s) {
  return String(s || '').toLowerCase()
    .replace(/[""'']/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function loadRoster(event) {
  // Try fs first (works locally + when included_files actually ships).
  const candidates = [
    path.join(__dirname, '..', '..', 'data', 'etl-agents-roster.json'),
    path.join(process.cwd(), 'data', 'etl-agents-roster.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.agents) && parsed.agents.length) return parsed.agents;
      }
    } catch (_) {}
  }
  // Bulletproof fallback: fetch the roster from the deployed site itself.
  // process.env.URL is set by Netlify for cron + standard invocations.
  const base = process.env.URL
            || ((event && event.headers && (event.headers.host || event.headers.Host))
                ? 'https://' + (event.headers.host || event.headers.Host) : '');
  if (base) {
    try {
      const r = await fetch(base + '/data/etl-agents-roster.json', { cache: 'no-store' });
      if (r.ok) {
        const parsed = await r.json();
        if (parsed && Array.isArray(parsed.agents) && parsed.agents.length) return parsed.agents;
      }
    } catch (_) {}
  }
  return [];
}

function buildPromptForAgent(agent) {
  const lines = [
    'You are generating PERSONAL, off-the-clock Watercooler conversation topics for ' + agent.name + ', a member of an AI workplace cast on Dr. Terry Oroszi\'s Studio.',
    '',
    'ABOUT ' + agent.name + ':',
    'Role: ' + (agent.role || ''),
  ];
  if (agent.background)  lines.push('Background: ' + agent.background);
  if (agent.floor_chat)  lines.push('How they talk on the Floor: ' + agent.floor_chat);
  if (agent.interests && Array.isArray(agent.interests) && agent.interests.length) {
    lines.push('Their interests: ' + agent.interests.join(', '));
  }
  if (agent.hashtags && Array.isArray(agent.hashtags) && agent.hashtags.length) {
    lines.push('Their hashtags: ' + agent.hashtags.join(' '));
  }
  lines.push('');
  lines.push('TASK: Generate ' + TOPICS_PER_AGENT + ' specific PERSONAL Watercooler kickoff topics ' + agent.name + ' might open with this week. Each topic is ONE concrete thing they might bring up.');
  lines.push('');
  lines.push('GOOD examples (concrete, off-the-clock, in-character):');
  lines.push('  - "a podcast they could not stop listening to on the commute"');
  lines.push('  - "a hot sauce their brother mailed from Texas"');
  lines.push('  - "their grandkid\'s loose tooth they keep showing photos of"');
  lines.push('  - "a paint color they keep walking past at the hardware store"');
  lines.push('  - "a cardamom roll at the new bakery on the corner"');
  lines.push('');
  lines.push('BAD examples (too vague, work-related, or off-character):');
  lines.push('  - "a podcast" (too vague)');
  lines.push('  - "a source she got off the phone with" (work-related)');
  lines.push('  - "a deploy that just finished" (work-related)');
  lines.push('  - "the meaning of life" (not specific)');
  lines.push('');
  lines.push('RULES:');
  lines.push('- OFF-THE-CLOCK ONLY. Nothing about clients, deliverables, drafts, deadlines, sources, deploys, projects, manuscripts, or anything they would do at work.');
  lines.push('- SPECIFIC and CONCRETE. Not a category, a particular thing.');
  lines.push('- IN THEIR VOICE and LIFE CONTEXT. Use the background and interests above.');
  lines.push('- VARIETY across topics. Spread across these registers: food/coffee, family/friends/pets, weekend plans, commute or neighborhood, small irritations, small joys, things they read/watched/listened to, hobbies, seasonal beats, household stuff, small personal wins.');
  lines.push('- NO two topics in the same micro-category. (Not three different "coffee" topics, not three different "their kid" topics.)');
  lines.push('- Avoid em dashes. Avoid AI tells (delve, navigate, robust, comprehensive, leverage, tapestry, fascinating, dive in, etc.).');
  lines.push('');
  lines.push('Return ONLY a JSON array of ' + TOPICS_PER_AGENT + ' strings. No prose before or after. No markdown fences. Just the JSON array.');
  return lines.join('\n');
}

function parseTopics(rawText) {
  if (!rawText) return null;
  // Strip optional code fences
  let t = rawText.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  }
  // Find first '[' and last ']'
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = t.slice(start, end + 1);
  try {
    const arr = JSON.parse(slice);
    if (!Array.isArray(arr)) return null;
    return arr.filter(x => typeof x === 'string' && x.trim().length > 4).map(x => x.trim());
  } catch (e) {
    return null;
  }
}

async function generateForAgent(client, agent) {
  const prompt = buildPromptForAgent(agent);
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOPICS_TOKENS,
      temperature: 0.9,
      messages: [{ role: 'user', content: prompt }],
    });
    const txt = (resp.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');
    const topics = parseTopics(txt);
    if (!topics || topics.length < 5) {
      return { ok: false, reason: 'parse_failed_or_too_few', raw_excerpt: (txt || '').slice(0, 200) };
    }
    return { ok: true, topics };
  } catch (e) {
    return { ok: false, reason: 'api_error', error: e && e.message };
  }
}

async function cleanupOldWeeks(store, currentKey) {
  // Best-effort: list keys under staff_topics/ and delete any week prefix
  // that is older than the current week minus 4. Netlify Blobs supports
  // list({ prefix }) — but in case the runtime doesn't, we wrap in try.
  try {
    const list = await store.list({ prefix: 'staff_topics/' });
    const seen = new Set();
    (list.blobs || []).forEach(b => {
      const m = b.key && b.key.match(/^staff_topics\/(\d{8})\//);
      if (m) seen.add(m[1]);
    });
    const cutoff = (() => {
      const c = new Date();
      c.setDate(c.getDate() - 35);
      const y = c.getFullYear();
      const mm = String(c.getMonth() + 1).padStart(2, '0');
      const dd = String(c.getDate()).padStart(2, '0');
      return '' + y + mm + dd;
    })();
    for (const wk of seen) {
      if (wk < cutoff && wk !== currentKey) {
        // Delete every blob under that week prefix
        try {
          const sub = await store.list({ prefix: 'staff_topics/' + wk + '/' });
          for (const b of (sub.blobs || [])) {
            try { await store.delete(b.key); } catch (_) {}
          }
        } catch (_) {}
      }
    }
  } catch (_) {}
}

exports.handler = async function(event) {
  try { connectLambda(event); } catch (_) {}

  // Allow GET for the cron scheduler (no body, no auth)
  const isCron = (event.httpMethod === 'GET') ||
                 ((event.headers || {})['x-netlify-event-type'] === 'scheduled');

  if (!isCron) {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method_not_allowed' }) };
    }
    const auth = await validateRequest(event);
    if (!auth.ok) {
      return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized', reason: auth.reason }) };
    }
  }

  const apiKey = process.env.FOUNDER_STUDIO_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'no_api_key' }) };
  }
  const client = new Anthropic({ apiKey });

  const roster = await loadRoster(event);
  if (!roster.length) {
    return { statusCode: 500, body: JSON.stringify({ error: 'roster_not_found' }) };
  }

  const byName = {};
  roster.forEach(a => { if (a && a.name) byName[a.name] = a; });

  const store = getStore('watercooler');
  const weekKey = currentWeekKey();
  const generated = [];
  const skipped = [];

  for (const castName of CAST_NAMES) {
    const agent = byName[castName];
    if (!agent) {
      skipped.push({ name: castName, reason: 'not_in_roster' });
      continue;
    }
    const result = await generateForAgent(client, agent);
    if (!result.ok) {
      skipped.push({ name: castName, reason: result.reason });
      continue;
    }
    const key = 'staff_topics/' + weekKey + '/' + normalizeName(castName);
    await store.setJSON(key, {
      name: castName,
      week_key: weekKey,
      generated_at: new Date().toISOString(),
      topics: result.topics,
    });
    generated.push({ name: castName, topic_count: result.topics.length });
  }

  // Maintain rolling window: drop pools older than ~4 weeks
  await cleanupOldWeeks(store, weekKey);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      ok: true,
      week_key: weekKey,
      generated_count: generated.length,
      skipped_count: skipped.length,
      generated,
      skipped,
    }),
  };
};
