/* _city-daily-cap - shared free-message cap for the City Operations Gateway (city-*.js).

   THE NUMBER MUST MATCH gc-chat.js's own DAILY_FREE_LIMIT (15) — Dr. O: the max free texting
   here should coincide with ETL's own texting limit, not invent a separate number. Audio is
   weighted 5x text, the same ratio gc-voice.js already uses for the same reason: speech costs
   roughly five times what text costs per turn.

   ITS OWN STORE (city_daily_usage), not ah_daily_usage — this page's free tier draws down its
   own budget, not a visitor's Good Company or Almost Human allowance. Same visitor identity
   convention as the rest of the campus (etl_visitor_id in localStorage) so it's the same person
   being counted, just a separate pool per product.

   CHECKED AND CHARGED BEFORE the expensive call, in -ask.js, not in -background.js: no point
   spinning up a background job (or paying for an ElevenLabs call) for a turn nobody has budget
   for. Same "take the money before the expensive part" reasoning as gc-voice.js. */

const { getStore } = require('@netlify/blobs');

const DAILY_FREE_LIMIT = 15;
const TEXT_COST = 1;
const AUDIO_COST = 5;

function safeVisitorId(v) {
  const s = String(v || '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
}

function todayKey(visitorId) {
  return visitorId + ':' + new Date().toISOString().slice(0, 10);
}

// Resolves { ok: true, used, limit } and charges the cost, or { ok: false, reason, used, limit }
// without charging anything, if there is not enough of today's free allowance left.
async function chargeDailyCap(visitorId, cost) {
  const vid = safeVisitorId(visitorId);
  if (!vid) return { ok: false, reason: 'no_visitor_id', used: 0, limit: DAILY_FREE_LIMIT };

  const store = getStore('city_daily_usage');
  const dayKey = todayKey(vid);
  let usage = null;
  try { usage = await store.get(dayKey, { type: 'json' }); } catch (_) {}
  const countSoFar = (usage && usage.count) || 0;

  if (countSoFar + cost > DAILY_FREE_LIMIT) {
    return { ok: false, reason: 'daily_capped', used: countSoFar, limit: DAILY_FREE_LIMIT };
  }
  try { await store.setJSON(dayKey, { count: countSoFar + cost }); } catch (_) {}
  return { ok: true, used: countSoFar + cost, limit: DAILY_FREE_LIMIT };
}

module.exports = { DAILY_FREE_LIMIT, TEXT_COST, AUDIO_COST, safeVisitorId, chargeDailyCap };
