/* ─────────────────────────────────────────────────────────────────────────────
   studio-auggie-forms — reads Netlify Forms submissions across every ETL
   site under the connected Netlify account, tracks which submissions Auggie
   has already mentioned, and returns a summary Auggie can include in the
   morning brief or recite on demand.

   Two operation modes:

   GET  /studio-auggie-forms                — JWT-gated, for Studio UI.
        Returns { newCount, sinceIso, items: [{site, formName, fields,
        createdAt, summary}], digest: "human-readable line for Auggie" }.

   POST /studio-auggie-forms { action: 'mark_seen', cursor: iso }
        Sets the last-seen cursor so the NEXT GET only returns submissions
        after this point. Auggie calls this after he has surfaced a batch.

   Internal call (no auth, basic auth from background fn):
        POST /studio-auggie-forms { action: 'summary_for_brief' }
        Returns { newCount, digest } for the daily brief generator to embed
        in Auggie's monologue. Uses admin basic auth so the cron path works.

   Env required:
   - NETLIFY_API_TOKEN: personal access token from
     https://app.netlify.com/user/applications#personal-access-tokens
     Scope needed: read submissions across all sites under your team.
   - PRESS_ADMIN_USER, PRESS_ADMIN_PASS (already set): used by the brief
     background function to call this endpoint without a Supabase JWT.

   Cursor storage: blob store `auggie_forms_state` keyed `cursor`. Holds
   the ISO timestamp of the most recent submission Auggie has surfaced.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

async function validateJwt(event) {
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

function checkAdminBasic(event) {
  const expectedUser = process.env.PRESS_ADMIN_USER;
  const expectedPass = process.env.PRESS_ADMIN_PASS;
  if (!expectedUser || !expectedPass) return false;
  const header = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!header.toLowerCase().startsWith('basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const [u, p] = decoded.split(':');
  return u === expectedUser && p === expectedPass;
}

/* Netlify Forms API helpers. The personal access token belongs to the
   Netlify user who owns the team; one token covers every site under the
   account so we do not need per-site secrets. */
const NL_API = 'https://api.netlify.com/api/v1';

