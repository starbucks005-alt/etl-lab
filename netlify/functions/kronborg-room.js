/* ─────────────────────────────────────────────────────────────────────────────
   kronborg-room -- thin, fast dispatcher for the Kronborg Table's group room.
   Validates the request, mints a job_id, fires kronborg-room-background
   (fire-and-forget) to do the actual multi-agent cascade, and returns
   immediately. kronborg-room-status.js is what the frontend polls.

   Free, ungated, self-contained, same as before -- this file just no longer
   does the slow work itself, since that's what was blowing past Netlify's
   synchronous function ceiling and causing the "table lost connection" error.

   POST {
     active_agents: string[]              -- 2+ keys from AGENTS
     transcript: [{speaker, name, content}]  -- shared room log so far
     message: string                       -- the visitor's new message
     visitor_name?: string
     visitor_id?: string
     agent_state?: { [agentKey]: { scales } }
   }
   Returns { ok: true, job_id, polling_endpoint }

   Env: ANTHROPIC_API_KEY (checked here so a misconfigured deploy fails fast,
   before ever spinning up a background job)
   ───────────────────────────────────────────────────────────────────────────── */

const { AGENTS } = require('./kronborg-chat.js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

const MAX_ROOM_AGENTS = 6;

function newJobId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return 'kr-' + stamp + '-' + Math.random().toString(36).slice(2, 6);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  if (!process.env.ANTHROPIC_API_KEY) return json(500, { error: 'ANTHROPIC_API_KEY not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'invalid json' }); }

  const activeAgents = Array.isArray(body.active_agents)
    ? [...new Set(body.active_agents.map((a) => String(a || '').trim().toLowerCase()))].filter((a) => AGENTS[a])
    : [];
  if (activeAgents.length < 2) return json(400, { error: 'need_at_least_two_agents' });
  if (activeAgents.length > MAX_ROOM_AGENTS) return json(400, { error: 'too_many_agents', max: MAX_ROOM_AGENTS });

  const message = String(body.message || '').trim();
  if (!message) return json(400, { error: 'message required' });

  const jobId = newJobId();

  const host = (event.headers && (event.headers.host || event.headers.Host)) || '';
  const proto = (event.headers && (event.headers['x-forwarded-proto'] || event.headers['X-Forwarded-Proto'])) || 'https';
  const base = process.env.URL || (host ? proto + '://' + host : '');
  if (!base) return json(500, { error: 'no_base_url' });

  const bgUrl = base + '/.netlify/functions/kronborg-room-background';
  try {
    fetch(bgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: jobId,
        active_agents: activeAgents,
        transcript: body.transcript,
        message: body.message,
        visitor_name: body.visitor_name,
        visitor_id: body.visitor_id,
        agent_state: body.agent_state,
      }),
      keepalive: true,
    }).catch((err) => console.error('[kronborg-room] background trigger failed:', err && err.message));
  } catch (err) {
    console.error('[kronborg-room] background trigger threw:', err && err.message);
  }

  return json(200, {
    ok: true,
    job_id: jobId,
    polling_endpoint: '/.netlify/functions/kronborg-room-status?job_id=' + jobId,
  });
};
