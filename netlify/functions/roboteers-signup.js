/* roboteers-signup: people ask to rent the robot family for a party or an event, or to join the waiting list, 2026-11-02.
   Dr. O: "I will have qr codes so people can sign up ... I mean rent or wait list", and "robot rentals for parties, 200 an hour".
   Kept in the 'roboteers_requests' blob store, one record per request (the same person may ask more than once).
   POST { kind: 'rent'|'waitlist', name, email, phone?, event?, date?, place?, hours?, guests?, robots?, notes?, source?, website }  open to anyone.
        'website' is a trap field a person never fills in. 'source' says which code was scanned (van, park, card ...), letters, numbers and dashes only.
        Each request sends Dr. O an email at her work address (so it can be read, not heard) and sends the person a short note that it arrived. Never throws: the request counts either way.
   GET  with Authorization: Bearer <owner key>   the list, newest first, for Dr. O.
   For a rental the client may also say who the guest of honor is and tell us some special facts about them, so the robots can greet them by name and talk as if they have
   known them. That is kept with the request for Dr. O to read and turn into a briefing for the robots: it is never given to a robot until she has read it.
   Nothing here takes payment, quotes a price or promises a date: Dr. O answers every request herself. */
const crypto = require('crypto');
const { ownerUser } = require('./_owner-auth.js');
const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const json = (statusCode, o) => ({ statusCode, headers: H, body: JSON.stringify(o) });
const WORK = 'drterryoroszi@emerging-tech-lab.com';
const FROM = 'Roboteers <drterryoroszi@emerging-tech-lab.com>';
const KINDS = ['rent', 'waitlist'];
const ROBOTS = ['astra', 'astrad', 'astro', 'astri', 'alice', 'elle', 'reggie', 'biscuit', 'mochi', 'any'];
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

function openStore(event) {
  const { getStore, connectLambda } = require('@netlify/blobs');
  try { if (event) connectLambda(event); } catch (_) {}
  return getStore('roboteers_requests');
}
async function mail(to, subject, html, deps) {
  const env = deps.env || process.env, f = deps.fetchFn || fetch, key = env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: 'no_resend_key' };
  try {
    const r = await f('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: FROM, to: [to], subject, html }) });
    return r.ok ? { sent: true } : { sent: false, reason: 'resend_' + r.status };
  } catch (e) { return { sent: false, reason: String((e && e.message) || e).slice(0, 100) }; }
}
function isOwner(event) {
  const token = String((event.headers && (event.headers.authorization || event.headers.Authorization)) || '').replace(/^Bearer\s+/i, '').trim();
  const gcOwner = String(process.env.GC_OWNER_KEY || '').trim();
  return !!ownerUser(token) || !!(gcOwner && token === gcOwner);
}

exports.handler = async function (event, _ctx, deps = {}) {
  const store = deps.store || openStore(event);
  if (event.httpMethod === 'GET') {
    if (!isOwner(event) && !(deps.owner && deps.owner(event))) return json(401, { error: 'owner_key_needed' });
    const out = [];
    const l = await store.list();
    for (const b of (l.blobs || [])) { const v = await store.get(b.key, { type: 'json' }); if (v && v.email) out.push(v); }
    out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return json(200, { count: out.length, rent: out.filter((x) => x.kind === 'rent').length, waitlist: out.filter((x) => x.kind === 'waitlist').length, requests: out });
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }
  if (body.website) return json(200, { ok: true });                           // a bot filled the trap field: say thanks and keep nothing
  const email = clip(body.email, 254).toLowerCase();
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email)) return json(400, { error: 'That does not look like an email address.' });
  const name = clip(body.name, 80);
  if (!name) return json(400, { error: 'Please tell us your name.' });
  const rec = {
    id: crypto.randomBytes(8).toString('hex'),
    at: new Date(deps.now || Date.now()).toISOString(),
    kind: KINDS.includes(body.kind) ? body.kind : 'waitlist',
    name, email,
    phone: clip(body.phone, 30),
    event: clip(body.event, 60), date: clip(body.date, 40), place: clip(body.place, 120), hours: clip(body.hours, 10), guests: clip(body.guests, 10),
    robots: (Array.isArray(body.robots) ? body.robots : []).map((x) => String(x).toLowerCase()).filter((x) => ROBOTS.includes(x)).slice(0, 10),
    honoree: clip(body.honoree, 80), honoreeAge: clip(body.honoreeAge, 10),      // the guest of honor, so the robots can greet them by name
    facts: clip(body.facts, 1500), others: clip(body.others, 400),                // what to tell the robots about them, and who else will be there
    notes: clip(body.notes, 800),
    source: /^[a-z0-9-]{1,40}$/.test(String(body.source || '')) ? body.source : '',
  };
  await store.setJSON(rec.id, rec);
  const rows = [['Kind', rec.kind === 'rent' ? 'Rent' : 'Waiting list'], ['Name', rec.name], ['Email', rec.email], ['Phone', rec.phone], ['Event', rec.event], ['Date', rec.date], ['Place', rec.place], ['Hours', rec.hours], ['Guests', rec.guests], ['Robots', rec.robots.join(', ')], ['Guest of honor', rec.honoree], ['Turning', rec.honoreeAge], ['Facts for the robots', rec.facts], ['Who else will be there', rec.others], ['Notes', rec.notes], ['Scanned from', rec.source]]
    .filter((r) => r[1]).map((r) => '<tr><td style="padding:2px 12px 2px 0"><b>' + esc(r[0]) + '</b></td><td>' + esc(r[1]) + '</td></tr>').join('');
  await mail(WORK, (rec.kind === 'rent' ? 'Roboteers rental request: ' : 'Roboteers waiting list: ') + rec.name, '<table>' + rows + '</table>', deps);
  await mail(email, 'We got your Roboteers request', '<p>Hello ' + esc(rec.name) + ', thank you. Your ' + (rec.kind === 'rent' ? 'rental request' : 'place on the waiting list') + ' arrived. Dr. O will write to you herself, by email, as soon as she can. Nothing has been charged, and no date is held until she confirms it.</p>', deps);
  return json(200, { ok: true });
};
