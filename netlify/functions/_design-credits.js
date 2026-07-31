/* _design-credits — who is allowed to run an ETL Design brief, and on whose tab.
   ─────────────────────────────────────────────────────────────────────────
   Dr. O: "add a credits system, tie it into membership to ETL, but not
   necessary." So membership BUYS something, it does not GATE anything. A
   stranger with no account can still use the page, which is the whole reason
   it exists.

   Three ways in, checked in this order:

     owner   the master key Studio already uses. Unlimited, no accounting.
     member  a signed-in ETL member. Spends from the existing etl_credits
             balance via _etl-credits-util, the same $19.99/mo Lab membership
             every other gated feature on this campus already uses. A
             studio_pass row is unlimited and is never deducted.
     guest   nobody at all. Gets GUEST_FREE_BRIEFS, tracked per browser.

   WHAT A CREDIT BUYS: one brief, meaning round one including the artwork,
   which is the only step that costs real money (three model calls plus a
   gpt-image-1 generation). REVISIONS ARE FREE and always will be: they are
   one cheap model call against a stored SVG, and charging for them would turn
   the design-firm behaviour Dr. O asked for back into a slot machine.

   The guest allowance is deliberately ONE finished piece, not zero. The page
   promises "You see it finished before you decide to buy it", and a guest
   who cannot generate anything makes that a lie. One free piece keeps the
   promise honest and caps the spend.

   Guest identity is a browser-scoped id, not security. It is clearable and
   that is fine: the real protection is that the clean file still costs money.
   This is a spend cap, not a lock.
*/

const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');
const { getUser, extractToken, deductCredit } = require('./_etl-credits-util.js');

// The two numbers worth tuning, kept here rather than scattered through copy.
const GUEST_FREE_BRIEFS = 1;   // finished pieces a stranger gets before paying
const BRIEF_COST = 1;          // member credits per brief

function newGuestId() {
  return 'g-' + crypto.randomBytes(12).toString('hex');
}

function safeGuestId(v) {
  const s = String(v || '').trim();
  return /^g-[a-f0-9]{24}$/.test(s) ? s : null;
}

/* Guest counters live in their own blob store rather than in etl_credits, so
   an anonymous visitor never creates a half-real membership row. */
async function guestState(event, guestId) {
  try { connectLambda(event); } catch (_) {}
  const store = getStore('etl_design_guests');
  const row = await store.get(guestId, { type: 'json' });
  return { store, used: (row && row.used) || 0 };
}

/* Decide whether this caller may run a brief. Does NOT spend anything: call
   spend() only once the work is actually about to start, so a validation
   failure never costs somebody a credit. */
async function check(event, body) {
  const token = extractToken((event.headers && (event.headers.authorization || event.headers.Authorization)) || '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (token) {
    const user = await getUser(token);
    if (user && (user.id === 'owner' || user.id === 'owner-master')) {
      return { ok: true, kind: 'owner', remaining: null };
    }
    if (user && serviceKey) {
      // Peek at the balance without spending. deductCredit both checks and
      // spends, so the actual deduction happens in spend() below.
      return { ok: true, kind: 'member', user, serviceKey, remaining: null };
    }
    // A token that does not resolve falls through to guest rather than being
    // rejected: a stale session should not lock somebody out of a public page.
  }

  const guestId = safeGuestId(body && body.guest_id) || newGuestId();
  const { used } = await guestState(event, guestId);
  const left = Math.max(0, GUEST_FREE_BRIEFS - used);
  if (left <= 0) {
    return {
      ok: false, kind: 'guest', guestId, remaining: 0,
      reason: 'guest_allowance_used',
    };
  }
  return { ok: true, kind: 'guest', guestId, remaining: left };
}

/* Spend for a caller that check() already approved. Returns what is left, or
   a reason it could not. */
async function spend(event, verdict) {
  if (verdict.kind === 'owner') return { ok: true, remaining: null };

  if (verdict.kind === 'member') {
    const res = await deductCredit(verdict.user.id, verdict.serviceKey);
    if (!res.ok) {
      // no_account or no_credits. A member out of credits is not thrown back
      // to the guest pool; they are told plainly, since they have somewhere
      // to top up and a stranger does not.
      return { ok: false, reason: res.reason || 'no_credits', remaining: 0 };
    }
    return { ok: true, remaining: res.balance_remaining };
  }

  const { store, used } = await guestState(event, verdict.guestId);
  const next = used + BRIEF_COST;
  await store.setJSON(verdict.guestId, { used: next, last: new Date().toISOString() });
  return { ok: true, remaining: Math.max(0, GUEST_FREE_BRIEFS - next) };
}

module.exports = { check, spend, newGuestId, safeGuestId, GUEST_FREE_BRIEFS, BRIEF_COST };
