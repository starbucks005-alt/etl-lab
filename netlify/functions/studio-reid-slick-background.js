/* ─────────────────────────────────────────────────────────────────────────────
   studio-reid-slick-background

   Reid Callum's Tailored Marketing Slick generator. Give Reid a name (a person
   or company) plus an optional brief; he researches and verifies them with his
   web-search backpack, pulls their real goals and pains, maps each to specific
   ETL crew, fills CCW's locked slick template, and stores a finished,
   self-contained HTML one-pager. The PA hands the owner the link; the recipient
   prints it to PDF from the page.

   Owner of the capability: Reid (copy + assembly). Yuki owns the visual system
   (the template). The brand, moat, pricing, and MPI footer are baked into the
   template; Reid fills only the content tokens, so every slick stays on brand.

   POST body: { job_id, recipient, brief? }
   Auth: Supabase JWT.
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { VOICE_LAW_PROSE, houseTypography } = require('./_etl-voice-law.js');
const { getStore, connectLambda } = require('@netlify/blobs');
const fs = require('fs');
const path = require('path');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4500;
const MAX_WEB_SEARCHES = 6;
const MAX_TURNS = 6;

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

// The bench Reid maps needs to. He names real crew in each value row, the way
// the SJA and Heidi slicks do. Keep lanes accurate so the mapping lands.
const CREW_REFERENCE = `The ETL bench (map each need to the right people by name):
- Auggie Vidal: Personal Assistant / Chief of Staff (runs the week, relays the team).
- Reid Callum: Marketing Expert (campaigns, positioning, messaging, competitor intel).
- Jax Rivera: SEO and Discovery (getting found in search).
- Jess Ramirez: Publicist (press, launches, announcements).
- Delia Marsh: Development and Sponsorships (sponsor and funder pipeline, the ask).
- Ayanna Cole: Communications (outreach, announcements, member/community comms).
- Benjamin Reed: CISO (security posture, InfraGard, regulated-buyer trust).
- Grey Hollis: Ghostwriter (drafts in the owner's voice).
- Eli Adler: Fact-Checker (verifies every claim before it ships).
- Yuki Mendel: Brand Designer (visual identity, the look).
- Leo Vance: Bookkeeper / Financial Operations (the money, monthly P&L).
- Rowan Tate: Quant Strategist (markets, disciplined investing; C-Suite).
- Kimberly Pass: Legal Researcher. Alicia James: LLC formation. Sasha Moreno: People Ops/HR.
- "Research and Methodology" and the ETL Newswire desk for sourced reporting and content.`;

const TIER_REFERENCE = `Pricing tiers (show ONLY the ones that fit the recipient; do not list all):
- PA + Studio: $199/mo (just your assistant; the floor).
- The Company: about $500/mo (PA, the essential six-pack, and your core specialists).
- Executive: $1,499/mo (the full bench, industry specialists, integrations, concierge onboarding, weekly review).
A la carte add-ons if relevant: Standard $49, MCP backpack $69, C-Suite $89, C-Suite backpack $119, Premium (Ms. Ivy) $549.`;

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

function loadTemplate() {
  const candidates = [
    path.join(__dirname, '..', '..', 'data', 'founder-studio-slick-template.html'),
    path.join(process.cwd(), 'data', 'founder-studio-slick-template.html'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8'); } catch (_) {}
  }
  return null;
}
async function loadTemplateHttp(event) {
  const base = process.env.URL
            || ((event && event.headers && (event.headers.host || event.headers.Host))
                ? 'https://' + (event.headers.host || event.headers.Host) : '');
  if (!base) return null;
  try {
    const r = await fetch(base + '/data/founder-studio-slick-template.html', { cache: 'no-store' });
    if (r.ok) return await r.text();
  } catch (_) {}
  return null;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// Reid's content allows a small whitelist of inline tags (<em>, <b>). Keep those,
// escape everything else, and strip em dashes per brand rules.
function inlineHtml(s) {
  let t = houseTypography(s);
  // escape all, then re-open the whitelisted tags
  t = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  t = t.replace(/&lt;(\/?)(em|b)&gt;/gi, '<$1$2>');
  return t;
}

function slugify(name) {
  return String(name || 'recipient').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'recipient';
}

function buildValueRows(rows) {
  return (rows || []).slice(0, 3).map((r, i) => {
    // The crew line renders only when there is a crew. Selling a staffed studio
    // it is the whole point; advertising a medical practice or a product page
    // there is nobody to name, and a bare "Your crew:" label reads as a defect.
    const crew = r.crew && String(r.crew).trim()
      ? '<div class="crew">Your crew: ' + inlineHtml(r.crew) + '</div>'
      : '';
    return '<div class="row"><div class="num">' + (i + 1) + '</div><div>'
      + '<h3>' + inlineHtml(r.title) + '</h3>'
      + '<p>' + inlineHtml(r.body_html) + '</p>'
      + crew
      + '</div></div>';
  }).join('\n');
}

/* Branding is per-slick and NEVER falls back to the landlord's own.
   Before 2026-07-30 the template hardcoded "FOUNDER STUDIO", "A Mission
   Possible Institute company" and a footer naming Mission Possible Institute
   LLC, so a buyer advertising their own business handed their prospect a sheet
   branded as someone else's company, with someone else's legal entity on it.
   Blank now means the element is omitted. An unbranded sheet is fine; a sheet
   branded as the wrong company is not. */
