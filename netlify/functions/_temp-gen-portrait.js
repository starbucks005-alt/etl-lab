/* TEMP, removed after use. One-off portrait generation for new Good Company
   house demos. GET ?who=cora|kioko|reggie|tansy -> { image } base64 PNG. */
const gemini = require('./_gemini-image.js');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
const json = (c, b) => ({ statusCode: c, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

const PROMPTS = {
  cora: 'A photograph of a real person. Natural photography, not an illustration, not a ' +
    'render, not a stock headshot. A Filipino-American woman in her seventies, warm and ' +
    'a little brisk, kind eyes, silver-grey hair worn short and neat. Head and shoulders, ' +
    'looking directly at the camera with a small, genuine, welcoming smile, as if she just ' +
    'looked up from the stove to greet someone she is glad to see. Soft warm kitchen light. ' +
    'An ordinary private person, not a celebrity, not anyone recognizable, no particular ' +
    'resemblance to any real named individual.',
  kioko: 'A photograph of a real person. Natural photography, not an illustration, not a ' +
    'render, not a stock headshot. A Kenyan man in his thirties, steady and a little tired ' +
    'in a good way, short hair, calm competent bearing. Head and shoulders, looking directly ' +
    'at the camera, plain and direct expression, nothing performed. Warm evening light. An ' +
    'ordinary private person, not a celebrity, not anyone recognizable, no particular ' +
    'resemblance to any real named individual.',
  reggie: 'A photograph of a real dog. Natural pet photography, not an illustration, not a ' +
    'render, not a cartoon. A scrappy medium-small terrier mix, a real shelter dog, wiry ' +
    'scruffy coat, one ear standing up and one ear folded down, expressive eyebrows, looking ' +
    'directly at the camera with intense, delighted, slightly manic alertness, mouth open ' +
    'in a happy pant, as though something enormously exciting just happened. Head and ' +
    'shoulders, close up. Warm afternoon light indoors, a home behind him, nothing posed or ' +
    'studio-lit. An ordinary real dog, not a show breed, not a recognizable famous animal.',
  tansy: 'A photograph of a fairy who is a clearly ADULT woman, in her thirties in bearing ' +
    'and face, mature sharp features, defined cheekbones and jawline, poised and severe, ' +
    'not youthful, not childlike, not doll-like, no large anime-style eyes, no rounded baby ' +
    'face. Tiny in scale but adult in every proportion and every feature. Elegant gossamer ' +
    'insect-like wings, fully and modestly dressed in an elaborate, sophisticated gown-like ' +
    'garment made of leaves and petals covering her from shoulders to well past the knee, ' +
    'high-necked and formal, nothing childish about the styling. An imperious, haughty, ' +
    'faintly amused adult expression, chin lifted, looking down her nose at the camera as ' +
    'though it has been granted a rare audience with visible age and self-possession in her ' +
    'face. Warm late-afternoon light, seated regally on a windowsill, wings slightly spread. ' +
    'Photorealistic fantasy photography, not a cartoon, not an illustration, not any style ' +
    'associated with children\'s media. An original adult fantastical character, not based ' +
    'on or resembling any existing copyrighted character.',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const who = (event.queryStringParameters || {}).who;
  const prompt = PROMPTS[who];
  if (!prompt) return json(400, { error: 'who must be cora, kioko, reggie, or tansy' });
  try {
    // No aspect param: gc-face.js's own working call omits it too, and
    // image_config errored live here as "Unknown parameter" on this API
    // version.
    const img = await gemini.generate(prompt);
    return json(200, { image: img });
  } catch (err) {
    return json(502, { error: err.message });
  }
};
