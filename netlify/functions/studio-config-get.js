/* ─────────────────────────────────────────────────────────────────────────────
   studio-config-get

   Returns the calling user's Studio config. Looked up by Supabase JWT.

   Lookup order:
   1. Per-user studio_config blob (written by studio-config-set, keyed by user_id)
   2. Email-keyed provisioning fixture (e.g. data/caroline-inma-company.json
      for cschirato@infragardnational.org — CCW's locked donation config)
   3. Empty defaults (anonymous-style minimal config)

   The Studio page reads this on load and templatizes every "Dr. O's Studio"
   or "Auggie" or "Your PA" string out of the page.

   GET, no body. Returns the unified studio_config envelope.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

// Email-keyed provisioning fixtures. When a NEW buyer with a matching email
// first authenticates, this fixture seeds their config. Subsequent edits land
// in their per-user blob via studio-config-set.
const PROVISIONING_FIXTURES = {
  'cschirato@infragardnational.org': 'caroline-inma-company.json',
};

async function validateRequest(event) {
  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return { ok: false, reason: 'no_bearer' };
  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false, reason: 'empty_token' };
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token, 'apikey': SUPABASE_ANON_KEY },
    });
    if (!r.ok) return { ok: false, reason: 'supabase_rejected_' + r.status };
    const user = await r.json();
    if (!user || !user.id) return { ok: false, reason: 'no_user' };
    return { ok: true, user };
  } catch (e) {
    return { ok: false, reason: 'fetch_failed', error: e && e.message };
  }
}

function loadFixture(filename) {
  const candidates = [
    path.join(__dirname, '..', '..', 'data', filename),
    path.join(process.cwd(), 'data', filename),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (_) {}
  }
  return null;
}

// Transform CCW's caroline-inma-company.json shape into the unified
// studio_config envelope the front-end consumes. Fixture is the canonical
// source; we just flatten + normalize.
function fixtureToStudioConfig(fixture, user) {
  if (!fixture) return null;
  const acct = fixture.account || {};
  const co = fixture.company || {};
  const sp = fixture.sponsorship || {};
  const landing = fixture.studio_landing || {};
  const staff = (co.staff || []).map(s => ({
    name: s.name, role: s.role, tier: s.tier, price: s.price,
    backpack: !!s.backpack, why: s.why || '',
    contract: 'standing', hired_at: acct.created_at || null,
    free_assistant: s.free_assistant || null,
  }));
  const sixpack = (co.sixpack_members || []).map(s => ({
    name: s.name, role: s.role, tier: 'core_six_pack', price: 0,
    backpack: !!s.backpack, note: s.note || '',
    contract: 'bundled', hired_at: acct.created_at || null,
  }));
  return {
    user_id: user.id,
    user_email: user.email,
    company_name: co.company_name || 'Your Studio',
    owner_name: acct.owner_name || user.email,
    owner_title: acct.owner_title || '',
    owner_org: acct.owner_org || '',
    owner_context: acct.owner_context || '',
    pa: {
      persona_id: (co.pa && co.pa.persona_id) || 'auggie_vidal',
      display_name: (co.pa && co.pa.display_name) || 'Auggie',
      label: 'Personal Assistant',
      backpack: (co.pa && co.pa.backpack !== false),
      voice_enabled: !!(co.pa && co.pa.voice_enabled),
      voice: (co.pa && co.pa.voice) || null,
      video_calls: (co.pa && co.pa.video_calls) || null,
    },
    address_pref: co.address_pref || null,
    timezone: co.timezone || null,
    brief_beat: co.beat || '',
    domain_addon: co.domain_addon || null,
    owner_site: co.owner_site || acct.owner_site || null,
    plan: co.plan || null,
    sponsorship: {
      sponsored: !!sp.sponsored,
      sponsor: sp.sponsor || null,
      in_kind: !!sp.in_kind,
      retail_value_monthly: sp.retail_value_monthly || 0,
      amount_due_monthly: typeof sp.amount_due_monthly === 'number' ? sp.amount_due_monthly : null,
      statement: sp.statement || '',
    },
    no_payment_ui: !!(landing.no_payment_ui || sp.in_kind),
    in_kind_banner: sp.statement || null,
    hired_staff: staff.concat(sixpack),
    first_login_show: landing.show_on_first_login || [],
    cv_provided: !!co.cv_provided,
    source: 'fixture',
    fixture_file: null,
  };
}

function defaultStudioConfig(user) {
  return {
    user_id: user.id,
    user_email: user.email,
    company_name: 'Your Studio',
    owner_name: user.email,
    pa: {
      persona_id: 'auggie_vidal',
      display_name: 'Auggie',
      label: 'Personal Assistant',
      backpack: true,
      voice_enabled: true,
    },
    brief_beat: '',
    // The owner's default Jax target. For Dr. O (default config) this is her
    // hub, so "have Jax improve SEO" still auto-targets ETL. Buyers override
    // it with their own owner_site via their fixture or Settings.
    owner_site: 'https://emerging-tech-lab.com',
    sponsorship: { sponsored: false, in_kind: false },
    no_payment_ui: false,
    hired_staff: [],
    source: 'default',
  };
}

exports.handler = async function(event) {
  try { connectLambda(event); } catch (_) {}

  const auth = await validateRequest(event);
  if (!auth.ok) {
    return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized', reason: auth.reason }) };
  }

  // 1. Per-user blob (writes from studio-config-set)
  const store = getStore('studio_config');
  try {
    const persisted = await store.get(auth.user.id, { type: 'json' });
    if (persisted) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify(Object.assign({ source: 'blob' }, persisted, { user_id: auth.user.id, user_email: auth.user.email })),
      };
    }
  } catch (_) {}

  // 2. Email-keyed provisioning fixture
  const email = (auth.user.email || '').toLowerCase();
  const fixtureFile = PROVISIONING_FIXTURES[email];
  if (fixtureFile) {
    const fixture = loadFixture(fixtureFile);
    if (fixture) {
      const cfg = fixtureToStudioConfig(fixture, auth.user);
      if (cfg) {
        cfg.fixture_file = fixtureFile;
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          body: JSON.stringify(cfg),
        };
      }
    }
  }

  // 3. Empty defaults
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(defaultStudioConfig(auth.user)),
  };
};
