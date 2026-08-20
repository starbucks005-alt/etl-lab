const { getStore, connectLambda } = require('@netlify/blobs');
const veo = require('./_veo-video.js');

const SECRET = 'veo-diag-x91k4mQ7';

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.key !== SECRET) return { statusCode: 403, body: 'no' };

  try { connectLambda(event); } catch (_) {}

  if (q.action === 'find') {
    // List recent orders so we can find Isabelle's without guessing the id.
    const orders = getStore('gc_scene_orders');
    const { blobs } = await orders.list();
    const rows = [];
    for (const b of blobs) {
      if (b.key.endsWith('.portrait')) continue;
      try {
        const o = await orders.get(b.key, { type: 'json' });
        if (o) rows.push({ order_id: o.order_id, friend_name: o.friend_name, status: o.status, where: o.where, created_at: o.created_at });
      } catch (_) {}
    }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rows, null, 2) };
  }

  if (q.action === 'start') {
    const orderId = q.order_id;
    if (!orderId) return { statusCode: 400, body: 'order_id required' };
    const orders = getStore('gc_scene_orders');
    const order = await orders.get(orderId, { type: 'json' });
    if (!order) return { statusCode: 404, body: 'order not found' };
    const portrait = String(await orders.get(order.portrait_key, { type: 'text' }) || '').trim();
    if (!portrait) return { statusCode: 404, body: 'portrait not found' };

    // gc-scene.js does not export scenePrompt, so the same shape is rebuilt here.
    const g = String(order.gender || '').toLowerCase();
    const isWoman = /woman|female|she/.test(g);
    const isMan = !isWoman && /man|male|\bhe\b/.test(g);
    const subject = isWoman ? 'this woman' : isMan ? 'this man' : 'this person';
    const single = isWoman || isMan;
    const they = isWoman ? 'She' : isMan ? 'He' : 'They';
    const are = single ? 'is' : 'are';
    const looks = single ? 'looks' : 'look';
    const stays = single ? 'stays' : 'stay';
    const prompt = [
      'A seamless infinite loop of ' + subject + ' ' + String(order.where).trim().replace(/\.$/, '') + '.',
      'Static camera, fixed framing, consistent soft lighting throughout.',
      'Minimal body movement, fluid and natural repetition where the ending seamlessly matches the starting frame, no jump cuts.',
      they + ' ' + looks + ' over at the camera and ' + stays + ' with the person watching, present, as though sitting with them. Not absorbed in a task, not looking away. ' + they + ' ' + are + ' not talking and there is no speech.',
      'Do not change ' + (isWoman ? 'her' : isMan ? 'his' : 'their') + ' looks.',
    ].join(' ');

    let started;
    try {
      started = await veo.start({
        prompt, firstFrameB64: portrait, seconds: 4, models: [veo.MODEL_LITE],
        aspect: '16:9', resolution: '720p',
      });
    } catch (e) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start_failed: true, error: String(e && e.message || e), prompt }) };
    }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ started, prompt }) };
  }

  if (q.action === 'check') {
    const op = q.op;
    if (!op) return { statusCode: 400, body: 'op required' };
    const res = await veo.check(decodeURIComponent(op));
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(res, null, 2) };
  }

  // RAW, no parsing at all -- the actual operation object Google returns,
  // to see the real shape of a completed response check() cannot find a uri in.
  if (q.action === 'checkraw') {
    const op = q.op;
    if (!op) return { statusCode: 400, body: 'op required' };
    const https = require('https');
    const apiKey = veo.apiKey();
    const raw = await new Promise((resolve, reject) => {
      https.get({
        hostname: 'generativelanguage.googleapis.com',
        path: '/v1beta/' + decodeURIComponent(op).replace(/^\/+/, ''),
        headers: { 'x-goog-api-key': apiKey },
      }, r => {
        let data = '';
        r.on('data', c => data += c);
        r.on('end', () => resolve(data));
      }).on('error', reject);
    });
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: raw };
  }

  return { statusCode: 400, body: 'action required: find | start | check' };
};
