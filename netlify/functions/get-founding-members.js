const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'method_not_allowed' }) };

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/etl_credits?opt_in_public=eq.true&select=display_name&order=created_at.asc`,
      { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } }
    );
    if (!r.ok) return { statusCode: 500, headers, body: JSON.stringify({ error: 'db_error' }) };
    const rows = await r.json();
    const names = rows.map(row => (row.display_name || '').trim()).filter(Boolean);
    return { statusCode: 200, headers, body: JSON.stringify({ names }) };
  } catch (_) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'server_error' }) };
  }
};
