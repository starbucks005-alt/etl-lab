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
const { getUser, extractToken, deductCredit, SUPABASE_URL } = require('./_etl-credits-util.js');

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

/* Guest counters live in Supabase, not Netlify Blobs.

   Blobs cannot do this job. It defaults to eventual consistency, which let the
   same guest run three paid briefs (write landed, next read did not see it),
   and asking for strong consistency fails outright in this runtime:
   "Netlify Blobs has failed to perform a read using strong consistency
   because the environment has not been configured with a 'uncachedEdgeURL'
   property". A spend counter needs read-after-write, and Supabase already is
   that store for etl_credits (2026-07-31).

   Requires supabase_design_credits_migration.sql to have been run. Until it
   has, these calls fail and the caller fails OPEN and reports credit_fault,
   so the page keeps working and the broken gate is visible. */
async function guestUsed(guestId) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set');
  const r = await fetch(
    SUPABASE_URL + '/rest/v1/etl_design_guests?guest_id=eq.' + encodeURIComponent(guestId) + '&select=used',
    { headers: { Authorization: 'Bearer ' + serviceKey, apikey: serviceKey } }
  );
  if (!r.ok) throw new Error('guest read failed: ' + r.status + ' ' + (await r.text()).slice(0, 120));
  const rows = await r.json();
  return (Array.isArray(rows) && rows.length) ? (rows[0].used || 0) : 0;
}

/* Atomic increment via the SQL function, so two briefs fired at once cannot
   both read the same count and write back the same value. */
async function guestSpend(guestId, amount) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set');
  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/etl_design_guest_spend', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + serviceKey,
      apikey: serviceKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_guest_id: guestId, p_amount: amount }),
  });
  if (!r.ok) throw new Error('guest spend failed: ' + r.status + ' ' + (await r.text()).slice(0, 120));
  return Number(await r.json()) || 0;
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
  const used = await guestUsed(guestId);
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

  const next = await guestSpend(verdict.guestId, BRIEF_COST);
  return { ok: true, remaining: Math.max(0, GUEST_FREE_BRIEFS - next) };
}

module.exports = { check, spend, newGuestId, safeGuestId, GUEST_FREE_BRIEFS, BRIEF_COST };
