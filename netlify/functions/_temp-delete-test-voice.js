/* ONE-OFF, DELETED RIGHT AFTER USE. Removes the "Test voice, delete me"
   voice created while smoke-testing gc-voice-design.js end to end. */
const json = (c, b) => ({ statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const TEMP_SECRET = 'del-voice-2026-08-19-b6r4';
const VOICE_ID = '44BfDD5qBOyegJbWV69X';

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  if (String(qs.secret || '').trim() !== TEMP_SECRET) return json(401, { error: 'nope' });
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return json(500, { error: 'no_key' });

  const r = await fetch('https://api.elevenlabs.io/v1/voices/' + VOICE_ID, {
    method: 'DELETE', headers: { 'xi-api-key': key },
  });
  const text = await r.text();
  return json(r.status, { deleted: r.ok, detail: text });
};
