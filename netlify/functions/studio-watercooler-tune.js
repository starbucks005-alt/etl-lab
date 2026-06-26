/* ─────────────────────────────────────────────────────────────────────────────
   studio-watercooler-tune

   The "TV tune-in" endpoint for the Floor. Called whenever the front-end
   opens or polls the Watercooler / Workfloor tab. Implements the cache
   rule Terry locked:

     Open the tab → check latest episode timestamp.
     If <30 min old → serve the cached episode (no spend).
     If ≥30 min old → fire studio-floor-render server-to-server, wrap the
     result in episode metadata, write to blob, return.

   Self-cleans episodes older than 7 days on every regen (rolling DVR
   window). Single-tenant for now; multi-tenant key prefixing lands with
   the Stripe sprint.

   POST body: { mode: 'workfloor' | 'watercooler' }

   Returns:
     { episode: { id, mode, timestamp, age_seconds, fresh: bool,
                  messages, context_note, lead?, topic? },
       dvr: [ { id, mode, timestamp, lead?, topic?, message_count }, ... ]  ← last 7 days, newest first
     }

   Auth: same Supabase JWT gate as every other studio-* function.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

const CACHE_TTL_MS = 30 * 60 * 1000;          // 30 minutes
const DVR_WINDOW_DAYS = 7;
const DVR_LIST_LIMIT = 200;                    // sanity cap

async function validateRequest(event) {
  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return { ok: false, reason: 'no_bearer' };
  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false, reason: 'empty_token' };
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token, 'apikey': SUPABASE_ANON_KEY },
    });
    if (!r.ok) return { ok: false, reason: 'supabase_rejected_' + r.status };
    const user = await r.json();
    if (!user || !user.id) return { ok: false, reason: 'no_user' };
    return { ok: true, user, token };
  } catch (e) {
    return { ok: false, reason: 'fetch_failed', error: e && e.message };
  }
}

// ET-date stamp so day boundaries align with the office, not UTC
function todayKeyET(d) {
  d = d || new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(d).replace(/-/g, ''); // YYYYMMDD
}

function dayKeyFromIso(iso) {
  return todayKeyET(new Date(iso));
}

function newEpisodeId(mode, ts) {
  const d = new Date(ts);
  const stamp = d.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14); // YYYYMMDDHHMMSS
  return 'ep-' + mode + '-' + stamp + '-' + Math.random().toString(36).slice(2, 6);
}

// Compute the cast and lead from the rendered messages (post-hoc) so the
// DVR row can show "Charles led · CV verb tense" without re-prompting.
function inferEpisodeMetadata(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { cast: [], lead: null, topic: null };
  }
  const seen = new Set();
  const cast = [];
  messages.forEach(m => {
    const s = (m.speaker || '').trim();
    if (s && !seen.has(s)) { seen.add(s); cast.push(s); }
  });
  // Lead = speaker of the first message (the kickoff voice)
  const lead = (messages[0].speaker || '').trim() || null;
  // Topic = first ~60 chars of the lead's opening, stripped to gist
  let topic = (messages[0].text || '').trim();
  if (topic.length > 80) topic = topic.slice(0, 77) + '...';
  return { cast, lead, topic };
}

async function readJson(store, key) {
  try {
    const blob = await store.get(key, { type: 'json' });
    return blob || null;
  } catch (e) {
    return null;
  }
}

async function writeJson(store, key, data) {
  await store.setJSON(key, data);
}

// Clean up episodes from the day exactly DVR_WINDOW_DAYS+1 ago (rolling).
// We don't list-and-prune the whole bucket because that's expensive;
// we just nuke the index for one stale day per regen, which keeps the
// window honest with minimal work.
async function cleanupStaleDay(store, pfx) {
  pfx = pfx || '';
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (DVR_WINDOW_DAYS + 1));
  const staleKey = todayKeyET(cutoff);
  try {
    const idx = await readJson(store, pfx + 'episodes/' + staleKey + '/index');
    if (!idx || !Array.isArray(idx.episode_ids)) return;
    for (const id of idx.episode_ids) {
      try { await store.delete(pfx + 'episodes/' + staleKey + '/' + id); } catch (_) {}
    }
    try { await store.delete(pfx + 'episodes/' + staleKey + '/index'); } catch (_) {}
  } catch (_) { /* best-effort */ }
}

async function buildDvrList(store, pfx) {
  pfx = pfx || '';
  // Walk back DVR_WINDOW_DAYS days, collect each day's index, return
  // newest-first list of episode summaries. Caps at DVR_LIST_LIMIT.
  const today = new Date();
  const summaries = [];
  for (let i = 0; i < DVR_WINDOW_DAYS; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dayKey = todayKeyET(d);
    const idx = await readJson(store, pfx + 'episodes/' + dayKey + '/index');
    if (!idx || !Array.isArray(idx.episode_ids)) continue;
    // Newest first within the day
    const ids = idx.episode_ids.slice().reverse();
    for (const id of ids) {
      const ep = await readJson(store, pfx + 'episodes/' + dayKey + '/' + id);
      if (!ep) continue;
      summaries.push({
        id: ep.id,
        mode: ep.mode,
        timestamp: ep.timestamp,
        lead: ep.lead || null,
        topic: ep.topic || null,
        message_count: Array.isArray(ep.messages) ? ep.messages.length : 0,
        dayKey: dayKey,
      });
      if (summaries.length >= DVR_LIST_LIMIT) return summaries;
    }
  }
  return summaries;
}

