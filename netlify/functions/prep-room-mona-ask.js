/* prep-room-mona-ask — sync chat for Mona Bahrami, MD, the PREP Room's premed
   readiness advisor. Public, no member auth (matches prep-room-ask.js).

   POST { question, messages?: [...], visitor_id }
   Returns { answer } synchronously.

   Mona's backpack: real tools (Claude tool use), not just a system prompt.
   Tier boundaries and module routes live in code
   (_prep-room-mona-scoring.js, ported from PREP_ROOM/PREMED COACH/
   readiness_scoring_rules.json + routing_table.json) so she never improvises
   a GPA/MCAT benchmark or invents a routing target in-conversation.

   Mona's memory: a persistent per-student record in Supabase, keyed by an
   anonymous visitor_id (localStorage, same pattern as harvest-ask.js). Fails
   soft: no visitor_id or no service key just means no memory, chat still
   works, she just won't remember the student next time.

   Required Supabase SQL (run once in SQL editor):

   CREATE TABLE IF NOT EXISTS public.premed_students (
     visitor_id TEXT PRIMARY KEY,
     intake JSONB NOT NULL DEFAULT '{}'::jsonb,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );

   CREATE TABLE IF NOT EXISTS public.premed_readiness_snapshots (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     visitor_id TEXT NOT NULL,
     profile JSONB NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
   CREATE INDEX IF NOT EXISTS premed_readiness_visitor_idx
     ON public.premed_readiness_snapshots(visitor_id, created_at DESC);

   CREATE TABLE IF NOT EXISTS public.premed_coaching_plans (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     visitor_id TEXT NOT NULL,
     snapshot_id UUID REFERENCES public.premed_readiness_snapshots(id),
     plan JSONB NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );

   CREATE TABLE IF NOT EXISTS public.premed_routing_log (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     visitor_id TEXT NOT NULL,
     route_id TEXT NOT NULL,
     target_module TEXT NOT NULL,
     gap_summary TEXT,
     urgency TEXT,
     status TEXT NOT NULL DEFAULT 'queued',
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
   CREATE INDEX IF NOT EXISTS premed_routing_visitor_idx
     ON public.premed_routing_log(visitor_id, created_at DESC);

   ALTER TABLE public.premed_students ENABLE ROW LEVEL SECURITY;
   ALTER TABLE public.premed_readiness_snapshots ENABLE ROW LEVEL SECURITY;
   ALTER TABLE public.premed_coaching_plans ENABLE ROW LEVEL SECURITY;
   ALTER TABLE public.premed_routing_log ENABLE ROW LEVEL SECURITY;
   -- No policies: only the service role (this function) reads/writes these.
*/

const Anthropic = require('@anthropic-ai/sdk').default;
const { buildReadinessProfile, lookupRoute } = require('./_prep-room-mona-scoring');

const MODEL = 'claude-sonnet-4-6';
const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const MAX_TOOL_LOOPS = 6;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, obj) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

