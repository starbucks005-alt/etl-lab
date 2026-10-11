'use strict';
/* _sources.cjs: real sources an agent can check at the moment someone asks.

   WHAT THIS IS FOR
   An agent whose roster entry says it can look things up has to actually look
   things up. Every function here makes a live request to a public, keyless
   source and hands back the few facts it found, each with the link a person
   can open to check it. The calling function puts them in front of the model
   and tells it to use them only where they bear on the question.

   RULES THIS MODULE KEEPS
   - It never throws. A source that is down, slow or empty returns [] and the
     agent simply answers without it. A lookup must never be the reason a chat
     fails.
   - It never waits long. Each request has its own timeout, and lookup()
     stops waiting for the whole batch after a hard deadline.
   - It never invents. Nothing is returned that the source did not say.

   The same file lives in etl-lab-push and in THE_GYM (two separate deploys).
   Keep the two byte-identical. If you change one, copy it to the other.

   SOURCES
   pubmed     PubMed (NCBI E-utilities): titles, journals, years, study type
              and the abstract text of the best matches.
   wikipedia  Wikipedia: the opening of the best matching article.
   exercise   free-exercise-db, an open (Unlicense) dataset of 800+ exercises:
              muscles, equipment, level and the how-to steps.

   LEFT OUT ON PURPOSE
   NIH Office of Dietary Supplements and Open Food Facts both answered fine by
   hand and then challenged or failed when called from a server (Cloudflare
   "Attention Required", "temporarily unavailable"). A source that blocks
   automated requests would make an agent's claim false again, so neither is
   used here. wger's exercise search also moved and returned 404. */

const UA = 'ETL-Lab/1.0 (https://emerging-tech-lab.com; drterryoroszi@emerging-tech-lab.com)';
const NCBI_ID = 'tool=etl-lab&email=drterryoroszi%40emerging-tech-lab.com';

/* ── plumbing ───────────────────────────────────────────────────────────── */
async function getText(url, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(timer); }
}
async function getJson(url, ms) { return JSON.parse(await getText(url, ms)); }
const enc = encodeURIComponent;

const STOP = new Set(('a an the and or but if so of to in on at by for with from about into over as is are was were be ' +
  'been being do does did can could should would will may might i me my mine you your we our they them their it its ' +
  'this that these those what which who whom how why when where there here have has had not no yes please tell give ' +
  'show need want just really very much more most some any also than then too get got make makes best good bad ' +
  'thing things way ways lot lots kind sort like think know say said ok okay hey hello thanks ' +
  'often usually always never sometimes long short fast quick quickly easy hard many enough better worse ' +
  'big small start starting stop help helps helpful use using used really actually ' +
  'okay normal normally lately recently without within between difference differences versus same ' +
  'different another other others each every because matter matters mean means meant why mine ' +
  'let lets try tried trying going gone come comes came keep keeps kept something anything everything ' +
  'nothing someone anyone everyone somewhere anywhere whatever whenever however probably maybe').split(' '));

/* Everyday words that mean something specific to a research database. "How
   often" is a question about frequency; "get bigger" is hypertrophy. */
const SAY = { often: 'frequency', frequently: 'frequency', bigger: 'hypertrophy', bulk: 'hypertrophy',
  bulking: 'hypertrophy', stronger: 'strength', jacked: 'hypertrophy', toned: 'hypertrophy' };

/* The few words in a question that carry its meaning. */
function keywords(text, max) {
  const words = String(text || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
    .map((w) => SAY[w] || w)
    .filter((w) => w.length > 2 && !STOP.has(w));
  return Array.from(new Set(words)).slice(0, max || 8);
}

function decode(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return ''; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch (e) { return ''; } })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}
function clip(s, n) {
  s = String(s || '');
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const i = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return (i > n * 0.5 ? cut.slice(0, i + 1) : cut.replace(/\s+\S*$/, '') + '...');
}

