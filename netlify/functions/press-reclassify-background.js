/* ─────────────────────────────────────────────────────────────────────────────
   press-reclassify-background — re-tag every piece's desk based on the
   STORY's content, not the reporter who wrote it.

   Why this exists: an earlier version of newswire-write-background.js
   hardcoded `desk: reporter.desk` on every published piece. Combined with
   reporters drifting off their assigned beat during web_search, this
   produced pieces tagged "Technology" about Iran ceasefires, "Business"
   about Ebola, etc. The Deskline puzzle and desk-nav UI scored against
   these wrong tags. This function is a one-shot cleanup that walks every
   piece on the wire, asks Claude to classify the actual desk from the
   title + dek, and updates both the piece blob and the press_index entry.

   It also wipes the deskline_puzzles blob store, so the next /press/deskline
   request re-freezes the day's puzzle from corrected data.

   POST /.netlify/functions/press-reclassify-background
   Body: {}
   Auth: HTTP Basic via PRESS_ADMIN_USER + PRESS_ADMIN_PASS.

   Background function (15-min runtime ceiling). Sequential to avoid
   Anthropic burst limits. Each piece is a small classification call
   (title + dek in, single desk ID out) so total wall-clock at 33 pieces
   is roughly 60-90 seconds.
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');

const MODEL = 'claude-sonnet-4-6';

const VALID_DESKS = ['us', 'world', 'business', 'technology', 'security', 'science', 'health', 'entertainment', 'sports'];
const VALID_DESKS_SET = new Set(VALID_DESKS);

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function requireBasicAuth(event) {
  const user = process.env.PRESS_ADMIN_USER;
  const pass = process.env.PRESS_ADMIN_PASS;
  if (!user || !pass) return { ok: false, response: { statusCode: 503, body: 'admin disabled' } };
  const header = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!header.toLowerCase().startsWith('basic ')) {
    return { ok: false, response: { statusCode: 401, headers: { 'WWW-Authenticate': 'Basic realm="ETL Press Admin"' }, body: 'auth required' } };
  }
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
    const idx = decoded.indexOf(':');
    if (idx === -1) throw new Error('malformed');
    if (decoded.slice(0, idx) !== user || decoded.slice(idx + 1) !== pass) {
      return { ok: false, response: { statusCode: 401, headers: { 'WWW-Authenticate': 'Basic realm="ETL Press Admin"' }, body: 'invalid credentials' } };
    }
  } catch {
    return { ok: false, response: { statusCode: 401, headers: { 'WWW-Authenticate': 'Basic realm="ETL Press Admin"' }, body: 'invalid auth' } };
  }
  return { ok: true };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function classifyPrompt(title, dek) {
  return `Classify this headline into one of nine newsroom desks.

DESKS
  us            - US politics, federal government, state legislatures, US courts, US policy
  world         - foreign affairs, geopolitics, foreign elections, international conflict, diplomacy
  business      - corporate earnings, M&A, finance, banking, markets, private equity, VC, business strategy
  technology    - software, hardware, AI products, dev tools, infrastructure, semiconductors, tech industry
  security      - national security, biosecurity, cybersecurity, intelligence, defense, biothreats
  science       - basic research, peer-reviewed findings, lab discoveries, Nature/Science papers, clinical trial results, methodology, drug discovery science
  health        - clinical practice, public health policy, health systems, insurance, care delivery, pharmacy benefits, hospital operations
  entertainment - film, TV, music, publishing, books, theater, celebrity, the arts
  sports        - athletes, leagues, teams, sports business, college sports, training, broadcast rights

DISAMBIGUATION RULES (read these BEFORE picking)
  - Research findings, peer-reviewed papers, "study finds", "researchers find", "Nature paper", "clinical trial reports" => almost always SCIENCE, even when the topic is medical or biological. Science is about discovery; health is about delivery.
  - Pharma earnings, drug pricing as a market story, M&A in healthcare, health-system stock moves => BUSINESS.
  - Drug approval by FDA, public health rules, hospital staffing, insurance coverage decisions => HEALTH.
  - Disease outbreaks abroad (Ebola in Congo, dengue in Brazil) => WORLD if the news IS the foreign event; HEALTH if the news is the US public-health response.
  - Biosecurity, bioweapons, biothreat preparedness, pandemic preparedness as a national-security topic => SECURITY.
  - State legislatures, congressional bills, governors, federal agency moves => US, even if the topic touches another desk.
  - When a story touches multiple desks, pick the desk that the headline's MAIN VERB / MAIN NEWS belongs to. ("Court Blocks Facility" => the news is the court ruling; "Court" + the country determines whether it is US or WORLD.)

HEADLINE
  ${title}

SUBTITLE
  ${dek || '(none)'}

INSTRUCTIONS
  Return ONLY the single desk ID (lowercase, no quotes, no punctuation, no explanation). Examples:
  - "Iran Halts US Ceasefire Talks" => world
  - "Illinois House Punts on Bears Stadium Bill" => us
  - "GitHub Copilot Drops Flat Subscription Pricing" => technology
  - "Pfizer Q2 Earnings Beat on Vaccine Demand" => business
  - "FDA Approves New Alzheimer Drug for Early-Stage Patients" => health
  - "Cochrane Review Finds Anti-Amyloid Drugs Offer No Cognitive Benefit" => science (research synthesis)
  - "AI Scans of Chest Organ Predict Longevity, Nature Papers Find" => science (research finding in Nature)
  - "Kenya Court Blocks U.S. Ebola Quarantine Site" => world (Kenyan judiciary ruling)
  - "CDC Updates Quarantine Guidelines After Ebola Cases" => health (US public-health policy)
  - "Pentagon Names Biothreats a Top National-Security Priority" => security

Output:`;
}

async function classifyOne(client, title, dek) {
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 16,
    messages: [{ role: 'user', content: classifyPrompt(title, dek) }],
  });
  const raw = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim().toLowerCase().replace(/[^a-z]/g, '');
  return VALID_DESKS_SET.has(raw) ? raw : null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });
  const auth = requireBasicAuth(event);
  if (!auth.ok) return auth.response;

  const apiKey = process.env.ETL_NEWSWIRE_API_KEY;
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured' });

  try { connectLambda(event); } catch (err) {
    console.error('[press-reclassify] connectLambda failed', err && err.message);
    return json(500, { error: 'blobs connect failed' });
  }

  const piecesStore = getStore('press_pieces');
  const indexStore = getStore('press_index');

  let order = [];
  try {
    const arr = await indexStore.get('order', { type: 'json' });
    if (Array.isArray(arr)) order = arr;
  } catch (err) {
    return json(500, { error: 'index read failed', detail: err && err.message });
  }
  if (!order.length) return json(200, { ok: true, processed: 0, message: 'no pieces to reclassify' });

  const client = new Anthropic({ apiKey });

  const stats = {
    total: order.length,
    inspected: 0,
    unchanged: 0,
    updated: 0,
    classify_failed: 0,
    blob_write_failed: 0,
    changes: [],   // {slug, old_desk, new_desk, title}
  };

  for (let i = 0; i < order.length; i++) {
    const entry = order[i];
    if (!entry || !entry.slug || !entry.title) continue;
    stats.inspected++;

    let newDesk = null;
    try {
      newDesk = await classifyOne(client, entry.title, entry.dek || '');
    } catch (err) {
      stats.classify_failed++;
      console.error('[press-reclassify] classify error', entry.slug, err && err.message);
      await sleep(300);
      continue;
    }
    if (!newDesk) {
      stats.classify_failed++;
      console.error('[press-reclassify] classify returned no valid desk', entry.slug, entry.title.slice(0, 80));
      await sleep(300);
      continue;
    }

    const oldDesk = entry.desk || '';
    if (newDesk === oldDesk) {
      stats.unchanged++;
      await sleep(200);
      continue;
    }

    // Update the index entry.
    entry.desk = newDesk;

    // Update the piece blob.
    try {
      const piece = await piecesStore.get(entry.slug, { type: 'json' });
      if (piece) {
        piece.desk = newDesk;
        await piecesStore.setJSON(entry.slug, piece);
      }
    } catch (err) {
      stats.blob_write_failed++;
      console.error('[press-reclassify] piece blob write failed', entry.slug, err && err.message);
      // Don't fail the run — index update is the priority.
    }

    stats.updated++;
    stats.changes.push({ slug: entry.slug, old_desk: oldDesk, new_desk: newDesk, title: entry.title.slice(0, 100) });
    console.log('[press-reclassify] retag', entry.slug, oldDesk, '->', newDesk, '|', entry.title.slice(0, 80));
    await sleep(300);
  }

  // Write the updated index back in one shot.
  try {
    await indexStore.setJSON('order', order);
  } catch (err) {
    console.error('[press-reclassify] index write failed', err && err.message);
    return json(500, { ok: false, error: 'index write failed', stats });
  }

  // Invalidate any frozen Deskline puzzles so the next visitor re-freezes
  // from the corrected desk tags. We don't know which date keys exist, so
  // delete the most likely range (today plus the last 7 days, ET).
  try {
    const puzzleStore = getStore('deskline_puzzles');
    const today = new Date();
    for (let off = -7; off <= 1; off++) {
      const d = new Date(today.getTime() + off * 86400000);
      const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
      try { await puzzleStore.delete(key); } catch (_) {}
    }
    stats.deskline_invalidated = true;
  } catch (err) {
    console.error('[press-reclassify] deskline invalidation failed', err && err.message);
    stats.deskline_invalidated = false;
  }

  console.log('[press-reclassify] complete', JSON.stringify({ ...stats, changes: stats.changes.length + ' changes' }));
  return json(200, { ok: true, complete: true, stats });
};
