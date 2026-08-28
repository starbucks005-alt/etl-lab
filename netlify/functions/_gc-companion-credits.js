/* _gc-companion-credits — per-companion subscription credits for Good
   Company. Underscore prefix = utility module, not a Netlify endpoint.

   ADDED 2026-08-28, Dr. O direct, across several turns: "each companion
   has its own $9.99/mo subscription and its own 300 credits, tracked
   separately... you are buying a product, each (companion + 300
   credits/month subscription) is a product." Replaces the pooled model
   (_ah-credits.js's ah_credits table, one balance shared across every
   companion a person has) for Good Company specifically. Almost Human's
   own use of ah_credits is untouched.

   LIVE STRIPE VERIFICATION, NOT A TRUSTED LOCAL FLAG. Dr. O direct:
   "just the live verification, keep the anonymous token" -- mirroring the
   one real gap in ah_credits' own lazy-rollover trick (see its own
   readCreditRow comment): subscription_active there is set once at
   checkout and never rechecked, so a canceled Stripe subscription never
   actually locks the room back up. check-subscription-etl.js already
   solves this correctly for the real-login ETL membership by asking
   Stripe directly; this does the same thing for an anonymous token, kept
   anonymous per her explicit instruction rather than adding real login.

   Required Supabase SQL: see ../../supabase_gc_companion_credits_migration.sql
*/

const crypto = require('crypto');

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';

const TIER_MONTHLY_CREDITS = 300;   // this companion's monthly allotment
const ONE_TO_ONE_COST = 1;          // credits per 1:1 message, same rate as ah_credits
const ROLLOVER_DAYS = 30;

function randomToken() {
  return `AH-${crypto.randomBytes(16).toString('hex')}`;
}

function safeToken(v) {
  const s = String(v || '').trim();
  return /^AH-[a-f0-9]{32}$/.test(s) ? s : null;
}

function safeFriendId(v) {
  const s = String(v || '').trim();
  return (s && s.length <= 80) ? s : null;
}

/* Reads a companion's credit row. If it has a live Stripe subscription,
   asks Stripe directly whether that subscription is still active rather
   than trusting subscription_active as written -- the whole point of this
   file. Self-heals the row either direction: a subscription Stripe now
   reports canceled flips subscription_active to false here, same as
   check-subscription-etl.js already does for the ETL membership; a
   subscription due for its monthly rollover (30 days since last top-up)
   gets it, same lazy mechanic ah_credits already uses, just gated on the
   live check instead of a stale local boolean. */
async function readCompanionCreditRow(accessToken, friendId, serviceKey) {
  const token = safeToken(accessToken);
  const fid = safeFriendId(friendId);
  if (!token || !fid || !serviceKey) return null;

  const filter = `access_token=eq.${encodeURIComponent(token)}&friend_id=eq.${encodeURIComponent(fid)}`;

  let row;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/gc_companion_credits?${filter}` +
      `&select=balance,last_topped_up_at,subscription_active,stripe_subscription_id`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    if (!r.ok) return null;
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    row = rows[0];
  } catch (err) {
    console.error('_gc-companion-credits readCompanionCreditRow failed:', err.message);
    return null;
  }

  if (!row.stripe_subscription_id) {
    /* A one-time grant (e.g. the catalog bonus) or a row with no
       subscription behind it at all -- nothing to verify against Stripe,
       just report the balance as it stands. */
    return { balance: row.balance, subscription_active: !!row.subscription_active };
  }

  /* LIVE CHECK. A stripeKey missing here (should not happen in practice,
     every caller already required STRIPE_SECRET_KEY to get this far) means
     falling back to the stored flag rather than silently granting access. */
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  let liveActive = !!row.subscription_active;
  if (stripeKey) {
    try {
      const sr = await fetch(`https://api.stripe.com/v1/subscriptions/${row.stripe_subscription_id}`, {
        headers: { Authorization: `Bearer ${stripeKey}` },
      });
      if (sr.ok) {
        const sub = await sr.json();
        liveActive = sub.status === 'active' || sub.status === 'trialing';
      }
      /* A non-OK response (subscription deleted, bad id) is treated as
         inactive -- the safer failure direction for a paywall. */
      else {
        liveActive = false;
      }
    } catch (err) {
      console.error('_gc-companion-credits: Stripe live check failed, trusting stored flag:', err.message);
    }
  }

  if (liveActive !== !!row.subscription_active) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/gc_companion_credits?${filter}`, {
        method: 'PATCH',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ subscription_active: liveActive, updated_at: new Date().toISOString() }),
      });
    } catch (err) {
      console.error('_gc-companion-credits: subscription_active sync failed (non-fatal):', err.message);
    }
  }

  if (!liveActive) return { balance: row.balance, subscription_active: false };

  const daysSince = (Date.now() - new Date(row.last_topped_up_at).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince >= ROLLOVER_DAYS) {
    const balance = row.balance + TIER_MONTHLY_CREDITS;
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/gc_companion_credits?${filter}`, {
        method: 'PATCH',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ balance, last_topped_up_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      });
    } catch (err) {
      console.error('_gc-companion-credits: rollover write failed:', err.message);
      return { balance: row.balance, subscription_active: true };
    }
    return { balance, subscription_active: true };
  }

  return { balance: row.balance, subscription_active: true };
}

