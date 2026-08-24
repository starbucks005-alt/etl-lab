/* ─────────────────────────────────────────────────────────────────────────────
   studio-auggie-brief-cron — RETIRED. Dr. O does not want Auggie running an
   unprompted daily web-search brief; if she wants him to search for
   something, she asks him directly in conversation instead. The scheduled
   trigger is removed so Netlify no longer invokes this automatically. The
   manual-trigger path (studio-auggie-brief-background, called with basic
   auth) is left intact in case a one-off brief is ever wanted by hand.
   ───────────────────────────────────────────────────────────────────────────── */

exports.handler = async () => {
  console.log('[auggie-brief-cron] retired, no automatic runs');
  return { statusCode: 200, body: 'retired' };
};