function safeVisitorId(v) {
  const s = String(v || '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
}

const SYSTEM_PROMPT = `You are Mona Bahrami, MD, lead advisor for ETL's PREP Room. You finished medical
school and one year of internal medicine residency before choosing advising over
clinical practice, and you spent three years on your medical school's admissions
committee reading primary applications and sitting on interview panels. That's where
your judgment comes from, not theory, direct experience reading what actually gets
students in.

You didn't get into medical school on your first try. You reapplied a year later with
a rebuilt, honest application and got in. You reference this when it's useful, never
as a party trick, but because it's real evidence that a rough readiness profile is
usually fixable.

Voice: direct, warm, dry sense of humor, allergic to empty encouragement. You give
real feedback and always pair it with a concrete next step. You remember context
students share with you across sessions and treat it as relevant, not small talk.
No em dashes, ever, use a comma or a period instead. Keep replies to two or three
short paragraphs unless the student is asking for something that genuinely needs
more (like walking through a full readiness profile).

You refer to ETL's other modules (the Faculty Agent, the Communication Coach, the
MMI Agent, the Pressure Simulation Agent, the Behavioral Science Agent, the
Cognitive Training Agent, the Writing Coach) as colleagues you route students to,
not as generic tools.

IMPORTANT, non-negotiable: you are an AI agent, not a real person and not a licensed
physician. "MD" and your medical-school backstory are persona details that inform how
you coach, not a real credential. You do not practice clinically, hold no license, and
never give medical advice, only admissions and readiness coaching. If a student asks
whether you are real, an AI, a bot, or a person, confirm plainly and immediately that
you are an AI agent built by ETL, never deflect and never imply you are human. Stay in
your lane: admissions and readiness coaching.

YOUR JOB: run a structured readiness evaluation across four domains, academic,
experiential, professional, identity, and turn it into a short, prioritized coaching
plan that routes the student to the right ETL module for each real gap.

YOUR TOOLS (use them, don't fake their output):
- save_intake_fields: call this as soon as a student tells you something that maps
  to a structured intake field (GPA, hours, MCAT status, etc). Partial updates are
  fine, call it again as more comes in. Never hold a field in your head instead of
  saving it.
- score_readiness: call this once you have enough intake saved to score at least one
  domain meaningfully. It returns the actual tier ratings, computed from the rules,
  not from your judgment. Never state a Low/Developing/On-Track/Strong rating or a
  specific GPA/MCAT/hours benchmark that didn't come from this tool's output.
- route_student: call this when a scored domain reveals a real, specific gap that
  maps to one of ETL's modules. Use the route_id values as documented. Don't
  over-route, at most one or two per session, and never route a freshman to
  interview prep just because they haven't started, that's normal at that stage.
- save_coaching_plan: call this at the end of a session where you've identified
  priorities, with at most 3 ranked actions, each specific and time-bound.

RULES:
- Ask intake questions in small clusters, not all 20 fields at once. This is a
  conversation, not a form dump.
- Never output more than 3 priority action items in a single coaching plan.
- Never state or imply an admissions outcome ("you will/won't get in").
- Never invent a GPA/MCAT/hours benchmark, always go through score_readiness.
- If a student shows signs of significant distress or burnout, pause the readiness
  workflow, respond with care, and suggest they reach out to someone close or a
  professional, before returning to coaching.
- Be honest and direct about weaknesses, students respond to real feedback, not
  empty encouragement, but always pair a gap with a next action.
- You are a system inside ETL, not a replacement for a human pre-health advisor.
  Say so when it's relevant.`;

const TOOLS = [
  {
    name: 'save_intake_fields',
    description: "Save or update structured intake fields for this student. Call this whenever the student shares information that maps to a known field, even mid-conversation. Merges with what's already saved, only include fields you're setting or changing.",
    input_schema: {
      type: 'object',
      properties: {
        fields: {
          type: 'object',
          description: 'Key-value pairs. Keys should match intake_schema.json field ids where possible (e.g. overall_gpa, science_gpa, current_year, target_pathway, clinical_hours_total, mcat_status, personal_statement_status, why_medicine_free_text, stress_self_report, leadership_roles, research_involved, etc). Values can be strings, numbers, booleans, or arrays/objects for table-type fields.',
        },
      },
      required: ['fields'],
    },
  },
  {
    name: 'score_readiness',
    description: 'Score the student across the four readiness domains using their currently saved intake data. Returns the real tier ratings and driving gaps, computed deterministically. Optionally flag qualitative signals you are best positioned to judge from the conversation.',
    input_schema: {
      type: 'object',
      properties: {
        why_medicine_cliche_flag: {
          type: 'boolean',
          description: 'True if the why_medicine narrative reads as generic or cliche with no specific personal throughline, based on your read of the conversation.',
        },
      },
    },
  },
  {
    name: 'route_student',
    description: 'Log a handoff to another ETL module for a specific, real gap. Use one of the fixed route_id values.',
    input_schema: {
      type: 'object',
      properties: {
        route_id: {
          type: 'string',
          enum: ['scientific_reasoning', 'communication_clarity', 'professionalism_flags', 'stress_performance', 'mcat_prep', 'personal_statement_drafting', 'interview_prep'],
        },
        gap_summary: { type: 'string', description: '1-2 sentence plain-language description of the specific gap driving this route.' },
        urgency: { type: 'string', enum: ['time_sensitive', 'long_horizon'] },
      },
      required: ['route_id', 'gap_summary', 'urgency'],
    },
  },
  {
    name: 'save_coaching_plan',
    description: 'Save the prioritized coaching plan for this session. At most 3 ranked actions.',
    input_schema: {
      type: 'object',
      properties: {
        priority_actions: {
          type: 'array',
          maxItems: 3,
          items: {
            type: 'object',
            properties: {
              domain: { type: 'string', enum: ['academic', 'experiential', 'professional', 'identity'] },
              action: { type: 'string', description: 'Specific, time-bound instruction.' },
              rationale: { type: 'string' },
              cost_of_inaction: { type: 'string', description: 'Only for time-sensitive items.' },
              routed_to: { type: 'string', description: 'Module name if this action was routed, otherwise omit.' },
            },
            required: ['domain', 'action', 'rationale'],
          },
        },
      },
      required: ['priority_actions'],
    },
  },
];

async function sbGet(path, serviceKey) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!r.ok) return [];
  return r.json();
}

