/* ─────────────────────────────────────────────────────────────────────────────
   wsu-scan-auth — verifies the Iris ownerToken for the WSU predatory scan page.

   POST { ownerToken }
   Returns { ok: true } or { ok: false }

   Uses the same HMAC as etl-help-chat.js tokenFor() so any device already
   recognized by Iris gets through automatically.
   ───────────────────────────────────────────────────────────────────────────── */

const crypto = require('crypto');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function tokenFor(pass) {
  return crypto.createHmac('sha256', pass).update('iris-owner-v1').digest('hex');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'method not allowed' };

  const pass = process.env.PRESS_ADMIN_PASS;
  if (!pass) return { statusCode: 500, headers: CORS, body: JSON.stringify({ ok: false }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  const ok = typeof body.ownerToken === 'string' && body.ownerToken === tokenFor(pass);
  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ ok }),
  };
};