/* ── PubMed ─────────────────────────────────────────────────────────────── */
const KEEP_TYPES = ['Randomized Controlled Trial', 'Meta-Analysis', 'Systematic Review', 'Review',
  'Clinical Trial', 'Practice Guideline', 'Guideline', 'Observational Study', 'Comparative Study',
  'Case Reports', 'Cohort Studies'];

function parsePubmed(xml) {
  const out = [];
  const parts = String(xml || '').split('<PubmedArticle>').slice(1);
  for (const p of parts) {
    const pmid = (p.match(/<PMID[^>]*>(\d+)<\/PMID>/) || [])[1];
    const title = decode((p.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/) || [])[1]);
    if (!pmid || !title) continue;
    const journal = decode((p.match(/<Journal>[\s\S]*?<Title>([\s\S]*?)<\/Title>/) || [])[1]);
    const year = (p.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/) || p.match(/<MedlineDate>(\d{4})/) || [])[1];
    const abs = [];
    const re = /<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g;
    let m;
    while ((m = re.exec(p))) {
      const label = (m[1].match(/Label="([^"]+)"/) || [])[1];
      const t = decode(m[2]);
      if (t) abs.push(label ? label + ': ' + t : t);
    }
    const types = [];
    const tre = /<PublicationType[^>]*>([^<]+)<\/PublicationType>/g;
    while ((m = tre.exec(p))) { const t = decode(m[1]); if (KEEP_TYPES.includes(t) && !types.includes(t)) types.push(t); }
    // First author's surname, so an agent never has to guess whose study it is.
    const first = decode((p.match(/<Author[^>]*>[\s\S]*?<LastName>([\s\S]*?)<\/LastName>/) || [])[1]);
    const authorCount = (p.match(/<Author[ >]/g) || []).length;
    const by = first ? 'By ' + first + (authorCount > 1 ? ' and colleagues' : '') + '.' : '';
    out.push({
      source: 'PubMed',
      title,
      text: [by, journal && year ? journal + ', ' + year : (journal || year || ''), types.length ? '(' + types.join(', ') + ')' : '',
        abs.length ? clip(abs.join(' '), 900) : 'No abstract on record.'].filter(Boolean).join(' '),
      url: 'https://pubmed.ncbi.nlm.nih.gov/' + pmid + '/',
    });
  }
  return out;
}

/* PubMed ANDs every term, so a natural question with one vague word ("often",
   "good") returns nothing. Try the whole set first, then fewer, longer terms. */
function termSets(kw) {
  const longest = (k) => kw.slice().sort((a, b) => b.length - a.length).slice(0, k)
    .sort((a, b) => kw.indexOf(a) - kw.indexOf(b));
  const sets = [kw.slice(0, 5)];
  if (kw.length > 3) sets.push(longest(3));
  if (kw.length > 2) sets.push(longest(2));
  const seen = new Set();
  return sets.filter((s) => { const k = s.join(' '); if (seen.has(k) || s.length < 2) return false; seen.add(k); return true; });
}

/* Evidence that has been through a filter first: reviews, meta-analyses and
   trials with an abstract. If a question has none of those, fall back to
   anything with an abstract, so the agent is never handed a bare title. */
const BEST_EVIDENCE = '(systematic review[pt] OR meta-analysis[pt] OR randomized controlled trial[pt] OR review[pt]) AND hasabstract';
const ANY_ABSTRACT = 'hasabstract';

/* NCBI allows 3 requests a second per address without a key (10 with one) and
   answers 429 past that. Server addresses are shared, so be polite: keep a
   minimum gap between calls from this instance, retry a 429 once, and cache
   identical questions for an hour. Set NCBI_API_KEY (free) to raise the limit. */
let _lastNcbi = 0;
async function ncbiGet(url, ms) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const wait = _lastNcbi + 360 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    _lastNcbi = Date.now();
    try { return await getText(url, ms); }
    catch (e) { if (!/HTTP 429/.test(String(e && e.message)) || attempt) throw e; }
  }
  return '';
}
const _pmCache = new Map();

