const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

/* Public recognition roll for /join. Merges two tables:
   etl_credits    = Lab Members who opted in (legacy rows, keyed to auth users)
   etl_supporters = donors and members recorded by stripe-supporter-webhook

   Returns { names, anonymous } where anonymous counts supporters who chose
   not to be named. Anonymous rows never leave the database; only the count does.

   Required Supabase SQL (run once in SQL editor):
   CREATE TABLE IF NOT EXISTS etl_supporters (
     id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     display_name      text,
     real_name         text,
     email             text,
     kind              text NOT NULL DEFAULT 'donor',
     opt_in_public     boolean NOT NULL DEFAULT false,
     stripe_session_id text,
     created_at        timestamptz DEFAULT now()
   );
   CREATE UNIQUE INDEX IF NOT EXISTS etl_supporters_session_uidx
     ON etl_supporters (stripe_session_id);
   ALTER TABLE etl_supporters ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "public read opted-in supporters" ON etl_supporters
     FOR SELECT USING (opt_in_public = true);
*/

/* Try the service key first (sees anonymous rows), fall back to the anon key
   so a bad service key can never blank the public roll. */
async function fetchRows(path) {
  const keys = [process.env.SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON];
  for (const key of keys) {
    if (!key) continue;
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (!r.ok) continue;
      const rows = await r.json();
      if (Array.isArray(rows)) return rows;
    } catch (_) {}
  }
  return [];
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'method_not_allowed' }) };

  const [members, supporters] = await Promise.all([
    fetchRows('etl_credits?opt_in_public=eq.true&select=display_name&order=created_at.asc'),
    fetchRows('etl_supporters?select=display_name,opt_in_public&order=created_at.asc'),
  ]);

  const named = members
    .concat(supporters.filter(row => row.opt_in_public === true))
    .map(row => (row.display_name || '').trim())
    .filter(Boolean);

  const names = [...new Set(named)];
  const anonymous = supporters.filter(row => row.opt_in_public === false).length;

  return { statusCode: 200, headers, body: JSON.stringify({ names, anonymous }) };
};
