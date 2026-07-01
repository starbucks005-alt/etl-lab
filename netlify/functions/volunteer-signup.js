/* volunteer-signup — adds email to volunteer_emails table in Supabase.
   No auth required. Rate-limited by Netlify's default function limits. */

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'bad_json' }) }; }

  const email = String(body.email || '').trim().toLowerCase();
  if (!email || !isValidEmail(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'invalid_email' }) };
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'config' }) };
  }

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/volunteer_emails`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'resolution=ignore-duplicates',
      },
      body: JSON.stringify({ email }),
    });

    if (!r.ok && r.status !== 409) {
      const err = await r.text();
      return { statusCode: 500, body: JSON.stringify({ error: 'db_error', detail: err }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'fetch_failed', message: e && e.message }) };
  }
};
