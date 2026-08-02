/* etl-design-image — serve the rendered piece.
   GET ?job_id=dsn-...  ->  image/png

   The piece is rendered by us now (Yuki's SVG through sharp) rather than
   fetched from a third party, so it lives in the job's blob store and needs
   an endpoint of its own.

   This serves the PREVIEW as well as the paid copy: the same bytes either
   way. The watermark is applied in the page, not baked in, because a buyer
   who has paid should get the clean file without a second render, and
   because a blurred PNG is not a security boundary. What payment actually
   gates is etl-design-deliver, which is the only thing that will hand over
   the pack.
*/

const { getStore, connectLambda } = require('@netlify/blobs');

exports.handler = async (event) => {
  const jobId = (event.queryStringParameters && event.queryStringParameters.job_id) || '';
  if (!/^dsn-[0-9a-z-]+$/i.test(jobId)) {
    return { statusCode: 400, body: 'job_id required' };
  }

  try { connectLambda(event); } catch (_) {}

  let store, job, buf;
  let layer = String((event.queryStringParameters && event.queryStringParameters.layer) || '').toLowerCase();
  try {
    store = getStore('etl_design_jobs');
    job = await store.get(jobId, { type: 'json' });
    if (!job) return { statusCode: 404, body: 'not found' };
    /* LAYERS, so the animator can composite.
       ─────────────────────────────────────────────────────────────────────
       The relay has stored three things for every piece since yesterday: the
       finished render, Chris's artwork on its own (plate) and the type on
       transparency (type). Only the first was ever reachable, so the type
       layer has existed unused this whole time.

       It matters now because Veo can animate the artwork but turns lettering
       into nonsense, which is the one defect a design firm cannot ship. So
       the plate moves, and the type is composited back over it crisp. That
       needs both layers addressable (2026-08-01). */
    const key = layer === 'plate' ? (job.result && job.result.plate_key)
              : layer === 'type'  ? (job.result && job.result.type_key)
              // The source SVG, so an overlay failure can be reproduced
              // locally against the real input instead of guessed at. The
              // type layer silently failed to store on a live piece and
              // there was nothing to debug with (2026-08-01).
              : layer === 'svg'   ? (job.result && job.result.svg_key)
              : (job.result && job.result.image_key);
    if (!key) {
      // Say WHY the layer is missing when the relay recorded a reason. A bare
      // 404 sent me looking for a bug in the renderer that was not there.
      const why = layer === 'type' && job.result && job.result.type_error;
      return { statusCode: 404, body: layer ? ('no ' + layer + ' layer for this piece' + (why ? ': ' + why : '')) : 'no image yet' };
    }
    buf = await store.get(key, { type: 'arrayBuffer' });
    if (!buf) return { statusCode: 404, body: 'no image yet' };
    /* OVER THE CEILING, SO RE-ENCODE RATHER THAN REFUSE.
       ─────────────────────────────────────────────────────────────────────
       A base64 body has a hard ~6MB platform ceiling, and this used to return
       413 "render too large" past 4MB. That was honest at the server and
       useless at the browser: the download link is a plain anchor, so it
       saved the refusal itself to disk as a 17 byte file called
       etl-image.png, and Photos said it was not a supported format. Dr. O
       had paid a credit for an image that existed the whole time.

       A photoreal square from Chris clears 4MB easily, so this is not an edge
       case. JPEG at 92 takes the same picture to a fraction of the size with
       no visible loss, which is a far better answer than refusing to hand
       over something already generated (2026-08-02). */
    if (buf.byteLength > 4 * 1024 * 1024) {
      try {
        const sharp = require('sharp');
        const jpeg = await sharp(Buffer.from(buf)).jpeg({ quality: 92 }).toBuffer();
        console.log('[etl-design-image] re-encoded ' + buf.byteLength + ' bytes to ' + jpeg.length + ' as jpeg for ' + jobId);
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Access-Control-Allow-Origin': '*',
          },
          body: jpeg.toString('base64'),
          isBase64Encoded: true,
        };
      } catch (e) {
        console.error('[etl-design-image] re-encode failed', e && e.message);
      }
      console.error('[etl-design-image] render too large to serve: ' + buf.byteLength + ' bytes for ' + jobId);
      return { statusCode: 413, body: 'render too large' };
    }
  } catch (e) {
    console.error('[etl-design-image] read failed', e && e.message);
    return { statusCode: 500, body: 'store unavailable' };
  }

  return {
    statusCode: 200,
    headers: {
      // The svg layer is source, not a raster.
      'Content-Type': layer === 'svg' ? 'image/svg+xml' : 'image/png',
      // Immutable: a job's piece never changes once rendered. A fresh brief
      // is a fresh job id, so this can be cached hard.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
    },
    body: Buffer.from(buf).toString('base64'),
    isBase64Encoded: true,
  };
};
