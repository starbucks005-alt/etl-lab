/* ─────────────────────────────────────────────────────────────────────────────
   press-seed-background — backfill ETL Newswire archive with 22 weekly
   evergreen pieces per reporter, dated Jan 1 - May 28, 2026.

   Triggered from the press-admin "Seed historical archive" tab. ONE
   reporter per invocation (so each run stays under the 15-minute
   background-function ceiling). Admin clicks 8 buttons in sequence to
   populate the full archive.

   Each generated piece is EVERGREEN: analysis or feature-style content
   on the reporter's beat, written without claiming any specific
   recent-news event (since the dates are historical). This is what
   makes backdating safe.

   POST body : { reporter_id: string (required) }
   Response  : 202 immediately. Real work happens after return.

   Auth: HTTP Basic via PRESS_ADMIN_USER + PRESS_ADMIN_PASS env vars.

   This is a Netlify background function (the -background.js suffix);
   the function returns 202 to the caller immediately, then keeps
   running up to 15 minutes generating + writing pieces.
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1800;
const SITE_BASE = 'https://emerging-tech-lab.com';

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
    if (idx === -1) throw new Error();
    if (decoded.slice(0, idx) !== user || decoded.slice(idx + 1) !== pass) {
      return { ok: false, response: { statusCode: 401, headers: { 'WWW-Authenticate': 'Basic realm="ETL Press Admin"' }, body: 'invalid credentials' } };
    }
  } catch {
    return { ok: false, response: { statusCode: 401, headers: { 'WWW-Authenticate': 'Basic realm="ETL Press Admin"' }, body: 'invalid auth' } };
  }
  return { ok: true };
}

let REPORTERS_CACHE = null;
function loadReporter(id) {
  if (!REPORTERS_CACHE) {
    const data = require('../../config/newswire-reporters.json');
    REPORTERS_CACHE = (data.reporters || []).reduce((acc, r) => { acc[r.id] = r; return acc; }, {});
  }
  return REPORTERS_CACHE[id] || null;
}

function shortHash(s) {
  let h = 0; const str = String(s || Date.now());
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).slice(0, 4);
}

/* ──────────────────────────────────────────────────────────────────────────
   extractJSON — robust JSON extraction from a model response.

   Prior behavior used a greedy regex /\{[\s\S]*\}/ which would silently
   fail when the response had ANY brace in preamble or commentary. That
   was the root cause of the seed-stops-early bug (Sasha generated 1 of
   22 pieces) — most responses parsed fine, but the few with preamble
   brackets killed the whole iteration with no retry and no log.

   New approach:
     1. Strip markdown code fences (```json ... ``` and ``` ... ```)
     2. Try direct JSON.parse of the cleaned string
     3. If that fails, balance-brace from the first { to its matching }
        accounting for strings and escapes
     4. Return null on total failure so the caller can retry or log
   ────────────────────────────────────────────────────────────────────── */
function extractJSON(text) {
  if (!text || typeof text !== 'string') return null;
  // Strip markdown fences.
  let s = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  // Try direct parse.
  try { return JSON.parse(s); } catch (_) {}
  // Balance-brace extraction.
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === '\\' && inString) { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)); } catch (_) { return null; }
      }
    }
  }
  return null;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function slugify(s, seed) {
  const base = String(s || '')
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || ('piece-' + seed);
  return base;
}

