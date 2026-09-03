/* ah-table-report-list — owner-only read side of Almost Human's table reports.

   Same X-Owner-Key gate as admin-comp-etl.js. Two shapes from one function,
   since the "list" and "one report" reads are both cheap and this campus's
   convention is one small file per feature rather than one per verb.

   GET /.netlify/functions/ah-table-report-list
     -> { ok, reports: [{ key, room_id, reported_by, reporter_name,
          created_at, message_count }] }, newest first

   GET /.netlify/functions/ah-table-report-list?key=<blob key>
     -> { ok, report } -- the full stored report, transcript included

   Header: X-Owner-Key
*/

const { connectLambda, getStore } = require('@netlify/blobs');

const STORE = 'ah_table_reports';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Owner-Key',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

function ownerOk(event) {
  const key = process.env.OWNER_KEY;
  if (!key) return false;
  const given = String(event.headers['x-owner-key'] || event.headers['X-Owner-Key'] || '').trim();
  return given === key;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'GET only' });

  try { connectLambda(event); } catch (_) {}
  if (!ownerOk(event)) return json(401, { error: 'owner_key_required' });

  const store = getStore(STORE);
  const params = event.queryStringParameters || {};

  if (params.key) {
    let report;
    try { report = await store.get(params.key, { type: 'json' }); }
    catch (err) { return json(500, { error: 'read_failed', message: err.message }); }
    if (!report) return json(404, { error: 'not_found' });
    return json(200, { ok: true, report });
  }

  let blobs;
  try {
    const listing = await store.list();
    blobs = listing.blobs || [];
  } catch (err) {
    return json(500, { error: 'list_failed', message: err.message });
  }

  // Reads every blob rather than keeping a second index. Report volume is
  // expected to stay small (this is a moderation queue, not app traffic), so
  // an index that could drift from the store is a worse trade than reading
  // each one directly.
  const summaries = await Promise.all(blobs.map(async (b) => {
    try {
      const r = await store.get(b.key, { type: 'json' });
      if (!r) return null;
      return {
        key: b.key,
        room_id: r.room_id,
        reported_by: r.reported_by,
        reporter_name: r.reporter_name,
        created_at: r.created_at,
        message_count: Array.isArray(r.transcript) ? r.transcript.length : 0,
      };
    } catch (_) { return null; }
  }));

  const reports = summaries.filter(Boolean).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return json(200, { ok: true, reports });
};
