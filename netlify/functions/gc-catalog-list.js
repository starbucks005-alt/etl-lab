/* gc-catalog-list — read-only companion to gc-catalog-add.js. Serves the
   same Blobs list (gc_catalog / index) to catalog.html so a visitor can
   actually browse what gc-catalog-add.js has been writing.

   ADDED 2026-08-27: the add side shipped earlier the same day with no way
   to view what it produced -- Dr. O caught it directly ("How does someone
   view the catalog?"). No new store, no new write path, just a GET over
   the list that already exists.

   GET /.netlify/functions/gc-catalog-list
   Returns: { ok, items: [...] }
*/

const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'GET only' });

  const catalogStore = getStore('gc_catalog');

  let list = [];
  try { list = (await catalogStore.get('index', { type: 'json' })) || []; } catch (_) {}
  if (!Array.isArray(list)) list = [];

  /* NEWEST FIRST. addedAt is an ISO string, so a plain string sort in
     reverse order is a correct chronological sort with no Date parsing. */
  list = list.slice().sort(function (a, b) {
    return String((b && b.addedAt) || '').localeCompare(String((a && a.addedAt) || ''));
  });

  return json(200, { ok: true, items: list });
};
