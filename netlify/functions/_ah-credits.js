/* _ah-credits — shared credit helpers for Almost Human's paywall.
   Underscore prefix = utility module, not a Netlify endpoint.

   Self-contained: does not touch _etl-credits-util.js or the etl_credits
   table (that's the separate $19.99/mo Lab membership). Each new gated
   feature on this campus gets its own table and its own small helper rather
   than modifying shared, working infrastructure.

   Required Supabase SQL: see ../../supabase_ah_credits_migration.sql
*/

const crypto = require('crypto');

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';

// Placeholders confirmed against real Sonnet 5 / Haiku 4.5 pricing during
// planning (2026-07-12): even a subscriber who spends the full monthly
// allotment entirely on group messages costs roughly $2-2.50 in API spend
// against $9.99 in revenue, comfortably profitable. Easy to retune once
// there's real usage data.
const TIER2_MONTHLY_CREDITS = 300; // paid tier's monthly allotment, covers both rooms
const ONE_TO_ONE_COST = 1;         // credits per 1:1 message
const GROUP_MESSAGE_COST = 3;      // credits per guest message in the group room (cascade costs ~3-4x to run)
const ADDON_CREDITS = 30;          // credits granted by one addon-pack purchase
const ROLLOVER_DAYS = 30;

function randomToken() {
  return `AH-${crypto.randomBytes(16).toString('hex')}`;
}

function safeToken(v) {
  const s = String(v || '').trim();
  return /^AH-[a-f0-9]{32}$/.test(s) ? s : null;
}

/* Reads (and, if due, rolls over) a subscriber's credit row. Returns null if
   the token doesn't resolve to a row at all. Rollover mirrors
   get-credits-etl.js's existing logic: adds TIER2_MONTHLY_CREDITS once
   ROLLOVER_DAYS have passed since the last top-up, never replaces the
   balance, just accumulates. */
async function getCreditRow(token, serviceKey) {
  const t = safeToken(token);
  if (!t || !serviceKey) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/ah_credits?access_token=eq.${encodeURIComponent(t)}&select=balance,last_topped_up_at,subscription_active`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    if (!r.ok) return null;
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    const row = rows[0];
    if (!row.subscription_active) return { balance: row.balance, subscription_active: false };

    const daysSince = (Date.now() - new Date(row.last_topped_up_at).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince >= ROLLOVER_DAYS) {
      const balance = row.balance + TIER2_MONTHLY_CREDITS;
      await fetch(`${SUPABASE_URL}/rest/v1/ah_credits?access_token=eq.${encodeURIComponent(t)}`, {
        method: 'PATCH',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ balance, last_topped_up_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      });
      return { balance, subscription_active: true };
    }
    return { balance: row.balance, subscription_active: true };
  } catch (err) {
    console.error('_ah-credits getCreditRow failed:', err.message);
    return null;
  }
}

/* Deducts `amount` credits for a token. Returns { ok, balance_remaining } or
   { ok: false, reason: 'no_account' | 'insufficient_credits' }. Re-checks the
   balance server-side before writing, so callers don't need to trust a
   balance they read earlier in the same request. */
async function deductCredits(token, amount, serviceKey) {
  const row = await getCreditRow(token, serviceKey);
  if (!row || !row.subscription_active) return { ok: false, reason: 'no_account' };
  if (row.balance < amount) return { ok: false, reason: 'insufficient_credits', balance_remaining: row.balance };

  const balance = row.balance - amount;
  const t = safeToken(token);
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/ah_credits?access_token=eq.${encodeURIComponent(t)}`, {
      method: 'PATCH',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ balance, updated_at: new Date().toISOString() }),
    });
  } catch (err) {
    console.error('_ah-credits deductCredits failed:', err.message);
    return { ok: false, reason: 'write_failed' };
  }
  return { ok: true, balance_remaining: balance };
}

module.exports = {
  SUPABASE_URL,
  TIER2_MONTHLY_CREDITS,
  ONE_TO_ONE_COST,
  GROUP_MESSAGE_COST,
  ADDON_CREDITS,
  randomToken,
  safeToken,
  getCreditRow,
  deductCredits,
};
