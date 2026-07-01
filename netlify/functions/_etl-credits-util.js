/* _etl-credits-util — shared auth + credit helpers for ETL membership.
   Underscore prefix = utility module, not a Netlify endpoint.

   Required Supabase SQL (run once in SQL editor):
   ─────────────────────────────────────────────────
   CREATE TABLE etl_credits (
     user_id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
     balance              integer NOT NULL DEFAULT 0,
     last_topped_up_at    timestamptz DEFAULT now(),
     stripe_customer_id   text,
     stripe_subscription_id text,
     subscription_active  boolean NOT NULL DEFAULT false,
     studio_pass          boolean NOT NULL DEFAULT false,
     created_at           timestamptz DEFAULT now()
   );
   -- Add studio_pass to existing installs:
   -- ALTER TABLE etl_credits ADD COLUMN studio_pass boolean NOT NULL DEFAULT false;
   ALTER TABLE etl_credits ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "users see own credits" ON etl_credits
     FOR SELECT USING (auth.uid() = user_id);
   ─────────────────────────────────────────────────
*/

const SUPABASE_URL  = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

/* Resolve a Supabase Bearer token to { id, email } or null. */
async function getUser(token) {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return (u && u.id) ? { id: u.id, email: u.email } : null;
  } catch (_) {
    return null;
  }
}

/* Extract Bearer token from Authorization header value. */
function extractToken(authHeader) {
  return (authHeader || '').replace(/^Bearer\s+/i, '').trim() || null;
}

/* Deduct 1 credit for a known userId. Returns { ok, balance_remaining } or { ok: false, reason }. */
async function deductCredit(userId, serviceKey) {
  const sel = await fetch(
    `${SUPABASE_URL}/rest/v1/etl_credits?user_id=eq.${userId}&select=balance,studio_pass`,
    { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } }
  );
  const rows = await sel.json();
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, reason: 'no_account' };
  const balance = rows[0].balance;
  if (rows[0].studio_pass === true) return { ok: true, balance_remaining: balance };
  if (balance <= 0) return { ok: false, reason: 'no_credits' };

  const newBalance = balance - 1;
  await fetch(`${SUPABASE_URL}/rest/v1/etl_credits?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ balance: newBalance }),
  });
  return { ok: true, balance_remaining: newBalance };
}

module.exports = { SUPABASE_URL, SUPABASE_ANON, getUser, extractToken, deductCredit };
