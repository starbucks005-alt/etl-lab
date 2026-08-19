/* _gc-notify — the email that says a scene has been paid for.
   ─────────────────────────────────────────────────────────────────────────
   Pulled out of gc-scene-checkout so the test endpoint can send the REAL
   thing. A test that copies the code tests the copy: it would pass with a
   valid key and a broken sender, or fail on a typo the real path does not
   have. There is one function here and both callers use it.

   Resend, because RESEND_API_KEY is already set on this site while the IONOS
   mailer lives in the My Echo repo. This is a note to ourselves rather than
   post from her mailbox, so it does not need to come from the real one.

   NEVER THROWS. A payment that went through has to confirm to the buyer even
   if the mail does not go, because the alternative is somebody who has been
   charged and told something went wrong. Every failure is returned as a
   reason instead, which is also what makes it testable: the test endpoint can
   say WHY rather than just failing.
*/

const FROM = 'Good Company <drterryoroszi@emerging-tech-lab.com>';

/* Their own words go into this email, so they are escaped. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function notifyAddress() {
  return (process.env.GC_ORDER_NOTIFY || 'drterryoroszi@emerging-tech-lab.com').trim();
}

/* Returns { sent, to, reason }. Never rejects. */
async function orderPaid(order, opts) {
  const isTest = !!(opts && opts.test);
  const key = process.env.RESEND_API_KEY;
  const to = notifyAddress();

  if (!key) {
    console.warn('[gc-notify] paid order, no RESEND_API_KEY:', order && order.order_id);
    return { sent: false, to, reason: 'no RESEND_API_KEY set on this site' };
  }

  const lines = [];
  if (isTest) {
    lines.push('<p style="background:#FFF3CD;padding:.6rem;border-radius:4px">' +
               '<b>This is a test.</b> Nobody has ordered anything and nobody has been ' +
               'charged. It was sent to prove this email arrives.</p>');
  }
  lines.push(
    '<p><b>' + esc(order.friend_name) + '</b> has been paid for.</p>',
    '<p><b>Where they want them:</b><br>' + esc(order.where) + '</p>',
    '<p><b>Reach them at:</b> ' + (order.from ? esc(order.from) : 'they did not say') + '</p>',
    '<p><b>Order:</b> ' + esc(order.order_id) + '</p>',
    '<p style="color:#666">Make it with gc-scene using that order id, then send them the ' +
    'add-scene link. Nothing has been generated yet.</p>'
  );

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject: (isTest ? '[test] ' : '') + 'Scene ordered and paid: ' + order.friend_name,
        html: lines.join('\n'),
      }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      console.warn('[gc-notify] resend refused:', res.status, detail);
      return { sent: false, to, reason: 'Resend said ' + res.status + ': ' + detail };
    }
    return { sent: true, to, reason: null };
  } catch (e) {
    console.warn('[gc-notify] could not send:', e && e.message);
    return { sent: false, to, reason: String((e && e.message) || e) };
  }
}

/* ── TELLING THE PERSON WHO PAID ─────────────────────────────────────────────
   The other half, and the one that reaches a customer. Their scene got made
   and the only way they found out was somebody remembering to send them a
   link by hand.

   THE LINK IS THE DELIVERY. There is no account to put a scene into: a built
   friend lives in their browser, so add-scene is how it gets there and this
   email is how the link reaches them. Which means an email that does not send
   is an undelivered order, not a missed notification.

   ONLY IF THEY LEFT AN ADDRESS. It is optional on purpose, so plenty of orders
   will have nowhere to write to and that is not a failure. The caller is told
   so it can say so rather than assuming it went. */
async function sceneReady(order, link) {
  const key = process.env.RESEND_API_KEY;
  const to = String((order && order.from) || '').trim();

  /* THE TWO ARE NOT THE SAME THING and were reported as one. Nobody left an
     address is an ordinary outcome and means send the link by hand. Something
     that is not an address means they tried and it will never arrive, which is
     worth seeing rather than filing under "optional". */
  if (!to) {
    return { sent: false, to: null, reason: 'they left no address, so send it by hand' };
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return { sent: false, to, reason: 'what they left is not an email address: ' + to };
  }
  if (!key) return { sent: false, to, reason: 'no RESEND_API_KEY set on this site' };

  const html = [
    '<p>' + esc(order.friend_name) + ' has somewhere new to sit.</p>',
    '<p><a href="' + esc(link) + '">Open this once and the scene is theirs</a>, saved with ' +
    'them and there every time after.</p>',
    '<p style="color:#666">Open it on the device where you made them. They live in that ' +
    'browser rather than in an account, which is why this is a link and not a login.</p>',
    '<p style="color:#666">You asked for: ' + esc(order.where) + '</p>',
  ].join('\n');

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject: esc(order.friend_name) + ' has a new scene',
        html,
      }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      return { sent: false, to, reason: 'Resend said ' + res.status + ': ' + detail };
    }
    return { sent: true, to, reason: null };
  } catch (e) {
    return { sent: false, to, reason: String((e && e.message) || e) };
  }
}

