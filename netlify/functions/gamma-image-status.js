/* gamma-image-status — polls a portrait generation.
   GET ?id=byoa-... -> { status, image_url }

   Historical name, see gamma-image-ask.js. The line that mattered was this:

     image_url: d.exportUrl

   d.exportUrl is Gamma's rendered CARD, not the picture inside it. So every
   portrait BYOA ever downloaded arrived with Gamma's text set across it, while
   the clean image sat in the Gamma doc where only the account holder could see
   it. Dr. O diagnosed it from the outside (2026-07-30): "the text has always
   been the visual on BYOA, but when I see the same image on GAMMA it is
   without text and looks great." The good portrait was always there. We were
   downloading the wrong artifact, every single time.

   image_url now points at the generated PNG itself.

   build-your-own-agent.html polls for status === 'completed' and then uses
   image_url, so both the field names and the status vocabulary are kept exactly
   as they were.
*/

const { getStore, connectLambda } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, obj) {
  return {
    statusCode: status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(obj),
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const id = (event.queryStringParameters && event.queryStringParameters.id) || '';
  if (!/^byoa-[0-9a-z-]+$/i.test(id)) return json(400, { error: 'id_required' });

  try { connectLambda(event); } catch (_) {}

  let job;
  try {
    const store = getStore('byoa_portraits');
    job = await store.get(id, { type: 'json' });
  } catch (e) {
    console.error('[gamma-image-status] blob read failed', e && e.message);
    return json(500, { error: 'store_unavailable' });
  }

  // Nothing written yet means the background function has not reached its
  // first save. Report pending, not failed, or the caller stops polling on a
  // job that is about to succeed.
  if (!job) return json(200, { status: 'pending', image_url: '' });

  return json(200, {
    status: job.status || 'pending',
    image_url: job.status === 'completed'
      ? ('/.netlify/functions/gamma-image-file?id=' + encodeURIComponent(id))
      : '',
    error: job.error || null,
  });
};
