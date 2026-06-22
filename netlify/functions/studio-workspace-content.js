/* ─────────────────────────────────────────────────────────────────────────────
   studio-workspace-content

   Returns the REAL Studio workspace content (live activity, staff current
   tasks, recently-shipped log) ONLY when the request carries a valid Supabase
   JWT in the Authorization header.

   This is the server-side gate that replaces the earlier client-side-only
   auth (which left all workspace content readable via View Source).

   GET /.netlify/functions/studio-workspace-content
   Header: Authorization: Bearer <supabase_access_token>

   Returns: { activity, staff, shipped } if auth valid
   Returns: 401 if no token / invalid / expired

   Auth strategy: hits Supabase's /auth/v1/user endpoint with the user's
   token. Supabase validates the JWT (signature, expiration, project) and
   returns user info. We don't need to share or store the JWT secret —
   Supabase does the verification.
   ───────────────────────────────────────────────────────────────────────────── */

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
// Anon public key is safe to embed in client AND server code. Supabase
// designed it for public exposure. The actual security lives in RLS + the
// JWT validation performed by Supabase itself when this code calls /user.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

async function validateRequest(event) {
  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return { ok: false, reason: 'no_bearer' };
  }
  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false, reason: 'empty_token' };

  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
        'apikey': SUPABASE_ANON_KEY,
      },
    });
    if (!r.ok) return { ok: false, reason: 'supabase_rejected_' + r.status };
    const user = await r.json();
    if (!user || !user.id) return { ok: false, reason: 'no_user_in_response' };
    return { ok: true, user };
  } catch (e) {
    return { ok: false, reason: 'fetch_failed', error: e && e.message };
  }
}

/* Real workspace content. Lives here, behind JWT. Public HTML on studio.html
   only contains placeholders. This data is only ever served to authenticated
   requests. Edit this object to update what Terry sees when she signs in. */
const WORKSPACE = {
  activity: [
    {
      status: 'In flight',
      agent: 'Charles Monroe',
      task: 'Reviewing the latest CV revision for the UD application, foregrounding operator credentials at the top.',
      meta: 'Career Services · started 14 min ago',
    },
    {
      status: 'In flight',
      agent: 'Bea Vega',
      task: 'Line-editing chapter 3 of the next Greylander Press title. CMOS pass, parallel-bullet pass, date-format consistency.',
      meta: 'Greylander Press · started 38 min ago',
    },
    {
      status: 'In flight',
      agent: 'Ms. Ivy',
      task: 'Cross-referencing the workshops catalog against the civilian-SME platform concept. Looking for the natsec hooks that are not named yet.',
      meta: 'Gauntlet Helpers · started 1 hr ago',
    },
  ],
  staff: {
    'Charles Monroe':           'Reviewing and restructuring Dr. O\'s CV for the UD application.',
    'Beatriz "Bea" Vega':      'Line-editing the next Greylander Press manuscript. Voice preserved, mechanics fixed.',
    'Ms. Ivy':                  'Mapping Dr. O\'s catalog against the new civilian-SME concept.',
    'Jules':                    'Holding for the next manuscript handoff from Bea.',
    'Jess Ramirez':             'Drafting the launch piece for the workshops catalog when it goes live.',
    'Imani Brooks':             'Filing the ETL Newswire piece on the Studio launch.',
    'Reid Callum':              'Sharpening positioning for the civilian-SME platform before name lock.',
    'Wren Calloway':            'Watching for federal opportunities in dual-use civic engagement.',
    'Carol Haynes':             'Triaging new ideas before they reach Ms. Ivy.',
    'Ayanna Cole':              'Drafting cross-platform social posts for the Gandhi-King Center.',
    'Sneha Desai':              'Filing this week\'s dispatch from Porbandar.',
    'Arjun Mehta':              'Tracking deploys across the ETL platforms.',
  },
  shipped: [
    { when: 'Today · AM',    what: 'Studio security: workspace content moved behind server-side JWT validation. Static HTML is now placeholder-only.', by: 'Studio' },
    { when: 'Today · AM',    what: 'Social Posts wizard shipped to the Studio Command Center with Zara, Sneha, and Ayanna voices.', by: 'Studio' },
    { when: 'Yesterday',     what: 'OPSEC Gauntlet palette swap: federal classical (navy, parchment, burgundy, brass, taupe).', by: 'Studio' },
    { when: 'Yesterday',     what: 'Charles credential-evaluation prompt fixed so operator credentials are no longer dismissed as padding.', by: 'Charles' },
    { when: 'Yesterday',     what: 'Bea added to the Prep Room as the second coach. Charles repositions, Bea cleans up.', by: 'Bea' },
    { when: 'Yesterday',     what: 'Charles and Bea moved to background functions with Blobs polling. No more 26-second timeouts on long CVs.', by: 'Studio' },
    { when: 'This week',     what: 'Workshops catalog spec filed. Seven verticals, one brand, no live sessions.', by: 'Studio' },
  ],
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: 'method not allowed' };

  const auth = await validateRequest(event);
  if (!auth.ok) {
    return {
      statusCode: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'unauthorized', reason: auth.reason }),
    };
  }

  const isOwner = (auth.user.email || '').toLowerCase() === 'starbucks005@gmail.com';
  const payload = isOwner ? WORKSPACE : { activity: [], staff: {}, shipped: [] };

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
};
