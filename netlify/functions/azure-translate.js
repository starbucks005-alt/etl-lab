/* azure-translate — POST { text | texts: [..], to: "es", from?: "en" }  ->  { ok, translations: [..] }
   Microsoft Azure AI Translator, through _azure.js. Added 2026-10-14, Dr. O.
   For the bilingual Dose (EN/ES) and the Everly Castle language words. Returns 503 until the Translator settings exist,
   so nothing that calls it can be surprised. Short, plain text only: it is capped, and it is not a place to send
   anything private. */

const azure = require('./_azure.js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const MAX_ITEMS = 25;
const MAX_CHARS = 5000;     // in total, per call

function reply(statusCode, obj) {
  return { statusCode, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { ok: false, error: 'bad json' }); }

  const to = String(body.to || '').trim();
  if (!/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/.test(to)) return reply(400, { ok: false, error: 'to must be a language code such as es' });
  const from = body.from ? String(body.from).trim() : '';
  if (from && !/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/.test(from)) return reply(400, { ok: false, error: 'bad from code' });

  const list = Array.isArray(body.texts) ? body.texts : (body.text != null ? [body.text] : []);
  const texts = list.map((t) => String(t == null ? '' : t));
  if (!texts.length || texts.length > MAX_ITEMS || texts.some((t) => !t.trim())) {
    return reply(400, { ok: false, error: 'send text, or texts with 1 to ' + MAX_ITEMS + ' non-empty strings' });
  }
  if (texts.reduce((n, t) => n + t.length, 0) > MAX_CHARS) return reply(413, { ok: false, error: 'too long' });

  if (!azure.configured().translator) return reply(503, { ok: false, error: 'translator not configured' });
  const out = await azure.translate(texts, to, from || undefined);
  if (!out) return reply(502, { ok: false, error: 'translator did not answer' });
  return reply(200, { ok: true, to, translations: out });
};
