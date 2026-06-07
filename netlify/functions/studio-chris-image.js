/* ─────────────────────────────────────────────────────────────────────────────
   studio-chris-image

   Chris (Greylander Press's digital artist) generates images for Studio
   Social Posts. Same OpenAI gpt-image-1 backend used by GP's
   generate-character-portrait.js, just adapted for social-post aspect
   ratios and post-context-aware prompts.

   POST body: { post, platform, imagePrompt, agentVoice }
   Returns: { imageBase64, mimeType, size, platform }

   Auth: requires valid Supabase JWT in Authorization header. Anonymous
   requests rejected with 401 (prevents burning OpenAI credits on
   non-Terry traffic).

   Env vars: OPENAI_GP_ImageGen_Key (or OPENAI_API_KEY fallback) must be
   set in the Netlify site environment. Same key used by GP's character
   portrait function.
   ───────────────────────────────────────────────────────────────────────────── */

const https = require('https');

/* ─── JWT validation (same pattern as studio-workspace-content + studio-social-generate) ─── */
const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

async function validateRequest(event) {
  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return { ok: false, reason: 'no_bearer' };
  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false, reason: 'empty_token' };
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token, 'apikey': SUPABASE_ANON_KEY },
    });
    if (!r.ok) return { ok: false, reason: 'supabase_rejected_' + r.status };
    const user = await r.json();
    if (!user || !user.id) return { ok: false, reason: 'no_user' };
    return { ok: true, user };
  } catch (e) {
    return { ok: false, reason: 'fetch_failed', error: e && e.message };
  }
}

/* ─── Per-platform image size (gpt-image-1 supports 1024x1024, 1024x1536, 1536x1024) ─── */
const PLATFORM_SIZES = {
  x:         { size: '1536x1024', label: 'landscape (3:2)' },
  bluesky:   { size: '1536x1024', label: 'landscape (3:2)' },
  linkedin:  { size: '1536x1024', label: 'landscape (3:2)' },
  facebook:  { size: '1536x1024', label: 'landscape (3:2)' },
  instagram: { size: '1024x1024', label: 'square (1:1)' },
  threads:   { size: '1024x1024', label: 'square (1:1)' },
};

/* ─── Voice-aligned visual style (matches the post's agent personality) ─── */
const VOICE_STYLES = {
  Zara:   'playful editorial illustration, warm color palette, hand-drawn feel with confident linework, magazine-cover energy, mid-2020s indie publication aesthetic',
  Sneha:  'clean schematic diagram or operator-aesthetic infographic, restrained palette, navy and amber accents, briefing-document feel, no decorative flourishes',
  Ayanna: 'clean editorial graphic, parchment background or warm neutral, classical typography aesthetic, museum-wall-text dignity, no clutter',
};

/* ─── OpenAI call (mirrors GP's pattern) ─── */
function callOpenAIImages(prompt, size, quality) {
  const apiKey = process.env.OPENAI_GP_ImageGen_Key || process.env.OPENAI_API_KEY;
  if (!apiKey) return Promise.reject(new Error('OpenAI API key not configured. Add OPENAI_GP_ImageGen_Key in Netlify Site Settings → Environment variables.'));
  const payload = JSON.stringify({
    model: 'gpt-image-1',
    prompt: prompt,
    size: size || '1024x1024',
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
          if (p.error) reject(new Error(p.error.message || 'OpenAI image error'));
          else resolve(p);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: CORS, body: 'method not allowed' };

  // Auth gate
  const auth = await validateRequest(event);
  if (!auth.ok) {
    return { statusCode: 401, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'unauthorized', reason: auth.reason }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'invalid json' }) }; }

  const { post, platform, imagePrompt, agentVoice } = body;
  const platformData = PLATFORM_SIZES[platform];
  if (!platformData) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'invalid or missing platform' }) };
  if (!imagePrompt || typeof imagePrompt !== 'string' || !imagePrompt.trim()) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'imagePrompt is required' }) };
  }

  // Build the full image prompt. Combines:
  //  - the user's image description (what kind of graphic they want)
  //  - the post text (so Chris understands the subject)
  //  - the voice-aligned visual style (matches the post's agent)
  //  - a no-text guard (social media images with auto-generated text usually look terrible)
  const voiceLabel = (agentVoice || '').split(' ')[0]; // first word: "Zara" / "Sneha" / "Ayanna"
  const styleNote = VOICE_STYLES[voiceLabel] || 'clean editorial illustration, professional but approachable';

  let fullPrompt = imagePrompt.trim();
  if (post && typeof post === 'string') {
    fullPrompt += '. Context: this image accompanies a social media post that says: "' + post.trim().slice(0, 400) + '"';
  }
  fullPrompt += '. Visual style: ' + styleNote + '.';
  fullPrompt += ' Composition: optimized for ' + platformData.label + ' aspect ratio social media.';
  fullPrompt += ' No text, no letters, no words, no logos, no captions anywhere in the image.';
  fullPrompt = fullPrompt.slice(0, 3500);

  let imgResp;
  try {
    imgResp = await callOpenAIImages(fullPrompt, platformData.size, 'medium');
  } catch (e) {
    console.error('[studio-chris-image] OpenAI call failed', e && e.message);
    return { statusCode: 502, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Image generation failed: ' + e.message }) };
  }

  const item = imgResp && imgResp.data && imgResp.data[0];
  if (!item) {
    return { statusCode: 502, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'OpenAI returned no image data' }) };
  }

  // Prefer base64 inline (no separate download step). Fallback to URL if that's what OpenAI returned.
  let imageBase64 = null;
  let imageUrl = null;
  if (item.b64_json) imageBase64 = item.b64_json;
  else if (item.url)  imageUrl = item.url;
  else return { statusCode: 502, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'OpenAI response had neither b64_json nor url' }) };

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageBase64: imageBase64,
      imageUrl: imageUrl,
      mimeType: 'image/png',
      size: platformData.size,
      platform: platform,
      promptUsed: fullPrompt,
    }),
  };
};
