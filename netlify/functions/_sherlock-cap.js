/* ─────────────────────────────────────────────────────────────────────────────
   _sherlock-cap.js

   Daily spend ceiling for the Sherlock functions.

   Solve It With Sherlock is going on Google Play, where the whole point is an
   install count we do not control. Every witness reply is a Sonnet call billed
   to us, and before this there was nothing stopping one device from running
   that in a loop all day.

   Two counters, because one is not enough:

     visitor  — the localStorage id the page already sends. Correct per student,
                and correct in a classroom where thirty people share one campus
                IP. Trivially reset by clearing storage, which is why it is not
                the only counter.
     address  — the client IP, as the backstop the visitor id cannot be cheated
                past. Set high enough that a shared campus connection does not
                trip it during a normal class.

   Both are best-effort. If Blobs is unavailable the call is allowed through:
   a storage outage must not take the cases offline mid-lesson.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

function today() {
  return new Date().toISOString().slice(0, 10);
}

function clientIp(event) {
  const h = event.headers || {};
  return h['x-nf-client-connection-ip'] || h['client-ip'] || h['x-forwarded-for'] || '';
}

function safeId(v) {
  return String(v || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

/* Reads both counters. Returns { allowed, reason } and the keys to bump on a
   successful call, so nothing is charged against a request that then fails. */
async function check(event, storeName, opts) {
  const perVisitor = opts.perVisitor;
  const perAddress = opts.perAddress;
  const visitor = safeId(opts.visitorId);
  const ip = clientIp(event);
  const day = today();

  const keys = [];
  if (visitor) keys.push({ key: `v:${visitor}:${day}`, limit: perVisitor, reason: 'visitor' });
  if (ip) keys.push({ key: `a:${Buffer.from(ip).toString('base64url').slice(0, 48)}:${day}`, limit: perAddress, reason: 'address' });

  if (!keys.length) return { allowed: true, keys: [] };

  let store;
  try {
    try { connectLambda(event); } catch (_) {}
    store = getStore(storeName);
  } catch (_) {
    return { allowed: true, keys: [] }; // Blobs down: never block the lesson
  }

  for (const k of keys) {
    let row = null;
    try { row = await store.get(k.key, { type: 'json' }); } catch (_) { /* treat as zero */ }
    const count = (row && row.count) || 0;
    if (count >= k.limit) return { allowed: false, reason: k.reason, keys: [] };
  }

  return { allowed: true, keys, store };
}

/* Increments after the work succeeded. Never throws into the caller. amount,
   added for Good Company's own voice replies (weighted heavier than a text
   message, same pool), defaults to 1 so every existing caller here is
   unaffected. */
async function bump(result, amount) {
  if (!result || !result.store || !result.keys || !result.keys.length) return;
  const n = amount || 1;
  for (const k of result.keys) {
    try {
      const row = await result.store.get(k.key, { type: 'json' });
      await result.store.setJSON(k.key, { count: ((row && row.count) || 0) + n });
    } catch (err) {
      console.error('[sherlock-cap] increment failed (non-fatal):', err.message);
    }
  }
}

module.exports = { check, bump, clientIp };