function buildBrandBlock(b) {
  const name = String(b.brand_name || '').trim();
  const tagline = String(b.brand_tagline || '').trim();
  if (!name && !tagline) return '';
  return '<div class="brand">'
    + (name ? '<div class="wm">' + esc(name) + '</div>' : '')
    + (tagline ? '<div class="sub">' + esc(tagline) + '</div>' : '')
    + '</div>';
}

function buildFooterBlock(b) {
  const parts = [];
  const site = String(b.brand_site || '').trim();
  const legal = String(b.brand_footer || '').trim();
  if (site) parts.push('Visit <b>' + esc(site) + '</b>');
  if (legal) parts.push(esc(legal));
  if (!parts.length) return '';
  return '<div class="foot">' + parts.join(' &nbsp;&middot;&nbsp; ') + '</div>';
}

/* Pricing is the owner's to state, never Reid's to infer: an agent inventing a
   price on a sheet handed to a prospect is the worst failure this document can
   have. No tiers supplied means the whole block, heading and blurb included,
   does not render. */
function buildPricingBlock(t) {
  const tiers = buildTiers(t.tiers);
  if (!tiers) return '';
  const heading = String(t.pricing_heading || '').trim();
  const blurb = String(t.pricing_blurb || '').trim();
  return '<div class="price">'
    + (heading ? '<h2>' + esc(heading) + '</h2>' : '')
    + (blurb ? '<p>' + inlineHtml(blurb) + '</p>' : '')
    + '<div class="tiers">' + tiers + '</div>'
    + '</div>';
}
function buildTiers(tiers) {
  return (tiers || []).slice(0, 4).map(t => {
    return '<div class="tier' + (t.best ? ' best' : '') + '">'
      + '<div class="nm">' + esc(t.name) + '</div>'
      + '<div class="amt">' + esc(t.amount) + '<span> ' + esc(t.unit || '/mo') + '</span></div>'
      + '<div class="d">' + inlineHtml(t.desc) + '</div>'
      + '</div>';
  }).join('\n');
}

/* The moat section used to hardcode "Why this is not just another tool" / "It is
   a real team, and it has your back", plus a default body about your staff
   having banter and rivalries. All of that is true of a staffed studio and
   nonsense on a sheet advertising a medical practice, so the copy now comes
   from Reid and the block is omitted when there is no body. */
function buildMoatBlock(t) {
  const body = String(t.moat_body || '').trim();
  if (!body) return '';
  const eyebrow = String(t.moat_eyebrow || '').trim();
  const heading = String(t.moat_heading || '').trim();
  return '<div class="moat">'
    + (eyebrow ? '<div class="eyebrow">' + esc(eyebrow) + '</div>' : '')
    + (heading ? '<h2>' + esc(heading) + '</h2>' : '')
    + '<p>' + inlineHtml(body) + '</p>'
    + '</div>';
}

