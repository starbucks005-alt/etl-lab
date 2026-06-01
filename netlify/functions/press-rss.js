/* ─────────────────────────────────────────────────────────────────────────────
   press-rss — RSS 2.0 feed of the ETL Newswire at /press.rss.

   Reads press_index 'order' and emits a standards-compliant RSS feed so
   the newswire can be subscribed to by readers, news aggregators, and
   indexers. Real publications have feeds; this gives the newswire that
   shape.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const SITE_BASE = 'https://emerging-tech-lab.com';
const FEED_TITLE = 'ETL Newswire';
const FEED_DESC  = 'Releases, reporting, and analysis from the ETL network. The Gauntlet, Greylander Press, and the lab itself.';

const escXml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const DESK_LABEL = {
  us: 'US', world: 'World', business: 'Business', technology: 'Technology',
  science: 'Science', health: 'Health', entertainment: 'Entertainment', sports: 'Sports',
};

function rfc822(iso) {
  try { return new Date(iso || Date.now()).toUTCString(); } catch { return new Date().toUTCString(); }
}

exports.handler = async (event) => {
  try { connectLambda(event); } catch (err) { console.error('[press-rss] connectLambda failed', err && err.message); }
  let pieces = [];
  try {
    const indexStore = getStore('press_index');
    const order = await indexStore.get('order', { type: 'json' });
    if (Array.isArray(order)) pieces = order;
  } catch (err) {
    console.error('[press-rss] blob read failed', err && err.message);
  }

  const lastBuild = pieces.length ? rfc822(pieces[0].published_at) : rfc822(new Date().toISOString());
  const items = pieces.slice(0, 100).map((p) => {
    const url = SITE_BASE + '/press/' + p.slug;
    const cats = [];
    if (p.desk && DESK_LABEL[p.desk]) cats.push(DESK_LABEL[p.desk]);
    if (p.platform) cats.push(p.platform);
    return `  <item>
    <title>${escXml(p.title)}</title>
    <link>${escXml(url)}</link>
    <guid isPermaLink="true">${escXml(url)}</guid>
    <pubDate>${escXml(rfc822(p.published_at))}</pubDate>
    ${p.dek ? `<description>${escXml(p.dek)}</description>` : ''}
    ${cats.map(c => `<category>${escXml(c)}</category>`).join('\n    ')}
  </item>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${escXml(FEED_TITLE)}</title>
  <link>${SITE_BASE}/press</link>
  <atom:link href="${SITE_BASE}/press.rss" rel="self" type="application/rss+xml" />
  <description>${escXml(FEED_DESC)}</description>
  <language>en-us</language>
  <lastBuildDate>${escXml(lastBuild)}</lastBuildDate>
  <generator>ETL Newswire</generator>
${items}
</channel>
</rss>`;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
    },
    body: xml,
  };
};
