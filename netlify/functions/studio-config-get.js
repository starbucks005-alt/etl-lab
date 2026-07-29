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

// Generic provisioning (Option B): the email -> fixture map lives in DATA
// (data/provisioned-clients.json), not hardcoded here. Adding a client is a
// data edit, not a code change. Caroline was the first; Vikram is the first
// paying client. No buyer is special-cased in this function anymore.

async function validateRequest(event) {
  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return { ok: false, reason: 'no_bearer' };
  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false, reason: 'empty_token' }; { const _ok = require('./_owner-auth.js').ownerUser(token); if (_ok) return { ok: true, user: _ok }; }
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
    path.join(__dirname, 'data', filename),
    path.join(process.cwd(), 'data', filename),
    path.join(__dirname, '..', '..', 'data', filename),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        // Strip a leading UTF-8 BOM before parsing. Several data files get
        // re-saved by editors / PowerShell `-Encoding utf8`, which prepends a
        // BOM (EF BB BF). Node's JSON.parse throws on it, which silently
        // dropped provisioned buyers (Caroline, Vikram) to the default config
        // (generic studio + the static "Ms. Terry" / Dr. O staff fallback).
        const _raw = fs.readFileSync(p, "utf8"); return JSON.parse(_raw.charCodeAt(0) === 0xFEFF ? _raw.slice(1) : _raw);
      }
    } catch (_) {}
  }
  return null;
}

// The generic email -> fixture map. Lives in data/provisioned-clients.json so
// onboarding a client is a data edit. Returns a flat { email: filename } object
// (lowercased keys), or {} if the file is missing.
function loadProvisioningMap() {
  const parsed = loadFixture('provisioned-clients.json');
  const clients = (parsed && parsed.clients) || {};
  const out = {};
  for (const k of Object.keys(clients)) out[k.toLowerCase()] = clients[k];
  return out;
}

// Build a lookup map from normalized agent ID → roster entry.
// IDs are hyphen-normalized (fixture uses underscores, roster uses hyphens).
function loadRosterIndex() {
  const roster = loadFixture('etl-agents-roster.json');
  const index = {};
  for (const agent of (roster && roster.agents) || []) {
    if (!agent || !agent.id) continue;
    const key = agent.id.toLowerCase().replace(/_/g, '-');
    index[key] = agent;
  }
  return index;
}

// Same key a staff entry resolves to everywhere else (roster lookup, the
// Hire More catalog): lowercase, underscores to hyphens. The fixture writes
// ids with underscores ("yuki_mendel"); the live catalog and persisted hires
// use hyphens ("yuki-mendel"). Any dedup-by-id check MUST normalize through
// this first, or the same person can survive as two entries (2026-07-06:
// exactly this let Yuki show up twice for a real buyer).
function staffKey(s) {
  if (!s) return '';
  return String(s.id || s.name || '').toLowerCase().replace(/_/g, '-').trim();
}

// Resolve a single hired_staff entry against the roster. Roster wins for
// display data (name, role); fixture/blob wins for contractual context
// (contract, hired_at, why). If ID not in roster, entry passes through
// unchanged (backwards-compat for legacy or custom agents).
function resolveStaffEntry(entry, rosterIndex) {
  if (!entry || typeof entry !== 'object') return null;
  const key = entry.id ? String(entry.id).toLowerCase().replace(/_/g, '-') : null;
  const r = key ? rosterIndex[key] : null;
  if (!r) return entry;
  return {
    id: r.id,
    name: r.name,
    role: r.role || entry.role || '',
    tier: entry.tier || r.tier || 'specialty_hire',
    price: entry.price != null ? entry.price : (r.price_monthly || 0),
    backpack: entry.backpack != null ? !!entry.backpack : !!(r.mcp),
    why: entry.why || entry.note || '',
    contract: entry.contract || 'standing',
    hired_at: entry.hired_at || null,
    free_assistant: entry.free_assistant || null,
  };
}

