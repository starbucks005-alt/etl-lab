const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SECRET = 'gc-memtest-a7f3d91c';

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.key !== SECRET) return { statusCode: 403, body: 'no' };

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return { statusCode: 200, body: 'NO_SERVICE_KEY' };

  const agentKey = 'gc:temp-verify-test';
  const visitorId = 'temp-verify-visitor';
  const out = {};

  try {
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/etl_visitor_memories`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify([{ visitor_id: visitorId, agent_key: agentKey, memory: 'round-trip test memory' }]),
    });
    out.insert_status = insertRes.status;
    out.insert_ok = insertRes.ok;
    if (!insertRes.ok) out.insert_body = await insertRes.text();
  } catch (err) {
    out.insert_error = err.message;
  }

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/etl_visitor_memories?visitor_id=eq.${encodeURIComponent(visitorId)}&agent_key=eq.${encodeURIComponent(agentKey)}&select=memory&order=created_at.desc&limit=8`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    out.fetch_status = r.status;
    out.fetch_ok = r.ok;
    out.rows = r.ok ? await r.json() : await r.text();
  } catch (err) {
    out.fetch_error = err.message;
  }

  // Clean up the test row so it never lingers in real data.
  try {
    const delRes = await fetch(
      `${SUPABASE_URL}/rest/v1/etl_visitor_memories?visitor_id=eq.${encodeURIComponent(visitorId)}&agent_key=eq.${encodeURIComponent(agentKey)}`,
      { method: 'DELETE', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    out.cleanup_status = delRes.status;
  } catch (err) {
    out.cleanup_error = err.message;
  }

  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out, null, 2) };
};
