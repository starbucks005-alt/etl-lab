/* ─────────────────────────────────────────────────────────────────────────────
   studio-routine-tick

   The Routines engine. Cron'd to run every 15 minutes. Reads the
   `auggie_routines` blob, finds every routine whose next_fire <= now,
   dispatches each (fire-and-forget against the routine's whitelisted
   endpoint), then updates last_fired + next_fire + fire_count + status.

   This is the function that makes Auggie's promise real: routines fire
   on schedule without anyone watching. Whitelist of allowed targets
   lives in data/auggie-routine-targets.json — Phase 2 opens arbitrary
   intent.

   GET (cron) — no auth, no body. Loops through every owner's routines.
   POST (manual fire-now): { routine_id: string } — same auth as other
   studio-* functions. Used by the Studio Routines tab "fire now" button.

   Returns (cron mode):
     { ok: true, swept: N, fired: [{routine_id, target, owner, status}], errors: [...] }

   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

// ─── Whitelist loader (fs first, HTTPS fallback) ────────────────────
async function loadWhitelist(event) {
  const candidates = [
    path.join(__dirname, '..', '..', 'data', 'auggie-routine-targets.json'),
    path.join(process.cwd(), 'data', 'auggie-routine-targets.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (parsed && Array.isArray(parsed.targets)) return parsed.targets;
      }
    } catch (_) {}
  }
  const base = process.env.URL
            || ((event && event.headers && (event.headers.host || event.headers.Host))
                ? 'https://' + (event.headers.host || event.headers.Host) : '');
  if (base) {
    try {
      const r = await fetch(base + '/data/auggie-routine-targets.json', { cache: 'no-store' });
      if (r.ok) {
        const parsed = await r.json();
        if (parsed && Array.isArray(parsed.targets)) return parsed.targets;
      }
    } catch (_) {}
  }
  return [];
}

// ─── Cron parser (subset: literal ints, '*', comma lists, '*/N' step) ──
function parseCronField(field, min, max) {
  if (!field || field === '*') {
    const out = [];
    for (let i = min; i <= max; i++) out.push(i);
    return out;
  }
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    if (isNaN(step) || step < 1) return null;
    const out = [];
    for (let i = min; i <= max; i += step) out.push(i);
    return out;
  }
  if (field.indexOf(',') >= 0) {
    return field.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n >= min && n <= max);
  }
  const n = parseInt(field, 10);
  if (isNaN(n) || n < min || n > max) return null;
  return [n];
}

function parseCron(expr) {
  // 5-field cron: M H D Mo Dow
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const min  = parseCronField(parts[0], 0, 59);
  const hour = parseCronField(parts[1], 0, 23);
  const dom  = parseCronField(parts[2], 1, 31);
  const mon  = parseCronField(parts[3], 1, 12);
  const dow  = parseCronField(parts[4], 0, 6);
  if (!min || !hour || !dom || !mon || !dow) return null;
  return { min, hour, dom, mon, dow };
}

// Walk forward minute-by-minute from `from` (UTC) until all 5 fields match.
// Cap at 8 weeks ahead to avoid infinite loops for unmatchable patterns.
function nextFireFromCron(expr, fromIso) {
  const parsed = parseCron(expr);
  if (!parsed) return null;
  const fromMs = new Date(fromIso || new Date().toISOString()).getTime();
  // Round up to next minute
  const start = Math.ceil(fromMs / 60000) * 60000;
  const cap = start + (8 * 7 * 24 * 60 * 60 * 1000); // 8 weeks
  for (let t = start; t < cap; t += 60000) {
    const d = new Date(t);
    if (parsed.min.indexOf(d.getUTCMinutes()) < 0) continue;
    if (parsed.hour.indexOf(d.getUTCHours()) < 0) continue;
    if (parsed.dom.indexOf(d.getUTCDate()) < 0) continue;
    if (parsed.mon.indexOf(d.getUTCMonth() + 1) < 0) continue;
    if (parsed.dow.indexOf(d.getUTCDay()) < 0) continue;
    return d.toISOString();
  }
  return null;
}

// ─── Auth (POST only) ────────────────────────────────────────────────
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

