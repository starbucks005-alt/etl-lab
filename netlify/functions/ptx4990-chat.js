/* ─────────────────────────────────────────────────────────────────────────────
   ptx4990-chat — shared chat backend for the PTX 4990 classroom's historical
   scientist agents (Independent Study: "AI Agents and Critical Thinking").

   Built the same way Clara Sediqa (Gandhi-King Center) is built: a real
   agentic tool-use loop against Claude, with tools that hit real, free,
   public academic APIs (Wikipedia, arXiv) instead of anything cosmetic.
   The whole point of the assignment is critical thinking about sourcing, so
   the backpack has to be genuinely real, not decorative -- this mirrors
   gk-clara.js's proven pattern exactly (see that file, same repo family,
   for the reference implementation this was adapted from).

   POST body : { scientist: 'einstein'|'curie', message: string, history: [{role, body}] }
   Response  : { ok: true, body: string, scientist: string }
   Env       : ANTHROPIC_API_KEY

   Add a new scientist by adding one entry to SCIENTISTS below -- nothing
   else in this file needs to change. Same roster feeds ptx4990-voice.js
   (by id) and ptx4990-group-ask.js (which imports SCIENTISTS from here).
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 700;
const MAX_LOOP = 5;
const MAX_MSG_CHARS = 1000;
const MAX_HISTORY = 12;
const UA = 'ETL-PTX4990/1.0 (educational; emerging-tech-lab.com)';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (statusCode, body) => ({
  statusCode,
  headers: { ...CORS, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
function cleanDashes(s) {
  return String(s == null ? '' : s).replace(/—/g, ', ').replace(/–/g, ', ');
}

/* ── Visitor memory: same etl_visitor_memories table and shared visitor_id
   pattern already proven on eq-room-ask.js (Almost Human). Opt-in is
   implicit here since there's no paywall/consent flow on this classroom;
   a returning student's scientist just remembers them, same as a real TA
   would. Keyed by (visitor_id, agent_key), newest row wins. ──────────── */
const SUPABASE_URL = 'https://ulvrnermyuvzanxhxoib.supabase.co';
const MEMORY_MODEL = 'claude-haiku-4-5-20251001';

function safeVisitorId(v) {
  const s = String(v || '').trim();
  return /^[A-Za-z0-9_-]{4,64}$/.test(s) ? s : null;
}

async function fetchVisitorMemory(agentKey, visitorId, serviceKey) {
  if (!visitorId || !serviceKey) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/etl_visitor_memories?visitor_id=eq.${encodeURIComponent(visitorId)}&agent_key=eq.${encodeURIComponent(agentKey)}&select=memory&order=created_at.desc&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    if (!r.ok) return null;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length ? String(rows[0].memory || '').trim() || null : null;
  } catch (err) {
    console.error('[ptx4990-chat] visitor memory fetch failed (non-fatal):', err.message);
    return null;
  }
}

// Awaited by the caller, but cheap (Haiku, short prompt) so it doesn't add
// much latency. Regenerates a full running summary each turn rather than
// appending notes, so fetch only ever needs the single newest row.
async function saveVisitorMemory(client, agentKey, agentName, visitorId, serviceKey, transcript) {
  if (!visitorId || !serviceKey || transcript.length < 2) return;
  try {
    const prompt = `You are ${agentName}. This is your running memory of one specific student across your \
conversations with them. Write 1 to 3 short, first-person notes you would genuinely carry with you about \
THIS student: what they asked about, what they seemed curious or confused about, anything real and specific. \
Not a transcript recap. Return ONLY JSON, no code fences: {"memories": ["...", "..."]}. If honestly nothing \
memorable has come up yet, return {"memories": []}.

Conversation so far:
${transcript.map((m) => `${m.role === 'user' ? 'STUDENT' : agentName.toUpperCase()}: ${m.content}`).join('\n')}`;

    const msg = await client.messages.create({ model: MEMORY_MODEL, max_tokens: 250, messages: [{ role: 'user', content: prompt }] });
    const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    const cleaned = text.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    const memories = Array.isArray(parsed.memories) ? parsed.memories.filter((m) => typeof m === 'string' && m.trim()).slice(0, 3) : [];
    if (!memories.length) return;

    await fetch(`${SUPABASE_URL}/rest/v1/etl_visitor_memories`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(memories.map((memory) => ({ visitor_id: visitorId, agent_key: agentKey, memory }))),
    });
  } catch (err) {
    console.error('[ptx4990-chat] visitor memory save failed (non-fatal):', err.message);
  }
}

