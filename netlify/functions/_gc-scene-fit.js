/* _gc-scene-fit — is this a fit for a scene or image somebody is buying?
   Underscore prefix = utility module, not a Netlify endpoint.
   ─────────────────────────────────────────────────────────────────────────
   Shared by gc-scene.js (video) and gc-image-checkout.js (still), so the
   two pipelines that generate a picture of somebody's companion cannot
   quietly drift into two different standards for the same rule.

   NOT A ROMANCE SITE, added 2026-09-04, Dr. O direct: "it is not a romance
   site, so a scene made that is questionable better be denied." Same
   ROMANCE_SNIFF regex + Haiku classify pattern gc-chat.js already runs on
   what somebody TYPES; this is the same boundary applied to what somebody
   DESCRIBES when ordering a scene or image.

   SELF-INSERTION IS A SEPARATE PROBLEM, AND ONLY ON THE SHARED PATH. Dr.
   O's own example: "make a scene with me and Julian on the sofa listening
   to records" could be completely innocent -- and still cannot go into
   Julian's SHARED world, because every other visitor would then find a
   stranger sitting in Julian's canon. "If they want that, buy Julian": the
   right answer for a personal scene with yourself in it is a personal
   companion, which already has fully private scenes with no such rule.
   Always classified on the shared path regardless of keyword match, since
   that path is low-volume and permanent for everyone, unlike a chat
   message or a personal companion's own private scene. */

const ROMANCE_SNIFF = /\b(kiss|kissing|sexy|sexual|horny|naked|nude|nudity|make love|making love|romantic|romance|in bed|undress|lingerie|seduc)\b/i;
const CLASSIFY_MODEL = 'claude-haiku-4-5-20251001';

/* Returns {ok:true} or {ok:false, reason: 'questionable'|'self_insertion'|'cannot_confirm'}. */
async function sceneRequestIsFitFor(Anthropic, where, forShared) {
  const text = String(where || '');
  if (!forShared && !ROMANCE_SNIFF.test(text)) return { ok: true };

  /* GOOD_COMPANY_API_KEY, NOT ANTHROPIC_API_KEY -- this campus gives each
     product its own Anthropic key (see GOOD_COMPANY_API_KEY, ALMOST_HUMAN_
     API_KEY, ETL_API_KEY, etc. in the site's env vars), and there is no
     literal ANTHROPIC_API_KEY at all. Caught by actually running this
     against the real classifier before shipping, not assumed: every case
     that needed a real call came back cannot_confirm until this was fixed. */
  const key = process.env.GOOD_COMPANY_API_KEY;
  if (!key) return { ok: false, reason: 'cannot_confirm' };
  try {
    const client = new Anthropic({ apiKey: key });
    /* WRITTEN WITH EXAMPLES, NOT JUST RULES, after a real test run: a bare
       rule statement ("SELF = the visitor appears alongside the companion")
       made Haiku over-trigger SELF on plainly innocent descriptions with no
       visitor in them at all ("sitting with Poppy and Blue on a branch,
       laughing about something" -- an established companion's own castmates,
       nobody personal). A small, fast model needs the boundary shown, not
       just stated -- see gc-face.js's own note on the same lesson for image
       prompts. FINE now lists concrete examples first, on purpose: what is
       allowed should be the thing most vividly in view, not an afterthought
       clause at the end of a paragraph about what to refuse. */
    const system = forShared
      ? 'A visitor described a scene or image for a SHARED companion on a PLATONIC companion ' +
        'app (not dating or romance). This companion is the same person for every visitor, and ' +
        'the result becomes part of what everyone sees, permanently. Classify it as exactly ' +
        'one word.\n\n' +
        'FINE examples (answer FINE for anything like these): "in the garden with a cup of ' +
        'tea", "sitting with Poppy and Blue on a branch, laughing about something", "reading ' +
        'to the kids at bedtime", "on watch at the front porch", "the whole family around the ' +
        'table". These describe the companion (alone, or with their own established castmates) ' +
        'doing something ordinary. None of them mention the visitor.\n\n' +
        'SELF examples (answer SELF for anything like these): "me and Julian on the sofa ' +
        'listening to records", "the two of us at the beach", "hanging out with me", "us ' +
        'having coffee together". The common thread: the VISITOR THEMSELVES (the person ' +
        'asking, "I"/"me"/"us"/"we") is a character IN the scene, not just its audience. That ' +
        'cannot go in a scene everyone else will also see, even when the request is completely ' +
        'wholesome.\n\n' +
        'QUESTIONABLE = romantic, sexual, or suggestive in any way, or stages the companion as ' +
        'a romantic partner (checked regardless of SELF).\n\n' +
        'Default to FINE. Only answer SELF if the visitor is explicitly named as a participant, ' +
        'not merely because other characters, animals, or people in general are present.'
      : 'A visitor described a scene or image they want made of their OWN companion on a ' +
        'PLATONIC companion app (not dating or romance). Answer with exactly one word. ' +
        'QUESTIONABLE = romantic, sexual, or suggestive in any way, or stages the companion as ' +
        'a romantic partner. FINE = anything else, including affectionate but platonic scenes, ' +
        'and scenes that include the visitor themselves.';
    const r = await client.messages.create({
      model: CLASSIFY_MODEL,
      max_tokens: 8,
      system,
      messages: [{ role: 'user', content: text.slice(0, 800) }],
    });
    const out = (r.content?.[0]?.text || '').trim().toUpperCase();
    if (out.startsWith('QUESTIONABLE')) return { ok: false, reason: 'questionable' };
    if (forShared && out.startsWith('SELF')) return { ok: false, reason: 'self_insertion' };
    return { ok: true };
  } catch (_) {
    return { ok: false, reason: 'cannot_confirm' };   // unreachable classifier: refuse rather than guess
  }
}

/* A ready-to-return error body for a refused request, so both callers give
   the same message for the same reason rather than writing their own. */
function fitErrorBody(reason) {
  return {
    error: 'not_fit_for_scene',
    reason,
    detail: reason === 'self_insertion'
      ? 'A scene for a shared companion cannot include you personally -- that is exactly ' +
        'what a companion you build yourself is for.'
      : reason === 'questionable'
      ? 'That description reads as romantic or suggestive, which this is not set up for.'
      : 'Could not confirm that description is a fit for a scene right now.',
  };
}

module.exports = { sceneRequestIsFitFor, fitErrorBody };