async function nlFetch(path) {
  const tok = process.env.NETLIFY_API_TOKEN;
  if (!tok) throw new Error('NETLIFY_API_TOKEN not set');
  const r = await fetch(NL_API + path, {
    headers: { 'Authorization': 'Bearer ' + tok, 'Accept': 'application/json' },
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Netlify API ${r.status} on ${path}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

/* Aggregate submissions across all forms across all sites in the account,
   then filter to anything created strictly after `sinceIso`. Returns a
   normalized list sorted newest-first. */
async function fetchAllSubmissionsSince(sinceIso) {
  // List sites for this account, paginated. 100 per page is the API max.
  const sites = await nlFetch('/sites?per_page=100');
  const allSubs = [];

  for (const site of sites) {
    let siteSubs = [];
    try {
      siteSubs = await nlFetch(`/sites/${site.id}/submissions?per_page=100`);
    } catch (e) {
      console.warn('[auggie-forms] site submissions fetch failed', site.id, e.message);
      continue;
    }
    for (const s of siteSubs) {
      const createdAt = s.created_at || s.createdAt;
      if (sinceIso && createdAt && createdAt <= sinceIso) continue;
      allSubs.push({
        site: site.name || site.url || site.id,
        siteId: site.id,
        formName: s.form_name || s.formName || 'unknown',
        createdAt: createdAt,
        // Submission fields. Netlify returns these under .data (object).
        fields: s.data || {},
        email: s.email || (s.data && (s.data.contact_email || s.data.email)) || '',
        name:  s.name  || (s.data && (s.data.contact_name  || s.data.name))  || '',
      });
    }
  }

  allSubs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return allSubs;
}

/* Build the one-line digest Auggie can paste into the morning brief.
   Examples:
     "Ms. Terry, three new forms overnight: 1 PA build inquiry from a
      hedge fund analyst, 1 custom-build inquiry mentioning Robinhood,
      1 contact form from Gandhi-King."
     "Ms. Terry, nothing in the inbox today, the kids stayed quiet."
   Keep it neutral and dense; Auggie can reword in his voice when he
   incorporates it. */
function buildDigest(items) {
  if (!items || items.length === 0) {
    return 'No new form submissions across the ETL sites since the last brief.';
  }
  const byForm = {};
  for (const s of items) {
    const key = s.formName + ' on ' + s.site;
    byForm[key] = (byForm[key] || 0) + 1;
  }
  const parts = Object.keys(byForm).map(k => `${byForm[k]} via ${k}`);
  return `${items.length} new form submission${items.length === 1 ? '' : 's'} across the ETL sites: ${parts.join('; ')}.`;
}

/* Build per-item summaries Auggie can read out in chat. Short enough to
   list without overwhelming, long enough to be actionable. */
function summarizeItem(item) {
  const fields = item.fields || {};
  const bits = [];
  if (item.name)  bits.push('from ' + item.name);
  if (item.email) bits.push('<' + item.email + '>');
  if (fields.contact_role) bits.push('role: ' + fields.contact_role);
  if (fields.what_you_want) bits.push('wants: ' + String(fields.what_you_want).slice(0, 140));
  if (fields.notes) bits.push('notes: ' + String(fields.notes).slice(0, 140));
  if (fields.domain_addons) bits.push('add-ons: ' + fields.domain_addons);
  if (fields.timeline) bits.push('timeline: ' + fields.timeline);
  if (fields.budget_signal) bits.push('budget: ' + fields.budget_signal);
  return bits.join(' · ');
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  try { connectLambda(event); } catch (_) {}
  const stateStore = getStore('auggie_forms_state');

  // POST mode (mark_seen or summary_for_brief)
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'invalid json' }) }; }

    const action = body.action || '';

    if (action === 'summary_for_brief') {
      // Internal use only (brief background fn). Basic auth.
      if (!checkAdminBasic(event)) {
        return { statusCode: 401, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'unauthorized' }) };
      }
      const cursor = await stateStore.get('cursor', { type: 'text' }).catch(() => null);
      let items = [];
      try { items = await fetchAllSubmissionsSince(cursor); }
      catch (e) {
        console.error('[auggie-forms] summary_for_brief failed', e.message);
        return { statusCode: 502, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: e.message }) };
      }
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newCount: items.length,
          sinceIso: cursor || null,
          digest: buildDigest(items),
          // Trimmed per-item view for the brief generator to weave into prose.
          items: items.slice(0, 10).map(it => ({
            site: it.site, formName: it.formName, createdAt: it.createdAt,
            name: it.name, email: it.email,
            summary: summarizeItem(it),
          })),
        }),
      };
    }

    if (action === 'mark_seen') {
      // JWT required for state mutations (Terry-only).
      const auth = await validateJwt(event);
      if (!auth.ok) {
        return { statusCode: 401, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'unauthorized', reason: auth.reason }) };
      }
      const cursor = (body.cursor || new Date().toISOString()).trim();
      await stateStore.set('cursor', cursor, { metadata: { contentType: 'text/plain' } });
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, cursor: cursor }),
      };
    }

    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'unknown action' }) };
  }

  // GET mode (Studio UI; JWT-gated)
  if (event.httpMethod === 'GET') {
    const auth = await validateJwt(event);
    if (!auth.ok) {
      return { statusCode: 401, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'unauthorized', reason: auth.reason }) };
    }
    const cursor = await stateStore.get('cursor', { type: 'text' }).catch(() => null);
    let items = [];
    try { items = await fetchAllSubmissionsSince(cursor); }
    catch (e) {
      return { statusCode: 502, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: e.message }) };
    }
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        newCount: items.length,
        sinceIso: cursor || null,
        digest: buildDigest(items),
        items: items.map(it => ({
          site: it.site, formName: it.formName, createdAt: it.createdAt,
          name: it.name, email: it.email,
          fields: it.fields, summary: summarizeItem(it),
        })),
      }),
    };
  }

  return { statusCode: 405, headers: CORS, body: 'method not allowed' };
};