// Transform CCW's caroline-inma-company.json shape into the unified
// studio_config envelope the front-end consumes. Fixture is the canonical
// source; we just flatten + normalize.
function fixtureToStudioConfig(fixture, user) {
  if (!fixture) return null;
  const acct = fixture.account || {};
  const co = fixture.company || {};
  const sp = fixture.sponsorship || {};   // Caroline-shape (sponsored / in-kind)
  const billing = fixture.billing || {};  // Vikram-shape (paid / invoiced)
  const landing = fixture.studio_landing || {};
  const staff = (co.staff || []).map(s => ({
    id: s.id || null,
    name: s.name, role: s.role, tier: s.tier, price: s.price,
    backpack: !!s.backpack, why: s.why || '',
    // Default 'standing', but preserve a gifted/comped contract so a staffer
    // given to the owner at no charge (e.g. Rowan -> Vikram) shows as a Gift,
    // not as a normal billed hire.
    contract: /gift|given|comp/i.test(s.contract || '') ? 'gift' : 'standing',
    hired_at: acct.created_at || null,
    free_assistant: s.free_assistant || null,
  }));
  const sixpack = (co.sixpack_members || []).map(s => ({
    id: s.id || null,
    name: s.name, role: s.role || '', tier: 'core_six_pack', price: 0,
    backpack: !!s.backpack, note: s.note || '',
    contract: s.contract || 'bundled', hired_at: acct.created_at || null,
  }));
  return {
    user_id: user.id,
    user_email: user.email,
    company_name: co.company_name || 'Your Studio',
    owner_name: acct.owner_name || user.email,
    owner_address_form: acct.owner_address_form || '',
    owner_honorific: acct.owner_honorific || '',
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
    billing: {
      sponsored: !!sp.sponsored,
      amount_due_monthly: typeof billing.amount_due_monthly === 'number'
        ? billing.amount_due_monthly
        : (typeof sp.amount_due_monthly === 'number' ? sp.amount_due_monthly : null),
      invoiced_out_of_band: !!billing.invoiced_out_of_band,
      plan: billing.plan || co.plan || null,
    },
    // Provisioned clients (sponsored or invoiced) never see self-serve checkout.
    no_payment_ui: !!(landing.no_payment_ui || sp.in_kind || billing.invoiced_out_of_band || billing.amount_due_monthly),
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
    owner_address_form: '',
    owner_honorific: '',
    // Auggie is the default seat. Swapping is now REAL: the in-Studio
    // picker posts to studio-config-set and the seat persists per user
    // via the overlay above (the 2026-06-13 rehearsal hardcode is gone;
    // Terry tests Jen through the same flow her customers use).
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

const OWNER_GUARANTEED_STAFF = [
  { name: 'Dr. Henry Chen, RPh', role: 'The Pharmacist', backpack: false, contract: 'standing', tier: 'addon', price: 25, why: 'Health Sciences pharmacology expert on The Dose cast; handles drug interactions, supplement evidence, and medication literacy.' },
  { name: 'Maeve "MJ" Johnson',  role: 'The Gardener',   backpack: false, contract: 'standing', tier: 'addon', price: 25, why: 'The Dose cast; nutrition, home growing, whole-food wellness, and practical plant-based guidance.' },
];

function injectOwnerStaff(cfg, email) {
  const ownerEmail = (process.env.OWNER_EMAIL || '').toLowerCase();
  if (!ownerEmail || email !== ownerEmail) return;
  const existing = new Set((cfg.hired_staff || []).map(s => s.name));
  const missing = OWNER_GUARANTEED_STAFF.filter(s => !existing.has(s.name));
  if (missing.length > 0) {
    cfg.hired_staff = [...missing, ...(cfg.hired_staff || [])];
  }
}

exports.handler = async function(event) {
  try { connectLambda(event); } catch (_) {}

  const auth = await validateRequest(event);
  if (!auth.ok) {
    return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized', reason: auth.reason }) };
  }

  // Owner preview ("view as"): the OWNER (Dr. O) may pass ?as=<client-email>
  // to view any provisioned client's studio from her own session, read only.
  // Gated to the owner email; for anyone else ?as is ignored. The returned
  // config is flagged preview:true so the page goes read-only and skips the
  // owner's own per-user blob (so her edits never bleed into the preview).
  const OWNER_PREVIEW_EMAIL = 'starbucks005@gmail.com';
  const realEmail = (auth.user.email || '').toLowerCase();
  const asParam = (event.queryStringParameters && (event.queryStringParameters.as || '')).toLowerCase().trim();
  const previewing = !!asParam && realEmail === OWNER_PREVIEW_EMAIL && asParam !== realEmail;

  // ── TENANCY IS DECIDED ONCE, HERE ────────────────────────────────────────
  // Every config returned by this endpoint carries is_owner. The page reads
  // that flag and nothing else. Before 2026-07-29 the browser decided tenancy
  // by string-matching the display name ("Dr. Terry Oroszi"), in several
  // separate places, which meant a buyer whose owner_name was merely absent or
  // different rendered down the owner branch, and the owner branch assumes
  // data buyers do not have. That is the defect class behind the recurring
  // "every time I log in I get errors" reports.
  //
  // Preview counts as NOT owner on purpose: when the landlord views a client
  // with ?as=, she should see exactly the buyer path, errors included. That is
  // the only way to exercise a buyer's studio without the buyer's password.
  const isOwnerSession = realEmail === OWNER_PREVIEW_EMAIL && !previewing;

  // Resolve the BASE config first (fixture > self-serve > default), then
  // overlay the per-user blob from studio-config-set ON TOP of it.
  //
  // Why the order changed (2026-06-13): the old code returned the per-user
  // blob INSTEAD of the base when it existed. The set endpoint writes only
  // the fields the user changed, so one PA swap would shadow a paying
  // client's whole fixture (billing, staff, recommendation) with a nearly
  // empty config. Merging means a seat swap changes the seat and nothing
  // else, for every config source.
  let baseCfg = null;

  // 1. Email-keyed provisioning fixture (the target email in preview mode)
  const email = previewing ? asParam : realEmail;
  const provMap = loadProvisioningMap();
  const fixtureFile = provMap[email];
  console.log('[studio-config-get] email=' + email + ' fixtureFile=' + fixtureFile + ' mapKeys=' + Object.keys(provMap).join(',') + ' __dirname=' + __dirname + ' cwd=' + process.cwd());
  if (fixtureFile) {
    const fixture = loadFixture(fixtureFile);
    console.log('[studio-config-get] fixture loaded=' + !!fixture);
    if (fixture) {
      const cfg = fixtureToStudioConfig(fixture, auth.user);
      if (cfg) {
        cfg.fixture_file = fixtureFile;
        baseCfg = cfg;
      }
    }
  }

  // Overlay helper: persisted user edits (PA seat, company name, settings)
  // win over the base, identity fields stay authoritative.
  const store = getStore('studio_config');
  const rosterIndex = loadRosterIndex();

  async function withUserOverlay(cfg) {
    try {
      const persisted = await store.get(auth.user.id, { type: 'json' });
      if (persisted && typeof persisted === 'object') {
        const merged = Object.assign({}, cfg, persisted, {
          user_id: auth.user.id,
          user_email: auth.user.email,
          source: (cfg.source || 'unknown') + '+user_edits',
        });
        // Provisioned fixture fields are canonical — the blob cannot override
        // them. A stale blob written before a fixture was set up would otherwise
        // shadow company_name, owner_name, and billing with defaults.
        //
        // pa is deliberately EXCLUDED from this list (fixed 2026-07-15): it
        // was here too, which meant every PA swap and every PA/Chief-of-Staff
        // title change silently reverted on the very next reload for any
        // fixture-backed account (Dr. O's own studio included — her fixture's
        // pa has no "label" at all, so Object.assign already merges the
        // persisted pa correctly on its own, same as this function's own
        // stated goal above: "a seat swap changes the seat and nothing else,
        // for every config source." This override was fighting that goal.
        if (cfg.source === 'fixture') {
          merged.company_name = cfg.company_name;
          merged.owner_name   = cfg.owner_name;
          merged.billing      = cfg.billing;
          merged.sponsorship  = cfg.sponsorship;
          merged.no_payment_ui = cfg.no_payment_ui;
        }
        // hired_staff: base/fixture staff always present; user-added staff
        // appended. Dedup by normalized id (staffKey), fall back to name —
        // raw id/name alone is not enough, see staffKey's comment.
        if (cfg.hired_staff && cfg.hired_staff.length > 0) {
          const baseKeys = new Set(cfg.hired_staff.map(staffKey));
          const userAdded = (persisted.hired_staff || []).filter(s => s && !baseKeys.has(staffKey(s)));
          merged.hired_staff = [...cfg.hired_staff, ...userAdded];
        }
        // Resolve every entry against the canonical roster so name/role/tier
        // stay current regardless of when the fixture or blob was written.
        merged.hired_staff = (merged.hired_staff || [])
          .map(s => resolveStaffEntry(s, rosterIndex))
          .filter(Boolean);
        injectOwnerStaff(merged, email);
        merged.is_owner = isOwnerSession;   // authoritative, never from the blob
        return merged;
      }
    } catch (_) {}
    // No persisted blob — still resolve base staff against roster.
    const noBlobResult = {
      ...cfg,
      hired_staff: (cfg.hired_staff || [])
        .map(s => resolveStaffEntry(s, rosterIndex))
        .filter(Boolean),
    };
    injectOwnerStaff(noBlobResult, email);
    noBlobResult.is_owner = isOwnerSession;
    return noBlobResult;
  }

  if (baseCfg) {
    if (previewing) {
      // Read-only owner preview: return the CLIENT's fixture as-is (resolved
      // against the roster), with NO owner-blob overlay and NO owner-staff
      // injection, so the page shows exactly the client's studio.
      baseCfg.preview = true;
      baseCfg.preview_as = email;
      baseCfg.source = (baseCfg.source || 'fixture') + '+preview';
      const resolved = {
        ...baseCfg,
        is_owner: false,   // previewing a client IS the buyer path, see above
        hired_staff: (baseCfg.hired_staff || []).map(s => resolveStaffEntry(s, rosterIndex)).filter(Boolean),
      };
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify(resolved),
      };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(await withUserOverlay(baseCfg)),
    };
  }

  // 3. Self-serve checkout provisioning (written by the stripe-provision
  //    webhook, keyed by email). First sign-in converts the purchase into
  //    a live config: paid, seats counted, six-pack on if bought.
  try {
    const pend = getStore('studio_config_pending');
    const p = await pend.get(email, { type: 'json' });
    if (p && p.paid) {
      const seats = p.seats || {};
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify(await withUserOverlay({
          user_id: auth.user.id,
          user_email: auth.user.email,
          company_name: 'Your Studio',
          owner_name: auth.user.email,
          pa: { persona_id: 'auggie_vidal', display_name: 'Auggie', label: 'Personal Assistant', backpack: true, voice_enabled: true },
          brief_beat: '',
          owner_site: null,
          plan: 'self_serve',
          sponsorship: { sponsored: false, in_kind: false },
          billing: {
            sponsored: false,
            paid: true,
            amount_due_monthly: p.amount_monthly || null,
            seats: seats,
            stripe_subscription: p.stripe_subscription || null,
          },
          no_payment_ui: true,
          sixpack_on: !!seats.six_pack,
          hired_staff: [],
          seats_to_assign: seats,
          first_login_show: ['welcome'],
          source: 'self_serve_checkout',
        })),
      };
    }
  } catch (_) {}

  // 4. Empty defaults
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(await withUserOverlay(defaultStudioConfig(auth.user))),
  };
};
