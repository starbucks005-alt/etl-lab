/* alice-lore: the long arc of A.L.I.C.E., 2026-10-23, Dr. O's spec (the core wound, five phases, the Last Day in the Lab, the closure, the new family).
   POST { seen: ["id", ...], days: 12, today: 1 }  ->  { ok, fragment: { id, phase, perspective, type, text }, phase }  or  { ok, all_collected: true }
   POST { action: "review" } with Authorization: Bearer <owner key>  ->  every generated fragment, for Dr. O to read.
   NOT A SERIAL: the phases are unlocked by what the visitor has collected (and how many days they have been coming), not by a fixed chapter order. Anyone can start
   anywhere. Closure needs sixty collected, ten of them truth fragments, and 120 days. At most three a day. Stored fragments first, then a new one is written (Azure first, Claude via
   ETL_API_KEY) for phases 0 to 3 and 5. The closure fragments are seeds only. Daily cap on new ones. Seeds ship in alice-fragments.json. */
const fs = require('fs');
const path = require('path');
const azure = require('./_azure.js');
const { houseTypography } = require('./_etl-voice-law.js');
const { ownerUser } = require('./_owner-auth.js');
const bible = require('./_alice-bible.js');

const CLAUDE_MODEL = 'claude-sonnet-5';
const MAX_NEW_PER_DAY = 40;
const MAX_STORED = 600;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
const reply = (status, obj) => ({ statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

function seeds() {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'alice-fragments.json'), 'utf8'));
    return (d.fragments || []).map((f) => ({ ...f, seed: true }));
  } catch (_) { return []; }
}

/* One clean fragment text, or null. Rules that hold whatever the model wrote. */
function clean(raw, type) {
  const wantMulti = type === 'contradiction';
  if (!raw || typeof raw !== 'object') return null;
  const text = houseTypography(String(raw.text || '')).replace(/\bplainly\b,?\s*/gi, '').trim();
  const n = words(text);
  if (n < 10 || n > 90) return null;
  // the closure conversation is only ever a seed
  if (/\bWe didn'?t\.|The project ended\./i.test(text)) return null;
  if (!wantMulti && /\n/.test(text)) return null;
  return text;
}

function parseJson(s) {
  if (!s) return null;
  const t = String(s).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < 0) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch (_) { return null; }
}

async function claudeChat(system, user, deps) {
  const apiKey = (deps.env || process.env).ETL_API_KEY;
  if (!apiKey) return null;
  const Anthropic = deps.Anthropic || require('@anthropic-ai/sdk').default;
  const client = new Anthropic({ apiKey });
  const r = await client.messages.create({ model: CLAUDE_MODEL, max_tokens: 400, system, messages: [{ role: 'user', content: user }] });
  return (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim() || null;
}

async function ask(system, user, deps) {
  let out = null;
  try { out = await (deps.azureChat || azure.chat)([{ role: 'system', content: system }, { role: 'user', content: user }], { maxTokens: 400, temperature: 0.95 }); } catch (_) { out = null; }
  if (!out) { try { out = await (deps.claudeChat || claudeChat)(system, user, deps); } catch (e) { console.error('[alice] claude failed:', e && e.message); out = null; } }
  return out;
}

async function store(event, deps) {
  if (deps.store) return deps.store;
  try {
    const { getStore, connectLambda } = require('@netlify/blobs');
    try { connectLambda(event); } catch (_) {}
    return getStore('alice');
  } catch (_) { return null; }
}

const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];

/* The highest phase this visitor has earned. Phase 4 (closure) is its own gate; once it is open the new family (5) follows it. */
function maxPhase(seenIds, all, days) {
  const n = seenIds.size;
  const byId = new Map(all.map((f) => [f.id, f]));
  const truth = [...seenIds].filter((id) => byId.get(id) && byId.get(id).phase === 3).length;
  const closureSeen = [...seenIds].some((id) => byId.get(id) && byId.get(id).phase === 4);
  if (closureSeen) return 5;
  if (n >= bible.CLOSURE.collected && truth >= bible.CLOSURE.truth && days >= bible.CLOSURE.days) return 4;
  if (n >= bible.UNLOCK[3]) return 3;
  if (n >= bible.UNLOCK[2]) return 2;
  if (n >= bible.UNLOCK[1]) return 1;
  return 0;
}

