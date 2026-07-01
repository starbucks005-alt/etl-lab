/* send-welcome-email — fires once on first signup, called from auth-callback.html
   Requires: RESEND_API_KEY in Netlify env vars
   Sending domain: lab@emerging-tech-lab.com must be verified in Resend dashboard */

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';
const FROM = 'Dr. O <drterryoroszi@emerging-tech-lab.com>';

function buildEmail(email) {
  const firstName = email.split('@')[0].split('.')[0];
  const name = firstName.charAt(0).toUpperCase() + firstName.slice(1);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Welcome to the Lab</title>
</head>
<body style="margin:0;padding:0;background:#0e0c08;font-family:'Georgia',serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0e0c08;">
  <tr><td align="center" style="padding:40px 20px;">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      <!-- Banner -->
      <tr><td style="background:#28527a;padding:8px 32px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#fff;text-align:center;">
        Emerging Technologies Laboratory &nbsp;&middot;&nbsp; Dayton, Ohio
      </td></tr>

      <!-- Header -->
      <tr><td style="padding:48px 40px 32px;border-left:1px solid rgba(92,138,181,0.2);border-right:1px solid rgba(92,138,181,0.2);">
        <p style="font-family:'Courier New',monospace;font-size:10px;letter-spacing:4px;text-transform:uppercase;color:#5c8ab5;margin:0 0 20px;">Dr. O's Emerging Tech Lab</p>
        <h1 style="font-family:'Georgia',serif;font-size:42px;font-weight:400;color:#ffffff;margin:0 0 8px;line-height:1.1;">You're in.</h1>
        <p style="font-family:'Georgia',serif;font-size:18px;font-weight:400;color:#b8a882;margin:0;line-height:1.4;">Welcome to the lab, ${name}.</p>
      </td></tr>

      <!-- Body -->
      <tr><td style="padding:0 40px 40px;border-left:1px solid rgba(92,138,181,0.2);border-right:1px solid rgba(92,138,181,0.2);">
        <p style="font-family:'Georgia',serif;font-size:16px;color:#c8bfa8;line-height:1.8;margin:0 0 20px;">
          This isn't a platform. It's a lab -- with real staff, real work, and a real mission at the intersection of education and emerging technology. You just became part of it.
        </p>
        <p style="font-family:'Georgia',serif;font-size:16px;color:#c8bfa8;line-height:1.8;margin:0 0 20px;">
          Iris is at the front door if you need a tour. Auggie can help you build something. Judge Roz holds court. Dr. Chen is in at The Dose. Wyatt's behind the bar. You'll get to know all of them.
        </p>
        <p style="font-family:'Georgia',serif;font-size:16px;color:#c8bfa8;line-height:1.8;margin:0 0 32px;">
          Your 20 credits are waiting. Use them to talk to the staff, run a Prep Room session, or bring a case to Roz. The broadcast feed is always on and always free.
        </p>

        <!-- CTA -->
        <table cellpadding="0" cellspacing="0">
          <tr><td style="background:#c6a667;">
            <a href="https://emerging-tech-lab.com" style="display:inline-block;padding:14px 40px;font-family:'Courier New',monospace;font-size:11px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#0e0c08;text-decoration:none;">Walk in the door &rarr;</a>
          </td></tr>
        </table>
      </td></tr>

      <!-- Divider -->
      <tr><td style="border-left:1px solid rgba(92,138,181,0.2);border-right:1px solid rgba(92,138,181,0.2);padding:0 40px;">
        <div style="border-top:1px solid rgba(92,138,181,0.2);"></div>
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:28px 40px 40px;border-left:1px solid rgba(92,138,181,0.2);border-right:1px solid rgba(92,138,181,0.2);border-bottom:1px solid rgba(92,138,181,0.2);">
        <p style="font-family:'Courier New',monospace;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#5a5040;margin:0 0 8px;">Dr. Terry Oroszi &nbsp;&middot;&nbsp; Emerging Technologies Laboratory</p>
        <p style="font-family:'Courier New',monospace;font-size:10px;letter-spacing:1px;color:#3a3428;margin:0;">
          You're receiving this because you joined the lab at emerging-tech-lab.com.<br>
          Questions? Reply to this email.
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;

  return { html, subject: 'Welcome to the Lab.' };
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }

  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return { statusCode: 401, body: JSON.stringify({ error: 'no_token' }) };
  }
  const token = authHeader.slice(7).trim();

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'resend_not_configured' }) };
  }

  let userEmail;
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { 'Authorization': 'Bearer ' + token, 'apikey': SUPABASE_ANON_KEY },
    });
    if (!r.ok) return { statusCode: 401, body: JSON.stringify({ error: 'invalid_token' }) };
    const user = await r.json();
    if (!user || !user.email) return { statusCode: 400, body: JSON.stringify({ error: 'no_email' }) };
    userEmail = user.email;
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'supabase_fetch_failed' }) };
  }

  const { html, subject } = buildEmail(userEmail);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + resendKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [userEmail],
        subject,
        html,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { statusCode: 500, body: JSON.stringify({ error: 'resend_error', detail: data }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, id: data.id }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'send_failed', message: e && e.message }) };
  }
};