async function pubmed(question, opts) {
  opts = opts || {};
  const n = opts.n || 2, ms = opts.ms || 3500;
  const kw = keywords(question, 7);
  if (kw.length < 2 && !(kw.length === 1 && kw[0].length >= 6)) return [];
  const cacheKey = kw.join(' ') + '|' + n + '|' + (opts.domain || '');
  const hit = _pmCache.get(cacheKey);
  if (hit && Date.now() - hit[0] < 3600 * 1000) return hit[1];
  const key = (typeof process !== 'undefined' && process.env && process.env.NCBI_API_KEY)
    ? '&api_key=' + enc(process.env.NCBI_API_KEY) : '';
  // At most two searches: the whole question against the best evidence, then
  // the few longest terms against anything with an abstract.
  const attempts = kw.length === 1
    ? [[kw, BEST_EVIDENCE], [kw, ANY_ABSTRACT]]
    : [[kw.slice(0, 5), BEST_EVIDENCE]].concat(termSets(kw).slice(1, 2).map((s) => [s, ANY_ABSTRACT]));
  if (attempts.length === 1) attempts.push([kw.slice(0, 5), ANY_ABSTRACT]);
  // A field scope keeps "progressive overload" about training, not kidneys.
  const scope = opts.domain ? ' AND (' + opts.domain + ')' : '';
  try {
    let ids = [];
    for (const [set, filter] of attempts) {
      const term = '(' + set.join(' ') + ')' + scope + ' AND ' + filter;
      const s = JSON.parse(await ncbiGet('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&sort=relevance&retmax=' +
        (n * 4) + '&' + NCBI_ID + key + '&term=' + enc(term), ms) || '{}');
      ids = (s.esearchresult && s.esearchresult.idlist) || [];
      if (ids.length) break;
    }
    if (!ids.length) return [];
    const xml = await ncbiGet('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&' +
      NCBI_ID + key + '&id=' + ids.join(','), ms);
    // PubMed's own ranking is not enough on a short natural question, so take a
    // wider set and rank it here: a term in the title counts three times a term
    // in the abstract. Keep only what actually talks about the question.
    const stems = kw.map((w) => fold(w).slice(0, 5));
    const need = Math.max(1, Math.min(2, Math.ceil(stems.length / 2)));
    const scored = [];
    for (const it of parsePubmed(xml)) {
      const t = fold(it.title), b = fold(it.text);
      let inTitle = 0, inBody = 0;
      for (const st of stems) { if (t.includes(st)) inTitle++; else if (b.includes(st)) inBody++; }
      if (inTitle + inBody >= need) scored.push([inTitle * 3 + inBody, it]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    const out = scored.slice(0, n).map((x) => x[1]);
    if (out.length) _pmCache.set(cacheKey, [Date.now(), out]);
    return out;
  } catch (e) { return []; }
}

/* ── Wikipedia ──────────────────────────────────────────────────────────── */
/* Wikipedia's search is lexical, so a plain question needs safeguards:
   1. An article is accepted only when its TITLE shares a stem with what was
      actually asked ("why does chocolate seize" once returned "Chocolate
      liqueur": the word appeared somewhere, the answer did not).
   2. When the agent has a subject, the title or the search snippet must
      belong to it (opts.family), so "what matters" cannot land on a sitcom.
   3. Episode lists, songs, films and the like are never the answer to a craft
      question.
   If the first search finds nothing acceptable it tries again with fewer
   terms before giving up. Saying nothing beats handing over the wrong article. */
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const stem = (w) => fold(w).slice(0, 5);

const NOT_AN_ANSWER_TITLE = /\b(episodes?|seasons?|soundtrack|discography|filmography)\b|^list of\b|\((?:[^)]*\b)?(?:tv|television|film|movie|album|song|band|novel|series|character|miniseries|video game|musical|podcast)\b[^)]*\)/i;
const NOT_AN_ANSWER_SNIPPET = /\b(episode of|television series|sitcom|album by|song by|single by|film directed|feature film|studio album|rock band)\b/i;