async function handler(event, deps) {
  const d = deps || {};
  const rnd = d.random || Math.random;
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'method_not_allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return reply(400, { ok: false, error: 'bad_json' }); }

  const st = await store(event, d);
  let kept = [];
  try { const j = st ? await st.get('fragments', { type: 'json' }) : null; if (Array.isArray(j)) kept = j; } catch (_) { kept = []; }
  const all = seeds().concat(kept);

  if (body.action === 'review') {
    const token = String((event.headers && (event.headers.authorization || event.headers.Authorization)) || '').replace(/^Bearer\s+/i, '').trim();
    if (!(d.isOwner || ((t) => !!ownerUser(t)))(token)) return reply(401, { ok: false, error: 'owner_key_needed' });
    return reply(200, { ok: true, fragments: all });
  }

  const seen = new Set((Array.isArray(body.seen) ? body.seen : []).map((x) => String(x).slice(0, 60)));
  const days = Math.max(0, Math.min(3650, Number(body.days) || 0));
  // slowly: only so many a day, then the lab goes quiet until tomorrow
  if ((Number(body.today) || 0) >= bible.DAILY_LIMIT) return reply(200, { ok: true, come_back_tomorrow: true });
  const view = (f) => ({ id: f.id, phase: f.phase, perspective: f.perspective, type: f.type, text: f.text });
  const top = maxPhase(seen, all, days);
  const unlocked = (f) => f.phase <= top;
  // the newest two phases they have earned are where most of what they hear comes from; earlier ones still turn up
  const near = (f) => f.phase >= top - 1;
  let open = all.filter((f) => unlocked(f) && !seen.has(f.id));
  const fresh = open.filter(near);
  const preferred = fresh.length && rnd() < 0.7 ? fresh : open;

  // a new one is written when nothing earned is left, for the phases that are not the closure
  if (!open.length && st) {
    const today = new Date().toISOString().slice(0, 10);
    let count = 0;
    try { const q = await st.get('count-' + today, { type: 'json' }); count = Number(q && q.n) || 0; } catch (_) { count = 0; }
    const writable = [0, 1, 2, 3, 5].filter((p) => p <= top);
    if (count < MAX_NEW_PER_DAY && writable.length) {
      const phase = pick(writable.slice(-2), rnd);
      const perspective = pick(bible.PHASE_PERSPECTIVES[phase], rnd);
      const type = pick(bible.PHASE_TYPES[phase], rnd);
      let text = null;
      try {
        for (let i = 0; i < 2 && !text; i++) text = clean(parseJson(await ask(bible.systemFor(), bible.userFor(phase, perspective, type), d)), type);
      } catch (e) { console.error('[alice] write failed:', e && e.message); }
      if (text) {
        const frag = { id: 'g-' + Date.now().toString(36) + Math.floor(rnd() * 1296).toString(36), phase, perspective, type, text, made: new Date().toISOString() };
        try { await st.setJSON('fragments', kept.concat([frag]).slice(-MAX_STORED)); await st.setJSON('count-' + today, { n: count + 1 }); } catch (e) { console.error('[alice] store failed:', e && e.message); }
        return reply(200, { ok: true, fragment: view(frag), phase: top, fresh: true });
      }
    }
  }
  if (!preferred.length) return reply(200, { ok: true, all_collected: true, phase: top });
  return reply(200, { ok: true, fragment: view(pick(preferred, rnd)), phase: top });
}

exports.handler = (event) => handler(event, {});
exports.run = handler;
exports.clean = clean;
exports.maxPhase = maxPhase;
exports.parseJson = parseJson;
