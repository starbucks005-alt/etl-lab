/* ─────────────────────────────────────────────────────────────────────────────
   newswire-briefing-cron — daily scheduled trigger for "Above the Fold".

   Fires at 10:00 UTC every day = 6:00 AM ET during Daylight Saving (EDT)
   and 5:00 AM ET in winter (EST). Wakes up newswire-briefing-background
   with admin credentials so the daily multi-voice briefing renders fresh
   without anyone clicking Regenerate.

   The schedule is configured below via exports.config.schedule. Netlify
   wires it into their cron infrastructure automatically on deploy.

   To pause the cron: comment out the schedule line and redeploy, OR set
   env var PRESS_CRON_DISABLED=true (early-exit below honors that).

   Requires env vars (already in place):
     PRESS_ADMIN_USER, PRESS_ADMIN_PASS  (basic auth for the background fn)
     ANTHROPIC_API_KEY, ELEVENLABS_API_KEY (consumed by the background fn)
   ───────────────────────────────────────────────────────────────────────────── */

exports.config = {
  schedule: '0 10 * * *',
};

exports.handler = async () => {
  if (String(process.env.PRESS_CRON_DISABLED || '').toLowerCase() === 'true') {
    console.log('[briefing-cron] paused (PRESS_CRON_DISABLED=true)');
    return { statusCode: 200, body: 'paused' };
  }

  const user = process.env.PRESS_ADMIN_USER;
  const pass = process.env.PRESS_ADMIN_PASS;
  if (!user || !pass) {
    console.error('[briefing-cron] PRESS_ADMIN_USER/PASS not configured');
    return { statusCode: 500, body: 'admin creds missing' };
  }
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');
  const base = process.env.URL || 'https://emerging-tech-lab.com';

  console.log('[briefing-cron] firing daily refresh at', new Date().toISOString());

  try {
    const res = await fetch(`${base}/.netlify/functions/newswire-briefing-background`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
      },
      body: JSON.stringify({}),
    });
    // Background function returns 202 immediately; the actual work runs after.
    // We just need to confirm the trigger landed.
    if (res.status >= 200 && res.status < 300) {
      console.log('[briefing-cron] trigger accepted, status', res.status);
      return { statusCode: 200, body: `triggered (background status ${res.status})` };
    }
    const errText = await res.text().catch(() => '<no body>');
    console.error('[briefing-cron] trigger rejected, status', res.status, errText.slice(0, 200));
    return { statusCode: 502, body: `trigger rejected: ${res.status}` };
  } catch (err) {
    console.error('[briefing-cron] fetch failed', err && err.message);
    return { statusCode: 500, body: 'cron trigger failed: ' + (err && err.message) };
  }
};
