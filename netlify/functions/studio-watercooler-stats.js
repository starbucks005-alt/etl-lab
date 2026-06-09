/* ─────────────────────────────────────────────────────────────────────────────
   studio-watercooler-stats

   Aggregator that powers the /studio/watercooler-stats.html dashboard.
   Reads the last 7 days of telemetry blobs plus the same 7 days of
   episode indexes, returns counters + leaderboards so Terry can answer
   "is the Watercooler a feature."

   GET (or POST) — no body.

   Returns:
     { today: { episodes, opens, dwell_seconds, replays, saves, by_mode: {...} },
       week:  { episodes, opens, dwell_seconds, replays, saves,
                channel_split: { watercooler_pct, workfloor_pct },
                longest_session_seconds,
                most_replayed: { episode_id, count, lead, topic, mode } | null,
                most_saved:    { episode_id, count, lead, topic, mode } | null },
       days:  [ { dayKey, episodes, opens, dwell_seconds } ... ] }

   Auth: same Supabase JWT gate.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

const WINDOW_DAYS = 7;

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
    return { ok: true, user };
  } catch (e) {
    return { ok: false, reason: 'fetch_failed', error: e && e.message };
  }
}

function todayKeyET(d) {
  d = d || new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(d).replace(/-/g, '');
}

async function readJson(store, key) {
  try { return (await store.get(key, { type: 'json' })) || null; }
  catch (e) { return null; }
}

function emptyDayBucket(dayKey) {
  return {
    dayKey,
    episodes: 0,
    opens: 0,
    closes: 0,
    dwell_seconds: 0,
    views: 0,
    replays: 0,
    saves: 0,
    by_mode: { watercooler: 0, workfloor: 0 },  // dwell_seconds per mode for split
  };
}

exports.handler = async function(event) {
  try { connectLambda(event); } catch (_) {}

  const auth = await validateRequest(event);
  if (!auth.ok) {
    return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized', reason: auth.reason }) };
  }

  const store = getStore('watercooler');
  const today = new Date();
  const days = [];
  const replayCounts = {};   // episode_id → count
  const saveCounts   = {};   // episode_id → count
  const episodeMeta  = {};   // episode_id → {lead, topic, mode}
  let longestSession = 0;

  for (let i = 0; i < WINDOW_DAYS; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dayKey = todayKeyET(d);
    const bucket = emptyDayBucket(dayKey);

    // Episodes generated this day
    const idx = await readJson(store, 'episodes/' + dayKey + '/index');
    if (idx && Array.isArray(idx.episode_ids)) {
      bucket.episodes = idx.episode_ids.length;
      // Cache episode metadata for the leaderboards
      for (const id of idx.episode_ids) {
        const ep = await readJson(store, 'episodes/' + dayKey + '/' + id);
        if (ep) {
          episodeMeta[id] = { lead: ep.lead || null, topic: ep.topic || null, mode: ep.mode };
        }
      }
    }

    // Telemetry events this day
    const tel = await readJson(store, 'telemetry/' + dayKey);
    if (tel && Array.isArray(tel.events)) {
      for (const e of tel.events) {
        if (e.type === 'tab_open')         bucket.opens   += 1;
        else if (e.type === 'tab_close') {
          bucket.closes += 1;
          const sec = (typeof e.dwell_ms === 'number') ? Math.floor(e.dwell_ms / 1000) : 0;
          bucket.dwell_seconds += sec;
          if (sec > longestSession) longestSession = sec;
          if (e.mode === 'watercooler' || e.mode === 'workfloor') {
            bucket.by_mode[e.mode] = (bucket.by_mode[e.mode] || 0) + sec;
          }
        }
        else if (e.type === 'episode_view') {
          bucket.views += 1;
        }
        else if (e.type === 'episode_replay') {
          bucket.replays += 1;
          if (e.episode_id) replayCounts[e.episode_id] = (replayCounts[e.episode_id] || 0) + 1;
        }
        else if (e.type === 'episode_save') {
          bucket.saves += 1;
          if (e.episode_id) saveCounts[e.episode_id] = (saveCounts[e.episode_id] || 0) + 1;
        }
      }
    }

    days.push(bucket);
  }

  // Today = days[0]; Week = sum across days[0..6]
  const todayBucket = days[0];
  const week = days.reduce((acc, b) => {
    acc.episodes      += b.episodes;
    acc.opens         += b.opens;
    acc.dwell_seconds += b.dwell_seconds;
    acc.replays       += b.replays;
    acc.saves         += b.saves;
    acc.water_dwell   += b.by_mode.watercooler || 0;
    acc.work_dwell    += b.by_mode.workfloor || 0;
    return acc;
  }, { episodes:0, opens:0, dwell_seconds:0, replays:0, saves:0, water_dwell:0, work_dwell:0 });

  const totalModeDwell = week.water_dwell + week.work_dwell;
  const channelSplit = totalModeDwell > 0
    ? { watercooler_pct: Math.round((week.water_dwell / totalModeDwell) * 100),
        workfloor_pct:   Math.round((week.work_dwell  / totalModeDwell) * 100) }
    : { watercooler_pct: 0, workfloor_pct: 0 };

  function topByCount(counts) {
    let topId = null, topN = 0;
    for (const id in counts) {
      if (counts[id] > topN) { topN = counts[id]; topId = id; }
    }
    if (!topId) return null;
    const meta = episodeMeta[topId] || {};
    return { episode_id: topId, count: topN, lead: meta.lead || null, topic: meta.topic || null, mode: meta.mode || null };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      today: {
        dayKey:        todayBucket.dayKey,
        episodes:      todayBucket.episodes,
        opens:         todayBucket.opens,
        dwell_seconds: todayBucket.dwell_seconds,
        replays:       todayBucket.replays,
        saves:         todayBucket.saves,
      },
      week: {
        episodes:                week.episodes,
        opens:                   week.opens,
        dwell_seconds:           week.dwell_seconds,
        replays:                 week.replays,
        saves:                   week.saves,
        channel_split:           channelSplit,
        longest_session_seconds: longestSession,
        most_replayed:           topByCount(replayCounts),
        most_saved:              topByCount(saveCounts),
      },
      days,
    }),
  };
};
