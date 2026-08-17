/* gemini-aspect-probe — find the shape this endpoint accepts for an aspect
   ratio, using the key that actually works.
   ─────────────────────────────────────────────────────────────────────────
   GET ?owner_key=...            -> what each shape did
   GET ?owner_key=...&save=1     -> also keep an image from each success

   THE PROBLEM IT EXISTS TO SETTLE. _gemini-image.js sends an aspect ratio as
   image_config, and this endpoint rejects that field outright. Three callers
   pass one and never notice, because each falls back to the OpenAI engine when
   the Gemini call throws:

     etl-design-background.js:757
     etl-design-revise.js:173
     etl-image-background.js:91

   So ETL Design has effectively never used Gemini, despite Gemini being chosen
   deliberately for image quality: "Gamma uses gemini and I love Gamma's
   images." Every picture has quietly come from gpt-image-1 instead.

   WHY THIS IS A DEPLOYED FUNCTION RATHER THAN A SCRIPT. The key on the desktop
   is out of quota and refuses everything, so probing from there proves nothing
   and reads as a rejection. The working key is a site environment variable and
   this is the only place it can be reached.

   A REJECTED REQUEST COSTS NOTHING, being refused before an image is made. A
   successful one costs about a nickel, so the ones expected to work are the
   only spend and there are three of them.

   THE SIZE IS MEASURED, NOT BELIEVED. A request can be accepted and the aspect
   ignored, which looks identical to success from the status code. The bytes
   are read for real dimensions, so "accepted" and "obeyed" stay separate.
*/

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
const json = (s, o) => ({ statusCode: s, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(o, null, 1) });

const HOST = 'https://generativelanguage.googleapis.com';
const MODEL = 'gemini-3.1-flash-image';
const PROMPT = 'A plain photograph of a red apple on a wooden table.';
const WANT = '3:4';

function apiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || null;
}

const SHAPES = [
  ['interactions + image_config (what ships today)', '/v1beta/interactions',
    { model: MODEL, input: [{ type: 'text', text: PROMPT }], image_config: { aspect_ratio: WANT } }],
  ['interactions + imageConfig', '/v1beta/interactions',
    { model: MODEL, input: [{ type: 'text', text: PROMPT }], imageConfig: { aspectRatio: WANT } }],
  ['interactions + generation_config.image_config', '/v1beta/interactions',
    { model: MODEL, input: [{ type: 'text', text: PROMPT }], generation_config: { image_config: { aspect_ratio: WANT } } }],
  ['interactions, no aspect (the workaround)', '/v1beta/interactions',
    { model: MODEL, input: [{ type: 'text', text: PROMPT }] }],
  ['generateContent + generationConfig.imageConfig', '/v1beta/models/' + MODEL + ':generateContent',
    { contents: [{ parts: [{ text: PROMPT }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: WANT } } }],
];

function findImage(o, hit = { b64: null }) {
  if (!o || typeof o !== 'object') return hit;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (typeof v === 'string' && v.length > 2000 && /^[A-Za-z0-9+/=]+$/.test(v.slice(0, 200))) {
      if (!hit.b64 || v.length > hit.b64.length) hit.b64 = v;
    } else if (v && typeof v === 'object') findImage(v, hit);
  }
  return hit;
}

/* PNG and JPEG dimensions out of the bytes. Accepted is not obeyed. */
function dims(buf) {
  if (buf.length > 24 && buf.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const qs = event.queryStringParameters || {};
  if (!process.env.OWNER_KEY || String(qs.owner_key || '') !== process.env.OWNER_KEY) {
    return json(403, { error: 'owner_only' });
  }
  const key = apiKey();
  if (!key) return json(503, { error: 'no_gemini_key_on_this_site' });

  const results = [];
  for (const [label, path, body] of SHAPES) {
    const row = { shape: label };
    try {
      const r = await fetch(HOST + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => null);
      row.status = r.status;
      if (r.status >= 400) {
        row.result = 'rejected';
        row.detail = String((j && j.error && j.error.message) || r.status).slice(0, 200);
      } else {
        const { b64 } = findImage(j);
        if (!b64) { row.result = 'accepted, no image came back'; }
        else {
          const buf = Buffer.from(b64, 'base64');
          const d = dims(buf);
          row.kb = Math.round(buf.length / 1024);
          row.size = d ? d.w + 'x' + d.h : 'unreadable';
          row.ratio = d ? (d.w / d.h).toFixed(3) : null;
          /* 3:4 is 0.75. Anything else means the field was accepted and
             ignored, which is the failure that looks like success. */
          row.result = d && Math.abs(d.w / d.h - 0.75) < 0.02
            ? 'WORKS, and the aspect was obeyed'
            : 'accepted, but the aspect was ignored';
        }
      }
    } catch (e) {
      row.result = 'error';
      row.detail = String((e && e.message) || e).slice(0, 200);
    }
    results.push(row);
  }

  const winner = results.find(r => r.result === 'WORKS, and the aspect was obeyed');
  return json(200, {
    ok: true,
    asked_for: WANT + ' (0.750)',
    answer: winner
      ? 'Use: ' + winner.shape
      : 'No shape obeyed the aspect. Keep asking for orientation in the prompt text, the way gc-face.js does.',
    results,
  });
};
