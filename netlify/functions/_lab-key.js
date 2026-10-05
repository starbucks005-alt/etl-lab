/* _lab-key — the lab key: a paywall bypass for Dr. O's own testing, and nothing else.

   WHAT IT IS
   A lab key makes a site's existing PAID check answer "paid". It grants no
   owner powers, no admin, no ?as=, and it is NEVER the owner key. It is
   metered by a daily ceiling (LAB_DAILY_CALLS) so a leaked key has a bounded
   cost.

   ABSENCE IS A BUYER
   Keys come only from the LAB_KEYS env var (comma separated, each starting
   with lab_). There is no default and no fallback. If the var is unset or
   empty, no key is ever valid.

   The server is the only authority. The browser stores the key in
   localStorage (etl_lab_key) and sends it as the x-lab-key header; it never
   decides paid status from the key alone. */
const crypto = require('crypto');

const LAB_DAILY_CALLS = 400;
const LAB_STORE = 'lab-key-daily';

function labKeys() {
  return (process.env.LAB_KEYS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/* Length-independent constant-time compare: hash both sides first so
   timingSafeEqual always sees equal-length buffers. */
function safeEq(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/* Accepts the raw token, or a headers object (reads x-lab-key). */
function tokenOf(headersOrToken) {
  if (headersOrToken && typeof headersOrToken === 'object') {
    const h = headersOrToken;
    return String(h['x-lab-key'] || h['X-Lab-Key'] || '').trim();
  }
  return String(headersOrToken || '').trim();
}

function isLabKey(headersOrToken) {
  const t = tokenOf(headersOrToken);
  if (!t || t.indexOf('lab_') !== 0) return false;
  let ok = false;
  for (const k of labKeys()) {
    if (k.indexOf('lab_') !== 0) continue;   // a configured key without the prefix is ignored
    if (safeEq(t, k)) ok = true;             // no early exit
  }
  return ok;
}

/* Daily ceiling, counted per key per UTC day in Netlify Blobs. Call once per
   model call. Fails CLOSED: if the store cannot be read or written, the lab
   key is refused rather than allowed unmetered. Returns true if the call may
   proceed. `event` is the Functions v1 event (needed by connectLambda). */
async function labCallAllowed(event, headersOrToken) {
  if (!isLabKey(headersOrToken)) return false;
  try {
    const { connectLambda, getStore } = require('@netlify/blobs');
    try { connectLambda(event); } catch (e) { /* already connected */ }
    const store = getStore(LAB_STORE);
    const id = crypto.createHash('sha256').update(tokenOf(headersOrToken)).digest('hex').slice(0, 16);
    const key = new Date().toISOString().slice(0, 10) + '/' + id;
    const rec = await store.get(key, { type: 'json' });
    const used = (rec && Number(rec.count)) || 0;
    if (used >= LAB_DAILY_CALLS) return false;
    await store.setJSON(key, { count: used + 1 });
    return true;
  } catch (err) {
    console.error('[lab-key] ceiling store failed, refusing:', err && err.message);
    return false;
  }
}

module.exports = { isLabKey, labCallAllowed, labKeys, LAB_DAILY_CALLS };
