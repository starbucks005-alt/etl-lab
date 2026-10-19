/* sun-interest: the list of people who want to be told when the Rising Sun light or a candle is ready, 2026-10-19, Dr. O: "I need a form for people to be alerted
   when the lights and candles are available."
   Kept in the 'rising_sun_interest' blob store, one record per email, so a repeat is an update.
   POST { email, product: light|candle|both, fairy, source, website }  open to anyone. 'website' is a trap field a person never fills in.
        The first time an email signs up it gets one short note saying it is on the list (with a way off the list). Never throws: the signup counts either way.
   GET ?u=<token>   the way off the list that note and every announcement carries. Marks that record and says so.
   GET  with Authorization: Bearer <owner key>   the list, for Dr. O.
   POST { action: 'announce', subject, message, product, test } with the owner key   writes to the list. test sends it only to Dr. O's own address. Everyone who left the
        list is skipped, and every message ends with their own way off the list. */
const crypto = require('crypto');
const { ownerUser } = require('./_owner-auth.js');
const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const json = (statusCode, o) => ({ statusCode, headers: H, body: JSON.stringify(o) });
const PRODUCTS = ['light', 'candle', 'both'];
const FAIRIES = ['poppy', 'velvet', 'ember', 'ash', 'flint', 'tansy', 'blue'];
const SITE = 'https://emerging-tech-lab.com';
const FROM = 'The Rising Sun Court <drterryoroszi@emerging-tech-lab.com>';
const WORK = 'drterryoroszi@emerging-tech-lab.com';
const MAX_SEND = 500;

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function openStore(event) {
  const { getStore, connectLambda } = require('@netlify/blobs');
  try { if (event) connectLambda(event); } catch (_) {}
  return getStore('rising_sun_interest');
}
function footer(token) {
  const link = SITE + '/.netlify/functions/sun-interest?u=' + encodeURIComponent(token);
  return '<p style="color:#777;font-size:12px;margin-top:24px">You are getting this because you asked to be told when the Rising Sun light or a candle is ready. ' +
         '<a href="' + esc(link) + '">Take me off the list</a>.</p>';
}
/* Never rejects. Returns { sent, reason }. */
async function mail(to, subject, html, deps) {
  const env = deps.env || process.env, f = deps.fetchFn || fetch, key = env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: 'no_resend_key' };
  try {
    const r = await f('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: FROM, to: [to], subject, html }) });
    if (!r.ok) return { sent: false, reason: 'resend_' + r.status };
    return { sent: true };
  } catch (e) { return { sent: false, reason: String((e && e.message) || e).slice(0, 100) }; }
}
async function allRecords(store) {
  const out = [];
  const l = await store.list();
  for (const b of (l.blobs || [])) { if (b.key.indexOf('u-') === 0) continue; const v = await store.get(b.key, { type: 'json' }); if (v && v.email) out.push(v); }
  return out;
}
function isOwner(event) {
  const token = String((event.headers && (event.headers.authorization || event.headers.Authorization)) || '').replace(/^Bearer\s+/i, '').trim();
  const gcOwner = String(process.env.GC_OWNER_KEY || '').trim();
  return !!ownerUser(token) || !!(gcOwner && token === gcOwner);
}

exports.handler = async function (event, _ctx, deps = {}) {
  const store = deps.store || openStore(event);
  const q = event.queryStringParameters || {};

  if (event.httpMethod === 'GET' && q.u) {
    const key = await store.get('u-' + String(q.u).slice(0, 80), { type: 'json' });
    let msg = 'That link is not valid any more.';
    if (key && key.k) {
      const rec = await store.get(key.k, { type: 'json' });
      if (rec) { rec.unsubscribed = true; await store.setJSON(key.k, rec); msg = 'You are off the list. You will not hear from us about the Rising Sun again.'; }
    }
    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, body: '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>The Rising Sun Court</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;line-height:1.6"><h1 style="font-weight:500">' + esc(msg) + '</h1><p><a href="/rising-sun/">Back to the Rising Sun Court</a></p></body>' };
  }

  if (event.httpMethod === 'GET') {
    if (!isOwner(event)) return json(401, { error: 'owner_key_needed' });
    const out = (await allRecords(store)).map((r) => ({ email: r.email, product: r.product, fairy: r.fairy, source: r.source, at: r.at, unsubscribed: !!r.unsubscribed }));
    out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return json(200, { count: out.length, active: out.filter((x) => !x.unsubscribed).length, interested: out });
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }

  if (body.action === 'announce') {
    if (!isOwner(event)) return json(401, { error: 'owner_key_needed' });
    const subject = String(body.subject || '').trim().slice(0, 150), message = String(body.message || '').trim().slice(0, 5000);
    if (!subject || !message) return json(400, { error: 'Write a subject and a message first.' });
    const html = (tok) => message.split(/\n{2,}/).map((p) => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('') + footer(tok);
    if (body.test) { const r = await mail(WORK, '[test] ' + subject, html('test'), deps); return json(200, { test: true, sent: r.sent ? 1 : 0, reason: r.reason || null }); }
    const want = PRODUCTS.includes(body.product) ? body.product : 'both';
    const list = (await allRecords(store)).filter((r) => !r.unsubscribed && r.token && (want === 'both' || r.product === 'both' || r.product === want)).slice(0, MAX_SEND);
    let sent = 0, failed = 0;
    for (const r of list) { const m = await mail(r.email, subject, html(r.token), deps); if (m.sent) sent++; else failed++; }
    return json(200, { sent, failed, skipped: 0 });
  }

  if (body.website) return json(200, { ok: true });                                   // a bot filled the trap field: say thanks and keep nothing
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email) || email.length > 254) return json(400, { error: 'That does not look like an email address.' });
  const k = crypto.createHash('sha256').update(email).digest('hex').slice(0, 32);
  const before = await store.get(k, { type: 'json' });
  const token = (before && before.token) || crypto.randomBytes(16).toString('hex');
  const rec = {
    email, token,
    product: PRODUCTS.includes(body.product) ? body.product : 'both',
    fairy: FAIRIES.includes(body.fairy) ? body.fairy : '',
    source: /^[a-z0-9-]{1,40}$/.test(String(body.source || '')) ? body.source : '',
    at: new Date(deps.now || Date.now()).toISOString(),
  };
  await store.setJSON(k, rec);
  await store.setJSON('u-' + token, { k });
  if (!before) {
    await mail(email, 'You are on the list for the Rising Sun',
      '<p>Thank you. You are on the list.</p><p>We will write to you once the Rising Sun light or a candle is ready. ETL Lab members get 15% off.</p><p>No one greets the morning alone.</p>' + footer(token), deps);
  }
  return json(200, { ok: true });
};
