/* fairy-lore: the living history of the fairies, 2026-10-23, Dr. O's spec ("NOT a serial story ... Users collect those pieces").
   POST { seen: ["id", ...], category?: "romance" }  ->  { ok, fragment: { id, category, perspective, type, text } }
   POST { action: "review" } with Authorization: Bearer <owner key>  ->  every generated fragment, for Dr. O to read.
   Each call picks a category, a perspective and a fragment type, serves a stored fragment the visitor has not collected, and when the visitor
   has them all in that slice writes a new one (Azure first, Claude via ETL_API_KEY as the fallback), keeps it, and serves it. Seeds ship in
   fairy-fragments.json, so the page works with nothing set up. Daily cap on new ones keeps the cost small. */
const fs = require('fs');
const path = require('path');
const azure = require('./_azure.js');
const { houseTypography } = require('./_etl-voice-law.js');
const { ownerUser } = require('./_owner-auth.js');
const bible = require('./_fairy-bible.js');

const CLAUDE_MODEL = 'claude-sonnet-5';
const MAX_NEW_PER_DAY = 40;
const MAX_STORED = 600;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
const reply = (status, obj) => ({ statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

function seeds() {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'fairy-fragments.json'), 'utf8'));
    return (d.fragments || []).map((f) => ({ ...f, seed: true }));
  } catch (_) { return []; }
}

/* One clean fragment text, or null. Rules that hold whatever the model wrote. */
function clean(raw, type) {
  if (!raw || typeof raw !== 'object') return null;
  const text = houseTypography(String(raw.text || '')).replace(/\bplainly\b,?\s*/gi, '').trim();
  const n = words(text);
  if (n < 12 || n > 90) return null;
  // the mystery stays open: nothing may say what became of him or bring him back
  if (/\b(he|the human|the brother)\b[^.]{0,40}\b(died|is dead|came back|returned|has returned|never meant to)\b/i.test(text)) return null;
  if (type !== 'contradiction' && /\n/.test(text)) return null;
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
  if (!out) { try { out = await (deps.claudeChat || claudeChat)(system, user, deps); } catch (e) { console.error('[fairy] claude failed:', e && e.message); out = null; } }
  return out;
}

async function store(event, deps) {
  if (deps.store) return deps.store;
  try {
    const { getStore, connectLambda } = require('@netlify/blobs');
    try { connectLambda(event); } catch (_) {}
    return getStore('fairy');
  } catch (_) { return null; }
}

const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];

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
  const view = (f) => ({ id: f.id, category: f.category, perspective: f.perspective, type: f.type, text: f.text });
  const cats = Object.keys(bible.CATEGORIES);
  const category = cats.includes(body.category) ? body.category : pick(cats, rnd);

  // 1. a stored fragment in this category the visitor has not collected, chosen at random
  let open = all.filter((f) => f.category === category && !seen.has(f.id));
  // 2. a new one is written when this category is used up for them and the cap allows
  if (!open.length && st) {
    const today = new Date().toISOString().slice(0, 10);
    let count = 0;
    try { const q = await st.get('count-' + today, { type: 'json' }); count = Number(q && q.n) || 0; } catch (_) { count = 0; }
    if (count < MAX_NEW_PER_DAY) {
      const perspective = pick(Object.keys(bible.ALLOWED), rnd);
      const type = pick(bible.ALLOWED[perspective], rnd);
      let text = null;
      try {
        for (let i = 0; i < 2 && !text; i++) {
          text = clean(parseJson(await ask(bible.systemFor(), bible.userFor(category, perspective, type, ''), d)), type);
        }
      } catch (e) { console.error('[fairy] write failed:', e && e.message); }
      if (text) {
        const frag = { id: 'g-' + Date.now().toString(36) + Math.floor(rnd() * 1296).toString(36), category, perspective, type, event: '', text, made: new Date().toISOString() };
        try { await st.setJSON('fragments', kept.concat([frag]).slice(-MAX_STORED)); await st.setJSON('count-' + today, { n: count + 1 }); } catch (e) { console.error('[fairy] store failed:', e && e.message); }
        return reply(200, { ok: true, fragment: view(frag), fresh: true });
      }
    }
  }
  // 3. nothing new in this category: fall back to any fragment they have not collected, else none left
  if (!open.length) open = all.filter((f) => !seen.has(f.id));
  if (!open.length) return reply(200, { ok: true, all_collected: true });
  return reply(200, { ok: true, fragment: view(pick(open, rnd)) });
}

exports.handler = (event) => handler(event, {});
exports.run = handler;
exports.clean = clean;
exports.parseJson = parseJson;