// ─── Routine dispatch (fire one routine against its whitelisted endpoint) ─
async function fireRoutine(routine, target, event) {
  const base = process.env.URL
            || ((event && event.headers && (event.headers.host || event.headers.Host))
                ? 'https://' + (event.headers.host || event.headers.Host) : '');
  if (!base) throw new Error('cannot derive base url for dispatch');
  const url = base + target.endpoint;
  const params = Object.assign({}, target.default_params || {}, routine.target_params || {});
  try {
    const r = await fetch(url, {
      method: target.method || 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Routine-Id': routine.id, 'X-Routine-Owner': routine.owner || 'unknown' },
      body: (target.method === 'GET') ? undefined : JSON.stringify(params),
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, status: 0, error: e && e.message };
  }
}

// ─── Tick handler (cron + manual fire-now) ──────────────────────────
exports.handler = async function(event) {
  try { connectLambda(event); } catch (_) {}

  const store = getStore('routines');
  const whitelist = await loadWhitelist(event);
  const targetByKey = {};
  whitelist.forEach(t => { if (t && t.key) targetByKey[t.key] = t; });

  const isCron = (event.httpMethod === 'GET') ||
                 ((event.headers || {})['x-netlify-event-type'] === 'scheduled');

  // ─── Manual fire-now (single routine, Studio button) ─────────────
  if (!isCron && event.httpMethod === 'POST') {
    const auth = await validateRequest(event);
    if (!auth.ok) {
      return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized', reason: auth.reason }) };
    }
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'bad_json' }) }; }
    if (!body.routine_id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'routine_id_required' }) };
    }
    const idx = (await store.get('index', { type: 'json' })) || { owners: {} };
    const ownerRoutines = (idx.owners[auth.user.id] || []);
    const routine = ownerRoutines.find(r => r.id === body.routine_id);
    if (!routine) {
      return { statusCode: 404, body: JSON.stringify({ error: 'routine_not_found' }) };
    }
    const target = targetByKey[routine.target];
    if (!target) {
      return { statusCode: 400, body: JSON.stringify({ error: 'target_not_in_whitelist' }) };
    }
    const result = await fireRoutine(routine, target, event);
    const now = new Date().toISOString();
    routine.last_fired = now;
    routine.fire_count = (routine.fire_count || 0) + 1;
    routine.last_status = result.ok ? 'ok' : 'fail';
    routine.last_error = result.ok ? null : (result.error || ('HTTP ' + result.status));
    routine.next_fire = nextFireFromCron(routine.schedule_cron, now);
    await store.setJSON('index', idx);
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, fired: { routine_id: routine.id, target: routine.target, status: result.ok ? 'ok' : 'fail', http_status: result.status } }),
    };
  }

  // ─── Cron sweep (loop all owners, fire all due routines) ─────────
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }

  const idx = (await store.get('index', { type: 'json' })) || { owners: {} };
  const now = new Date();
  const nowIso = now.toISOString();
  const fired = [];
  const errors = [];
  let swept = 0;

  for (const ownerId of Object.keys(idx.owners || {})) {
    const ownerRoutines = idx.owners[ownerId] || [];
    for (const routine of ownerRoutines) {
      swept++;
      if (!routine.enabled || routine.paused) continue;
      if (!routine.next_fire) continue;
      if (new Date(routine.next_fire).getTime() > now.getTime()) continue;
      const target = targetByKey[routine.target];
      if (!target) {
        errors.push({ routine_id: routine.id, reason: 'target_not_in_whitelist', target: routine.target });
        continue;
      }
      const result = await fireRoutine(routine, target, event);
      routine.last_fired = nowIso;
      routine.fire_count = (routine.fire_count || 0) + 1;
      routine.last_status = result.ok ? 'ok' : 'fail';
      routine.last_error = result.ok ? null : (result.error || ('HTTP ' + result.status));
      routine.next_fire = nextFireFromCron(routine.schedule_cron, nowIso);
      fired.push({ routine_id: routine.id, target: routine.target, owner: ownerId, status: routine.last_status, http_status: result.status });
    }
  }

  // Write back once at the end (single blob write per tick)
  await store.setJSON('index', idx);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, swept, fired_count: fired.length, error_count: errors.length, fired, errors, tick_at: nowIso }),
  };
};

// Export the parser for testing / reuse
exports.nextFireFromCron = nextFireFromCron;
exports.parseCron = parseCron;