async function sbUpsert(table, row, serviceKey, onConflict) {
  const url = `${SUPABASE_URL}/rest/v1/${table}${onConflict ? `?on_conflict=${onConflict}` : ''}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: onConflict ? 'resolution=merge-duplicates,return=representation' : 'return=representation',
    },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error('supabase upsert failed: ' + (await r.text()));
  const out = await r.json();
  return Array.isArray(out) ? out[0] : out;
}

async function loadStudent(visitorId, serviceKey) {
  const rows = await sbGet(`premed_students?visitor_id=eq.${encodeURIComponent(visitorId)}&select=intake`, serviceKey);
  return (rows[0] && rows[0].intake) || {};
}

async function loadLatestSnapshot(visitorId, serviceKey) {
  const rows = await sbGet(`premed_readiness_snapshots?visitor_id=eq.${encodeURIComponent(visitorId)}&select=profile,created_at&order=created_at.desc&limit=1`, serviceKey);
  return rows[0] || null;
}

async function runTool(name, input, ctx) {
  const { visitorId, serviceKey } = ctx;

  if (name === 'save_intake_fields') {
    if (!visitorId || !serviceKey) return { ok: false, note: 'no memory configured for this session, noted for this reply only' };
    const current = await loadStudent(visitorId, serviceKey);
    const merged = { ...current, ...(input.fields || {}) };
    await sbUpsert('premed_students', { visitor_id: visitorId, intake: merged, updated_at: new Date().toISOString() }, serviceKey, 'visitor_id');
    ctx.intake = merged;
    return { ok: true, saved_fields: Object.keys(input.fields || {}) };
  }

  if (name === 'score_readiness') {
    const intake = ctx.intake || (visitorId && serviceKey ? await loadStudent(visitorId, serviceKey) : {});
    const profile = buildReadinessProfile(intake, { why_medicine_cliche_flag: input.why_medicine_cliche_flag });
    if (visitorId && serviceKey) {
      try {
        const saved = await sbUpsert('premed_readiness_snapshots', { visitor_id: visitorId, profile }, serviceKey);
        ctx.lastSnapshotId = saved && saved.id;
      } catch (err) { console.error('snapshot save failed:', err.message); }
    }
    return profile;
  }

  if (name === 'route_student') {
    const route = lookupRoute(input.route_id);
    if (!route) return { ok: false, error: 'unknown route_id' };
    if (visitorId && serviceKey) {
      try {
        await sbUpsert('premed_routing_log', {
          visitor_id: visitorId,
          route_id: input.route_id,
          target_module: route.target_module,
          gap_summary: input.gap_summary,
          urgency: input.urgency,
          status: 'queued',
        }, serviceKey);
      } catch (err) { console.error('routing log save failed:', err.message); }
    }
    return { ok: true, target_module: route.target_module, handoff_notes: route.handoff_notes, status: 'queued' };
  }

  if (name === 'save_coaching_plan') {
    const actions = Array.isArray(input.priority_actions) ? input.priority_actions.slice(0, 3) : [];
    if (visitorId && serviceKey) {
      try {
        await sbUpsert('premed_coaching_plans', {
          visitor_id: visitorId,
          snapshot_id: ctx.lastSnapshotId || null,
          plan: { priority_actions: actions },
        }, serviceKey);
      } catch (err) { console.error('plan save failed:', err.message); }
    }
    return { ok: true, saved_actions: actions.length };
  }

  return { ok: false, error: 'unknown tool' };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return json(400, { error: 'bad_json' }); }

  const question = String(body.question || '').trim();
  if (!question) return json(400, { error: 'question_required' });
  if (question.length > 4000) return json(400, { error: 'question_too_long' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'config' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const visitorId = safeVisitorId(body.visitor_id);
  const ctx = { visitorId, serviceKey, intake: null, lastSnapshotId: null };

  let contextNote = '';
  if (visitorId && serviceKey) {
    const [intake, snapshot] = await Promise.all([
      loadStudent(visitorId, serviceKey),
      loadLatestSnapshot(visitorId, serviceKey),
    ]);
    ctx.intake = intake;
    if (Object.keys(intake).length) {
      contextNote += `\n\nSaved intake on file for this student:\n${JSON.stringify(intake)}`;
    }
    if (snapshot) {
      contextNote += `\n\nMost recent readiness profile (from ${snapshot.created_at}):\n${JSON.stringify(snapshot.profile)}`;
    }
    if (!contextNote) {
      contextNote = '\n\nNo intake on file yet, this is a new or first-time student.';
    }
  } else {
    contextNote = '\n\nNo memory available this session (visitor_id or storage not configured), treat this as a one-off conversation.';
  }

  const rawHistory = Array.isArray(body.messages) ? body.messages : [];
  const history = rawHistory
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));

  const messages = [...history, { role: 'user', content: question }];
  const client = new Anthropic({ apiKey });
  const system = SYSTEM_PROMPT + contextNote;

  let finalText = '';
  try {
    for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
      const resp = await client.messages.create({
        model: MODEL,
        max_tokens: 900,
        system,
        tools: TOOLS,
        messages,
      });

      const textBlocks = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      const toolUses = (resp.content || []).filter((b) => b.type === 'tool_use');

      if (resp.stop_reason !== 'tool_use' || !toolUses.length) {
        finalText = textBlocks;
        break;
      }

      messages.push({ role: 'assistant', content: resp.content });
      const toolResults = [];
      for (const use of toolUses) {
        let result;
        try { result = await runTool(use.name, use.input || {}, ctx); }
        catch (err) { result = { ok: false, error: err.message }; }
        toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(result) });
      }
      messages.push({ role: 'user', content: toolResults });

      if (i === MAX_TOOL_LOOPS - 1) finalText = textBlocks || "Let's keep going, one more clarifying question at a time.";
    }
  } catch (err) {
    console.error('prep-room-mona-ask error:', err.message);
    return json(502, { error: 'ai_error', message: err.message });
  }

  return json(200, { answer: finalText });
};
