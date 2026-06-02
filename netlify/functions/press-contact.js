/* ─────────────────────────────────────────────────────────────────────────────
   press-contact — accept a reader's message to a reporter (or to the
   newsroom in general) and store it in the press_submissions blob for the
   admin to review.

   POST /.netlify/functions/press-contact
   Body: {
     reporter_id?: string,   // optional - which reporter the message is for
     sender_name: string,
     sender_email: string,
     subject?: string,
     message: string,
   }

   Response: { ok: true, id }

   Same-origin gated to defeat random spam from outside. No auth required -
   this is a public contact endpoint.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const ALLOWED_ORIGIN_HOSTS = new Set([
  'emerging-tech-lab.com',
  'www.emerging-tech-lab.com',
]);

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function originHost(value) {
  if (!value) return '';
  try { return new URL(value).hostname.toLowerCase(); } catch { return ''; }
}

function requireSameOrigin(event) {
  const h = event.headers || {};
  const oh = originHost(h.origin || h.Origin || '');
  const rh = originHost(h.referer || h.Referer || '');
  if (oh && ALLOWED_ORIGIN_HOSTS.has(oh)) return true;
  if (rh && ALLOWED_ORIGIN_HOSTS.has(rh)) return true;
  return false;
}

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });
  if (!requireSameOrigin(event)) return json(403, { error: 'cross-origin request refused' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'invalid json' }); }

  // Honeypot - if filled, silently succeed (spammer thinks they won)
  if (body.website || body.url_address || body.bot_field) return json(200, { ok: true, id: 'silently_dropped' });

  const senderName = String(body.sender_name || '').trim().slice(0, 140);
  const senderEmail = String(body.sender_email || '').trim().slice(0, 200);
  const subject = String(body.subject || '').trim().slice(0, 200);
  const message = String(body.message || '').trim().slice(0, 5000);
  const reporterId = String(body.reporter_id || '').trim().slice(0, 80) || null;

  if (!senderName) return json(400, { error: 'name required' });
  if (!isValidEmail(senderEmail)) return json(400, { error: 'valid email required' });
  if (!message || message.length < 10) return json(400, { error: 'message must be at least 10 characters' });

  try { connectLambda(event); } catch (err) {
    console.error('[press-contact] connectLambda failed', err && err.message);
    return json(500, { error: 'blobs connect failed' });
  }

  const now = new Date().toISOString();
  // ID: timestamp + small random suffix for uniqueness
  const rnd = Math.floor(Math.random() * 1e6).toString(36);
  const id = `${now.replace(/[^0-9]/g, '')}-${rnd}`;

  const submission = {
    id,
    type: 'contact',
    received_at: now,
    reporter_id: reporterId,
    sender_name: senderName,
    sender_email: senderEmail,
    subject,
    message,
    read: false,
    user_agent: (event.headers && (event.headers['user-agent'] || event.headers['User-Agent'])) || '',
  };

  try {
    const store = getStore('press_submissions');
    await store.setJSON(id, submission);
    // Also append id to the 'index' list so admin can iterate without listing all blobs.
    let index = [];
    try { const arr = await store.get('_index', { type: 'json' }); if (Array.isArray(arr)) index = arr; } catch (_) {}
    index.unshift(id);
    if (index.length > 1000) index = index.slice(0, 1000);
    await store.setJSON('_index', index);
  } catch (err) {
    console.error('[press-contact] blob write failed', err && err.message);
    return json(500, { error: 'storage write failed' });
  }

  return json(200, { ok: true, id });
};
