/* _openai-image — gpt-image-1 generation, shared.
   Lifted from studio-chris-image.js so the ETL Design relay and the Studio's
   Social Posts tool call it one way. Chris makes the artwork in both places;
   two copies of the call is how they drift apart.

   Returns a base64 PNG string, or throws with a readable message. */

const https = require('https');

/* gpt-image-1 accepts 1024x1024, 1024x1536, 1536x1024 only. Everything else
   is a 400, so map an intent to one of the three rather than passing a
   canvas size straight through. */
const SIZES = {
  square:    '1024x1024',
  portrait:  '1024x1536',
  landscape: '1536x1024',
};

function generate(prompt, size, quality) {
  const apiKey = process.env.OPENAI_GP_ImageGen_Key || process.env.OPENAI_API_KEY;
  if (!apiKey) return Promise.reject(new Error('OpenAI API key not configured (OPENAI_GP_ImageGen_Key)'));
  const payload = JSON.stringify({
    model: 'gpt-image-1',
    prompt: String(prompt || '').slice(0, 4000),
    size: size || SIZES.square,
    quality: quality || 'medium',
    n: 1,
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/images/generations',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(payload),
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const p = JSON.parse(data);
          if (p.error) return reject(new Error(p.error.message || 'OpenAI image error'));
          const item = (p.data && p.data[0]) || {};
          if (!item.b64_json) return reject(new Error('OpenAI returned no b64_json'));
          resolve(item.b64_json);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

module.exports = { generate, SIZES };
