/* ─────────────────────────────────────────────────────────────────────────────
   press-sitemap — XML sitemap listing every press piece + the /press hub.

   Served at /press-sitemap.xml via the netlify.toml redirect. Tell Google
   about every piece so it gets crawled and indexed fast. Add the URL of
   this sitemap to Google Search Console once and Google will discover
   every new piece automatically as the index updates.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const SITE_BASE = 'https://emerging-tech-lab.com';
const escXml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

exports.handler = async (event) => {
  try { connectLambda(event); } catch (err) { console.error('[press-sitemap] connectLambda failed', err && err.message); }
  let pieces = [];
  try {
    const indexStore = getStore('press_index');
    const order = await indexStore.get('order', { type: 'json' });
    if (Array.isArray(order)) pieces = order;
  } catch (err) {
    console.error('[press-sitemap] blob read failed', err && err.message);
  }

  const urls = [
    `<url><loc>${SITE_BASE}/press</loc><changefreq>daily</changefreq><priority>0.8</priority></url>`,
    ...pieces.map(p => `<url><loc>${SITE_BASE}/press/${escXml(p.slug)}</loc><lastmod>${escXml(p.published_at || new Date().toISOString())}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>`)
  ].join('\n  ');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls}
</urlset>`;
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600, stale-while-revalidate=3600',
    },
    body: xml,
  };
};
