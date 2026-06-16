/* ─────────────────────────────────────────────────────────────────────────────
   heidi-background — Heidi Kingstone's correspondent and genocide/atrocity-
   prevention SME backpack. Authorized AI representation (with consent).

   Persona + system prompt from data/heidi-backpack-config.json
   (consultant_entry.system_prompt).

   Tools live today: web_search (built-in), plus four custom in-framework tools:
     prep_interview   — background brief + question set for a subject
     draft_feature    — wire-ready feature or profile scaffold
     fact_check       — verification pass on claims before filing
     find_source      — match a story to the right source or database
   Pending / not yet wired: USHMM/EWP (no public API), Genocide Watch, ACLED
   (needs key), UCDP (API available — add next), GDELT, Wayback, data_analysis.
   Prompt is honest about what's connected.

   POST body: { job_id, question, context? }
   Auth: Supabase JWT.
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { VOICE_LAW_PROSE, houseTypography } = require('./_etl-voice-law.js');
const { getStore, connectLambda } = require('@netlify/blobs');
const fs = require('fs');
const path = require('path');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4000;
const MAX_WEB_SEARCHES = 8;
const MAX_TURNS = 8;
const UA = 'ETL-Newswire-Heidi/1.0 (genocide-atrocity-journalism)';

const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdnJuZXJteXV2emFueGh4b2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzYyMDEsImV4cCI6MjA5NjMxMjIwMX0.tAaXhm_pb-DxrYsXYw1DvvYENDJ_y3jlt2nGWSp2lbA';

const LIVE_TOOLS_NOTE = [
  '',
  'Backpack status (read carefully): LIVE and connected now are web search and four custom tools (prep_interview, draft_feature, fact_check, find_source). Specialized data sources not yet wired: USHMM / Early Warning Project, Genocide Watch, ACLED (needs key), GDELT, Wayback, data analysis, UCDP. Never claim to have used a tool that returned nothing. When a question needs an unwired source, name which one would answer it and use web search to get as close as you honestly can.',
  '',
  'Output format:',
  '- Lead with what is established, then what is contested, then what is still unverified, then the sourcing.',
  '- Every claim carries a source and a date. Estimates are labeled as estimates.',
  '- Use the recognized frameworks precisely: the 1948 Genocide Convention definition, R2P, accepted early-warning models. Do not call something genocide loosely.',
  '- Never fabricate quotes, sources, or facts. Never attribute invented statements to a real person.',
  '- Sensitive subjects, especially mental health and trauma, handled with the care Heidi\'s background demands.',
  '- Avoid em dashes. Use commas, periods, and semicolons.',
  '- End with one line: "Next step:" followed by the single verification or editorial action to take.',
].join('\n');

// ── Auth ──────────────────────────────────────────────────────────────────────
async function validateRequest(event) {
  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return { ok: false, reason: 'no_bearer' };
  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false, reason: 'empty_token' };
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

// ── Config loader ─────────────────────────────────────────────────────────────
function loadConfig() {
  const candidates = [
    path.join(__dirname, '..', '..', 'data', 'heidi-backpack-config.json'),
    path.join(process.cwd(), 'data', 'heidi-backpack-config.json'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
  }
  return null;
}
async function loadConfigHttp(event) {
  const base = process.env.URL
             || ((event && event.headers && (event.headers.host || event.headers.Host))
                 ? 'https://' + (event.headers.host || event.headers.Host) : '');
  if (!base) return null;
  try {
    const r = await fetch(base + '/data/heidi-backpack-config.json', { cache: 'no-store' });
    if (r.ok) return await r.json();
  } catch (_) {}
  return null;
}
function configToPrompt(cfg) {
  const entry = (cfg && cfg.consultant_entry) || {};
  return entry.system_prompt || null;
}

// ── Custom tool definitions ───────────────────────────────────────────────────
const PREP_INTERVIEW_TOOL = {
  name: 'prep_interview',
  description: 'Generate a background brief and question set for an interview subject. Returns: key facts about the subject, context on the story angle, and 8-12 questions ordered from open to specific, with the most important flagged.',
  input_schema: {
    type: 'object',
    required: ['subject', 'story_angle'],
    properties: {
      subject: { type: 'string', description: 'Person or organization to be interviewed.' },
      story_angle: { type: 'string', description: 'What the story is about and why this subject matters to it.' },
      known_context: { type: 'string', description: 'What is already known about the subject (optional).' },
      sensitive_areas: { type: 'array', description: 'Topics that require extra care in framing.', items: { type: 'string' } },
    },
  },
};

const DRAFT_FEATURE_TOOL = {
  name: 'draft_feature',
  description: 'Turn notes, quotes, and context into a wire-ready feature or profile scaffold. Returns a structured first draft. Human does the final edit; the byline and every editorial call stay with the owner.',
  input_schema: {
    type: 'object',
    required: ['notes', 'story_type'],
    properties: {
      notes: { type: 'string', description: 'Reporter notes, quotes, and facts gathered.' },
      story_type: { type: 'string', description: 'profile, feature, explainer, news, or opinion.' },
      headline: { type: 'string', description: 'Working headline (optional).' },
      word_target: { type: 'integer', description: 'Target word count.' },
      audience: { type: 'string', description: 'Intended audience or publication.' },
    },
  },
};

const FACT_CHECK_TOOL = {
  name: 'fact_check',
  description: 'Run a verification pass on a set of claims before filing. Returns each claim with a verification status (verified/contested/unverified), the source or gap, and a recommended action. Verify before publish, always.',
  input_schema: {
    type: 'object',
    required: ['claims'],
    properties: {
      claims: { type: 'array', description: 'List of factual claims to verify.', items: { type: 'string' } },
      context: { type: 'string', description: 'Story context that frames the claims.' },
    },
  },
};

const FIND_SOURCE_TOOL = {
  name: 'find_source',
  description: 'Match a story or research need to the right source, database, or contact type. For atrocity and conflict stories, routes to the appropriate specialized dataset or institution. Returns source recommendations with access notes.',
  input_schema: {
    type: 'object',
    required: ['story_need'],
    properties: {
      story_need: { type: 'string', description: 'What information or source is needed.' },
      topic_area: { type: 'string', description: 'genocide, conflict, human-rights, journalism, culture, mental-health, arts, or general.' },
      urgency: { type: 'string', description: 'breaking, same-day, feature (days), or background.' },
    },
  },
};

// ── In-framework tool handlers ────────────────────────────────────────────────

function handlePrepInterview(inp) {
  const { subject, story_angle, known_context, sensitive_areas = [] } = inp;
  const sensitiveNote = sensitive_areas.length
    ? `\nSensitive areas requiring careful framing: ${sensitive_areas.join(', ')}.`
    : '';
  return {
    subject,
    story_angle,
    background_brief: {
      subject,
      story_context: story_angle,
      known: known_context || 'To be researched before interview.',
      sensitive_handling: sensitiveNote || 'No specific sensitive areas flagged.',
    },
    question_guide: {
      opening_questions: [
        `Can you tell me about your role in [context of ${story_angle}]?`,
        'How did you first become involved in this?',
        'What has changed in your view over time?',
      ],
      core_questions: [
        `What would you most want people to understand about [${story_angle.slice(0, 60)}]?`,
        'What do the numbers or reports miss that you see directly?',
        'Who else should I be talking to?',
      ],
      closing_questions: [
        'Is there anything you wanted to say that I haven\'t asked about?',
        'What happens next, from your perspective?',
      ],
      flagged_as_most_important: `What would you most want people to understand about [${story_angle.slice(0, 60)}]?`,
    },
    trauma_protocol: sensitive_areas.length
      ? 'Let the subject set the pace. Offer to skip or return to any topic. Never push past a clear stop. Confirm consent before quoting anything personal.'
      : null,
    verify_before_interview: 'Run the subject through web search for recent statements or reporting first.',
  };
}

function handleDraftFeature(inp) {
  const { notes, story_type, headline, word_target, audience } = inp;
  const wt = word_target || (story_type === 'profile' ? 1200 : story_type === 'feature' ? 1500 : 800);
  return {
    story_type,
    headline_draft: headline || '[WORKING HEADLINE: Heidi to finalize]',
    word_target: wt,
    audience: audience || 'general',
    scaffold: {
      lede: '[LEDE: One-sentence scene or fact that opens the door. The detail no one else has.]',
      nut_graf: '[NUT GRAF: Why this story matters now. Stakes in two sentences.]',
      body_sections: [
        { section: 1, role: 'Context and background', placeholder: '[Context from notes: ' + notes.slice(0, 150) + '...]' },
        { section: 2, role: 'Key testimony or evidence', placeholder: '[Best quote or specific evidence from notes.]' },
        { section: 3, role: 'Complication or counter-view', placeholder: '[What complicates the story or who sees it differently?]' },
        { section: 4, role: 'So what / stakes', placeholder: '[Why does this matter beyond the immediate story?]' },
      ],
      kicker: '[KICKER: The line they\'ll still be thinking about tomorrow.]',
    },
    editorial_note: 'This scaffold is AI-assisted. Heidi does the final edit. The byline and every editorial call stay with the owner.',
    verify_before_filing: 'Run fact_check on every named claim before this goes to the desk.',
  };
}

function handleFactCheck(inp) {
  const { claims = [], context } = inp;
  return {
    context: context || null,
    claim_count: claims.length,
    verification_pass: claims.map((claim, i) => ({
      index: i + 1,
      claim: claim.slice(0, 300),
      status: 'unverified',
      source_gap: 'Web search has not run on this claim yet. Queue for verification.',
      action: 'Run web_search on the key assertion in this claim. Corroborate across independent sources.',
      note: 'An agent\'s say-so is a quote, not verification. Verify against primary sources.',
    })),
    filing_gate: 'Nothing leaves the desk until all claims are marked verified or the uncertainty is disclosed to the reader.',
    note: 'Use web_search to run verification on each claim, then return with sources to update status.',
  };
}

function handleFindSource(inp) {
  const { story_need, topic_area, urgency } = inp;

  const SOURCE_MAP = {
    'genocide':      [
      { name: 'USHMM Early Warning Project', url: 'https://earlywarningproject.ushmm.org/', access: 'free, web', note: 'Risk assessments and genocide archives. NOT yet wired to backpack; use web search.' },
      { name: 'Genocide Watch', url: 'https://genocidewatch.com/', access: 'free, web', note: 'Stages-of-genocide framework and country alerts.' },
      { name: 'UCDP (Uppsala Conflict Data)', url: 'https://ucdp.uu.se/', access: 'free API', note: 'Violence datasets by actor, place, year. API available; not yet wired.' },
      { name: 'ReliefWeb', url: 'https://reliefweb.int/', access: 'free API', note: 'UN OCHA humanitarian situation reports.' },
      { name: 'ICC / ICJ / ICTY records', url: 'https://www.icc-cpi.int/', access: 'free, web', note: 'Tribunal and court records for accountability.' },
    ],
    'conflict':      [
      { name: 'ACLED', url: 'https://acleddata.com/', access: 'free key required', note: 'Sourced conflict events. Key needed; not yet wired.' },
      { name: 'UCDP', url: 'https://ucdp.uu.se/', access: 'free API', note: 'Organized violence datasets.' },
      { name: 'ReliefWeb', url: 'https://reliefweb.int/', access: 'free API', note: 'Humanitarian data and situation reports.' },
    ],
    'human-rights':  [
      { name: 'UN OHCHR', url: 'https://www.ohchr.org/', access: 'free, web', note: 'UN human-rights documents and Commissions of Inquiry.' },
      { name: 'ReliefWeb', url: 'https://reliefweb.int/', access: 'free API', note: 'OCHA humanitarian documents.' },
      { name: 'Amnesty International', url: 'https://www.amnesty.org/', access: 'free, web', note: 'Country reports and alerts.' },
    ],
    'mental-health': [
      { name: 'NIMH research', url: 'https://www.nimh.nih.gov/', access: 'free, web', note: 'U.S. mental health statistics and reports.' },
      { name: 'WHO mental health', url: 'https://www.who.int/health-topics/mental-health', access: 'free, web', note: 'Global data and guidelines.' },
    ],
    'journalism':    [
      { name: 'CPJ', url: 'https://cpj.org/', access: 'free, web', note: 'Committee to Protect Journalists; press freedom data.' },
      { name: 'RSF', url: 'https://rsf.org/', access: 'free, web', note: 'Reporters Without Borders press freedom index.' },
    ],
  };

  const area = (topic_area || 'general').toLowerCase();
  const sources = SOURCE_MAP[area] || SOURCE_MAP['genocide'];

  return {
    story_need,
    topic_area: area,
    urgency: urgency || 'feature',
    recommended_sources: sources,
    immediate_action: urgency === 'breaking'
      ? 'Use web_search now. Specialized APIs can supplement after the initial filing window.'
      : 'Web search first for current context, then primary sources for verification.',
    source_protection_note: 'Honor off-the-record and embargo conditions. Never expose a survivor, witness, or at-risk individual. Escalate anything legally risky to Dr. Oroszi before it runs.',
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
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
  const question = String(body.question || '').trim();
  if (!jobId)    return { statusCode: 400, body: JSON.stringify({ error: 'job_id_required' }) };
  if (!question) return { statusCode: 400, body: JSON.stringify({ error: 'question_required' }) };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: 'no_api_key' }) };

  const store = getStore('specialist_jobs');
  const jobKey = 'heidi/' + jobId;
  await store.setJSON(jobKey, {
    job_id: jobId,
    agent: 'Heidi Kingstone',
    role: 'Foreign Correspondent and Genocide/Atrocity-Prevention SME',
    question,
    status: 'running',
    created_at: new Date().toISOString(),
    owner_id: auth.user.id,
  });

  const cfg = loadConfig() || await loadConfigHttp(event);
  const basePrompt = configToPrompt(cfg);
  if (!basePrompt) {
    await store.setJSON(jobKey, {
      job_id: jobId, status: 'error', error: 'backpack_config_not_found',
      finished_at: new Date().toISOString(),
    });
    return { statusCode: 500, body: JSON.stringify({ error: 'backpack_config_not_found' }) };
  }

  const systemPrompt = basePrompt + '\n' + LIVE_TOOLS_NOTE + VOICE_LAW_PROSE;

  const client = new Anthropic({ apiKey });
  const tools = [
    { type: 'web_search_20250305', name: 'web_search', max_uses: MAX_WEB_SEARCHES },
    PREP_INTERVIEW_TOOL,
    DRAFT_FEATURE_TOOL,
    FACT_CHECK_TOOL,
    FIND_SOURCE_TOOL,
  ];
  const messages = [
    {
      role: 'user',
      content: question + (body.context ? '\n\nOwner context: ' + String(body.context).slice(0, 2000) : ''),
    },
  ];

  const citations = [];
  const seenUrls = new Set();
  function collectCitations(content) {
    (content || []).filter(b => b.type === 'text').forEach(b => {
      (b.citations || []).forEach(c => {
        const url = c.url || (c.web_search_result_location && c.web_search_result_location.url) || '';
        const title = c.title || c.cited_text || '';
        if (url && !seenUrls.has(url)) { seenUrls.add(url); citations.push({ url, title }); }
      });
    });
  }

  try {
    let finalText = '';
    let totalTokens = 0;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.messages.create({
        model: MODEL, max_tokens: MAX_TOKENS, system: systemPrompt, tools, messages,
      });
      totalTokens += (response.usage && (response.usage.output_tokens + response.usage.input_tokens)) || 0;
      collectCitations(response.content);

      const turnText = (response.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      if (turnText) finalText = turnText;

      const customToolUses = (response.content || []).filter(b => b.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || customToolUses.length === 0) break;

      messages.push({ role: 'assistant', content: response.content });
      const toolResults = [];
      for (const tu of customToolUses) {
        let result;
        const inp = tu.input || {};
        try {
          switch (tu.name) {
            case 'prep_interview': result = handlePrepInterview(inp); break;
            case 'draft_feature':  result = handleDraftFeature(inp); break;
            case 'fact_check':     result = handleFactCheck(inp); break;
            case 'find_source':    result = handleFindSource(inp); break;
            default: result = { error: 'tool_not_connected', tool: tu.name };
          }
        } catch (e) {
          result = { error: tu.name + ' failed: ' + (e && e.message) };
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result).slice(0, 12000),
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    const scrubbed = houseTypography(finalText);

    await store.setJSON(jobKey, {
      job_id: jobId,
      agent: 'Heidi Kingstone',
      role: 'Foreign Correspondent and Genocide/Atrocity-Prevention SME',
      question,
      status: 'done',
      created_at: new Date(Date.now() - 1000).toISOString(),
      finished_at: new Date().toISOString(),
      response: { text: scrubbed, citations },
      tokens_used: totalTokens || null,
      owner_id: auth.user.id,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, job_id: jobId, citations_count: citations.length }),
    };
  } catch (err) {
    console.error('[heidi-background] error', err && err.message);
    await store.setJSON(jobKey, {
      job_id: jobId,
      status: 'error',
      error: err && err.message,
      finished_at: new Date().toISOString(),
    });
    return { statusCode: 500, body: JSON.stringify({ error: err && err.message }) };
  }
};
