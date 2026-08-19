/* ONE-OFF, DELETED RIGHT AFTER USE. Testing a hypothesis: Google's real
   filter reason for both failed attempts at Isabelle's scene was "an issue
   with the audio for your prompt." scenePrompt() in gc-scene.js includes
   "She is not talking and there is no speech" -- not part of Dr. O's own
   hand-verified Flow template quoted at length in that file's comments, and
   a plausible trigger for an audio-related filter despite being phrased as
   a negation. This starts ONE test render with that clause removed, same
   portrait and place, to see whether that alone is the difference. Neither
   prior attempt was charged (Google says so explicitly on a filtered
   result), so this is not new money at risk beyond the one render if it
   succeeds. */
const { getStore, connectLambda } = require('@netlify/blobs');
const veo = require('./_veo-video.js');

const TEMP_SECRET = 'test-prompt-2026-08-19-x5q7';
const ORDER_ID = 'gco-50d7788a514ba05b';

const json = (c, b) => ({ statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

exports.handler = async (event) => {
  try { connectLambda(event); } catch (_) {}
  const qs = event.queryStringParameters || {};
  if (String(qs.secret || '').trim() !== TEMP_SECRET) return json(401, { error: 'nope' });

  const orders = getStore('gc_scene_orders');
  const order = await orders.get(ORDER_ID, { type: 'json' });
  if (!order) return json(404, { error: 'order_not_found' });
  const portrait = String(await orders.get(order.portrait_key, { type: 'text' }) || '').trim();
  if (!portrait) return json(404, { error: 'portrait_not_found' });

  /* Same shape as scenePrompt() in gc-scene.js, minus the one clause being
     tested. Everything else -- the seamless-loop framing, looking at the
     camera, "do not change her looks" -- is Dr. O's own verified wording,
     untouched. */
  const prompt =
    'A seamless infinite loop of this woman at the kitchen table with the light coming in. ' +
    'the kitchen is a typically home on the Welsh island. Static camera, fixed framing, ' +
    'consistent soft lighting throughout. Minimal body movement, fluid and natural repetition ' +
    'where the ending seamlessly matches the starting frame, no jump cuts. She looks over at ' +
    'the camera and stays with the person watching, present, as though sitting with them. Not ' +
    'absorbed in a task, not looking away. Do not change her looks.';

  let started;
  try {
    started = await veo.start({
      prompt,
      firstFrameB64: portrait,
      seconds: 4,
      models: [veo.MODEL_LITE],
      aspect: '16:9',
      resolution: '720p',
    });
  } catch (e) {
    return json(502, { error: 'veo_refused', detail: String(e && e.message || e).slice(0, 500) });
  }

  const operation = started && (started.operation || started.name || started);
  return json(200, { ok: true, operation, model: started && started.model, prompt });
};
