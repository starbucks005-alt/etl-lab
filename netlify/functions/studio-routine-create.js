/* ─────────────────────────────────────────────────────────────────────────────
   studio-routine-create

   Called by Auggie (or the Studio Routines tab "new routine" UI) to write
   a new standing order into the auggie_routines blob. Validates target
   against the whitelist, validates params, parses the cron, computes
   next_fire. Returns the saved routine.

   POST body: {
     target:          string  (whitelist key, e.g. 'jax-scan-apply'),
     target_params:   object  (per-target customization),
     schedule_cron:   string  (5-field cron, UTC),
     schedule_human:  string  (human description for display),
     label?:          string  (optional override; auto-built from target if absent)
   }

   Returns: { ok: true, routine: {...} }

   Auth: Supabase JWT.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');
const fs = require('fs');
const path = require('path');
const { nextFireFromCron, parseCron } = require('./studio-routine-tick.js');

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

const ROUTINES_PER_OWNER_CAP = 50;

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

function newRoutineId() {
  const d = new Date();
  const stamp = d.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return 'rt-' + stamp + '-' + Math.random().toString(36).slice(2, 6);
}

function validateParams(target, params) {
  const schema = target.param_schema || {};
  const out = Object.assign({}, target.default_params || {}, params || {});
  for (const key of Object.keys(schema)) {
    const rule = schema[key] || {};
    if (rule.required && (out[key] === undefined || out[key] === null || out[key] === '')) {
      return { ok: false, reason: 'missing_required_param: ' + key };
    }
    if (rule.options && out[key] !== undefined && rule.options.indexOf(out[key]) < 0) {
      return { ok: false, reason: 'invalid_value_for_' + key + ' (must be one of: ' + rule.options.join(', ') + ')' };
    }
  }
  return { ok: true, params: out };
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

  if (!body.target) return { statusCode: 400, body: JSON.stringify({ error: 'target_required' }) };
  if (!body.schedule_cron) return { statusCode: 400, body: JSON.stringify({ error: 'schedule_cron_required' }) };

  const whitelist = await loadWhitelist(event);
  const target = whitelist.find(t => t && t.key === body.target);
  if (!target) {
    return { statusCode: 400, body: JSON.stringify({ error: 'target_not_in_whitelist', valid_keys: whitelist.map(t => t.key) }) };
  }

  const paramCheck = validateParams(target, body.target_params);
  if (!paramCheck.ok) {
    return { statusCode: 400, body: JSON.stringify({ error: paramCheck.reason }) };
  }

  const cron = parseCron(body.schedule_cron);
  if (!cron) {
    return { statusCode: 400, body: JSON.stringify({ error: 'invalid_cron', expr: body.schedule_cron }) };
  }
  const nowIso = new Date().toISOString();
  const next = nextFireFromCron(body.schedule_cron, nowIso);
  if (!next) {
    return { statusCode: 400, body: JSON.stringify({ error: 'cron_unmatchable_within_8_weeks' }) };
  }

  const routine = {
    id: newRoutineId(),
    owner: auth.user.id,
    label: body.label || target.label,
    staff: target.staff,
    target: target.key,
    target_params: paramCheck.params,
    schedule_cron: body.schedule_cron,
    schedule_human: body.schedule_human || target.example_human || '',
    enabled: true,
    paused: false,
    created_at: nowIso,
    last_fired: null,
    next_fire: next,
    fire_count: 0,
    last_status: null,
    last_error: null,
  };

  const store = getStore('routines');
  const idx = (await store.get('index', { type: 'json' })) || { owners: {} };
  if (!idx.owners[auth.user.id]) idx.owners[auth.user.id] = [];
  if (idx.owners[auth.user.id].length >= ROUTINES_PER_OWNER_CAP) {
    return { statusCode: 400, body: JSON.stringify({ error: 'routine_cap_reached', cap: ROUTINES_PER_OWNER_CAP }) };
  }
  idx.owners[auth.user.id].push(routine);
  await store.setJSON('index', idx);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, routine }),
  };
};
