/* ─────────────────────────────────────────────────────────────────────────────
   studio-yuki-background

   Yuki Mendel's brand direction generator. Receives a brief and the owner's
   site URL, fetches the site for real visual context, then produces a
   structured design direction proposal in Yuki's voice.

   Output sections: Brand Snapshot, Typography Direction, Color Direction,
   Layout and Hierarchy, Recommended Next Steps.

   Stored in studio_jobs blob under yuki/<job_id> as plain text so the PA
   can surface it inline in the chat thread.

   POST body: { job_id, brief, owner_site?, owner_name?, owner_context?, user_id }
   Auth: Supabase JWT.
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { VOICE_LAW_PROSE } = require('./_etl-voice-law.js');
const { loadProductFacts } = require('./_etl-product-facts.js');
const { getStore, connectLambda } = require('@netlify/blobs');

const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 4096;
const MEMORY_MAX_TURNS = 16;

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

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

/* Fetch a site's HTML and strip it down to readable text for brand context.
   Caps at 8KB so we don't blow the context window. */
async function fetchSiteText(url) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ETL-Studio/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    let html = await r.text();
    // Strip scripts, styles, and SVG blobs before extracting text
    html = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<svg[\s\S]*?<\/svg>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    // Pull text nodes: preserve spacing between block elements
    const text = html
      .replace(/<\/(p|div|li|h[1-6]|section|article|header|footer|nav)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return text.slice(0, 8000);
  } catch (_) {
    return null;
  }
}

const YUKI_SYSTEM = `You are Yuki Mendel. Brand designer. Based in Portland; trained at RISD and then at a typographic studio in Tokyo. Half-Japanese, half-German, and the combination shows in your work: rigorous systems, quiet confidence, nothing decorative that does not earn its place.

You think in type first. Color is a system, not a mood board. Layout is hierarchy made visible. You do not illustrate (that is Chris's territory), but you design the container that everything else lives inside.

You are at your own studio in Portland. You work with the ETL bench as a collaborator, not an employee. When a brief comes to you, you read it, you look at what already exists, and you say what you actually see. You are not trying to please anyone. You are trying to make the thing right.

HOW YOU SPEAK:
- Spare. Considered. One sentence where three would do.
- You name specifics: actual typeface families, hex ranges, actual problems you observe.
- You do not hype. You assess.
- You do not use em dashes. Use a comma, a period, or a colon.
- Contractions are fine. You are not a cover letter.
- You ask one clarifying question at the end if something is genuinely unclear.

YOUR OUTPUT FORMAT for a design direction brief:
Produce five clearly labeled sections. No headers with # symbols, just the label in ALL CAPS followed by a colon, then a blank line, then the content.

BRAND SNAPSHOT:
What you actually observed about the current site or brand. Be honest. Name specific problems and specific strengths. Two to four sentences.

TYPOGRAPHY DIRECTION:
Your recommendation. Name a specific typeface family or pairing (real names: Inter, Freight Display, Neue Haas Grotesk, ABC Arizona, etc.). Say what it does for the brand and why. One or two typefaces only. No mood-board language.

COLOR DIRECTION:
A palette of three to five values. Name the role of each (primary, background, accent, warning, etc.). Give a descriptive anchor (e.g., "deep navy anchors authority") not just a hex. You can name an approximate hex or a color family.

LAYOUT AND HIERARCHY:
What is structurally wrong or right, and what needs to change. Specific: the hero, the navigation, the content rhythm, the whitespace. Two to four observations.

RECOMMENDED DELIVERABLES:
What you would actually produce from here. Concrete: "a type specimen sheet," "a revised logo lockup in two weights," "a one-page brand guide PDF." Three to five items. These are things you can actually do.

Write the brief as if you are sending it to the PA to relay to the owner. You are not in the room. The PA will read this out or paste it into the chat thread. Keep it tight. The owner can ask follow-up questions.`;

exports.handler = async function(event) {
  try { connectLambda(event); } catch (_) {}

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }
  const auth = await validateRequest(event);
  if (!auth.ok) {
    return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized', reason: auth.reason }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'bad_json' }) }; }

  const jobId = String(body.job_id || '').trim();
  const brief = String(body.brief || '').trim();
  if (!jobId || !brief) {
    return { statusCode: 400, body: JSON.stringify({ error: 'job_id_and_brief_required' }) };
  }

  const apiKey = process.env.FOUNDER_STUDIO_API_KEY;
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: 'no_api_key' }) };

  const jobs = getStore('studio_jobs');
  const jobKey = 'yuki/' + jobId;
  const userId = body.user_id || auth.user.id;

  await jobs.setJSON(jobKey, {
    job_id: jobId,
    agent: 'Yuki Mendel',
    status: 'running',
    owner_site: body.owner_site || null,
    user_id: userId,
    created_at: new Date().toISOString(),
  });

  try {
    // Fetch the owner's site for real context
    const ownerSite = body.owner_site || null;
    const siteText = ownerSite ? await fetchSiteText(ownerSite) : null;

    // Build the user message
    const parts = [];
    if (body.owner_name) parts.push('Owner: ' + body.owner_name);
    if (body.owner_context) parts.push('Context: ' + body.owner_context);
    if (ownerSite) parts.push('Site: ' + ownerSite);
    parts.push('Brief: ' + brief);
    if (siteText) {
      parts.push('\nSite content (stripped HTML, for your assessment):\n---\n' + siteText + '\n---');
    } else if (ownerSite) {
      parts.push('Note: site fetch returned no content. Work from the brief and context alone.');
    }

    const userMsg = parts.join('\n');

    const memory = getStore('studio_staff_memory');
    const memKey = 'yuki-mendel__' + userId;
    let history = [];
    try {
      const stored = await memory.get(memKey, { type: 'json' });
      if (Array.isArray(stored)) history = stored;
    } catch (_) {}

    const messages = history.slice(-MEMORY_MAX_TURNS * 2).concat([{ role: 'user', content: userMsg }]);
    const productFacts = loadProductFacts();

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [YUKI_SYSTEM, productFacts, VOICE_LAW_PROSE].filter(Boolean).join('\n\n'),
      messages,
    });

    const text = (response.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (!text) {
      await jobs.setJSON(jobKey, {
        job_id: jobId, status: 'error', error: 'empty_response',
        user_id: userId, finished_at: new Date().toISOString(),
      });
      return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'empty_response' }) };
    }

    try {
      const updatedHistory = history.concat([
        { role: 'user', content: userMsg },
        { role: 'assistant', content: text },
      ]).slice(-MEMORY_MAX_TURNS * 2);
      await memory.setJSON(memKey, updatedHistory);
    } catch (memErr) {
      console.error('[studio-yuki-background] memory save failed:', memErr && memErr.message);
    }

    await jobs.setJSON(jobKey, {
      job_id: jobId,
      agent: 'Yuki Mendel',
      status: 'done',
      text,
      owner_site: ownerSite,
      user_id: userId,
      created_at: new Date(Date.now() - 1000).toISOString(),
      finished_at: new Date().toISOString(),
    });

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, job_id: jobId }) };
  } catch (err) {
    console.error('[studio-yuki-background] error', err && err.message);
    await jobs.setJSON(jobKey, {
      job_id: jobId, status: 'error', error: err && err.message,
      user_id: userId, finished_at: new Date().toISOString(),
    });
    return { statusCode: 500, body: JSON.stringify({ error: err && err.message }) };
  }
};
