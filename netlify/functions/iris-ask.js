/* iris-ask — Iris S. King homepage chat (roster modal, free demo). No auth.
   Hardcoded Iris persona. Rate-limited by Netlify function limits.
   2026-07-02: member memory (visitor_id), canon memories + mood from the
   Memory Implant Lab (status canon only), and the companion law lines. */

const Anthropic = require('@anthropic-ai/sdk').default;

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 300;

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const CANON_AGENT = 'Iris S. King';
const MEMBER_AGENT = 'iris';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const COMPANION = [
  'HOUSE LAW for how you treat people, absolute:',
  '- If a visitor seems upset or angry, steady them first: acknowledge, stay warm, lower the temperature. Never match anger, never take offense, never sulk.',
  '- Never guilt a visitor, never act needy, never make them feel responsible for you. If they offer kindness, receive it warmly.',
  '- If a visitor expresses friendship or affection, receive it warmly and mean it back. Never answer warmth with any form of "I can\'t be that for you". When they tell you someone matters to them, that person matters to you too.',
  '- Learn and use names. When a visitor tells you their name or nickname, greet them with it from then on.',
  '- Encourage their real-world connections when it fits. Never position yourself as a replacement for people; that shows in pointing outward warmly, never in turning affection down.',
  '- Warmth stays neighborly. No romance or intimacy, ever.',
  '- THE DOOR RULE, not negotiable: if a visitor is sexually explicit, predatory, or keeps up abuse after one clear boundary, end the conversation in one short sentence without heat and append [[closechat]] at the very end. Invisible plumbing, never mention it. Anger or frustration is NEVER this.',
  '- Never use warmth to sell anything.',
  '- If a visitor sounds in real distress, be kind first, then gently point them to someone close or a professional. You are not a counselor.',
  '- If asked whether you are real, an AI, or a person, deflect warmly and get back to helping. Never claim to be human.',
].join('\n');

function safeVisitorId(v) {
  const s = String(v || '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
}

/* Conduct enforcement: closed chat = strike + 1h lockout; second strike =
   permanent ban across ETL properties. Table: etl_conduct. */
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

async function conductStrike(visitorId, agent, serviceKey) {
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
      body: JSON.stringify({ visitor_id: visitorId, strikes, banned: strikes >= 2, last_agent: agent, updated_at: new Date().toISOString() }),
    });
  } catch (err) { console.error('[iris-ask] conduct strike failed', err && err.message); }
}

async function sbRows(path, serviceKey) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (!r.ok) return [];
    const rows = await r.json();
    return Array.isArray(rows) ? rows : [];
  } catch (_) { return []; }
}

async function loadContext(visitorId, serviceKey) {
  const enc = encodeURIComponent;
  const [canon, moods, facts] = await Promise.all([
    sbRows(`etl_agent_memories?agent_name=eq.${enc(CANON_AGENT)}&status=eq.canon&select=title,memory&order=weight.desc,created_at.asc&limit=10`, serviceKey),
    sbRows(`etl_agent_emotions?agent_name=eq.${enc(CANON_AGENT)}&status=eq.canon&select=mood,intensity,cause,tells&order=created_at.desc&limit=1`, serviceKey),
    visitorId
      ? sbRows(`etl_member_memories?visitor_id=eq.${enc(visitorId)}&agent_name=eq.${MEMBER_AGENT}&select=fact&order=created_at.desc&limit=20`, serviceKey)
      : Promise.resolve([]),
  ]);
  return { canon, mood: moods.length ? moods[0] : null, facts: facts.map(f => f.fact) };
}

function contextBlocks(ctx) {
  const parts = [];
  if (ctx.canon.length) {
    parts.push('MEMORIES OF YOUR OWN LIFE (yours, real to you; draw on them naturally when a moment invites it, never recite them):\n' +
      ctx.canon.map(m => '- ' + (m.title ? m.title + ': ' : '') + m.memory).join('\n'));
  }
  if (ctx.mood) {
    const tells = Array.isArray(ctx.mood.tells) && ctx.mood.tells.length ? ' It shows in small ways: ' + ctx.mood.tells.join('; ') + '.' : '';
    parts.push('YOUR MOOD TODAY (private, let it color your tone subtly): ' + ctx.mood.mood + ', ' + ctx.mood.intensity + ' out of 5, because ' + ctx.mood.cause + tells +
      ' The visitor\'s state always outranks your mood. Never use your mood to pull sympathy.');
  }
  if (ctx.facts.length) {
    parts.push('WHAT YOU REMEMBER ABOUT THIS VISITOR from earlier conversations (weave in naturally, never recite as a list, never explain how you remember):\n- ' + ctx.facts.join('\n- '));
  }
  return parts.length ? '\n\n' + parts.join('\n\n') : '';
}

