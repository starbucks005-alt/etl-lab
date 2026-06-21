/* voice-preview — ElevenLabs audition for the build-your-own-agent shop.
   POST { text?, style?, description?, voice_id? } -> audio/mpeg.  Uses ELEVENLABS_API_KEY.

   Two paths:
   1. If voice_id is given, read the sample with that existing voice (Dr. O's My Voices library).
   2. Otherwise DESIGN a voice from the description text via /v1/text-to-voice/design (the same
      Voice Design the ElevenLabs app uses), and return the first generated preview. The bench sends
      a free-text "Other" voice or a preset label; both become the voice_description here. The final
      production voice is assigned or cloned on deploy; this is just the audition.
   Response header X-Generated-Voice-Id carries the generated_voice_id so it can be saved later. */

// Preset bench labels expanded to Voice-Design-friendly descriptions (must be 20-1000 chars).
const PRESET_DESC = {
  'Warm narrator':      'A warm, friendly narrator. Mature, clear and reassuring, with an even, unhurried pace and a natural conversational tone.',
  'Deep & commanding':  'A deep, commanding male voice. Resonant baritone, confident and authoritative, measured, strong and grounded.',
  'Bright & energetic': 'A bright, energetic voice. Upbeat, lively and youthful, with quick, expressive, enthusiastic delivery.',
  'Calm & measured':    'A calm, measured voice. Soft, steady and soothing, with a gentle even cadence and relaxed warmth.',
  'Dry & precise':      'A dry, precise voice. Crisp, articulate and exact, cool and understated, every word deliberate.',
  'Match my own':       'A neutral, professional adult voice, clear and natural, as a stand-in until a cloned voice is assigned.'
};

async function synthExisting(key, voiceId, text){
  const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + voiceId, {
    method:'POST',
    headers:{ 'xi-api-key':key, 'Content-Type':'application/json', 'Accept':'audio/mpeg' },
    body: JSON.stringify({ text:text, model_id:'eleven_multilingual_v2',
      voice_settings:{ stability:0.5, similarity_boost:0.75 } })
  });
  if (!r.ok){ let m=''; try{m=await r.text();}catch(_){} const e=new Error('elevenlabs_'+r.status); e.status=r.status; e.detail=m.slice(0,300); throw e; }
  return Buffer.from(await r.arrayBuffer());
}

async function designVoice(key, description, sample){
  const payload = { voice_description: description, model_id:'eleven_multilingual_ttv_v2', guidance_scale:5 };
  const s = String(sample||'').trim();
  if (s.length >= 100) payload.text = s.slice(0,1000);   // Design needs 100-1000 chars of sample text
  else payload.auto_generate_text = true;                 // otherwise let ElevenLabs write the sample
  const r = await fetch('https://api.elevenlabs.io/v1/text-to-voice/design', {
    method:'POST',
    headers:{ 'xi-api-key':key, 'Content-Type':'application/json', 'Accept':'application/json' },
    body: JSON.stringify(payload)
  });
  if (!r.ok){ let m=''; try{m=await r.text();}catch(_){} const e=new Error('design_'+r.status); e.status=r.status; e.detail=m.slice(0,300); throw e; }
  const j = await r.json();
  const p = j && j.previews && j.previews[0];
  if (!p || !p.audio_base_64){ const e=new Error('no_preview'); e.status=502; throw e; }
  return { audio: Buffer.from(p.audio_base_64,'base64'), gvid: p.generated_voice_id||'' };
}

exports.handler = async function(event){
  if (event.httpMethod !== 'POST') return { statusCode:405, body:JSON.stringify({error:'method_not_allowed'}) };
  let body; try { body = JSON.parse(event.body||'{}'); } catch(e){ return { statusCode:400, body:JSON.stringify({error:'bad_json'}) }; }

  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return { statusCode:500, body:JSON.stringify({error:'no_elevenlabs_key'}) };

  var text = String(body.text||'').trim();
  if (!text) text = 'Hello. This is how I sound. Tell me what you need and I will get to work, and I will tell you where every answer comes from.';

  try {
    // Path 1: an explicit existing voice.
    const voiceId = String(body.voice_id||'').trim();
    if (voiceId){
      const buf = await synthExisting(key, voiceId, text.slice(0,600));
      return { statusCode:200, headers:{ 'Content-Type':'audio/mpeg', 'Cache-Control':'no-store', 'X-Voice-Id':voiceId }, body:buf.toString('base64'), isBase64Encoded:true };
    }
    // Path 2: design a voice from the description.
    let desc = String(body.description || PRESET_DESC[body.style] || body.style || '').trim();
    if (desc.length < 20) desc = PRESET_DESC['Warm narrator'];   // Design requires >= 20 chars
    desc = desc.slice(0,1000);
    const out = await designVoice(key, desc, text);
    return { statusCode:200, headers:{ 'Content-Type':'audio/mpeg', 'Cache-Control':'no-store', 'X-Generated-Voice-Id':out.gvid }, body:out.audio.toString('base64'), isBase64Encoded:true };
  } catch(err){
    const code = err && err.status ? err.status : 500;
    return { statusCode:code, body:JSON.stringify({ error:String(err&&err.message)||'error', detail:err&&err.detail||'' }) };
  }
};