async function callFloorRender(event, mode, token, ownerCtx) {
  // Server-to-server call to the existing render function. We pass the
  // user's JWT through so the render endpoint's own auth gate sees a
  // valid session. Host derived from the incoming request so this works
  // on prod, deploy previews, and netlify dev locally.
  const host = (event.headers && (event.headers.host || event.headers.Host)) || '';
  const proto = (event.headers && (event.headers['x-forwarded-proto'] || event.headers['X-Forwarded-Proto'])) || 'https';
  const base = process.env.URL || (host ? proto + '://' + host : '');
  if (!base) throw new Error('cannot derive base url for floor-render call');
  const url = base + '/.netlify/functions/studio-floor-render';
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify(Object.assign({ mode }, ownerCtx || {})),
  });
  let data;
  try { data = await r.json(); }
  catch (e) { throw new Error('floor-render returned non-JSON: ' + (e && e.message)); }
  if (!r.ok || data.error) throw new Error(data.error || ('floor-render HTTP ' + r.status));
  return data;
}

exports.handler = async function(event) {
  try { connectLambda(event); } catch (_) {}

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }

  const auth = await validateRequest(event);
  if (!auth.ok) {
    return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized', reason: auth.reason }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'bad_json' }) }; }

  const mode = (body.mode === 'watercooler') ? 'watercooler' : 'workfloor';
  const store = getStore('watercooler');

  // Per-user namespace. The Floor is each owner's OWN office; episodes, the
  // latest pointer, and the DVR history must not be shared across studios.
  // (Previously these keys were global, so a buyer would have seen Dr. O's
  // episodes.) Owner context is forwarded to the render so the cast + names
  // are the buyer's, not Terry's.
  const pfx = 'u/' + auth.user.id + '/';
  const ownerCtx = {
    owner_name: body.owner_name || '',
    company_name: body.company_name || '',
    owner_address_form: body.owner_address_form || '',
    pa_name: body.pa_name || '',
    staff_names: Array.isArray(body.staff_names) ? body.staff_names : [],
  };

  // DVR replay branch: caller wants a specific past episode. Skip cache
  // check, skip regen — just read the episode body and return it inside
  // the same envelope (so the front-end uses the same rendering path).
  if (body.episode_id && body.dayKey && /^[0-9]{8}$/.test(body.dayKey)) {
    const ep = await readJson(store, pfx + 'episodes/' + body.dayKey + '/' + body.episode_id);
    if (!ep) {
      return { statusCode: 404, body: JSON.stringify({ error: 'episode_not_found' }) };
    }
    const ageMs = Date.now() - new Date(ep.timestamp).getTime();
    const dvr = await buildDvrList(store, pfx);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        episode: {
          id: ep.id,
          mode: ep.mode,
          timestamp: ep.timestamp,
          age_seconds: Math.floor(ageMs / 1000),
          fresh: false,
          replay: true,
          messages: ep.messages,
          context_note: ep.context_note || '',
          cast: ep.cast || [],
          lead: ep.lead || null,
          topic: ep.topic || null,
        },
        dvr,
        ttl_seconds: 0,
      }),
    };
  }

  // 1. Check latest pointer for this mode.
  const latestPtr = await readJson(store, pfx + 'latest/' + mode);
  const now = Date.now();
  let episode = null;
  let fresh = false;

  if (latestPtr && latestPtr.timestamp && latestPtr.id && latestPtr.dayKey) {
    const age = now - new Date(latestPtr.timestamp).getTime();
    if (age >= 0 && age < CACHE_TTL_MS) {
      // Cache hit — read full episode from its day's bucket
      const ep = await readJson(store, pfx + 'episodes/' + latestPtr.dayKey + '/' + latestPtr.id);
      if (ep) {
        episode = ep;
      }
    }
  }

  // 2. If no cached episode, regen.
  if (!episode) {
    const render = await callFloorRender(event, mode, auth.token, ownerCtx);
    const ts = new Date().toISOString();
    const dayKey = todayKeyET(new Date(ts));
    const id = newEpisodeId(mode, ts);
    const meta = inferEpisodeMetadata(render.messages || []);
    const noteText = render.context_used
      ? (render.context_used.item_count > 0
          ? 'based on today (' + render.context_used.date + ') — ' + render.context_used.item_count + ' real item' + (render.context_used.item_count === 1 ? '' : 's')
          : 'no fresh activity today — texture only')
      : '';
    episode = {
      id,
      mode,
      timestamp: ts,
      dayKey,
      messages: render.messages || [],
      context_note: noteText,
      cast: meta.cast,
      lead: meta.lead,
      topic: meta.topic,
    };
    // Write the episode body
    await writeJson(store, pfx + 'episodes/' + dayKey + '/' + id, episode);
    // Update the day's index
    const idx = (await readJson(store, pfx + 'episodes/' + dayKey + '/index')) || { episode_ids: [] };
    idx.episode_ids.push(id);
    await writeJson(store, pfx + 'episodes/' + dayKey + '/index', idx);
    // Update the latest pointer for this mode
    await writeJson(store, pfx + 'latest/' + mode, { id, dayKey, timestamp: ts });
    // Cleanup stale day (rolling 7-day window)
    await cleanupStaleDay(store, pfx);
    fresh = true;
  }

  const ageMs = now - new Date(episode.timestamp).getTime();
  const dvr = await buildDvrList(store, pfx);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      episode: {
        id: episode.id,
        mode: episode.mode,
        timestamp: episode.timestamp,
        age_seconds: Math.floor(ageMs / 1000),
        fresh,
        messages: episode.messages,
        context_note: episode.context_note || '',
        cast: episode.cast || [],
        lead: episode.lead || null,
        topic: episode.topic || null,
      },
      dvr,
      ttl_seconds: Math.max(0, Math.floor((CACHE_TTL_MS - ageMs) / 1000)),
    }),
  };
};
