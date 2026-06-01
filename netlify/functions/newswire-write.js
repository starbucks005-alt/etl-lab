/* ─────────────────────────────────────────────────────────────────────────────
   newswire-write — DEPRECATED.

   This endpoint used to run the reporter inline in a standard Netlify
   function, which capped at 10 seconds. Anthropic + web_search routinely
   takes 30-120 seconds so the foreground version timed out and returned an
   HTML error page that broke the admin UI's JSON parser.

   The live endpoint is now newswire-write-background, which runs up to 15
   minutes in the background. Update any caller to POST there instead.
   ───────────────────────────────────────────────────────────────────────────── */

exports.handler = async () => ({
  statusCode: 410,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    error: 'gone',
    detail: 'newswire-write moved to newswire-write-background (background function, up to 15 min runtime)',
    new_endpoint: '/.netlify/functions/newswire-write-background',
  }),
});
