/* studio-slick-view — serve a generated slick as HTML. Public (no auth): the
   owner shares the link with the prospect, who is not logged in. Keyed by the
   unguessable slug from the generator. GET ?slug=<slug> (or /slick/<slug>). */

const { getStore, connectLambda } = require('@netlify/blobs');

exports.handler = async function(event) {
  try { connectLambda(event); } catch (_) {}

  const slug = (event.queryStringParameters && (event.queryStringParameters.slug || event.queryStringParameters.splat)) || '';
  if (!slug) {
    return { statusCode: 400, headers: { 'Content-Type': 'text/plain' }, body: 'Missing slug.' };
  }

  let rec;
  try {
    const store = getStore('studio_slicks');
    rec = await store.get(slug, { type: 'json' });
  } catch (e) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: 'Lookup failed.' };
  }

  if (!rec || !rec.html) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: '<!doctype html><meta charset="utf-8"><title>Not found</title>'
        + '<div style="font-family:system-ui,sans-serif;max-width:520px;margin:80px auto;text-align:center;color:#3b362e">'
        + '<h1 style="font-family:Georgia,serif">This slick is not available.</h1>'
        + '<p>The link may be old or mistyped. Ask the sender for a fresh one.</p></div>',
    };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Robots-Tag': 'noindex',
    },
    body: rec.html,
  };
};
