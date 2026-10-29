/* fireside: the director for a fireside chat between ALICE, Elle and Lumvivo, 2026-10-29, Dr. O. The rules are in _fireside-core.js.

   POST { action, room?, seat?, name?, cue?, said?, code?, ... }

   Robots:  poll {seat, name}   -> { on, stop, paused, cue: {id, ask} or null, floor, every }
            speaking {seat, cue} (her voice has started)
            done {seat, cue, said} (she has finished speaking, and what she said)
   Host:    start {code, topic, order, auto, run_max, opener}, end, hold, hold_after, resume, next, give {seat, prompt?, from?},
            ask {prompt, seat or "all", from: "host" or "guest"}, set {auto, topic, run_max}, clear_queue. Each needs the code chosen at start.
   Anyone:  state  -> what the host page shows (never the code)

   STORAGE, NO NEW TABLE: the same table gc-floor.js uses, etl_visitor_memories, agent_key "fireside:<room>". Every change is a NEW row with the
   next revision number. If two changes were made from the same revision at once, the row the database wrote first wins and the other is
   removed and worked out again from the winner, so a tap on the host page and a robot finishing at the same moment cannot undo each other.
   Old rows are removed as new ones are written. NOT TRIED AGAINST THE REAL TABLE when it was written. */
const crypto = require('crypto');
const core = require('./_fireside-core.js');

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (code, body) => ({ statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
const hashCode = (room, code) => crypto.createHash('sha256').update('fireside:' + room + ':' + String(code || '').trim().toLowerCase()).digest('hex');

function supabaseStore(key) {
  const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const T = `${SUPABASE_URL}/rest/v1/etl_visitor_memories`;
  const q = (room, s) => `${T}?agent_key=eq.${encodeURIComponent('fireside:' + room)}${s || ''}`;
  async function rows(room) {
    const r = await fetch(q(room, '&select=visitor_id,memory,created_at&order=created_at.desc&limit=10'), { headers: H });
    if (!r.ok) throw new Error('select ' + r.status);
    const out = [];
    for (const row of await r.json()) {
      try { const m = JSON.parse(row.memory || '{}'); if (m && m.state) out.push({ vid: row.visitor_id, at: row.created_at, rev: Number(m.rev) || 0, nonce: m.nonce, state: m.state }); } catch (_) {}
    }
    return out;
  }
  function winner(list) {
    if (!list.length) return null;
    const top = Math.max(...list.map(x => x.rev));
    return list.filter(x => x.rev === top).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))[0];
  }
  return {
    async load(room) { const w = winner(await rows(room)); return w ? { rev: w.rev, state: w.state } : { rev: 0, state: null }; },
    async commit(room, rev, state) {
      const nonce = crypto.randomBytes(6).toString('hex');
      const vid = ('fireside-' + room + '-' + rev + '-' + nonce).slice(0, 64);
      const ins = await fetch(T, { method: 'POST', headers: { ...H, Prefer: 'return=representation' },
        body: JSON.stringify({ visitor_id: vid, agent_key: 'fireside:' + room, memory: JSON.stringify({ rev, nonce, state }) }) });
      if (!ins.ok) throw new Error('insert ' + ins.status);
      const w = winner(await rows(room));
      if (!w || w.nonce !== nonce) {
        await fetch(q(room, `&visitor_id=eq.${encodeURIComponent(vid)}`), { method: 'DELETE', headers: H });
        return false;
      }
      const old = new Date(Date.parse(w.at) - 60 * 1000).toISOString();
      fetch(q(room, `&created_at=lt.${encodeURIComponent(old)}`), { method: 'DELETE', headers: H }).catch(() => {});
      return true;
    },
  };
}

let storeFor = () => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return key ? supabaseStore(key) : null;
};

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  const store = storeFor();
  if (!store) return json(500, { error: 'not_configured' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }
  const room = slug(body.room) || 'etl-fireside';
  const codeHash = body.code ? hashCode(room, body.code) : '';
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      const { rev, state } = await store.load(room);
      const isHost = !!(state && state.code && codeHash && state.code === codeHash);
      const r = core.apply(state, body, Date.now(), { isHost, codeHash });
      if (r.error) return json(r.status || 400, { error: r.error });
      if (!r.changed || await store.commit(room, rev + 1, r.state)) return json(200, r.reply);
    }
    return json(503, { error: 'busy, try again' });
  } catch (err) {
    console.error('fireside failed:', err.message);
    return json(502, { error: 'director_unreachable' });
  }
};

exports._setStore = fn => { storeFor = fn; };
exports._hashCode = hashCode;
