/* etl-design-list — the owner's back catalogue of ETL Design jobs.
   ─────────────────────────────────────────────────────────────────────────
   GET (or POST) with an owner Bearer token -> { ok, count, jobs: [...] }

   WHY THIS EXISTS (2026-07-31)
   Dr. O ran a brief for My Echo, hit the $49 checkout, backed out, and then
   could not get back to her own piece. Nothing had deleted it: the page
   simply never persists a job id, and the id only reaches the URL on the way
   BACK from Stripe. Abandon the checkout and the only remaining copy of the
   handle was inside the Stripe session's metadata.

   So a finished piece could exist in the store and be unreachable by the
   person who made it. This endpoint is the missing read side.

   READ ONLY, DELIBERATELY. Deleting lives in etl-design-purge behind admin
   basic auth and stays there. Nothing here mutates a job, so pointing a
   browser at it can never cost anything. That separation is the point: the
   listing tool is the one you reach for casually.

   Auth is the same owner master key Studio, the credits layer and
   etl-design-deliver already use, so there is one definition of owner on this
   campus rather than a fourth.

   Each job owns three keys in the store: the JSON record, <id>.png and
   <id>.svg. Only the JSON is a job; the other two are its renders.
*/

const { getStore, connectLambda } = require('@netlify/blobs');
const { getUser, extractToken } = require('./_etl-credits-util.js');

// Reading every record means one blob fetch per job, so the page size is a
// real cost, not a formality. 120 is generous for a catalogue this age and
// still bounded. `truncated` says plainly when the cap bit, because a list
// that silently stops short reads as "that is everything".
const MAX_JOBS = 120;
const BATCH = 10;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(status, obj) {
  return {
    statusCode: status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(obj),
  };
}

/* A job id, not one of its renders. */
function isJobKey(key) {
  return /^dsn-[0-9a-z-]+$/i.test(key) && !/\.(png|svg)$/i.test(key);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return json(405, { error: 'GET or POST only' });
  }

  const token = extractToken(
    (event.headers && (event.headers.authorization || event.headers.Authorization)) || ''
  );
  if (!token) return json(401, { error: 'owner_token_required' });

  let user = null;
  try {
    user = await getUser(token);
  } catch (e) {
    console.error('[etl-design-list] auth lookup failed', e && e.message);
    return json(500, { error: 'auth_unavailable' });
  }
  if (!user || (user.id !== 'owner' && user.id !== 'owner-master')) {
    return json(403, { error: 'owner_only' });
  }

  // Optional substring filter on the business name, so "my echo" finds the
  // one piece without reading a hundred rows by eye.
  const qs = (event.queryStringParameters || {});
  let bodyQ = '';
  if (event.httpMethod === 'POST') {
    try { bodyQ = String((JSON.parse(event.body || '{}') || {}).q || ''); } catch (_) {}
  }
  const q = String(qs.q || bodyQ || '').trim().toLowerCase();

  try { connectLambda(event); } catch (_) {}
  let store;
  try { store = getStore('etl_design_jobs'); } catch (e) {
    console.error('[etl-design-list] store unavailable', e && e.message);
    return json(500, { error: 'store_unavailable', detail: e && e.message });
  }

  let keys = [];
  try {
    const listed = await store.list();
    keys = (listed.blobs || []).map(b => String(b.key || ''));
  } catch (e) {
    console.error('[etl-design-list] list failed', e && e.message);
    return json(500, { error: 'list_failed', detail: e && e.message });
  }

  // Whether a render exists is answerable from the key list alone. Checking
  // it with a fetch per job would double the reads to learn nothing new.
  const renders = new Set(keys.filter(k => /\.png$/i.test(k)).map(k => k.replace(/\.png$/i, '')));

  /* The id carries its own creation stamp (dsn-YYYYMMDDHHMMSS-rand), so the
     newest jobs can be identified BEFORE reading any of them. Sorting first
     means the cap keeps the most recent work rather than an arbitrary slice
     of it. created_at from the record is still what gets reported. */
  const jobKeys = keys.filter(isJobKey).sort().reverse();
  const truncated = jobKeys.length > MAX_JOBS;
  const take = jobKeys.slice(0, MAX_JOBS);

  const jobs = [];
  for (let i = 0; i < take.length; i += BATCH) {
    const slice = take.slice(i, i + BATCH);
    const recs = await Promise.all(slice.map(async (key) => {
      try { return await store.get(key, { type: 'json' }); }
      catch (e) {
        // One unreadable record must not lose the other hundred.
        console.warn('[etl-design-list] unreadable job', key, e && e.message);
        return null;
      }
    }));
    recs.forEach((job, n) => {
      if (!job) return;
      const key = slice[n];
      const brief = job.brief || {};
      const business = String(brief.businessName || '').trim();
      if (q && business.toLowerCase().indexOf(q) === -1) return;
      const hasImage = renders.has(key);
      jobs.push({
        job_id: key,
        business: business || '(no name given)',
        promoting: String(brief.promoting || '').slice(0, 160),
        platform: brief.platform || '',
        status: job.status || '',
        created_at: job.created_at || '',
        updated_at: job.updated_at || '',
        paid: !!job.paid,
        revision: job.revision || 0,
        has_image: hasImage,
        // Ready to paste into a browser. No auth on the render endpoint, so
        // this opens as-is.
        image_url: hasImage
          ? ('/.netlify/functions/etl-design-image?job_id=' + encodeURIComponent(key) + '&v=' + (job.revision || 0))
          : '',
      });
    });
  }

  jobs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  return json(200, {
    ok: true,
    count: jobs.length,
    scanned: take.length,
    total_jobs: jobKeys.length,
    truncated,
    query: q || null,
    jobs,
  });
};