/* ── TELLING THEM THEY HAVE BEEN REFUNDED ────────────────────────────────────
   A refund nobody mentions reads like a mistake on the statement. This says it
   plainly and does not ask them to do anything.

   NO APOLOGY THEATRE AND NO EXCUSES. If a scene came out wrong, say that the
   money is back and leave it there. The one thing worth adding is that their
   friend is untouched, because the obvious fear on seeing a refund for a
   companion app is that something has been taken away. */
async function refunded(order, why) {
  const key = process.env.RESEND_API_KEY;
  const to = String((order && order.from) || '').trim();

  if (!to) return { sent: false, to: null, reason: 'they left no address, so tell them by hand' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return { sent: false, to, reason: 'what they left is not an email address: ' + to };
  }
  if (!key) return { sent: false, to, reason: 'no RESEND_API_KEY set on this site' };

  const html = [
    '<p>The scene you asked for was not right, so your money has gone back. It ' +
    'takes a few days to show up, depending on the bank.</p>',
    why ? '<p>' + esc(why) + '</p>' : '',
    '<p>' + esc(order.friend_name) + ' is exactly as they were. Nothing has been ' +
    'taken away from your room.</p>',
    '<p style="color:#666">You asked for: ' + esc(order.where) + '</p>',
  ].filter(Boolean).join('\n');

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject: 'Your money is on its way back',
        html,
      }),
    });
    if (!res.ok) return { sent: false, to, reason: 'Resend said ' + res.status + ': ' + (await res.text()).slice(0, 200) };
    return { sent: true, to, reason: null };
  } catch (e) {
    return { sent: false, to, reason: String((e && e.message) || e) };
  }
}

/* ── SOMEBODY ASKING FOR DR. O DIRECTLY ──────────────────────────────────────
   Added 2026-08-19. Dr. O, right after Pookie's invite link sent her to
   Arch instead of Isabelle: "this has to be fixed... give the website a
   chatbot... or a way to get help, to reach out to me." A chatbot can
   explain how a feature works; it cannot fix a wiring bug, and that is
   what had actually gone wrong. This is the plainer, more honest half of
   that ask: a real message, straight to her, with no AI in between
   pretending it can solve what only a person actually can.

   SAME "NEVER THROWS" DISCIPLINE AS THE OTHERS. A person reaching out
   because something is already broken is the worst possible moment for
   the "contact us" feature to also fail silently. */
async function helpRequest(payload) {
  const key = process.env.RESEND_API_KEY;
  const to = notifyAddress();
  const message = String((payload && payload.message) || '').trim();
  if (!message) return { sent: false, to, reason: 'empty message' };

  if (!key) {
    console.warn('[gc-notify] help request, no RESEND_API_KEY');
    return { sent: false, to, reason: 'no RESEND_API_KEY set on this site' };
  }

  const from = String((payload && payload.from) || '').trim();
  const page = String((payload && payload.page) || '').trim();
  const friendName = String((payload && payload.friend_name) || '').trim();

  const lines = [
    '<p>' + esc(message).replace(/\n/g, '<br>') + '</p>',
    '<p style="color:#666">Reach them at: ' + (from ? esc(from) : 'they did not say') + '</p>',
    page ? '<p style="color:#666">Page: ' + esc(page) + '</p>' : '',
    friendName ? '<p style="color:#666">Their friend: ' + esc(friendName) + '</p>' : '',
  ].filter(Boolean);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject: 'Good Company — someone needs help' + (friendName ? ' (' + friendName + ')' : ''),
        html: lines.join('\n'),
      }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      console.warn('[gc-notify] resend refused:', res.status, detail);
      return { sent: false, to, reason: 'Resend said ' + res.status + ': ' + detail };
    }
    return { sent: true, to, reason: null };
  } catch (e) {
    console.warn('[gc-notify] could not send:', e && e.message);
    return { sent: false, to, reason: String((e && e.message) || e) };
  }
}

module.exports = { orderPaid, sceneReady, refunded, helpRequest, notifyAddress, esc, FROM };