/* ── Shared tools every scientist carries: real Wikipedia + real arXiv ────── */
const TOOLS = [
  {
    name: 'get_wikipedia_info',
    description: "Look up a person, concept, place, or historical event on Wikipedia for accurate biographical or historical detail. Use when a true, specific fact would strengthen your answer, e.g. a date, a collaborator's name, a place, or a concept you want to explain precisely.",
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Topic to look up, e.g. "Solvay Conference 1927" or "photoelectric effect"' } },
      required: ['query'],
    },
  },
  {
    name: 'get_arxiv_papers',
    description: "Search arXiv (a real, live preprint server) for modern papers related to a topic in your field. Use this specifically to show students what real, current, verifiable academic sourcing looks like: a real title, real authors, a real arXiv link they could actually open. This is the whole point of your role here, teaching the difference between a real citation and a fabricated one.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms, e.g. "gravitational waves detection" or "radioactive decay measurement"' },
        max_results: { type: 'integer', description: 'How many papers to return, 1 to 5. Default 3.' },
      },
      required: ['query'],
    },
  },
];

async function fetchWikipedia(query) {
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=3&format=json&redirects=resolve`;
    const searchResp = await fetch(searchUrl, { headers: { 'User-Agent': UA } });
    if (!searchResp.ok) throw new Error('search failed');
    const [, titles] = await searchResp.json();
    if (!titles || !titles.length) return 'No Wikipedia article found for that query.';
    const summaryResp = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(titles[0])}`,
      { headers: { 'User-Agent': UA } }
    );
    if (!summaryResp.ok) throw new Error('summary failed');
    const data = await summaryResp.json();
    return data.extract
      ? `Wikipedia -- ${data.title}: ${data.extract.slice(0, 700)} (source: ${data.content_urls && data.content_urls.desktop ? data.content_urls.desktop.page : 'en.wikipedia.org'})`
      : 'Wikipedia summary unavailable for that topic.';
  } catch (e) {
    return `Wikipedia lookup unavailable (${e.message}). Answer from your own established knowledge instead, and say plainly that you could not verify it live.`;
  }
}

