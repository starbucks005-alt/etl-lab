/* gamma-image-ask — kicks off an AI portrait generation via the Gamma API.
   Public (build-your-own-agent shop). Uses GAMMA_API_KEY from the Netlify env.
   POST { prompt, name?, role?, model? } -> { ok, generation_id }. */

const GAMMA = 'https://public-api.gamma.app/v1.0/generations';

exports.handler = async function(event){
  if (event.httpMethod !== 'POST') return { statusCode:405, body:JSON.stringify({error:'method_not_allowed'}) };
  let body; try { body = JSON.parse(event.body||'{}'); } catch(e){ return { statusCode:400, body:JSON.stringify({error:'bad_json'}) }; }

  const prompt = String(body.prompt||'').trim();
  if (!prompt) return { statusCode:400, body:JSON.stringify({error:'prompt_required'}) };
  if (prompt.length > 4000) return { statusCode:400, body:JSON.stringify({error:'prompt_too_long'}) };

  const key = process.env.GAMMA_API_KEY || process.env.GAMMA_KEY || process.env.BUILD_YOUR_AGENT_GAMMA;
  if (!key) return { statusCode:500, body:JSON.stringify({error:'no_gamma_key'}) };

  const name = String(body.name||'Agent').trim();
  const role = String(body.role||'').trim();
  const model = String(body.model||'imagen-4-pro').trim();

  const style = prompt + '. Photorealistic environmental portrait, head and shoulders, eye level, '
    + 'subject centered looking at camera, soft even lighting, shallow depth of field, natural skin texture.';

  const payload = {
    inputText: (name + (role ? ' — ' + role : '') + '. ' + prompt).slice(0,4000),
    format: 'social',
    textMode: 'none',
    numCards: 1,
    cardOptions: { dimensions: '1x1' },
    imageOptions: { source: 'aiGenerated', model: model, style: style },
    exportAs: 'png'
  };

  try {
    const r = await fetch(GAMMA, {
      method:'POST',
      headers:{ 'X-API-KEY':key, 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
    const d = await r.json().catch(function(){ return {}; });
    if (!r.ok) return { statusCode:r.status, body:JSON.stringify({ error:'gamma_'+r.status, detail:(d&&d.message)||d }) };
    return { statusCode:200, headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ ok:true, generation_id:d.generationId, warnings:d.warnings||null }) };
  } catch(err){
    return { statusCode:500, body:JSON.stringify({ error:String(err&&err.message) }) };
  }
};
