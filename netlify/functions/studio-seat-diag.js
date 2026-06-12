/* ─────────────────────────────────────────────────────────────────────────────
   studio-seat-diag — TEMPORARY read-only diagnostic for the PA swap bug.

   2026-06-12: the swap reported "seated" (server verify read back jen_lopez)
   then the reload showed Auggie again. This endpoint lets CC inspect the
   studio_config blob store directly, without asking Dr. O to click anything:
   every key, each blob's pa.persona_id, and updated_at.

   Gated by a long random token (repo is private). DELETE THIS FILE once
   the swap bug is closed.

   GET ?t=<token>
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const DIAG_TOKEN = 'tg7Vq2pXr9mKw4Zs8bN3hYcDf6JaLuE5';

exports.handler = async (event) => {
  const t = (event.queryStringParameters && event.queryStringParameters.t) || '';
  if (t !== DIAG_TOKEN) return { statusCode: 404, body: 'not found' };

  try { connectLambda(event); } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'connectLambda failed', detail: e && e.message }) };
  }

  const out = { stores: {} };
  for (const name of ['studio_config', 'studio_config_pending', 'studio_seat_overrides']) {
    try {
      const store = getStore(name);
      const listing = await store.list();
      const blobs = (listing && listing.blobs) || [];
      const entries = [];
      for (const b of blobs.slice(0, 25)) {
        let detail = null;
        try {
          const v = await store.get(b.key, { type: 'json' });
          detail = {
            pa_persona: v && v.pa && v.pa.persona_id,
            pa_display: v && v.pa && v.pa.display_name,
            updated_at: v && v.updated_at,
            user_email: v && v.user_email,
            top_keys: v ? Object.keys(v) : null,
          };
        } catch (e) { detail = { read_error: e && e.message }; }
        entries.push({ key: b.key, detail });
      }
      out.stores[name] = { count: blobs.length, entries };
    } catch (e) {
      out.stores[name] = { error: e && e.message };
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(out, null, 2),
  };
};
