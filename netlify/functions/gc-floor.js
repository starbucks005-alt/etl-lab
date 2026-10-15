/* gc-floor: who has the floor in a talk between characters, 2026-10-15, Dr. O: "stop talking over each other".

   POST { action: "claim" | "release", room, who, ttl? }  ->  claim: { granted: true } or { granted: false, holder }   release: { ok: true }

   Elle (on her Pi) and the hologram pages (Alice, Reggie, Tansy ...) hear each other only through the air, so nothing stopped two of them
   starting at once. Each now asks here before speaking and says when it has finished; only one holds the floor at a time. The one that asked first
   (by the database's own clock) wins a tie. A hold expires on its own after ttl seconds (default 25, never more than 60), so a crash cannot leave the
   floor taken. A caller that cannot reach this function speaks anyway, so a failure here never silences them.

   ACTIONS: claim, release, status ({hushed}), hush (everybody stop, 10 minutes unless body.minutes says otherwise), clear.

   NO NEW TABLE: a hold is a row in etl_visitor_memories with agent_key "floor:<room>", which no character ever reads as a memory (they read
   "gc:" and "gcd:" keys only). Rows older than five minutes are removed on every claim. NOT TRIED AGAINST THE REAL TABLE when it was written. */
const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (code, body) => ({
  statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return json(500, { error: 'not_configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }
  const room = slug(body.room), who = slug(body.who);
  if (room.length < 3 || !who) return json(400, { error: 'room_and_who_needed' });
  const action = ['release', 'hush', 'clear', 'status'].includes(body.action) ? body.action : 'claim';
  const ttl = Math.max(5, Math.min(60, Number(body.ttl) || 25));

  const agentKey = 'floor:' + room;
  const visitor = ('floor-' + who + '-xxxxxxxx').slice(0, 64);
  const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const T = `${SUPABASE_URL}/rest/v1/etl_visitor_memories`;
  const q = s => `${T}?agent_key=eq.${encodeURIComponent(agentKey)}${s || ''}`;

  async function mine() { return fetch(q(`&visitor_id=eq.${encodeURIComponent(visitor)}`), { method: 'DELETE', headers: H }); }
  async function active() {
    const r = await fetch(q('&select=visitor_id,memory,created_at&order=created_at.asc&limit=20'), { headers: H });
    if (!r.ok) throw new Error('select ' + r.status);
    const rows = await r.json();
    const now = Date.now(), out = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      let m = {}; try { m = JSON.parse(row.memory || '{}'); } catch (_) {}
      if (m && Number(m.until) > now) out.push({ visitor: row.visitor_id, who: m.who || '' });
    }
    return out;
  }

  /* HUSH, 2026-10-15, Dr. O: "tell all of them to stop talking when I say This is Dr. O", and "I have to wait until they stop talking to say it, well
     then it really will not work". While one is speaking the others are listening, so whichever one hears the phrase (or a button on hush.html is
     pressed) sets this, and every device checks it before speaking and while it speaks. It lasts 10 minutes by default (body.minutes, 1 to 120), or until
     cleared, or until a new talk is started. 2026-10-15, Dr. O: "a way to stop them when I need to talk to real people, so I do not need to run away". */
  const hushKey = 'hush:' + room;
  const hushUrl = s => `${T}?agent_key=eq.${encodeURIComponent(hushKey)}${s || ''}`;
  async function hushed() {
    const r = await fetch(hushUrl('&select=memory&order=created_at.desc&limit=1'), { headers: H });
    if (!r.ok) throw new Error('hush select ' + r.status);
    const rows = await r.json();
    let m = {}; try { m = JSON.parse((rows[0] || {}).memory || '{}'); } catch (_) {}
    return Number(m.until) > Date.now();
  }

  try {
    if (action === 'release') { await mine(); return json(200, { ok: true }); }
    if (action === 'status') return json(200, { hushed: await hushed() });
    if (action === 'clear') { await fetch(hushUrl(), { method: 'DELETE', headers: H }); await mine(); return json(200, { ok: true, hushed: false }); }
    if (action === 'hush') {
      await fetch(hushUrl(), { method: 'DELETE', headers: H });
      const hi = await fetch(T, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
        body: JSON.stringify({ visitor_id: 'hush-' + room + '-xxxxxxxx', agent_key: hushKey, memory: JSON.stringify({ until: Date.now() + Math.max(1, Math.min(120, Number(body.minutes) || 10)) * 60 * 1000, by: who }) }) });
      if (!hi.ok) throw new Error('hush insert ' + hi.status);
      await mine();
      return json(200, { ok: true, hushed: true });
    }
    if (await hushed()) return json(200, { granted: false, hushed: true });

    await fetch(q(`&created_at=lt.${encodeURIComponent(new Date(Date.now() - 5 * 60 * 1000).toISOString())}`), { method: 'DELETE', headers: H });
    let rows = await active();
    const other = rows.find(r => r.visitor !== visitor);
    if (other) return json(200, { granted: false, holder: other.who });

    await mine();
    const ins = await fetch(T, {
      method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify({ visitor_id: visitor, agent_key: agentKey, memory: JSON.stringify({ who, until: Date.now() + ttl * 1000 }) }),
    });
    if (!ins.ok) throw new Error('insert ' + ins.status);

    rows = await active();                          // two may have asked at once: the earliest row wins, the other gives up
    if (rows.length && rows[0].visitor !== visitor) { await mine(); return json(200, { granted: false, holder: rows[0].who }); }
    return json(200, { granted: true });
  } catch (err) {
    console.error('gc-floor failed:', err.message);
    return json(502, { error: 'floor_unreachable' });
  }
};
