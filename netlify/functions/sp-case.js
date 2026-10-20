/* sp-case: standardized patient case generator. Added 2026-10-20, Dr. O.
   GET  ->  { ok, options }              the dropdown choices
   POST { learner, field, level, focus? }  ->  { ok, case, review_note }
   Runs on the Azure OpenAI deployment (_azure.js), so it uses the Azure credits. Returns 503 until those settings exist.
   Naomi Baptiste's persona in data/studio-staff-registry.json is the system prompt, so the standards for a good case
   live in one place. Every case is a DRAFT until a clinician has read it. */

const fs = require('fs');
const path = require('path');
const azure = require('./_azure.js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const OPTIONS = {
  learner: ['Medical student', 'Nursing student'],
  level: ['Early (first or second year)', 'Middle (third year)', 'Advanced (final year)'],
  field: [
    'Emergency medicine', 'Oncology', 'Cardiology', 'Primary care', 'Pediatrics', 'Psychiatry and mental health',
    'Geriatrics', 'Obstetrics and gynecology', 'Surgery', 'Critical care', 'Neurology', 'Palliative care',
    'Medical-surgical nursing', 'Community health',
  ],
};

const REQUIRED = [
  'title', 'learner', 'field', 'level', 'learning_objectives', 'patient', 'opening_statement', 'chief_complaint',
  'history_of_present_illness', 'past_history', 'medications', 'allergies', 'family_history', 'social_history',
  'review_of_systems', 'vitals', 'findings_card', 'hidden_concern', 'emotional_script', 'reveal_rules', 'distractors',
  'checklist', 'robot_script',
];

function reply(statusCode, obj) {
  return { statusCode, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}

function loadPersona() {
  const dirs = [
    path.join(__dirname, 'data'),
    path.join(process.cwd(), 'data'),
    path.join(__dirname, '..', '..', 'data'),
  ];
  for (const d of dirs) {
    try {
      const reg = JSON.parse(fs.readFileSync(path.join(d, 'studio-staff-registry.json'), 'utf8'));
      if (reg.naomi_baptiste && reg.naomi_baptiste.persona) return reg.naomi_baptiste.persona;
    } catch (e) { /* try the next place */ }
  }
  return null;
}

function buildMessages(persona, pick) {
  const shape = REQUIRED.map((k) => '"' + k + '"').join(', ');
  const user = [
    'Write one complete standardized patient case.',
    'Learner: ' + pick.learner + '. Level: ' + pick.level + '. Field: ' + pick.field + '.',
    pick.focus ? 'Teaching focus asked for: ' + pick.focus : '',
    'The case is fictional. Every answer the patient can be asked is written down, so a robot plays it the same way for every student.',
    'Answer with one JSON object and nothing else. Keys: ' + shape + '.',
    'checklist is an object with the arrays history, assessment, communication, closing, each item a yes or no observable action.',
    'findings_card is an array of {finding, given_when}. patient is an object with name, age, sex, occupation, living_situation.',
    'robot_script is the full second person instruction to the robot: who it is, how it speaks, what it reveals when, and to stay in this patient until a new patient number is said.',
    'Add a key "needs_clinician_check" listing every medical fact a faculty clinician should confirm.',
    'No em dashes anywhere.',
  ].filter(Boolean).join('\n');
  return [{ role: 'system', content: persona }, { role: 'user', content: user }];
}

function parseCase(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
}

function missingKeys(c) {
  return REQUIRED.filter((k) => c[k] == null || c[k] === '' || (Array.isArray(c[k]) && !c[k].length));
}

function clean(v) {
  if (typeof v === 'string') return v.replace(/\s*[\u2013\u2014]\s*/g, ', ').replace(/\u2011/g, '-');
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = clean(v[k]); return o; }
  return v;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod === 'GET') return reply(200, { ok: true, options: OPTIONS, configured: azure.configured().model });
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return reply(400, { ok: false, error: 'bad json' }); }

  const pick = {
    learner: String(body.learner || ''), level: String(body.level || ''), field: String(body.field || ''),
    focus: String(body.focus || '').slice(0, 300),
  };
  if (!OPTIONS.learner.includes(pick.learner)) return reply(400, { ok: false, error: 'choose a learner type from the list' });
  if (!OPTIONS.level.includes(pick.level)) return reply(400, { ok: false, error: 'choose a level from the list' });
  if (!OPTIONS.field.includes(pick.field)) return reply(400, { ok: false, error: 'choose a field from the list' });

  if (!azure.configured().model) return reply(503, { ok: false, error: 'the Azure model is not set up yet' });
  const persona = loadPersona();
  if (!persona) return reply(500, { ok: false, error: 'Naomi Baptiste is missing from the staff registry' });

  const text = await azure.chat(buildMessages(persona, pick), { maxTokens: 4000, temperature: 0.6, timeoutMs: 55000 });
  if (!text) return reply(502, { ok: false, error: 'Azure did not answer' });
  const parsed = parseCase(text);
  if (!parsed) return reply(502, { ok: false, error: 'the case came back unreadable, try again' });
  const c = clean(parsed);
  const missing = missingKeys(c);
  if (missing.length) return reply(502, { ok: false, error: 'the case was incomplete, try again', missing });
  return reply(200, { ok: true, case: c, review_note: 'Draft. A faculty clinician reads every case before a robot plays it.' });
};

module.exports.OPTIONS = OPTIONS;
module.exports.REQUIRED = REQUIRED;
module.exports.parseCase = parseCase;
module.exports.missingKeys = missingKeys;
module.exports.buildMessages = buildMessages;
module.exports.loadPersona = loadPersona;
