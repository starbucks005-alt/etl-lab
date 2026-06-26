/* ─────────────────────────────────────────────────────────────────────────────
   studio-list — the LANDLORD's directory of every Founder Studio.

   Owner-only. Returns one entry per studio (sold + future) from EVERY
   provisioning source so the directory stays current with zero edits:
     1. Email-keyed provisioning fixtures (data/provisioned-clients.json).
     2. Self-serve checkout buyers (the studio_config_pending blob store,
        keyed by email, written by the stripe-provision webhook).

   The landlord (Dr. O) uses each entry's email to "enter" that studio
   read-only via /studio?as=<email> (the existing owner-preview path in
   studio-config-get). Gated to the owner email; everyone else gets 403.

   GET, no body. Returns { owner_email, count, studios: [...] }.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

// The landlord. Matches OWNER_PREVIEW_EMAIL in studio-config-get.js (the only
// account allowed to ?as= into a client studio). Env override wins.
const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'starbucks005@gmail.com').toLowerCase();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}

async function validateRequest(event) {
  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return { ok: false, reason: 'no_bearer' };
  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false, reason: 'empty_token' };
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { 'Authorization': 'Bearer ' + token, 'apikey': SUPABASE_ANON_KEY } });
    if (!r.ok) return { ok: false, reason: 'supabase_rejected_' + r.status };
    const user = await r.json();
    if (!user || !user.id) return { ok: false, reason: 'no_user' };
    return { ok: true, user };
  } catch (e) { return { ok: false, reason: 'fetch_failed', error: e && e.message }; }
}

// BOM-safe JSON loader (see studio-config-get.js / studio-fixtures-bom-bug).
function loadFixture(filename) {
  const candidates = [
    path.join(__dirname, 'data', filename),
    path.join(process.cwd(), 'data', filename),
    path.join(__dirname, '..', '..', 'data', filename),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        return JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
      }
    } catch (_) {}
  }
  return null;
}

function loadProvisioningMap() {
  const parsed = loadFixture('provisioned-clients.json');
  const clients = (parsed && parsed.clients) || {};
  const out = {};
  for (const k of Object.keys(clients)) out[k.toLowerCase()] = clients[k];
  return out;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  try { connectLambda(event); } catch (_) {}

  const auth = await validateRequest(event);
  if (!auth.ok) return json(401, { error: 'unauthorized', reason: auth.reason });

  const email = (auth.user.email || '').toLowerCase();
  if (email !== OWNER_EMAIL) return json(403, { error: 'owner_only' });

  const studios = [];
  const seenEmail = new Set();
  const seenFixture = new Set();

  // 1. Provisioned fixtures. Dedup by fixture file so a studio with two login
  //    emails (e.g. Vikram) shows once; collect its alternate emails.
  const provMap = loadProvisioningMap();
  for (const [em, filename] of Object.entries(provMap)) {
    if (seenFixture.has(filename)) {
      const existing = studios.find(s => s.fixture === filename);
      if (existing && em !== existing.email) existing.alt_emails.push(em);
      seenEmail.add(em);
      continue;
    }
    const fx = loadFixture(filename);
    const co = (fx && fx.company) || {};
    const acct = (fx && fx.account) || {};
    const isOwner = em === OWNER_EMAIL;
    studios.push({
      email: em,
      alt_emails: [],
      company_name: co.company_name || (isOwner ? 'Emerging Tech Lab' : 'Studio'),
      owner_name: acct.owner_name || em,
      owner_title: acct.owner_title || acct.owner_org || '',
      source: isOwner ? 'owner' : 'fixture',
      fixture: filename,
    });
    seenFixture.add(filename);
    seenEmail.add(em);
  }

  // 2. Self-serve checkout buyers (studio_config_pending, keyed by email).
  //    Future-proof: any Stripe purchase appears here automatically.
  try {
    const pend = getStore('studio_config_pending');
    const listing = await pend.list();
    for (const b of (listing.blobs || [])) {
      const em = (b.key || '').toLowerCase();
      if (!em || seenEmail.has(em)) continue;
      let p = null;
      try { p = await pend.get(em, { type: 'json' }); } catch (_) {}
      studios.push({
        email: em,
        alt_emails: [],
        company_name: 'Your Studio',
        owner_name: em,
        owner_title: '',
        source: 'self_serve',
        paid: !!(p && p.paid),
      });
      seenEmail.add(em);
    }
  } catch (_) {}

  // Owner first, then alphabetical by company.
  studios.sort((a, b) => {
    if (a.source === 'owner') return -1;
    if (b.source === 'owner') return 1;
    return (a.company_name || '').localeCompare(b.company_name || '');
  });

  return json(200, { owner_email: email, count: studios.length, studios });
};
