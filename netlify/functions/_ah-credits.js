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

// STARTER_CREDITS: Good Company, 2026-08-17, raised 100 -> 200 on 2026-08-19
// after Dr. O asked for the real cost numbers behind Pookie's "17 credits for
// 30-40 minutes of texting felt ridiculous." Worst case for the ORIGINAL 100
// (one unbroken text-only sitting, history resent uncached the whole way) was
// about $3 in real Sonnet spend against the $9.99 charged for the bundle --
// real margin, not a rounding error. Doubling the grant roughly doubles that
// worst case to ~$6, still comfortably under the $9.99 it is sold with. A
// one-time grant, not a subscription's monthly allotment, so it lives here
// rather than in a separate table (see the deductBy note below on why one
// row shape now covers both cases).
const STARTER_CREDITS = 200;

function randomToken() {
  return `AH-${crypto.randomBytes(16).toString('hex')}`;
}

function safeToken(v) {
  const s = String(v || '').trim();
  return /^AH-[a-f0-9]{32}$/.test(s) ? s : null;
}

/* An opaque, non-credential handle on a credit row.

   The shared table (see supabase_ah_table_migration.sql) has to charge the
   HOST for a question her invited friend asked, at a moment when the friend's
   browser is the only one talking to the server and the host's token is
   nowhere near the request. So the room row carries this instead of the token:
   a sha256 that names the row without being able to open it.

   ah_credits.token_ref is written by ah-table-open.js at the one moment it
   matters, from the live token, so nothing here ever needs a backfill. */
function tokenRef(token) {
  const t = safeToken(token);
  if (!t) return null;
  return crypto.createHash('sha256').update(t).digest('hex');
}

/* Filter clauses, so read-by-token and read-by-ref share one implementation
   rather than two copies of the rollover math drifting apart. */
function byToken(token) {
  const t = safeToken(token);
  return t ? `access_token=eq.${encodeURIComponent(t)}` : null;
}
function byRef(ref) {
  const r = String(ref || '').trim();
  return /^[a-f0-9]{64}$/.test(r) ? `token_ref=eq.${r}` : null;
}

/* Reads (and, if due, rolls over) a subscriber's credit row, given a PostgREST
   filter clause naming exactly one row. Returns null if it doesn't resolve to a
   row at all. Rollover mirrors get-credits-etl.js's existing logic: adds
   TIER2_MONTHLY_CREDITS once ROLLOVER_DAYS have passed since the last top-up,
   never replaces the balance, just accumulates. */
async function readCreditRow(filter, serviceKey) {
  if (!filter || !serviceKey) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/ah_credits?${filter}&select=balance,last_topped_up_at,subscription_active`,
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
      await fetch(`${SUPABASE_URL}/rest/v1/ah_credits?${filter}`, {
        method: 'PATCH',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ balance, last_topped_up_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      });
      return { balance, subscription_active: true };
    }
    return { balance: row.balance, subscription_active: true };
  } catch (err) {
    console.error('_ah-credits readCreditRow failed:', err.message);
    return null;
  }
}

async function getCreditRow(token, serviceKey) {
  return readCreditRow(byToken(token), serviceKey);
}

/* Same read, reached by reference instead of by token. What the shared table
   uses on every turn, whoever asked the question. */
async function getCreditRowByRef(ref, serviceKey) {
  return readCreditRow(byRef(ref), serviceKey);
}

/* Deducts `amount` credits from the row named by `filter`. Returns
   { ok, balance_remaining } or { ok: false, reason: 'no_account' |
   'insufficient_credits' }. Re-reads the balance server-side before writing, so
   callers don't need to trust a balance they read earlier in the same request. */
/* GATED ON BALANCE, NOT ON subscription_active, on purpose since Good
   Company started spending from this table too (2026-08-17). A row can now
   mean either of two things: a real recurring subscriber (subscription_active
   true, eligible for the 30-day rollover top-up in readCreditRow above), or a
   one-time, non-renewing grant (subscription_active false, a fixed balance
   that only ever depletes) — Good Company's $9.99 one-time "build a friend"
   purchase mints the second kind, not the first, because minting it as a
   real subscriber row would hand out a free 300-credit top-up every 30 days
   forever for a payment made exactly once.

   ZERO BEHAVIOR CHANGE FOR ALMOST HUMAN: eq-room-ask.js only ever calls
   deductCredits after it has independently confirmed subscription_active
   === true (see isSubscriber there), so this path already never received a
   non-subscriber row before this change and still never will. This only
   opens a door nothing on this campus previously walked through. */
async function deductBy(filter, amount, serviceKey) {
  const row = await readCreditRow(filter, serviceKey);
  if (!row) return { ok: false, reason: 'no_account' };
  if (row.balance < amount) return { ok: false, reason: 'insufficient_credits', balance_remaining: row.balance };

  const balance = row.balance - amount;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/ah_credits?${filter}`, {
      method: 'PATCH',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ balance, updated_at: new Date().toISOString() }),
    });
  } catch (err) {
    console.error('_ah-credits deduct failed:', err.message);
    return { ok: false, reason: 'write_failed' };
  }
  return { ok: true, balance_remaining: balance };
}

async function deductCredits(token, amount, serviceKey) {
  return deductBy(byToken(token), amount, serviceKey);
}

async function deductCreditsByRef(ref, amount, serviceKey) {
  return deductBy(byRef(ref), amount, serviceKey);
}

/* Stamps the reference onto the host's own row, so a later request holding only
   the reference can find it. Called once, when a room is opened. Idempotent:
   the ref is a pure function of the token, so re-running writes the same value.
   Returns the ref, or null if the token doesn't resolve to a real row. */
async function linkTokenRef(token, serviceKey) {
  const filter = byToken(token);
  const ref = tokenRef(token);
  if (!filter || !ref || !serviceKey) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/ah_credits?${filter}`, {
      method: 'PATCH',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ token_ref: ref, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) return null;
    const rows = await r.json();
    return (Array.isArray(rows) && rows.length) ? ref : null;
  } catch (err) {
    console.error('_ah-credits linkTokenRef failed:', err.message);
    return null;
  }
}

module.exports = {
  SUPABASE_URL,
  TIER2_MONTHLY_CREDITS,
  ONE_TO_ONE_COST,
  GROUP_MESSAGE_COST,
  ADDON_CREDITS,
  STARTER_CREDITS,
  randomToken,
  safeToken,
  tokenRef,
  linkTokenRef,
  getCreditRow,
  getCreditRowByRef,
  deductCredits,
  deductCreditsByRef,
};