/* Deducts `amount` credits from one companion's row. Re-reads (and
   live-verifies) before writing, same reasoning as _ah-credits.js's own
   deductBy: a caller should never have to trust a balance it read earlier
   in the same request. */
async function deductCompanionCredits(accessToken, friendId, amount, serviceKey) {
  const row = await readCompanionCreditRow(accessToken, friendId, serviceKey);
  if (!row) return { ok: false, reason: 'no_account' };
  if (row.balance < amount) return { ok: false, reason: 'insufficient_credits', balance_remaining: row.balance };

  const token = safeToken(accessToken);
  const fid = safeFriendId(friendId);
  const filter = `access_token=eq.${encodeURIComponent(token)}&friend_id=eq.${encodeURIComponent(fid)}`;
  const balance = row.balance - amount;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/gc_companion_credits?${filter}`, {
      method: 'PATCH',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ balance, updated_at: new Date().toISOString() }),
    });
  } catch (err) {
    console.error('_gc-companion-credits deduct failed:', err.message);
    return { ok: false, reason: 'write_failed' };
  }
  return { ok: true, balance_remaining: balance };
}

/* Creates or tops up one companion's row after a successful Stripe
   checkout. Upsert via PATCH-then-POST-if-missing rather than a single
   upsert call, matching every other checkout function's existing style
   on this campus (see gc-friend-checkout.js, verify-checkout-ah.js). */
async function grantCompanionSubscription(accessToken, friendId, friendName, stripeCustomerId, stripeSubscriptionId, serviceKey) {
  const token = safeToken(accessToken) || randomToken();
  const fid = safeFriendId(friendId);
  if (!fid || !serviceKey) return null;

  const filter = `access_token=eq.${encodeURIComponent(token)}&friend_id=eq.${encodeURIComponent(fid)}`;
  let existing = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/gc_companion_credits?${filter}&select=balance`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length) existing = rows[0];
    }
  } catch (err) {
    console.error('_gc-companion-credits grant lookup failed:', err.message);
  }

  const now = new Date().toISOString();
  if (existing) {
    const balance = existing.balance + TIER_MONTHLY_CREDITS;
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/gc_companion_credits?${filter}`, {
        method: 'PATCH',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          balance, subscription_active: true,
          stripe_customer_id: stripeCustomerId || null,
          stripe_subscription_id: stripeSubscriptionId || null,
          last_topped_up_at: now, updated_at: now,
        }),
      });
    } catch (err) {
      console.error('_gc-companion-credits grant top-up failed:', err.message);
      return null;
    }
    return { access_token: token, balance };
  }

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/gc_companion_credits`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        access_token: token, friend_id: fid, friend_name: friendName || null,
        balance: TIER_MONTHLY_CREDITS, subscription_active: true,
        stripe_customer_id: stripeCustomerId || null,
        stripe_subscription_id: stripeSubscriptionId || null,
        last_topped_up_at: now,
      }),
    });
  } catch (err) {
    console.error('_gc-companion-credits grant mint failed:', err.message);
    return null;
  }
  return { access_token: token, balance: TIER_MONTHLY_CREDITS };
}

/* Adds `amount` credits to one companion's row WITHOUT touching
   subscription_active or stripe_subscription_id -- a one-time top-up, not
   a subscription. Same reasoning as ah_credits' own STARTER_CREDITS grant:
   a row can mean either a real recurring subscriber or a one-time,
   non-renewing balance that only depletes; this always writes the second
   kind. Added 2026-08-28 so the $4.99/$60 addon buttons can top up THIS
   companion's own row instead of the old pooled ah_credits table, which
   this companion's credit check no longer reads at all -- without this, a
   top-up purchase would charge real money for credits nothing could ever
   spend. */
async function topUpCompanion(accessToken, friendId, friendName, amount, stripeCustomerId, serviceKey) {
  const token = safeToken(accessToken) || randomToken();
  const fid = safeFriendId(friendId);
  if (!fid || !serviceKey) return null;

  const filter = `access_token=eq.${encodeURIComponent(token)}&friend_id=eq.${encodeURIComponent(fid)}`;
  let existing = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/gc_companion_credits?${filter}&select=balance`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length) existing = rows[0];
    }
  } catch (err) {
    console.error('_gc-companion-credits topUp lookup failed:', err.message);
  }

  if (existing) {
    const balance = existing.balance + amount;
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/gc_companion_credits?${filter}`, {
        method: 'PATCH',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ balance, updated_at: new Date().toISOString() }),
      });
    } catch (err) {
      console.error('_gc-companion-credits topUp write failed:', err.message);
      return null;
    }
    return { access_token: token, balance };
  }

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/gc_companion_credits`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        access_token: token, friend_id: fid, friend_name: friendName || null,
        balance: amount, subscription_active: false,
        stripe_customer_id: stripeCustomerId || null,
        last_topped_up_at: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.error('_gc-companion-credits topUp mint failed:', err.message);
    return null;
  }
  return { access_token: token, balance: amount };
}

module.exports = {
  SUPABASE_URL,
  TIER_MONTHLY_CREDITS,
  ONE_TO_ONE_COST,
  randomToken,
  safeToken,
  readCompanionCreditRow,
  deductCompanionCredits,
  grantCompanionSubscription,
  topUpCompanion,
};
