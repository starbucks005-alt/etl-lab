/* ONE-OFF, DELETED RIGHT AFTER USE. Reads the real ElevenLabs subscription
   tier and remaining credits so "~300 credits per voice made" (Dr. O's own
   number) can be converted to an actual dollar figure instead of guessed. */
const json = (c, b) => ({ statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

const TEMP_SECRET = 'eleven-plan-2026-08-19-w8v1';

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  if (String(qs.secret || '').trim() !== TEMP_SECRET) return json(401, { error: 'nope' });

  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return json(500, { error: 'no_key' });

  const r = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
    headers: { 'xi-api-key': key },
  });
  const data = await r.json();
  return json(r.status, data);
};
