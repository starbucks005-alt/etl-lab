const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

/* Reads two tables and merges them into one recognition roll:
   etl_credits    = Lab Members (auth accounts)
   etl_supporters = one-time donors and anyone without an account

   Required Supabase SQL (run once in SQL editor):
   CREATE TABLE etl_supporters (
     id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     display_name  text NOT NULL,
     kind          text NOT NULL DEFAULT 'donor',
     opt_in_public boolean NOT NULL DEFAULT false,
     created_at    timestamptz DEFAULT now()
   );
   ALTER TABLE etl_supporters ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "public read opted-in supporters" ON etl_supporters
     FOR SELECT USING (opt_in_public = true);
*/

async function fetchRows(path) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
    });
    if (!r.ok) return [];
    const rows = await r.json();
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'method_not_allowed' }) };

  const [members, supporters] = await Promise.all([
    fetchRows('etl_credits?opt_in_public=eq.true&select=display_name,created_at'),
    fetchRows('etl_supporters?opt_in_public=eq.true&select=display_name,created_at'),
  ]);

  const merged = members.concat(supporters)
    .map(row => ({ name: (row.display_name || '').trim(), at: row.created_at || '' }))
    .filter(row => row.name)
    .sort((a, b) => a.at.localeCompare(b.at));

  const names = [...new Set(merged.map(row => row.name))];
  return { statusCode: 200, headers, body: JSON.stringify({ names }) };
};
