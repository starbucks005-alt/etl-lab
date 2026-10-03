/* astra9-waitlist — adds email to astra9_waitlist_emails table in Supabase.
   No auth required, no payment. Rate-limited by Netlify's default function limits. */

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* Optional, self-reported, so a bad or missing value is never a reason to
   reject a signup -- worst case it is just not stored. */
const USE_CASES = ['home', 'education', 'workshop', 'other'];

/* Optional "came from" tag, e.g. a QR code on a table at an exhibition. Only
   short lowercase words, numbers and dashes are kept, anything else is dropped. */
function cleanSource(v) {
  const s = String(v || '').trim().toLowerCase();
  return /^[a-z0-9-]{1,40}$/.test(s) ? s : null;
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
  const useCase = USE_CASES.includes(body.use_case) ? body.use_case : null;

  const source = cleanSource(body.source);

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'config' }) };
  }

  async function save(row) {
    return fetch(`${SUPABASE_URL}/rest/v1/astra9_waitlist_emails`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'resolution=ignore-duplicates',
      },
      body: JSON.stringify(row),
    });
  }

  try {
    let r = await save({ email, use_case: useCase, source });
    /* If the source column has not been added in Supabase yet, keep the signup
       without it rather than losing the email. */
    if (!r.ok && r.status !== 409 && source) {
      r = await save({ email, use_case: useCase });
    }

    if (!r.ok && r.status !== 409) {
      const err = await r.text();
      return { statusCode: 500, body: JSON.stringify({ error: 'db_error', detail: err }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'fetch_failed', message: e && e.message }) };
  }
};
