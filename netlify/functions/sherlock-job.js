/* ─────────────────────────────────────────────────────────────────────────────
   sherlock-job -- thin, fast dispatcher for the two slow operations in the
   "Solve It With Sherlock" classroom:

     kind: "room"     the multi-agent cascade at the Baker Street table
     kind: "verdict"  the case review of a student's submitted solution

   Both blow past Netlify's synchronous function ceiling on a bad day (the
   room because it chains several agent turns, the verdict because it is one
   long structured call), so both go through the dispatcher plus background
   worker plus poll pattern already proven on the Kronborg classroom and
   elsewhere on the ETL campus. This file validates, mints a job id, fires
   sherlock-job-background, and returns immediately.

   POST, kind "room" {
     kind: "room", case_id?, active_agents: string[], transcript: [...],
     message: string, visitor_name?, visitor_id?, agent_state?
   }
   POST, kind "verdict" {
     kind: "verdict", case_id, suspect: string, chain: string,
     inadmissible?: string
   }
   Returns { ok: true, job_id, polling_endpoint }

   Env: ANTHROPIC_API_KEY (checked here so a misconfigured deploy fails fast,
   before ever spinning up a background job)
   ───────────────────────────────────────────────────────────────────────────── */

const { AGENTS } = require('./sherlock-chat.js');
const { CASES } = require('./_sherlock-cases.js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

const MAX_ROOM_AGENTS = 6;

function newJobId(kind) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return 'sh-' + kind + '-' + stamp + '-' + Math.random().toString(36).slice(2, 6);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  if (!process.env.ETL_CLASSROOMS_API_KEY) return json(500, { error: 'ANTHROPIC_API_KEY not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'invalid json' }); }

  const kind = String(body.kind || 'room').trim().toLowerCase();
  if (kind !== 'room' && kind !== 'verdict') return json(400, { error: 'unknown kind' });

  const caseId = String(body.case_id || '').trim().toLowerCase() || null;
  if (caseId && !CASES[caseId]) return json(400, { error: `unknown case "${caseId}"` });

  const payload = { kind, case_id: caseId };

  if (kind === 'room') {
    const caseWitnesses = caseId ? Object.keys(CASES[caseId].witnesses) : [];
    const known = (a) => Boolean(AGENTS[a]) || caseWitnesses.includes(a);
    const activeAgents = Array.isArray(body.active_agents)
      ? [...new Set(body.active_agents.map((a) => String(a || '').trim().toLowerCase()))].filter(known)
      : [];
    if (activeAgents.length < 2) return json(400, { error: 'need_at_least_two_agents' });
    if (activeAgents.length > MAX_ROOM_AGENTS) return json(400, { error: 'too_many_agents', max: MAX_ROOM_AGENTS });

    const message = String(body.message || '').trim();
    if (!message) return json(400, { error: 'message required' });

    Object.assign(payload, {
      active_agents: activeAgents,
      transcript: body.transcript,
      message,
      visitor_name: body.visitor_name,
      visitor_id: body.visitor_id,
      agent_state: body.agent_state,
    });
  } else {
    if (!caseId) return json(400, { error: 'case_id required for a verdict' });
    const suspect = String(body.suspect || '').trim();
    const chain = String(body.chain || '').trim();
    if (!suspect) return json(400, { error: 'name_a_suspect' });
    if (chain.length < 40) return json(400, { error: 'chain_too_short' });
    Object.assign(payload, {
      suspect: suspect.slice(0, 300),
      chain: chain.slice(0, 6000),
      inadmissible: String(body.inadmissible || '').trim().slice(0, 4000),
    });
  }

  const jobId = newJobId(kind);
  payload.job_id = jobId;

  const host = (event.headers && (event.headers.host || event.headers.Host)) || '';
  const proto = (event.headers && (event.headers['x-forwarded-proto'] || event.headers['X-Forwarded-Proto'])) || 'https';
  const base = process.env.URL || (host ? proto + '://' + host : '');
  if (!base) return json(500, { error: 'no_base_url' });

  try {
    // Netlify Background Functions ack with an immediate 202 regardless of how
    // long the real work takes, so awaiting this is still fast. An un-awaited
    // fetch can be killed the instant this handler returns, which is what
    // silently dropped every request in the Kronborg build before that fix.
    await fetch(base + '/.netlify/functions/sherlock-job-background', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[sherlock-job] background trigger failed:', err && err.message);
  }

  return json(200, {
    ok: true,
    job_id: jobId,
    polling_endpoint: '/.netlify/functions/sherlock-job-status?job_id=' + jobId,
  });
};