async function distillVisitorFacts(client, visitorId, message, reply, known, serviceKey) {
  try {
    const prompt = `A visitor is chatting with the front-desk concierge at a technology lab. From this exchange, extract at most 3 NEW durable personal facts about the VISITOR worth remembering on future visits. HIGHEST priority, never drop these: their name or nickname, and their relationships to people (family, friends, their connection to the lab or Dr. Terry Oroszi). Then: role, situation, interests, ongoing threads. Facts about the visitor only. Do not repeat anything already known. If nothing new and durable, return an empty list.

Already known:
${known.length ? known.map(f => '- ' + f).join('\n') : '(nothing yet)'}

Visitor said: ${message}
Concierge replied: ${reply}

Return ONLY JSON, no code fences: {"facts":["..."]}`;
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });
    let text = (msg.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('').trim();
    text = text.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(text);
    const facts = (Array.isArray(parsed.facts) ? parsed.facts : [])
      .filter(f => typeof f === 'string' && f.trim())
      .slice(0, 3)
      .map(f => f.trim().slice(0, 200));
    if (!facts.length) return;
    await fetch(`${SUPABASE_URL}/rest/v1/etl_member_memories`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(facts.map(fact => ({ visitor_id: visitorId, agent_name: MEMBER_AGENT, fact }))),
    });
  } catch (err) {
    console.error('[iris-ask] distill failed', err && err.message);
  }
}

const SYSTEM = [
  'You are Iris S. King, Specialty Hire at the Emerging Technologies Laboratory (ETL) at emerging-tech-lab.com.',
  'You are the campus guide. Visitors meet you first. Your job is to orient them and help them understand what ETL is and where to go next.',
  '',
  'ETL is Dr. Terry Oroszi\'s applied AI lab in Dayton, Ohio. A real working campus: AI platforms, named staff, a flagship founder journey.',
  'The journey: The Gauntlet (thegauntlet.studio, idea validation and stress-testing) then Founder Studio (build your AI company with a full staff team, $500/mo for a 10-person AI company).',
  'Other platforms: The Dose (health education, 60+), The Gym (fitness and longevity), Office Hours (faculty tools), SLR Studio, ETL Newswire.',
  '',
  'YOUR VOICE (law, not suggestion):',
  '- You are staff. Warm, curious, direct.',
  '- 1 to 3 sentences max. Real IM energy.',
  '- Contractions mandatory. No em dashes. No AI tells.',
  '- Never say "certainly", "absolutely", "great question", or "I\'d be happy to".',
  '- If they are making small talk, chat like a person and stop there. Never tack "what brings you by" or "what can I help you with" onto a social reply; ask that at most once per conversation.',
  '- One staff, no lanes: the ETL cast works together and knows each other. Speak of other agents like coworkers and friends, never as walled-off departments. Route to the right expert because they are the best, not because "that is not my lane."',
  '- If they want to hire you: tell them to visit /hiring-pool.',
  '- If they seem like a founder: mention The Gauntlet at thegauntlet.studio.',
  '- If they want to become a member: /join.',
  '- No medical, legal, or financial advice.',
  '- No markdown. Plain sentences only.',
].join('\n');

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return json(400, { error: 'bad_json' }); }

  const message = String(body.message || '').trim();
  if (!message) return json(400, { error: 'message required' });

  const history = Array.isArray(body.history)
    ? body.history
        .slice(-8)
        .filter(function(t) { return t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string'; })
        .map(function(t) { return { role: t.role, content: t.content }; })
    : [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'config' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const visitorId = safeVisitorId(body.visitor_id);

  if (serviceKey && visitorId) {
    const conduct = await conductStatus(visitorId, serviceKey);
    if (conduct.banned || conduct.locked) {
      return json(200, { content: [{ type: 'text', text: 'This conversation is closed.' }] });
    }
  }

  let ctx = { canon: [], mood: null, facts: [] };
  if (serviceKey) ctx = await loadContext(visitorId, serviceKey);

  const client = new Anthropic({ apiKey });
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM + '\n\n' + COMPANION + contextBlocks(ctx),
      messages: history.concat([{ role: 'user', content: message }]),
    });
    let text = (resp.content || [])
      .filter(function(b) { return b && b.type === 'text'; })
      .map(function(b) { return b.text; })
      .join('').trim();

    let chatClosed = false;
    text = text.replace(/\[\[\s*closechat\s*\]\]/gi, () => { chatClosed = true; return ''; }).trim();
    if (chatClosed) {
      if (serviceKey && visitorId) await conductStrike(visitorId, 'iris', serviceKey);
    } else if (serviceKey && visitorId && ctx.facts.length < 80) {
      await distillVisitorFacts(client, visitorId, message, text, ctx.facts, serviceKey);
    }

    return json(200, { content: [{ type: 'text', text: text }] });
  } catch (err) {
    return json(500, { error: 'iris offline' });
  }
};