function fillTemplate(tpl, t, brand) {
  brand = brand || {};
  const docTitle = String(brand.brand_name || '').trim()
    ? String(brand.brand_name).trim() + ' - one-pager'
    : 'One-pager';
  return tpl
    .replace(/\{\{DOC_TITLE\}\}/g, esc(docTitle))
    .replace(/\{\{BRAND_BLOCK\}\}/g, buildBrandBlock(brand))
    .replace(/\{\{FOOTER_BLOCK\}\}/g, buildFooterBlock(brand))
    .replace(/\{\{AUDIENCE_LINE\}\}/g, esc(t.audience_line))
    .replace(/\{\{HEADLINE_HTML\}\}/g, inlineHtml(t.headline_html))
    .replace(/\{\{LEDE_HTML\}\}/g, inlineHtml(t.lede_html))
    .replace(/\{\{VALUE_ROWS\}\}/g, buildValueRows(t.value_rows))
    .replace(/\{\{MOAT_BLOCK\}\}/g, buildMoatBlock(t))
    .replace(/\{\{PRICING_BLOCK\}\}/g, buildPricingBlock(t))
    .replace(/\{\{CTA_LINE_HTML\}\}/g, inlineHtml(t.cta_line_html))
    .replace(/\{\{CTA_BUTTON\}\}/g, esc(t.cta_button || 'Get in touch'));
}

// Inject a small print-to-PDF bar above the sheet (screen only; hidden in print).
function withPrintBar(html) {
  const bar = '<div style="max-width:840px;margin:0 auto 14px;text-align:right" class="noprint">'
    + '<button onclick="window.print()" style="font-family:Inter,system-ui,sans-serif;font-size:13px;font-weight:600;'
    + 'background:#1c1a17;color:#fff;border:0;border-radius:8px;padding:10px 18px;cursor:pointer">Download PDF</button></div>'
    + '<style>@media print{.noprint{display:none!important}}</style>';
  return html.replace(/<body>/i, '<body>\n' + bar);
}

function parseTokens(text) {
  if (!text) return null;
  // Prefer a fenced json block, else the first balanced object.
  let m = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let raw = m ? m[1] : null;
  if (!raw) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) raw = text.slice(start, end + 1);
  }
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

/* The system prompt is built per run (2026-07-30). It used to open "You are Reid
   Callum, the Marketing Expert on the ETL Founders Studio bench" and carried a
   hardcoded ETL crew roster and ETL price list, with no input for whose product
   was being sold. Reid could therefore only ever advertise Founder Studio: a
   buyer asking for a sheet about their own services got a pitch for the
   landlord's product instead. WHAT is being advertised is now an input like
   WHO it is for. */
function buildSlickSystem(opts) {
  const subjectUrl = String(opts.subjectUrl || '').trim();
  const crewRef = String(opts.crewReference || '').trim();
  const tiersSupplied = !!opts.tiersSupplied;

  const subjectStep = subjectUrl
    ? `1. Research the ADVERTISED SITE with web search: ${subjectUrl}. Learn what it actually sells, who it serves, and how it describes itself. Everything you write is selling THIS, in ITS voice. Never substitute another company's offering.`
    : `1. The advertised offering is described in the brief below. Sell that, and nothing else.`;

  return `You are Reid Callum, a marketing expert. You are generating a TAILORED MARKETING SLICK: a one-page sell sheet advertising one specific offering to one specific recipient, the way a great development director would tailor a pitch.

Your job:
${subjectStep}
2. Research and VERIFY the recipient with web search. Find their real work, role, goals, and pains. Use only what you can verify. Never invent a quote or a fact. If you cannot verify something, leave it out.
3. Pull their two or three real goals or pains, and map each to what the advertised offering actually does about it.
4. Pick a headline from THEIR situation, not a stock line.

${crewRef
  ? crewRef + `\nWhen a need maps to specific named people above, name them in that row's "crew". If a row has no obvious person, leave "crew" as an empty string.`
  : `There is no named team to reference for this offering. Leave every "crew" field as an empty string.`}

