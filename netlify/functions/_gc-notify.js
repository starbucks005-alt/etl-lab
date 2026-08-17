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

module.exports = { orderPaid, notifyAddress, esc, FROM };