async function wikipedia(question, opts) {
  opts = opts || {};
  const ms = opts.ms || 3000, chars = opts.chars || 1500;
  const hint = opts.hint ? String(opts.hint).toLowerCase() : '';
  const family = (opts.family || (hint ? [hint] : [])).map(fold);
  const own = keywords(question, 6).filter((k) => k !== hint);
  if (!own.length && !hint) return [];

  const longest = own.slice().sort((a, b) => b.length - a.length);
  const variants = [];
  const add = (terms) => {
    const q = (hint ? [hint] : []).concat(terms).join(' ');
    if (q && !variants.some((v) => v.q === q)) variants.push({ q, terms });
  };
  add(own.slice(0, 4));
  if (own.length > 2) add(own.slice(0, 2));
  if (own.length > 2) add(longest.slice(0, 2));
  if (own.length > 1) add(longest.slice(0, 1));
  if (!own.length) add([]);

  try {
    for (const v of variants.slice(0, 4)) {
      const s = await getJson('https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=5&format=json&srsearch=' +
        enc(v.q), ms);
      const hits = (s.query && s.query.search) || [];
      const stems = v.terms.map(stem);
      let best = null, bestScore = -1;
      for (const h of hits) {
        const snippet = String(h.snippet || '').replace(/<[^>]+>/g, ' ');
        if (NOT_AN_ANSWER_TITLE.test(h.title) || NOT_AN_ANSWER_SNIPPET.test(snippet)) continue;
        const title = fold(h.title);
        const inTitle = stems.filter((st) => title.includes(st)).length;
        if (stems.length && !inTitle) continue;
        if (family.length && !family.some((f) => title.includes(f) || fold(snippet).includes(f))) continue;
        if (inTitle > bestScore) { best = h; bestScore = inTitle; }
      }
      if (!best) continue;
      const e = await getJson('https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&exchars=' +
        chars + '&titles=' + enc(best.title), ms);
      const page = Object.values((e.query && e.query.pages) || {})[0];
      const text = page && String(page.extract || '').replace(/\n{2,}/g, ' ').trim();
      if (!text) continue;
      // The article's first sentence is where it says what the thing IS, so that
      // is where the agent's subject has to appear. (A rum brand whose second
      // sentence mentions a "wine and spirits merchant" is not about wine.)
      if (family.length) {
        const cut = text.slice(0, 320);
        const m = cut.slice(30).search(/[.!?]\s+(?=[A-Z])/);
        const first = fold(m >= 0 ? cut.slice(0, 30 + m + 1) : cut);
        if (!family.some((f) => first.includes(f))) continue;
      }
      return [{ source: 'Wikipedia', title: page.title, text: clip(text, chars),
        url: 'https://en.wikipedia.org/wiki/' + enc(String(page.title).replace(/ /g, '_')) }];
    }
    return [];
  } catch (e) { return []; }
}

/* ── open exercise dataset ──────────────────────────────────────────────── */
let _ex = null, _exAt = 0;
async function loadExercises() {
  if (_ex && Date.now() - _exAt < 6 * 3600 * 1000) return _ex;
  const j = await getJson('https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json', 5000);
  if (Array.isArray(j) && j.length) { _ex = j; _exAt = Date.now(); }
  return _ex || [];
}

