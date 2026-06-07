/* ─────────────────────────────────────────────────────────────────────────────
   studio-auggie-brief-cron — daily scheduled trigger for Auggie's morning
   brief to Ms. Terry.

   Fires at 11:00 UTC every day = 7am ET in DST (EDT), 6am ET in winter (EST).
   Staggered one hour after the newswire-briefing-cron (10:00 UTC) so Auggie
   can theoretically reference today's newswire output if his prompt ever
   evolves to pull it in.

   Wakes up studio-auggie-brief-background with admin credentials. The
   background function gathers findings via web_search, generates Auggie's
   monologue in his voice, renders ElevenLabs audio, stores both audio and
   metadata in Netlify Blobs.

   To pause: set env var AUGGIE_BRIEF_CRON_DISABLED=true and redeploy.

   Requires env vars (already configured):
     PRESS_ADMIN_USER, PRESS_ADMIN_PASS (basic auth for the background fn)
     ANTHROPIC_API_KEY, ELEVENLABS_API_KEY (consumed by background fn)
   ───────────────────────────────────────────────────────────────────────────── */

exports.config = {
  schedule: '0 11 * * *',
};

exports.handler = async () => {
  if (String(process.env.AUGGIE_BRIEF_CRON_DISABLED || '').toLowerCase() === 'true') {
    console.log('[auggie-brief-cron] paused (AUGGIE_BRIEF_CRON_DISABLED=true)');
    return { statusCode: 200, body: 'paused' };
  }

  const user = process.env.PRESS_ADMIN_USER;
  const pass = process.env.PRESS_ADMIN_PASS;
  if (!user || !pass) {
    console.error('[auggie-brief-cron] PRESS_ADMIN_USER/PASS not configured');
    return { statusCode: 500, body: 'admin creds missing' };
  }
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');
  const base = process.env.URL || 'https://emerging-tech-lab.com';

  console.log('[auggie-brief-cron] firing daily brief at', new Date().toISOString());

  try {
    const res = await fetch(`${base}/.netlify/functions/studio-auggie-brief-background`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
      },
      body: JSON.stringify({}),
    });
    if (res.status >= 200 && res.status < 300) {
      console.log('[auggie-brief-cron] trigger accepted, status', res.status);
      return { statusCode: 200, body: `triggered (background status ${res.status})` };
    }
    const errText = await res.text().catch(() => '<no body>');
    console.error('[auggie-brief-cron] trigger rejected, status', res.status, errText.slice(0, 200));
    return { statusCode: 502, body: `trigger rejected: ${res.status}` };
  } catch (err) {
    console.error('[auggie-brief-cron] fetch failed', err && err.message);
    return { statusCode: 502, body: `fetch failed: ${err && err.message}` };
  }
};
