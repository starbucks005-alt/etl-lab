/* ─────────────────────────────────────────────────────────────────────────────
   newswire-daily-news-cron — daily reporter commissions.

   Fires at 09:00 UTC every day = 5:00 AM ET (EDT) / 4:00 AM ET (EST),
   ONE HOUR before the briefing cron at 10 UTC. Wakes up each of the 9
   reporters to find and file a fresh story on their beat via web search.
   By the time the briefing fires, the wire has 9 fresh pieces to cover.

   We trigger all 9 reporter commissions in parallel since each
   newswire-write-background invocation is a separate background function
   (15-min runtime ceiling, runs concurrently). Each takes 60-180 seconds.

   Each reporter does ONE story per day. No topic seed is passed - the
   reporter uses web search to find whatever is newsworthy on their beat
   that day.

   To pause: set env var PRESS_CRON_DISABLED=true.
   ───────────────────────────────────────────────────────────────────────────── */

exports.config = {
  schedule: '0 9 * * *',
};

const REPORTERS = [
  'marcus_reyes',
  'elke_vogel',
  'sasha_park',
  'theo_okafor',
  'renee_kovac',
  'maya_iyer',
  'karen_bishop',
  'jules_rivera',
  'frank_donovan',
];

exports.handler = async () => {
  if (String(process.env.PRESS_CRON_DISABLED || '').toLowerCase() === 'true') {
    console.log('[daily-news-cron] paused (PRESS_CRON_DISABLED=true)');
    return { statusCode: 200, body: 'paused' };
  }

  const user = process.env.PRESS_ADMIN_USER;
  const pass = process.env.PRESS_ADMIN_PASS;
  if (!user || !pass) {
    console.error('[daily-news-cron] PRESS_ADMIN_USER/PASS not configured');
    return { statusCode: 500, body: 'admin creds missing' };
  }
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');
  const base = process.env.URL || 'https://emerging-tech-lab.com';

  console.log('[daily-news-cron] firing 9 reporter commissions at', new Date().toISOString());

  // Fire all 9 in parallel. Each reporter is a separate background function
  // instance; they run concurrently. We just need each trigger to land.
  const results = await Promise.allSettled(
    REPORTERS.map(reporter_id =>
      fetch(`${base}/.netlify/functions/newswire-write-background`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`,
        },
        body: JSON.stringify({ reporter_id, auto_publish: true }),
      }).then(res => ({ reporter_id, status: res.status, ok: res.ok }))
    )
  );

  const summary = results.map((r, i) => {
    if (r.status === 'fulfilled') return `${REPORTERS[i]}: ${r.value.status}${r.value.ok ? ' OK' : ' FAIL'}`;
    return `${REPORTERS[i]}: rejected (${r.reason && r.reason.message})`;
  }).join('; ');

  const failures = results.filter(r => r.status !== 'fulfilled' || !r.value.ok).length;
  console.log(`[daily-news-cron] queued ${REPORTERS.length} commissions, ${failures} failed: ${summary}`);

  return {
    statusCode: failures === 0 ? 200 : 207,
    body: JSON.stringify({ queued: REPORTERS.length, failed: failures, detail: summary }),
  };
};
