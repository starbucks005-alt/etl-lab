/* gamma-image-status — polls a Gamma generation. GET ?id=... -> { status, image_url, gamma_url }. */

const GAMMA = 'https://public-api.gamma.app/v1.0/generations';

exports.handler = async function(event){
  const id = (event.queryStringParameters && event.queryStringParameters.id) || '';
  if (!id) return { statusCode:400, body:JSON.stringify({error:'id_required'}) };
  const key = process.env.GAMMA_API_KEY || process.env.GAMMA_KEY || process.env.BUILD_YOUR_AGENT_GAMMA;
  if (!key) return { statusCode:500, body:JSON.stringify({error:'no_gamma_key'}) };

  try {
    const r = await fetch(GAMMA + '/' + encodeURIComponent(id), { headers:{ 'X-API-KEY':key } });
    const d = await r.json().catch(function(){ return {}; });
    if (!r.ok) return { statusCode:r.status, body:JSON.stringify({ error:'gamma_'+r.status, detail:(d&&d.message)||d }) };
    var st = d.status;
    if (st && typeof st === 'object') st = st.status || st.state || JSON.stringify(st);
    return { statusCode:200, headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
      body: JSON.stringify({
        status: st || 'pending',
        image_url: d.exportUrl || '',
        gamma_url: d.gammaUrl || '',
        error: d.error || null
      }) };
  } catch(err){
    return { statusCode:500, body:JSON.stringify({ error:String(err&&err.message) }) };
  }
};
