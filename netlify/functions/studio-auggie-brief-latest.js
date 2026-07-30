/* ─────────────────────────────────────────────────────────────────────────────
   studio-auggie-brief-latest — returns metadata for the most recent Auggie
   morning brief: date, transcript, estimated audio length, sources used.

   GET /.netlify/functions/studio-auggie-brief-latest
   Auth: Supabase JWT (this is Terry-personal data, not public).

   Returns: { available, dateKey, generatedAt, transcript, estimatedSeconds,
             audioUrl, sourcesUsed, stale, expectedDateKey }
   or:      { available: false }

   Self-healing: if the stored brief's dateKey is older than today (America/
   New_York), the response includes stale=true AND fires a fire-and-forget
   regen of the background brief. By the time Terry reads the stale text,
   the fresh one is ready on next refresh. Prevents the "still showing
   Sunday on Monday" failure mode that bit us when a cron misfired.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

/* Today's date key in America/New_York, format YYYY-MM-DD. Mirrors the
   helper in studio-auggie-brief-background.js so freshness comparison
   uses the same wall clock. */
function todayKeyET() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const get = (t) => parts.find(p => p.type === t).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}

/* Fire-and-forget regen trigger. Calls the background brief function with
   admin basic auth (same path the daily cron uses). We do NOT await the
   bg's actual generation (that takes 60-90s). We just kick it off. */
async function fireRegen(eventHost) {
  try {
    const user = process.env.PRESS_ADMIN_USER;
    const pass = process.env.PRESS_ADMIN_PASS;
    if (!user || !pass) {
      console.warn('[brief-latest] regen skipped: PRESS_ADMIN_USER/PASS not set');
      return;
    }
    const basic = Buffer.from(user + ':' + pass).toString('base64');
    const base = (process.env.URL || ('https://' + (eventHost || 'emerging-tech-lab.com'))).replace(/\/$/, '');
    // Await the bg invocation (cheap; bg returns 202 fast). Don't await the
    // bg's actual work — that takes ~90s and would blow the sync function's
    // 10s budget.
    const r = await fetch(base + '/.netlify/functions/studio-auggie-brief-background', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + basic },
      body: JSON.stringify({ trigger: 'stale_auto_regen' }),
    });
    console.log('[brief-latest] regen invoke status', r.status);
  } catch (e) {
    console.warn('[brief-latest] regen invoke failed (non-fatal)', e && e.message);
  }
}

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  const auth = await validateRequest(event);
  if (!auth.ok) {
    return { statusCode: 401, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'unauthorized', reason: auth.reason }) };
  }

  // Per-owner brief. Dr. O reads the global blobs (written by her cron); every
  // other signed-in owner reads their own namespace (written by the buyer
  // brief path, keyed by user_id).
  const OWNER_EMAIL = 'starbucks005@gmail.com';
  const isOwner = (auth.user.email || '').toLowerCase() === OWNER_EMAIL;
  // Landlord preview: the owner reads a client's TEST brief (?as=<client email>),
  // written to a preview-<email> namespace by brief-trigger's preview path. Never
  // the owner's global brief (that was the "Ms. Terry brief in Vikram's studio"
  // leak). Auto-regen stays owner-only and is suppressed while previewing.
  const asParam = (event.queryStringParameters && (event.queryStringParameters.as || '')).toLowerCase().trim();
  const previewing = isOwner && !!asParam && asParam !== OWNER_EMAIL;
  const keyPfx = previewing ? ('u/preview-' + asParam + '/') : (isOwner ? '' : ('u/' + auth.user.id + '/'));

  try { connectLambda(event); } catch (_) {}

  let meta = null;
  try {
    const metaStore = getStore('auggie_briefs_meta');
    meta = await metaStore.get(keyPfx + 'latest', { type: 'json' });
  } catch (err) {
    console.error('[auggie-brief-latest] meta read failed', err && err.message);
  }

  const expectedDateKey = todayKeyET();
  const eventHost = (event.headers && (event.headers.host || event.headers.Host)) || '';

  if (!meta) {
    // Owner: kick a regen so the next pageview has content. Buyer: no auto
    // regen (the daily cron is owner-only), but tell the UI it can generate
    // one on demand via the "generate one now" button.
    // Awaited (fixed 2026-07-30): fireRegen is async and this call site did not
    // await it, so the handler returned immediately and the runtime froze before
    // the fetch inside it was sent. The regen was never actually invoked, which
    // is why the background function's log was empty while this endpoint kept
    // reporting regenFired: true. fireRegen only awaits the invocation itself
    // (~100ms, returns 202), never the 60-90s generation, so awaiting it here
    // stays well inside the sync function's budget.
    if (isOwner && !previewing) await fireRegen(eventHost);
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ available: false, expectedDateKey, stale: true, regenFired: isOwner && !previewing, can_generate: true }),
    };
  }

  // Freshness check: stored brief's dateKey vs today (ET). If stale, fire
  // a regen and flag the response so the UI can warn ("brief is from
  // [Sunday] — refreshing now, check back in ~90s"). Auto-regen is owner-only
  // (cron path); buyers refresh their stale brief with the explicit button.
  const isStale = meta.dateKey && meta.dateKey !== expectedDateKey;
  if (isStale && isOwner && !previewing) {
    console.log('[brief-latest] stale brief detected: stored=' + meta.dateKey + ' expected=' + expectedDateKey + ' — firing regen');
    await fireRegen(eventHost);   // see the note on the other call site: must be awaited
  }

  return {
    statusCode: 200,
    // No-store when stale so a refresh actually re-hits this endpoint and
    // gets the fresh brief once the bg writes it.
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': isStale ? 'no-store' : 'private, max-age=30' },
    body: JSON.stringify({
      available: true,
      dateKey: meta.dateKey,
      expectedDateKey,
      stale: isStale,
      regenFired: isStale && isOwner && !previewing,
      generatedAt: meta.generatedAt,
      transcript: meta.transcript,
      estimatedSeconds: meta.estimatedSeconds,
      audioUrl: '/.netlify/functions/studio-auggie-brief-audio?date=' + encodeURIComponent(meta.dateKey),
      sourcesUsed: meta.sourcesUsed || [],
    }),
  };
};