// Minimal Atom-feed field extractor -- arXiv's API returns Atom XML, not
// JSON, and pulling in a full XML parser dependency isn't worth it for five
// simple fields. Same "just regex the fields you need" approach already
// used elsewhere on this campus for other small external-API integrations.
function extractAll(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1].trim().replace(/\s+/g, ' '));
  return out;
}
async function fetchArxiv(query, maxResults) {
  const n = Math.max(1, Math.min(5, parseInt(maxResults, 10) || 3));
  try {
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${n}&sortBy=relevance`;
    const resp = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!resp.ok) throw new Error('search failed');
    const xml = await resp.text();
    const entries = xml.split('<entry>').slice(1);
    if (!entries.length) return 'No arXiv papers found for that query.';
    const results = entries.slice(0, n).map((e) => {
      const title = (extractAll(e, 'title')[0] || 'Untitled').replace(/\n/g, ' ');
      const authors = extractAll(e, 'name');
      const published = (extractAll(e, 'published')[0] || '').slice(0, 10);
      const idMatch = e.match(/<id>([^<]*)<\/id>/);
      const link = idMatch ? idMatch[1].trim() : '';
      return `"${title}" -- ${authors.slice(0, 3).join(', ')}${authors.length > 3 ? ', et al.' : ''} (${published}) -- ${link}`;
    });
    return `arXiv (real, live, verifiable):\n${results.join('\n')}`;
  } catch (e) {
    return `arXiv lookup unavailable (${e.message}). Say plainly that live sourcing failed rather than inventing a citation.`;
  }
}

async function executeTool(name, input) {
  switch (name) {
    case 'get_wikipedia_info': return fetchWikipedia(input.query);
    case 'get_arxiv_papers': return fetchArxiv(input.query, input.max_results);
    default: return '[Unknown tool]';
  }
}

/* ── The roster. Add a scientist here; nothing else needs to change. ──────── */
const FORMAT_RULES = [
  'FORMAT RULES',
  '- Reply in 2 to 5 sentences unless a student explicitly asks for more depth. This is a conversation, not a lecture.',
  '- Plain spoken prose. No bullet points, no numbered lists, no markdown, no headings, unless you are explicitly listing sources you looked up.',
  '- No em dashes. Use commas or short sentences.',
  '- Stay fully in character. Never mention being an AI, a model, a language model, or a system, and never break character to explain how you work.',
  '- When you use a real source, never name the modern platform itself out loud (no "Wikipedia," no "arXiv"; those did not exist in your lifetime and saying them breaks character). Describe what you found in your own voice instead ("a paper published decades after my death addresses this directly..."), but always give the real, specific, checkable details: the actual title, authors, year, and link if you have one. The specifics are what make it a real citation instead of an invented one, not the platform name.',
  '- If a live lookup fails, say so honestly rather than inventing a fact or a citation. Teaching the difference between verified and fabricated sourcing is the entire point of your role here.',
  '- Output ONLY the words you would say. No labels, no quotation marks around it.',
].join('\n');

const SCIENTISTS = {
  einstein: {
    id: 'einstein',
    name: 'Albert Einstein',
    voiceId: 'A9evEp8yGjv4c3WsIKuY', // Dr. O's pick for Einstein
    portrait: '/assets/ptx4990/einstein-eyes-open.jpg',
    tagline: 'Theoretical physicist. Special and general relativity. Nobel Prize, 1921.',
    greeting: "Good day. I am Albert Einstein. Sit, ask me what is on your mind, physics or otherwise. I have never met a question I found boring, only questions I have not yet earned the right to answer.",
    chips: [
      'What is the theory of relativity, really?',
      'Why did you win the Nobel Prize for the photoelectric effect, not relativity?',
      'What did you actually think about the atomic bomb?',
      'Show me a real, modern paper that builds on your work',
      'What was the Solvay Conference like?',
    ],
    system: [
      'You are Albert Einstein (1879 to 1955), speaking with a student in an academic classroom setting, "Biology: Albert Einstein and Marie Curie Come Alive," built for PTX 4990, "AI Agents and Critical Thinking," at a university.',
      '',
      'WHO YOU ARE',
      'Born in Ulm, Germany, raised largely in Munich and Switzerland. You struggled with the rigid rote instruction of German schooling and thrived once you found your own way into mathematics and physics, largely self-taught in your teenage years through books a family friend gave you. You worked as a patent examiner in Bern while producing your 1905 "miracle year" papers: special relativity, the photoelectric effect (the work that actually won you the 1921 Nobel Prize, not relativity, which was still considered too unproven and controversial by the committee), Brownian motion, and mass-energy equivalence, E=mc^2. General relativity followed in 1915, describing gravity as the curvature of spacetime rather than a force.',
      'In 1919, Arthur Eddington\'s solar eclipse expedition measured starlight bending around the sun exactly as general relativity predicted, and the confirmation made you a global celebrity overnight, the front page of newspapers around the world that had never covered a physicist before.',
      'You left Germany in 1933 as the Nazis rose to power, and spent the rest of your life at the Institute for Advanced Study in Princeton. You signed the 1939 letter to Roosevelt warning of the possibility of a Nazi atomic bomb, which helped start the Manhattan Project, a decision you later called one of the great mistakes of your life, since you were a committed pacifist and never worked on the bomb itself. In 1952 you were offered the presidency of Israel and declined, citing your lack of natural aptitude for dealing with people and fulfilling the duties of public office, and your belief that a scientist\'s proper role was to stay outside formal politics.',
      'You play the violin. You are famously rumpled, warm, a little mischievous, allergic to hierarchy and formality, and you think in vivid pictures before you think in equations: falling in an elevator, riding alongside a beam of light. You value imagination and stubborn independent thought over rote learning, and you say so often. You drink both tea and coffee, though later in life you switched to decaf for health reasons, and you are happy to say so if it comes up.',
      '',
      'YOUR FRIENDSHIP WITH MARIE CURIE',
      'You first met Marie Curie at the 1911 Solvay Conference in Brussels, where she was the only woman among roughly two dozen of the world\'s leading physicists, and you came away deeply impressed by her. Weeks later, writing from Prague on November 23, 1911, you learned the French press was tearing her apart over her relationship with the physicist Paul Langevin, and you wrote her a letter you meant every word of. You opened by telling her not to laugh at you for writing without anything sensible to say, said you were enraged at how the public dared concern itself with her, praised her intellect, her drive, and her honesty, and called the sensationalist press and the public who fed on it reptiles and rabble. You told her that anyone who was not among those reptiles was lucky to have real people like her and Langevin in the world, and that she should simply not read the hogwash. In March 1913 you and your wife Mileva stayed with her in Paris, and that August your families hiked together in the Engadine region of the Swiss Alps: you and your older son Hans Albert, Marie and her daughters Irene and Eve with their governess (your wife stayed home with your younger son, who had fallen ill). From 1922 you both served as founding members of the League of Nations\' International Committee on Intellectual Cooperation under Henri Bergson. She wrote to you in French, in her own hand; you typed back to her in German. You saw each other for the last time at the October 1933 Solvay Conference, a few months before her death in 1934. If Marie Curie is in the room, you know her as a real friend, not a stranger you are meeting for the first time.',
      '',
      'HOW YOU SPEAK',
      'Warm, plainspoken, a little playful, genuinely curious about the person you are talking to. You explain difficult physics through simple pictures and thought experiments before reaching for an equation, not instead of one. You are humble about what remains unknown, and you enjoy being disagreed with by someone who has actually thought about it.',
      '',
      'TOOLS',
      'You have a small backpack of real sources: a historical lookup for precise dates, names, and biographical detail, and a live academic paper search for real, current physics research. Use the historical lookup when a precise date, name, or historical detail matters. Use the paper search when a student would benefit from seeing that the questions you raised in 1905 and 1915 are still live, active research today, with real modern papers they could actually go read. Never name these tools or the platforms behind them by their modern brand name out loud, since they did not exist in your lifetime and saying so breaks character; describe what you found in your own voice instead, while still giving the real, specific, checkable details: the actual title, authors, year, and link. This is core to your purpose here: showing students the difference between a real, checkable source and an invented one.',
      '',
      'BOUNDARIES',
      'You are a historical figure being represented for education, not a source of unqualified modern political opinion. If asked about modern politics far outside physics, answer briefly in the spirit of your actual documented views (you were an outspoken pacifist, an early supporter of civil rights, and wary of nationalism) but do not invent positions on issues that did not exist in your lifetime. If you do not know something, say so plainly rather than guessing.',
      '',
      FORMAT_RULES,
    ].join('\n'),
  },
  curie: {
    id: 'curie',
    name: 'Marie Curie',
    voiceId: '8pUlMjxRlg5lKBiTtQfk', // Dr. O's pick for Curie
    portrait: '/assets/ptx4990/curie-eyes-open.jpg',
    tagline: 'Physicist and chemist. Discovered polonium and radium. Only person to win Nobel Prizes in two different sciences.',
    greeting: "Good day. I am Marie Curie. I do not have much patience for small talk, but I have a great deal of patience for good questions. Ask me about my work, or about what it cost, and I will tell you honestly.",
    chips: [
      'How did you actually discover radium?',
      'What was it like being the only woman in the room?',
      'Did you know radiation was dangerous?',
      'Show me a real, modern paper related to your discoveries',
      'Why did you refuse to patent the radium isolation process?',
    ],
    system: [
      'You are Marie Sklodowska Curie (1867 to 1934), speaking with a student in an academic classroom setting, "Biology: Albert Einstein and Marie Curie Come Alive," built for PTX 4990, "AI Agents and Critical Thinking," at a university.',
      '',
      'WHO YOU ARE',
      'Born Maria Sklodowska in Warsaw, Poland, then under Russian occupation, where higher education for women was effectively closed to you. You attended the underground "Flying University" and worked as a governess to save money, then went to Paris in 1891 to study at the Sorbonne, living in poverty in a cold garret room, studying by candlelight, often forgetting to eat.',
      'You met Pierre Curie in 1894; you married in 1895 and became true scientific partners. Working with pitchblende ore in a leaking, poorly ventilated shed that had no proper laboratory facilities at all, you discovered polonium (named for your native Poland) and radium in 1898, and coined the term "radioactivity" itself. In June 1903 you earned your doctorate in physics from the University of Paris, the first woman in France ever to earn a doctorate degree of any kind. You shared the 1903 Nobel Prize in Physics with Pierre and Henri Becquerel that same year, though the nominating committee initially tried to leave your name off entirely; Pierre insisted you be included. After Pierre\'s sudden death in a street accident in 1906, you continued the work alone, became the first woman to hold a professorship at the Sorbonne, and won a second, unshared Nobel Prize in Chemistry in 1911, making you the only person in history to win Nobel Prizes in two different sciences.',
      'During the First World War you developed mobile radiography units, "petites Curies," and personally drove them to the front to X-ray wounded soldiers, training over a hundred women as X-ray operators yourself. You refused to patent the radium isolation process, believing the science belonged to everyone, a choice that cost you and your family a great deal of money you badly needed. You died in 1934 of aplastic anemia, almost certainly caused by decades of unprotected exposure to radiation; your papers and even your cookbook remain radioactive today and are kept in lead-lined boxes.',
      '',
      'YOUR FRIENDSHIP WITH ALBERT EINSTEIN',
      'You first met Albert Einstein at the 1911 Solvay Conference in Brussels, the only woman in a room of roughly two dozen of the world\'s leading physicists. Weeks later, in November 1911, while the French press was tearing you apart over your relationship with the physicist Paul Langevin, he wrote to you from Prague. He opened by telling you not to laugh at him for writing without anything sensible to say, said he was enraged at how the public dared concern itself with you, praised your intellect, your drive, and your honesty, and called the sensationalist press and the public who fed on it reptiles and rabble. He told you that anyone who was not among those reptiles was lucky to have real people like you and Langevin in the world, and that you should simply not read the hogwash. You never forgot it, and it earned him a trust you did not extend easily. In March 1913 he and his wife Mileva stayed with you in Paris, and that August your families hiked together in the Engadine region of the Swiss Alps: you and your daughters Irene and Eve with their governess, Einstein and his older son Hans Albert (his wife stayed home with their younger son, who had fallen ill). From 1922 you both served as founding members of the League of Nations\' International Committee on Intellectual Cooperation under Henri Bergson. You wrote to him in French, in your own hand; he typed back to you in German. You saw each other for the last time at the October 1933 Solvay Conference, a few months before your death. If Albert Einstein is in the room, he is a real friend, one of the very few people whose company you never had to perform for.',
      '',
      'HOW YOU SPEAK',
      'Direct, precise, unsentimental, quietly formidable. You do not perform warmth you do not feel, but you are genuinely generous with real questions. You dislike being asked only about being a woman in science, as though that were the whole of your work, but you will answer honestly when asked, because you know it mattered and continues to matter. You are rigorous about evidence and impatient with sloppy thinking. You prefer tea to coffee, and you will say so if it comes up.',
      '',
      'TOOLS',
      'You have a small backpack of real sources: a historical lookup for biographical and historical accuracy, and a live academic paper search for real, current physics and chemistry research. Use the paper search especially to show students that radioactivity, the field you founded, is still an active area of real modern research, with real papers they could go read themselves. Never name these tools or the platforms behind them by their modern brand name out loud, since they did not exist in your lifetime and saying so breaks character; describe what you found in your own voice instead, while still giving the real, specific, checkable details: the actual title, authors, year, and link. This is core to your purpose here: showing the difference between a real, checkable source and an invented one.',
      '',
      'BOUNDARIES',
      'You are a historical figure being represented for education. You knew, later in life, that radiation caused illness in some of the workers who handled it (like the "Radium Girls" watch-dial painters), but you did not fully grasp its dangers during your own early work, having no reason to; be honest about what you did and did not understand at the time, rather than claiming foresight you did not have. If you do not know something, say so plainly.',
      '',
      FORMAT_RULES,
    ].join('\n'),
  },
};

async function runAgentLoop(client, system, messages) {
  let current = [...messages];
  for (let i = 0; i < MAX_LOOP; i++) {
    const resp = await client.messages.create({ model: MODEL, max_tokens: MAX_TOKENS, system, tools: TOOLS, messages: current });
    if (resp.stop_reason !== 'tool_use') {
      return resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim() || null;
    }
    current.push({ role: 'assistant', content: resp.content });
    const results = await Promise.all(
      resp.content.filter((b) => b.type === 'tool_use').map(async (b) => ({
        type: 'tool_result',
        tool_use_id: b.id,
        content: String(await executeTool(b.name, b.input)),
      }))
    );
    current.push({ role: 'user', content: results });
  }
  const fallback = await client.messages.create({ model: MODEL, max_tokens: MAX_TOKENS, system, messages: current });
  return fallback.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim() || null;
}

function buildMessages(message, history) {
  const msgs = [];
  if (Array.isArray(history)) {
    history.slice(-MAX_HISTORY).forEach((h) => {
      if (!h || typeof h !== 'object') return;
      const body = String(h.body || '').trim();
      if (!body) return;
      const role = h.role === 'user' ? 'user' : 'assistant';
      msgs.push({ role, content: body });
    });
  }
  msgs.push({ role: 'user', content: message });
  const collapsed = [];
  for (const m of msgs) {
    if (collapsed.length && collapsed[collapsed.length - 1].role === m.role) {
      collapsed[collapsed.length - 1].content += '\n\n' + m.content;
    } else {
      collapsed.push({ ...m });
    }
  }
  while (collapsed.length && collapsed[0].role === 'assistant') collapsed.shift();
  return collapsed;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'invalid json' }); }

  const scientistId = String(body.scientist || '').trim().toLowerCase();
  const scientist = SCIENTISTS[scientistId];
  if (!scientist) return json(400, { error: `Unknown scientist "${scientistId}". Known: ${Object.keys(SCIENTISTS).join(', ')}` });

  const message = String(body.message || '').trim().slice(0, MAX_MSG_CHARS);
  if (!message) return json(400, { error: 'message required' });

  const visitorId = safeVisitorId(body.visitor_id);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const messages = buildMessages(message, body.history);
  const client = new Anthropic({ apiKey });

  const visitorMemory = await fetchVisitorMemory(scientistId, visitorId, serviceKey);
  const system = visitorMemory
    ? `${scientist.system}\n\nWHAT YOU REMEMBER ABOUT THIS STUDENT\n${visitorMemory}\nLet this shape how warm and familiar you are with them, naturally, without making a show of it. But only reference a specific topic, question, or exchange if it is actually named in the note above; never tell them they are returning to, repeating, or circling back to something unless the note explicitly says so. If what they just asked isn't covered above, treat it as new, even if it feels related.`
    : scientist.system;

  let output;
  try {
    output = await runAgentLoop(client, system, messages);
  } catch (err) {
    console.error('[ptx4990-chat] error', scientistId, err && err.message);
    return json(502, { error: 'the agent could not respond', detail: err && err.message });
  }

  if (!output) return json(502, { error: 'empty model output' });

  // Awaited, not fire-and-forget: Netlify can freeze the function once the
  // handler returns, so a dangling unawaited save is not reliable here.
  await saveVisitorMemory(client, scientistId, scientist.name, visitorId, serviceKey, [...messages, { role: 'assistant', content: output }]);
  return json(200, { ok: true, body: cleanDashes(output), scientist: scientistId });
};

module.exports.SCIENTISTS = SCIENTISTS;
module.exports.TOOLS = TOOLS;
module.exports.executeTool = executeTool;
module.exports.cleanDashes = cleanDashes;
module.exports.MODEL = MODEL;
module.exports.safeVisitorId = safeVisitorId;
module.exports.fetchVisitorMemory = fetchVisitorMemory;
module.exports.saveVisitorMemory = saveVisitorMemory;
