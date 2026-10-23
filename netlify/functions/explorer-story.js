/* explorer-story: the story generator for the explorer, 2026-10-23, Dr. O ("you need to create a story generator for her, with all the specifics").
   POST { seen: ["mongolia", ...] }  ->  { ok, episode: { id, place, text, postcard: { front, back } } }  or  { ok, all_seen: true }
   POST { action: "review" } with Authorization: Bearer <owner key>  ->  every generated episode with its facts list, for Dr. O to check.

   How it works. Stories are written once and kept (Netlify Blobs), so a story is true the same way a line in a character file is true and is told
   the same way every time. A visitor is given the first story they have not heard (the page remembers which, in the browser). Only when a visitor
   has heard everything is a new one written: a real place nobody has used, a draft from the bible, then a second pass that strikes any
   claim the checker is not sure of. A daily cap keeps the cost small and stops a loop from running up a bill. It runs on the Azure model first
   (_azure.js), so it uses the Azure credits, and falls back to Claude with ETL_API_KEY. The three seed stories ship in explorer-episodes.json,
   so the page works even when nothing is set up. The generated facts lists are never sent to visitors. */
const fs = require('fs');
const path = require('path');
const azure = require('./_azure.js');
const { houseTypography } = require('./_etl-voice-law.js');
const { ownerUser } = require('./_owner-auth.js');
const { BIBLE, VERIFY, PLACES } = require('./_explorer-bible.js');

const CLAUDE_MODEL = 'claude-sonnet-5';
const MAX_NEW_PER_DAY = 6;
const MAX_STORED = 300;
const EXIT = "Sorry, {name}, I have to go, they're on to me.";
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
const reply = (status, obj) => ({ statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });

function seeds() {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'explorer-episodes.json'), 'utf8'));
    return (d.episodes || []).map((e) => ({ id: e.id, place: e.place, text: e.text, postcard: e.postcard, facts: e.facts || [], seed: true }));
  } catch (_) { return []; }
}

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

/* One clean episode, or null. Rules that must hold whatever the model wrote. */
function clean(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const fix = (s) => houseTypography(String(s || '')).replace(/\bplainly\b,?\s*/gi, '').replace(/\bmy bad\b/gi, 'oops').trim();
  let text = fix(raw.text);
  if (!text.includes('{name}')) return null;
  if (!text.endsWith(EXIT)) text = text.replace(/Sorry,\s*\{name\}[^]*$/i, '').trim() + ' ' + EXIT;
  const n = words(text);
  if (n < 90 || n > 200) return null;
  const pc = raw.postcard || {};
  const front = fix(pc.front), back = fix(pc.back);
  if (!front || !back || words(front) > 16 || words(back) > 60) return null;
  const facts = (Array.isArray(raw.facts) ? raw.facts : []).map((f) => fix(f)).filter(Boolean).slice(0, 12);
  return { text, postcard: { front, back }, facts };
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
  const r = await client.messages.create({ model: CLAUDE_MODEL, max_tokens: 900, system, messages: [{ role: 'user', content: user }] });
  return (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim() || null;
}

async function ask(system, user, deps, temperature) {
  let out = null;
  try { out = await (deps.azureChat || azure.chat)([{ role: 'system', content: system }, { role: 'user', content: user }], { maxTokens: 900, temperature }); } catch (_) { out = null; }
  if (!out) { try { out = await (deps.claudeChat || claudeChat)(system, user, deps); } catch (e) { console.error('[explorer] claude failed:', e && e.message); out = null; } }
  return out;
}

/* Draft, then a checking pass. Returns a clean episode or null. */
async function write(place, hook, deps) {
  const draft = clean(parseJson(await ask(BIBLE, 'Write a new episode set in ' + place + '. A true place to start from: ' + hook + '. Use only facts you are certain of.', deps, 0.9)));
  if (!draft) return null;
  const checked = clean(parseJson(await ask(VERIFY, JSON.stringify(draft), deps, 0.2)));
  const best = checked || draft;
  best.verified = !!checked;
  return best;
}

async function store(event, deps) {
  if (deps.store) return deps.store;
  try {
    const { getStore, connectLambda } = require('@netlify/blobs');
    try { connectLambda(event); } catch (_) {}
    return getStore('explorer');
  } catch (_) { return null; }
}

async function handler(event, deps) {
  const d = deps || {};
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'method_not_allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return reply(400, { ok: false, error: 'bad_json' }); }

  const st = await store(event, d);
  let kept = [];
  try { const j = st ? await st.get('episodes', { type: 'json' }) : null; if (Array.isArray(j)) kept = j; } catch (_) { kept = []; }
  const all = seeds().concat(kept);

  if (body.action === 'review') {
    const token = String((event.headers && (event.headers.authorization || event.headers.Authorization)) || '').replace(/^Bearer\s+/i, '').trim();
    if (!(d.isOwner || ((t) => !!ownerUser(t)))(token)) return reply(401, { ok: false, error: 'owner_key_needed' });
    return reply(200, { ok: true, episodes: all.map((e) => ({ id: e.id, place: e.place, verified: e.verified !== false, facts: e.facts, text: e.text, postcard: e.postcard })) });
  }

  const seen = new Set((Array.isArray(body.seen) ? body.seen : []).map((x) => String(x).slice(0, 60)));
  const open = all.find((e) => !seen.has(e.id));
  const view = (e) => ({ id: e.id, place: e.place, text: e.text, postcard: e.postcard });
  if (open) return reply(200, { ok: true, episode: view(open) });

  // the visitor has heard everything: write a new one, if the cap allows and a store exists
  if (!st) return reply(200, { ok: true, all_seen: true });
  const today = new Date().toISOString().slice(0, 10);
  let count = 0;
  try { const q = await st.get('count-' + today, { type: 'json' }); count = Number(q && q.n) || 0; } catch (_) { count = 0; }
  if (count >= MAX_NEW_PER_DAY) return reply(200, { ok: true, all_seen: true });

  const used = new Set(all.map((e) => slug(e.place)));
  const free = PLACES.filter((p) => !used.has(slug(p.place)));
  if (!free.length) return reply(200, { ok: true, all_seen: true });
  const pick = free[Math.floor((d.random || Math.random)() * free.length)];

  let made = null;
  try { made = await write(pick.place, pick.hook, d) || await write(pick.place, pick.hook, d); } catch (e) { console.error('[explorer] write failed:', e && e.message); }
  if (!made) return reply(200, { ok: true, all_seen: true });

  const ep = { id: slug(pick.place), place: pick.place, text: made.text, postcard: made.postcard, facts: made.facts, verified: made.verified, made: new Date().toISOString() };
  try {
    await st.setJSON('episodes', kept.concat([ep]).slice(-MAX_STORED));
    await st.setJSON('count-' + today, { n: count + 1 });
  } catch (e) { console.error('[explorer] store failed:', e && e.message); }
  return reply(200, { ok: true, episode: view(ep), fresh: true });
}

exports.handler = (event) => handler(event, {});
exports.run = handler;
exports.clean = clean;
exports.parseJson = parseJson;