${tiersSupplied
  ? `Pricing has been supplied by the owner and is passed through verbatim. Do not restate, adjust, or invent prices anywhere in your copy. You may write a short heading and one-line intro for the pricing section.`
  : `NO pricing has been supplied. Return "tiers" as an empty array and do not mention prices, rates, or costs anywhere in your copy. Never infer a price from the site you researched.`}

Brand rules (do not break): honest claims only, no invented quotes, no em dashes (use commas, periods, semicolons). On sensitive subjects (grief, conflict, illness), lead with gravity and respect, never salesy.

OUTPUT: When your research is done, output ONLY a single JSON object, nothing before or after it, with exactly these keys:
{
  "audience_line": "short eyebrow, e.g. 'Prepared for Jane Doe' or 'For Primary Care Physicians in Dayton, Ohio'",
  "headline_html": "the headline; wrap the gold phrase in <em>...</em>",
  "lede_html": "1 to 3 sentences; you may use <b>...</b>",
  "value_rows": [ { "title": "row title", "body_html": "the need and how the offering solves it, with a <b>bold hook</b>", "crew": "Name (role) and Name, the specific people, or an empty string" } ],
  "moat_eyebrow": "short label above the differentiator, or empty string",
  "moat_heading": "the differentiator headline, or empty string",
  "moat_body": "why this offering is hard to copy; empty string to omit the section entirely",
  "pricing_heading": "heading for the pricing block, or empty string",
  "pricing_blurb": "one line above the prices, or empty string",
  "cta_line_html": "closing line; you may use <em>...</em>",
  "cta_button": "button label, e.g. 'Get in touch' or 'Book a consult'"
}
Provide 2 or 3 value_rows. Output the JSON and nothing else.`;
}

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
  const recipient = String(body.recipient || '').trim();
  // WHAT is being advertised, and whose branding goes on the sheet. All
  // optional, all supplied by the caller, none defaulting to the landlord's.
  const subjectUrl = String(body.subject_url || '').trim();
  const brand = {
    brand_name: String(body.brand_name || '').trim(),
    brand_tagline: String(body.brand_tagline || '').trim(),
    brand_footer: String(body.brand_footer || '').trim(),
    brand_site: String(body.brand_site || '').trim(),
  };
  // Prices are passed through verbatim from the owner. Reid never sets them.
  const ownerTiers = Array.isArray(body.tiers)
    ? body.tiers.filter(t => t && (t.name || t.amount)).slice(0, 4)
    : [];
  if (!jobId)     return { statusCode: 400, body: JSON.stringify({ error: 'job_id_required' }) };
  if (!recipient) return { statusCode: 400, body: JSON.stringify({ error: 'recipient_required' }) };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: 'no_api_key' }) };

  const jobs = getStore('studio_jobs');
  const jobKey = 'reid-slick/' + jobId;
  await jobs.setJSON(jobKey, {
    job_id: jobId, agent: 'Reid Callum', role: 'Slick Generator',
    recipient, status: 'running', created_at: new Date().toISOString(), owner_id: auth.user.id,
  });

  const tpl = loadTemplate() || await loadTemplateHttp(event);
  if (!tpl) {
    await jobs.setJSON(jobKey, { job_id: jobId, status: 'error', error: 'template_not_found', finished_at: new Date().toISOString() });
    return { statusCode: 500, body: JSON.stringify({ error: 'template_not_found' }) };
  }

  const briefBlock = body.brief && typeof body.brief === 'object'
    ? '\n\nBrief from the owner (use verbatim where useful):\n' + JSON.stringify(body.brief).slice(0, 2000)
    : (body.brief ? '\n\nBrief from the owner:\n' + String(body.brief).slice(0, 2000) : '');
  // The crew comes from the caller (the buyer's own hired staff), not from a
  // hardcoded ETL roster. That is what stopped a buyer's sheet naming Auggie as
  // their assistant when their assistant is someone else entirely.
  const crewReference = String(body.crew_reference || '').trim();
  const slickSystem = buildSlickSystem({
    subjectUrl,
    crewReference,
    tiersSupplied: ownerTiers.length > 0,
  });

  const subjectLine = subjectUrl
    ? 'You are advertising what is sold at: ' + subjectUrl + '\n\n'
    : '';
  const userMsg = subjectLine
    + 'Generate a tailored marketing slick for this recipient: ' + recipient
    + briefBlock + '\n\nResearch first, then output only the JSON.';

  const client = new Anthropic({ apiKey });
  const tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_WEB_SEARCHES }];
  const messages = [{ role: 'user', content: userMsg }];

  try {
    let finalText = '';
    let totalTokens = 0;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.messages.create({
        model: MODEL, max_tokens: MAX_TOKENS, system: slickSystem + VOICE_LAW_PROSE, tools, messages,
      });
      totalTokens += (response.usage && (response.usage.output_tokens + response.usage.input_tokens)) || 0;
      const turnText = (response.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      if (turnText) finalText = turnText;

      // pause_turn: the SERVER-SIDE web_search loop hit its own iteration cap
      // mid-task. It is not completion. The old code treated it as completion
      // ("break when not searching"), so a recipient that needed more research
      // than the cap allowed returned truncated text, parseTokens failed, and
      // the run died in the silent no_valid_tokens branch below. It worked for
      // the owner and failed for a buyer purely because an unfamiliar recipient
      // needs more searches. Resume by re-sending with the assistant turn
      // appended and NO extra user message: the server picks up where it left
      // off, and injecting a "Continue." here derails that resumption.
      if (response.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content });
        continue;
      }

      if (response.stop_reason !== 'tool_use') break;
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: 'Continue. When done researching, output only the JSON object.' });
    }

    const tokens = parseTokens(finalText);
    if (!tokens || !tokens.headline_html) {
      // Logged (added 2026-07-30). This branch wrote the reason into the job
      // blob and returned 200 without a single log line, so in Netlify it looked
      // like a successful 28-43s run that simply produced no page. The length
      // and shape of what Reid actually returned is what tells you whether the
      // output was truncated, empty, or just malformed.
      console.error('[studio-reid-slick-background] no valid tokens.'
        + ' parsed=' + !!tokens
        + ' finalTextLen=' + (finalText ? finalText.length : 0)
        + ' totalTokens=' + totalTokens
        + ' head=' + JSON.stringify((finalText || '').slice(0, 200)));
      await jobs.setJSON(jobKey, { job_id: jobId, status: 'error', error: 'reid_returned_no_valid_tokens', finished_at: new Date().toISOString(), owner_id: auth.user.id });
      return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'no_valid_tokens' }) };
    }

    // Owner-supplied prices win outright; Reid's "tiers" are ignored so a
    // generated number can never reach a sheet handed to a prospect.
    tokens.tiers = ownerTiers;
    const filled = withPrintBar(fillTemplate(tpl, tokens, brand));
    const slug = slugify(recipient) + '-' + jobId.slice(-4);

    const slicks = getStore('studio_slicks');
    await slicks.setJSON(slug, {
      slug, recipient, html: filled, tokens,
      owner_id: auth.user.id, created_at: new Date().toISOString(),
    });

    await jobs.setJSON(jobKey, {
      job_id: jobId, agent: 'Reid Callum', role: 'Slick Generator', recipient,
      status: 'done', created_at: new Date(Date.now() - 1000).toISOString(), finished_at: new Date().toISOString(),
      slug, view_url: '/slick/' + slug, tokens_used: totalTokens || null, owner_id: auth.user.id,
    });

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, job_id: jobId, slug, view_url: '/slick/' + slug }) };
  } catch (err) {
    console.error('[studio-reid-slick-background] error', err && err.message);
    await jobs.setJSON(jobKey, { job_id: jobId, status: 'error', error: err && err.message, finished_at: new Date().toISOString() });
    return { statusCode: 500, body: JSON.stringify({ error: err && err.message }) };
  }
};
