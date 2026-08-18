/* TEMP, removed after use. Search ElevenLabs' shared voice library for a
   Reggie candidate. GET -> { voices: [{voice_id,name,gender,age,accent,description,preview_url}] } */
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
const json = (c, b) => ({ statusCode: c, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return json(500, { error: 'no_voice_key' });

  const qs = event.queryStringParameters || {};
  const params = new URLSearchParams({
    gender: qs.gender || 'male',
    page_size: '15',
  });
  if (qs.q) params.set('search', qs.q);

  let r;
  try {
    r = await fetch('https://api.elevenlabs.io/v1/shared-voices?' + params.toString(), {
      headers: { 'xi-api-key': key },
    });
  } catch (err) {
    return json(502, { error: 'unreachable', detail: err.message });
  }
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    return json(r.status, { error: 'elevenlabs_error', detail: detail.slice(0, 500) });
  }
  const data = await r.json();
  const voices = (data.voices || []).map(v => ({
    voice_id: v.voice_id,
    name: v.name,
    gender: v.gender,
    age: v.age,
    accent: v.accent,
    descriptive: v.descriptive,
    description: v.description,
    use_case: v.use_case,
    preview_url: v.preview_url,
  }));
  return json(200, { voices, total: data.total_count });
};
