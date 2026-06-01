/* ─────────────────────────────────────────────────────────────────────────────
   newswire-latest — JSON endpoint for the homepage "Latest from ETL Newswire"
   strip. Returns the N most recent press_index entries.

   GET /.netlify/functions/newswire-latest?limit=5
   Response: { items: [{slug, title, dek, desk, byline_kind, reporter_id,
                        author, source_label, published_at, url}], total }

   Public (no auth) since the same data is in the press_index sitemap.
   Cached at the CDN for 60s to keep load light.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const PRESS_BASE_URL = 'https://emerging-tech-lab.com';
const DESK_LABELS = {
  us: 'US', world: 'World', business: 'Business', technology: 'Technology',
  security: 'Security', science: 'Science', health: 'Health',
  entertainment: 'Entertainment', sports: 'Sports',
};

let REPORTERS_CACHE = null;
function loadReporters() {
  if (REPORTERS_CACHE) return REPORTERS_CACHE;
  try {
    const data = require('../../config/newswire-reporters.json');
    REPORTERS_CACHE = (data.reporters || []).reduce((acc, r) => { acc[r.id] = r; return acc; }, {});
  } catch (_) { REPORTERS_CACHE = {}; }
  return REPORTERS_CACHE;
}

// Convert reporter id ("marcus_reyes") into the avatar filename in /agents/
// ("Marcus_Reyes.png"). Capitalize each underscore-separated segment.
function avatarUrlFor(id) {
  if (!id) return '';
  const file = id.split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('_');
  return `/agents/${file}.png`;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  try { connectLambda(event); } catch (_) {}

  let limit = parseInt((event.queryStringParameters && event.queryStringParameters.limit) || '5', 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 5;
  if (limit > 25) limit = 25;

  let order = [];
  try {
    const indexStore = getStore('press_index');
    const arr = await indexStore.get('order', { type: 'json' });
    if (Array.isArray(arr)) order = arr;
  } catch (err) {
    console.error('[newswire-latest] index read failed', err && err.message);
  }

  const reporters = loadReporters();

  // order is stored most-recent-first; take the first `limit`. Filter out
  // entries with no title (defensive — should not exist but cheap to guard).
  const items = order
    .filter(p => p && p.title && p.slug)
    .slice(0, limit)
    .map(p => {
      const r = (p.byline_kind === 'reporter' && p.reporter_id) ? reporters[p.reporter_id] : null;
      return {
        slug: p.slug,
        title: p.title,
        dek: p.dek || '',
        desk: p.desk || '',
        desk_label: DESK_LABELS[p.desk] || '',
        byline_kind: p.byline_kind || 'client',
        reporter_id: p.reporter_id || null,
        reporter_tier: r ? (r.tier_label || '') : '',
        reporter_profile_url: r ? `/press/reporter/${r.id.replace(/_/g, '-')}` : '',
        reporter_avatar_url: r ? avatarUrlFor(r.id) : '',
        author: p.author || (r ? r.name : ''),
        source_label: p.source_label || '',
        published_at: p.published_at || '',
        url: PRESS_BASE_URL + '/press/' + p.slug,
      };
    });

  return {
    statusCode: 200,
    headers: {
      ...CORS,
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
    },
    body: JSON.stringify({ items, total: order.length }),
  };
};