// 22 weekly dates: Wednesdays from 2026-01-07 through 2026-05-27 + a final
// 2026-05-28 closer. Wednesdays are when wire desks tend to file flagship
// pieces, so dating evergreens to Wednesdays reads natural.
function weeklyDates() {
  const out = [];
  let d = new Date('2026-01-07T13:00:00Z'); // first Wednesday of 2026
  const end = new Date('2026-05-28T13:00:00Z');
  while (d <= end) {
    out.push(new Date(d).toISOString());
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

function buildSystemPrompt(reporter) {
  return `You are ${reporter.name}, ${reporter.desk_label} desk reporter for ETL Newswire.

YOUR BEAT
  ${reporter.beat}

YOUR BACKGROUND
  ${reporter.bio}

YOUR VOICE
  ${reporter.voice_rider}

YOUR TASK
  You are writing an EVERGREEN analysis or feature piece for the archive. The piece must NOT claim any specific recent news event, because the publication date is historical and we cannot retroactively report on real events. Frame the piece as analysis, feature, primer, or explainer.

  Acceptable framings:
  - "What [pattern] tells us about [your beat]"
  - "An anatomy of [structural feature of your beat]"
  - "Why [conventional wisdom on your beat] is incomplete"
  - "A primer on [topic readers in your beat should understand]"
  - "Field notes from [recurring scenario in your beat]"

  UNacceptable framings:
  - "Yesterday X announced Y" (fake recent event)
  - "This week's [thing]" (fake recency)
  - Any claim that a specific person said a specific thing on a specific date

LENGTH
  450-650 words.

OUTPUT FORMAT (JSON only, nothing before or after):
  {
    "title": "<headline, 8-200 chars, analysis-shaped not breaking-news-shaped>",
    "dek": "<one-sentence subtitle under 300 chars>",
    "body": "<450-650 word piece in your voice, paragraphs separated by blank lines, plain text>"
  }

RULES
  - No em dashes. Plain hyphens or restructure.
  - No marketing-cliche adjectives.
  - Anchor in real domain knowledge about your beat, but never claim a specific recent event.
  - Numbers should be ranges or characteristics, not specific dated claims.
  - You may reference well-known historical context (e.g. "the post-2008 reshaping of investment banking" is fine because it is structural, not breaking).`;
}

// Per-reporter topic seeds. The reporter chooses what to write, but the seeds
// keep 22 pieces from collapsing into the same topic.
const TOPIC_SEEDS_BY_DESK = {
  us: [
    'congressional oversight of federal agencies', 'state attorneys general as policy actors', 'the rise of state-level AI rules',
    'how the federal contracting cycle shapes startup outcomes', 'declining trust in institutions and what fills the gap',
    'the post-pandemic state of the federal workforce', 'red and blue divergence on tech policy', 'how local journalism collapse changed politics',
    'the politicization of inspector general reports', 'how the federal grant process actually works',
    'the changing role of the federal advisory committee', 'why some state ballot initiatives travel and others die',
    'the new generation of mayors who came up through tech', 'how the executive order has expanded as a policy tool',
    'the long tail of pandemic-era emergency authorizations', 'the federal data privacy bill that never quite passes',
    'why federal regulators struggle to hire technical staff', 'the role of think tanks in policy drafting',
    'the half-life of a presidential commission report', 'how cybersecurity and physical infrastructure policy converged',
    'the quiet rise of state-level industrial policy', 'what a real GAO audit looks like from the inside',
  ],
  world: [
    'the EU AI Act and how it actually gets enforced', 'why German industrial policy diverged from American', 'the new shape of US-India tech relations',
    'how the African Continental Free Trade Area is changing logistics', 'the long tail of the Ukraine war on energy markets',
    'why Singapore is the back office for so much Southeast Asian fintech', 'the Brazilian payments revolution and what it exports',
    'how Taiwan thinks about semiconductor sovereignty', 'the role of the Gulf as a venture capital corridor',
    'why the UK is rewriting its data protection regime', 'how Japan rebuilt its startup ecosystem in a decade',
    'the post-Brexit reality of cross-border financial services', 'the changing shape of multilateral institutions',
    'why Canada is overrepresented in AI research', 'the European energy transition and what it costs',
    'how diaspora capital flows shape emerging market tech', 'the Mexico nearshoring story past the hype',
    'how Indonesia handles its tech regulation differently than China or India', 'why the Nordic startup model travels and the Israeli one does not',
    'the unwritten rules of doing business in the Gulf', 'the long view on Sino-US technology decoupling',
    'how trade in services replaced trade in goods as the geopolitical story',
  ],
  business: [
    'why earnings calls increasingly look like product launches', 'the changing math of unit economics in subscription software',
    'how M&A advisors actually price an early-stage acquisition', 'why secondary markets reshaped startup compensation',
    'the long tail of zero interest rate policy on venture capital', 'how the activist investor playbook evolved',
    'why corporate development teams are the new venture funds', 'the structural shift in private equity exit horizons',
    'how working capital management became a moat', 'the rise of revenue-based financing',
    'why ESG reporting and ESG investing diverged', 'how the dual-class share structure shaped tech governance',
    'what a real CFO transition looks like at a Series D', 'why some down rounds save companies and others kill them',
    'how the SPAC era reshaped board composition', 'the quiet rise of family office direct investing',
    'how the LBO model adapted to higher-for-longer rates', 'the case against the rule of forty as a universal metric',
    'why churn is harder to measure than your dashboard says', 'how strategic versus financial buyers value the same company differently',
    'what enterprise sales discipline actually looks like', 'the math of customer acquisition cost when half your channel is dark',
  ],
  technology: [
    'why infrastructure costs are eating AI margins', 'the architectural difference between RAG and tool use',
    'what GPU shortage actually meant for product teams', 'why the dev-tools market keeps producing billion-dollar companies',
    'how product managers should think about AI evaluations', 'the case against benchmark obsession',
    'why edge inference matters more than people think', 'how vector databases changed the application stack',
    'the long shadow of the React monoculture', 'why platform fees became the venture math',
    'how observability became its own category', 'the architectural decisions that lock you in',
    'why some open source projects sustain and others collapse', 'the real economics of running your own model',
    'what fine-tuning is actually for in 2026', 'why latency is the AI product feature people undervalue',
    'how multi-agent systems break in production', 'the case for boring AI in regulated industries',
    'why the AI hardware market looks like the early cloud market', 'how copilots changed enterprise software pricing',
    'the unsung importance of evaluation harnesses', 'why model context length matters less than retrieval quality',
  ],
  security: [
    'why the BWC verification gap remains the bioweapons-control story no one writes about',
    'how dual-use research of concern actually gets reviewed in 2026',
    'the case for and against gain-of-function research moratoria',
    'why pandemic preparedness funding cycles undermine the work they fund',
    'how genomic surveillance changed outbreak detection at the public-health level',
    'the long shadow of the 2001 anthrax letters on US biosecurity policy',
    'why the next biothreat is more likely accidental than intentional',
    'how DIY biology communities self-regulate and where the gaps are',
    'the structural problem with the Select Agent Program',
    'why attribution claims travel further than the evidence behind them',
    'how zero-day disclosure economics actually work',
    'the case against the word sophisticated in incident reporting',
    'why the cyber insurance market keeps producing perverse incentives',
    'how ransomware groups rebrand and what that tells you about deterrence',
    'the long arc of the SBOM mandate and what changed at the vendor level',
    'why open-source intelligence rebuilt the war-reporting toolkit',
    'how the intelligence community transition to cloud reshaped analyst workflows',
    'the under-discussed problem of analytic confidence calibration',
    'why some intelligence failures repeat and others do not',
    'why water utility cybersecurity is a decade behind power utility cybersecurity',
    'the structural risk in single-source rare-earth supply chains',
    'how the chip-fabrication geography problem is also a national security problem',
  ],
  science: [
    'what a real preregistration looks like in a clinical trial', 'why effect sizes matter more than p-values',
    'how the replication crisis changed funding agency priorities', 'the case for and against the impact factor',
    'why preprints reshape the peer-review pipeline', 'how computational biology and lab biology actually collaborate',
    'the structural problem with graduate student labor', 'why some methodological advances travel across fields and most do not',
    'how machine learning entered drug discovery and what it has actually delivered', 'the case for null results journals',
    'why most clinical trial failures are predictable in retrospect', 'what a good systematic review reads like',
    'how AI for protein structure changed working biology', 'why the postdoc bottleneck reshapes who becomes a PI',
    'the slow renaissance of basic toxicology', 'how government scientific advisory committees actually work',
    'why some shared resources scale and most do not', 'the math of grant overhead and what it pays for',
    'how science journalism mis-translates effect sizes', 'why scientific consensus and policy consensus diverge',
    'what an actual conflict of interest disclosure should cover', 'the slow erosion of statistical literacy in clinical research',
  ],
  health: [
    'what value-based care actually changed at the clinic level', 'why prior authorization is a clinical problem not just an admin one',
    'the case against most direct-to-consumer health quizzes', 'how clinical guidelines actually update and why it takes years',
    'why nursing shortages reshape care quality faster than physician shortages', 'the long tail of the EHR transition',
    'why supplement marketing outpaces supplement evidence', 'how health systems consolidated and what changed for patients',
    'what real patient navigation looks like and why it works', 'the difference between screening and diagnosis people miss',
    'why mental health parity laws look great on paper', 'how telehealth scaled and what stuck after the pandemic',
    'why drug pricing reform never delivers as advertised', 'the case for the medical scribe',
    'how primary care is being unbundled', 'the unappreciated importance of pharmacy benefit managers',
    'why home health is the next consolidation wave', 'what a real prior auth appeal actually accomplishes',
    'the rise of the patient advocate as a profession', 'why specialty pharmacy is its own industry',
    'how community health workers stabilize chronic conditions', 'the slow professionalization of medical interpretation services',
  ],
  entertainment: [
    'why BookTok broke discovery and remade it', 'the streaming bundle is back and nobody noticed',
    'why mid-budget films keep dying and what replaces them', 'how the audiobook market quietly doubled',
    'the long tail of the writer strikes on prestige television', 'why theatrical windows matter less than people pretend',
    'how Substack changed the cultural critic economy', 'the unsung importance of the casting director',
    'why some genres travel internationally and most do not', 'the math of a debut novel advance in the current market',
    'how K-pop made the album release a multi-year campaign', 'why limited series rebalanced prestige television',
    'the slow death of the music magazine', 'why some indie bookstores expand and most contract',
    'how the comic book direct market kept the medium alive', 'the working life of a literary translator',
    'why book covers carry more weight than they used to', 'how reality television budgets actually break down',
    'why some festival circuits matter and most are vanity', 'the slow renaissance of the short story collection',
    'how publishing acquisitions actually happen', 'why the celebrity memoir is the most reliable trade publishing category',
  ],
  sports: [
    'how sports analytics escaped baseball', 'why NIL changed college recruiting more than people realize',
    'the long tail of betting legalization on broadcast culture', 'how women s soccer rebuilt its economic model',
    'why some franchises move and most threaten to', 'the slow professionalization of athlete representation',
    'how the broadcast rights cycle dictates league strategy', 'why the front office became the more interesting job than the bench',
    'how strength and conditioning became its own science', 'why the second contract is where careers turn',
    'how Formula 1 American expansion actually got built', 'the math of a stadium financing package',
    'how player tracking data changed coaching', 'why some farm systems develop talent and most cycle through it',
    'the working life of a scout in the age of analytics', 'how soccer s academy model differs from American development',
    'why some sports unions hold the line and others fracture', 'the rise of the sports-tech investor',
    'how youth sports privatized', 'why broadcast rules reshape gameplay as much as on-field rules',
    'the working economics of a pro athlete s longer post-career', 'how training camp got short and the season got long',
  ],
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });
  const auth = requireBasicAuth(event);
  if (!auth.ok) return auth.response;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured' });
  const publishToken = process.env.PRESS_PUBLISH_TOKEN;
  if (!publishToken) return json(500, { error: 'PRESS_PUBLISH_TOKEN required for backdating' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'invalid json' }); }

  const reporter = loadReporter(String(body.reporter_id || '').trim());
  if (!reporter) return json(400, { error: 'unknown reporter_id' });

  // Netlify routes -background functions asynchronously and returns 202 to
  // the caller automatically. We await the work inline so the lambda
  // container stays alive for the full duration (up to 15 minutes).
  try {
    const stats = await runSeed(reporter, apiKey, publishToken);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, reporter_id: reporter.id, complete: true, stats }) };
  } catch (err) {
    console.error('[press-seed-background] runSeed error', err && err.message);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: err && err.message }) };
  }
};