async function exercise(question, opts) {
  opts = opts || {};
  const n = opts.n || 2;
  // Words that describe the whole dataset match everything, so they decide nothing.
  const GENERIC = new Set(['exercise', 'exercises', 'workout', 'workouts', 'movement', 'movements', 'routine',
    'program', 'programs', 'training', 'train', 'muscle', 'muscles', 'body', 'weight', 'weights', 'gym', 'form']);
  const kw = keywords(question, 8).filter((k) => !GENERIC.has(k)).map((k) => k.replace(/s$/, ''));
  if (!kw.length) return [];
  try {
    const all = await loadExercises();
    const scored = [];
    for (const e of all) {
      const name = String(e.name || '').toLowerCase();
      const prim = (e.primaryMuscles || []).join(' ').toLowerCase();
      const sec = (e.secondaryMuscles || []).join(' ').toLowerCase();
      const gear = (String(e.equipment || '') + ' ' + String(e.category || '')).toLowerCase();
      let s = 0;
      for (const k of kw) {
        if (name.includes(k)) s += 3;
        else if (prim.includes(k)) s += 2;
        else if (sec.includes(k) || gear.includes(k)) s += 1;
      }
      if (s >= 2) scored.push([s, e]);
    }
    // Ties go to strength work over stretches and cardio unless they asked.
    const wantsOther = /stretch|mobil|cardio|warm/.test(String(question || '').toLowerCase());
    const rank = (e) => (wantsOther || e.category === 'strength' || e.category === 'powerlifting' ||
      e.category === 'olympic weightlifting' || e.category === 'strongman') ? 0 : 1;
    scored.sort((a, b) => b[0] - a[0] || rank(a[1]) - rank(b[1]));
    return scored.slice(0, n).map(([, e]) => ({
      source: 'free-exercise-db',
      title: e.name,
      text: [
        'Primary: ' + ((e.primaryMuscles || []).join(', ') || 'n/a') + '.',
        (e.secondaryMuscles || []).length ? 'Secondary: ' + e.secondaryMuscles.join(', ') + '.' : '',
        'Equipment: ' + (e.equipment || 'none listed') + '. Level: ' + (e.level || 'n/a') + '. ' +
          (e.mechanic ? 'Mechanic: ' + e.mechanic + '. ' : '') + (e.force ? 'Force: ' + e.force + '.' : ''),
        (e.instructions || []).length ? 'How: ' + clip((e.instructions || []).slice(0, 3).join(' '), 420) : '',
      ].filter(Boolean).join(' '),
      url: 'https://github.com/yuhonas/free-exercise-db',
    }));
  } catch (e) { return []; }
}

/* ── run several, never wait long ───────────────────────────────────────── */
const SOURCES = { pubmed, wikipedia, exercise };

/* names: ['exercise','pubmed']  ->  flat list of items, in that order.
   Anything that fails or runs past the deadline contributes nothing. */
async function lookup(question, names, opts) {
  opts = opts || {};
  const deadline = opts.deadlineMs || 4500;
  const jobs = (names || []).map((n) => {
    const fn = SOURCES[n];
    if (!fn) return Promise.resolve([]);
    return fn(question, opts[n] || {}).catch(() => []);
  });
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), deadline));
  const settled = await Promise.race([Promise.all(jobs), timeout]);
  const lists = settled || await Promise.all(jobs.map((j) => Promise.race([j, Promise.resolve([])])));
  return [].concat.apply([], lists || []);
}

/* True when a message is worth a lookup (not a greeting, not a one-liner). */
function worthLooking(message) {
  const m = String(message || '').trim();
  if (m.length < 14) return false;
  if (/^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|cool|great|lol|yep|nope)\b[\s!.,?]*$/i.test(m)) return false;
  return keywords(m, 8).length >= 1;
}

/* The block that goes in front of the model. It names no machinery: from the
   agent's side, these are things it just looked up. */
function lookupBlock(items) {
  if (!items || !items.length) return '';
  const lines = items.map((it, i) =>
    (i + 1) + '. ' + it.title + ' (' + it.source + ')\n   ' + it.text + '\n   ' + it.url);
  return '\n\n---\n\nWHAT YOU JUST LOOKED UP for this question, from real sources:\n\n' + lines.join('\n\n') +
    '\n\nHow to use it: draw on these only where they actually bear on what was asked. When you rely on one, ' +
    'name it and give its link. Refer to a source only by what is written above: its title, its first author as ' +
    'shown, its journal and year. Never add an author name, a sample size, a number or a finding that is not in ' +
    'the text above, and never put a name to a study from memory. Do not claim a source says more than the text ' +
    'shows; a title or an abstract is not the whole paper. If none of it bears on the question, say you would ' +
    'want to check properly instead of guessing. Never present a lookup as certain when it is one study or one article.';
}

module.exports = { lookup, lookupBlock, worthLooking, keywords, pubmed, wikipedia, exercise, parsePubmed };
