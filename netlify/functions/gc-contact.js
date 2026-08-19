/* gc-contact — a real message, straight to Dr. O.
   ─────────────────────────────────────────────────────────────────────────
   POST { message, from?, page?, friend_name? } -> { ok }

   Added 2026-08-19, right after Pookie's invite link sent her to Arch
   instead of Isabelle. Dr. O: "this has to be fixed, this going to Arch,
   because new users will not know how to fix it... give the website a
   chatbot... or a way to get help, to reach out to me." A chatbot can
   explain how a feature works; it cannot fix a wiring bug. This is the
   plainer half: no AI in between, just a message that reaches a person.

   PUBLIC, NO GATE. Someone reaching out because something is already
   broken should not also have to prove they are allowed to ask for help.
   The only real risk is spam, which _gc-notify.js's own "never throws"
   discipline already treats as tolerable: a bad message just becomes a
   bad email, not a broken feature.
*/

const notify = require('./_gc-notify.js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  const message = String(body.message || '').trim().slice(0, 4000);
  if (!message) return json(400, { error: 'message_required' });

  const result = await notify.helpRequest({
    message,
    from: String(body.from || '').slice(0, 200),
    page: String(body.page || '').slice(0, 200),
    friend_name: String(body.friend_name || '').slice(0, 60),
  });

  /* SENT OR NOT, THE PERSON GETS A STRAIGHT ANSWER. Same reasoning as
     _gc-notify.js's own top comment: someone who just tried to reach out
     deserves to know whether it actually went, not a cheerful "thanks!"
     over a message that silently vanished. */
  return json(200, { ok: result.sent, reason: result.sent ? null : result.reason });
};
