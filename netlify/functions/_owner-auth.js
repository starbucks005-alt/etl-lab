/* ─────────────────────────────────────────────────────────────────────────────
   _owner-auth — the landlord master key (passcode-less owner access).

   Files prefixed with "_" are ignored by Netlify's function scanner, so this
   is bundled into the functions that require it but is never published as its
   own endpoint (same pattern as _etl-voice-law.js, _briefing-helpers.js).

   Purpose: Dr. O (the owner/landlord) has no working per-user login (no
   password was ever set; magic link does not establish a desktop session).
   This gives her browser a single shared key it carries silently, so every
   studio-* function accepts her with no passcode. It mirrors the EXPORT_KEYS
   shared-key pattern the public agent tools already use (agent-ask.js).

   How it is used: each studio-* validateRequest, right after pulling the
   bearer token, calls ownerUser(token). A match returns a synthetic owner
   user ({ id: 'owner-master', email: <owner> }) so the rest of the handler
   behaves exactly as if the owner had signed in. A non-match returns null and
   the handler falls through to normal Supabase JWT validation, so real buyer
   logins are completely unaffected.

   SECURITY NOTE (demo-mode tradeoff): the source default below lets this work
   without touching Netlify config. For real security, set OWNER_KEYS in the
   Netlify environment (comma-separated to rotate) and delete the default. The
   key grants entry to ANY studio via ?as=, so treat it like a master key.
   ───────────────────────────────────────────────────────────────────────────── */

const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'starbucks005@gmail.com').toLowerCase();

/* Reads OWNER_KEYS, falling back to OWNER_KEY (singular), which is the name actually set in
   Netlify and the one the other eight functions on this site already use. Until 2026-07-28 this
   read only the plural, which was never set, so all 45 functions importing this module ran on a
   hardcoded default instead. That default has been removed: this repo is public, so it was a
   master key to every studio sitting in plain sight, and nothing about the setup made that
   visible. The dashboard showed a key present and the page said it was the one in use.
   Comma-separated still works, for rotating without a gap. */
const OWNER_KEYS = (process.env.OWNER_KEYS || process.env.OWNER_KEY || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// Returns a synthetic owner user when the bearer token is a valid owner key,
// otherwise null. Constant id keeps the owner's persisted blob (PA seat, etc.)
// stable across sessions.
function ownerUser(token) {
  if (!token) return null;
  if (OWNER_KEYS.indexOf(token) === -1) return null;
  return { id: 'owner-master', email: OWNER_EMAIL };
}

module.exports = { ownerUser, OWNER_EMAIL, OWNER_KEYS };