async function runSeed(reporter, apiKey, publishToken) {
  try { connectLambda({}); } catch (_) {}
  const client = new Anthropic({ apiKey });
  const dates = weeklyDates();
  const seeds = TOPIC_SEEDS_BY_DESK[reporter.desk] || [];
  // Shuffle deterministically by reporter so the same call produces the same
  // sequence of seeds and is idempotent against re-runs.
  const seedSeed = shortHash(reporter.id);
  const orderedSeeds = seeds.slice().sort((a, b) => shortHash(a + seedSeed).localeCompare(shortHash(b + seedSeed)));

  const piecesStore = getStore('press_pieces');
  const indexStore = getStore('press_index');

  // Per-iteration outcome counters. Returned to the caller and logged at
  // the end so the silent-fail mode that produced the original bug (most
  // iterations skipped, no telemetry) cannot recur unnoticed.
  const stats = {
    total: dates.length,
    generated: 0,         // wrote a piece successfully
    parse_failed: 0,      // model output couldn't be parsed even after retry
    parse_retried: 0,     // model output parsed only after a retry
    empty: 0,             // parsed but missing title/body
    blob_failed: 0,       // blob write threw
    anthropic_error: 0,   // model API call threw
  };

  for (let i = 0; i < dates.length; i++) {
    const published_at = dates[i];
    const topic = orderedSeeds[i % orderedSeeds.length] || '';

    // Step 1 — call the model with up to one retry on parse failure.
    let parsed = null;
    let lastRaw = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      let raw;
      try {
        const userMsg = attempt === 0
          ? `Write an evergreen piece for the archive. Topic seed: ${topic}. Date stamp will be ${new Date(published_at).toDateString()}. JSON only.`
          : `Your previous response was not valid JSON. Return ONLY the JSON object specified in the system prompt. NO markdown code fences. NO preamble. NO commentary after. The first character of your response must be { and the last must be }. Topic seed: ${topic}.`;
        const resp = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: buildSystemPrompt(reporter),
          messages: [{ role: 'user', content: userMsg }],
        });
        raw = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        lastRaw = raw;
      } catch (err) {
        console.error('[press-seed] anthropic error', reporter.id, i, 'attempt', attempt, '-', err && err.message);
        // On a hard API error, don't retry — the next iteration may succeed.
        break;
      }
      parsed = extractJSON(raw);
      if (parsed) {
        if (attempt > 0) stats.parse_retried++;
        break;
      }
    }

    if (!parsed) {
      // Either two anthropic_errors or two parse_faileds. Distinguish by
      // whether we got raw text back at all.
      if (lastRaw) {
        stats.parse_failed++;
        console.error('[press-seed] parse_failed', reporter.id, 'idx', i, 'topic', topic.slice(0, 60), 'raw:', lastRaw.slice(0, 200));
      } else {
        stats.anthropic_error++;
      }
      await sleep(300);
      continue;
    }

    // Step 2 — validate parsed content.
    const scrub = (s) => String(s || '').replace(/—/g, '-').replace(/–/g, '-');
    const title = scrub(parsed.title);
    const dek = scrub(parsed.dek);
    const body = scrub(parsed.body);
    if (!title || !body) {
      stats.empty++;
      console.error('[press-seed] empty title or body', reporter.id, 'idx', i, 'title_len', title.length, 'body_len', body.length);
      await sleep(300);
      continue;
    }

    // Step 3 — write to blob. Direct blob write (skipping press-publish so
    // we can backdate without a round trip).
    let slug = slugify(title, shortHash(reporter.id + published_at));
    try {
      const existing = await piecesStore.get(slug, { type: 'json' });
      if (existing) slug = slug + '-' + shortHash(reporter.id + i);
    } catch (_) {}

    const piece = {
      slug, title, dek, body,
      source_url: SITE_BASE + '/press',
      source_label: 'ETL Newswire',
      author: reporter.name,
      platform: 'newswire',
      desk: reporter.desk,
      byline_kind: 'reporter',
      reporter_id: reporter.id,
      published_at,
      hero_image_url: null,
    };
    try {
      await piecesStore.setJSON(slug, piece);
      // Insert into press_index 'order' in chronological position.
      let order = [];
      try { const arr = await indexStore.get('order', { type: 'json' }); if (Array.isArray(arr)) order = arr; } catch (_) {}
      const indexEntry = {
        slug, title, dek, platform: 'newswire', source_label: 'ETL Newswire',
        published_at, desk: reporter.desk, byline_kind: 'reporter', reporter_id: reporter.id,
      };
      let inserted = false;
      for (let j = 0; j < order.length; j++) {
        if (new Date(order[j].published_at) <= new Date(published_at)) {
          order.splice(j, 0, indexEntry); inserted = true; break;
        }
      }
      if (!inserted) order.push(indexEntry);
      await indexStore.setJSON('order', order.slice(0, 500));
      stats.generated++;
    } catch (err) {
      stats.blob_failed++;
      console.error('[press-seed] blob write failed', reporter.id, 'idx', i, '-', err && err.message);
    }

    // Pace requests so 22 sequential Anthropic calls don't tripwire a
    // burst rate limit on the API. 300 ms between iterations adds ~7
    // seconds of total wall-clock — negligible against the per-call
    // generation time and well inside the 15-min function ceiling.
    await sleep(300);
  }

  // Persist a per-reporter status record so admin can see results without
  // having to read function logs. Keyed by reporter so subsequent runs
  // overwrite the prior summary cleanly.
  try {
    const statusStore = getStore('press_seed_status');
    await statusStore.setJSON(reporter.id, {
      reporter_id: reporter.id,
      reporter_name: reporter.name,
      finished_at: new Date().toISOString(),
      stats,
    });
  } catch (err) {
    console.error('[press-seed] status write failed', reporter.id, err && err.message);
  }

  console.log('[press-seed] reporter complete', reporter.id, JSON.stringify(stats));
  return stats;
}
