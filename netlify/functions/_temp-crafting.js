// Real production render (not a bypass -- calls gc-scene.js's own POST
// handler over real HTTP, same crop + prompt pipeline a real order would
// go through) from a fresh image Dr. O supplied directly, not tied to
// any existing order. One-off, secret-gated, deleted after use.
const SECRET = 'crafting-Bn8Kw3';
const BASE = 'https://emerging-tech-lab.com/.netlify/functions/gc-scene';

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.key !== SECRET) return { statusCode: 403, body: 'no' };

  const ownerKey = process.env.OWNER_KEY;
  if (!ownerKey) return { statusCode: 200, body: 'NO_OWNER_KEY' };

  const portrait = String(event.body || '').trim();
  if (!portrait) return { statusCode: 400, body: 'no image body' };

  const r = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      owner_key: ownerKey,
      portrait: portrait,
      gender: 'A woman',
      where: 'in her herbal shop, holding a small bottle up, surrounded by jars of dried herbs ' +
        'and hanging bundles, an open book on the table in front of her',
    }),
  });
  const text = await r.text();
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: text };
};
