/* ─────────────────────────────────────────────────────────────────────────────
   sherlock-case -- serves the public half of a case file to the casebook page.

   GET /.netlify/functions/sherlock-case            -> { cases: [summary, ...] }
   GET /.netlify/functions/sherlock-case?id=lambeth -> { case: {...} }

   The solution and the witnesses' system prompts never leave the server. A
   student who opens the network tab finds the brief, the scene, and the
   modern-standards section, which they were going to be shown anyway, and
   nothing that answers the case for them.

   No model call, so this stays fast and synchronous.
   ───────────────────────────────────────────────────────────────────────────── */

const { CASES, CASE_ORDER, publicCase } = require('./_sherlock-cases.js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (statusCode, body) => ({
  statusCode,
  headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'method not allowed' });

  const id = String((event.queryStringParameters || {}).id || '').trim().toLowerCase();

  if (!id) {
    return json(200, {
      ok: true,
      cases: CASE_ORDER.map((key) => {
        const c = CASES[key];
        return {
          id: c.id, number: c.number, title: c.title, subtitle: c.subtitle,
          date: c.date, difficulty: c.difficulty, teaches: c.teaches, hero: c.hero,
        };
      }),
    });
  }

  const found = publicCase(id);
  if (!found) return json(404, { error: `unknown case "${id}"` });
  return json(200, { ok: true, case: found });
};
