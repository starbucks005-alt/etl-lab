/* Builds the personality lists for the AL panel from the files already in this repository.
   Run from the repository root:  node al-panel/tools/build_personalities.js
   Writes:
     al-panel/personas.json           the short list the page shows (no long text)
     al-panel/pi/personalities.json   the full text the server uses (copied to AL)
   Nothing is invented here: every fact comes from roster.json or good-company/gc-friend.js. */
const vm = require('vm'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');

// ---------- Good Company: load its character file with stand-ins for the browser ----------
const src = fs.readFileSync(path.join(root, 'good-company/gc-friend.js'), 'utf8');
const noop = () => {};
const store = {};
const sb = {
  console, URLSearchParams, setTimeout: noop, clearTimeout: noop, fetch: () => Promise.reject(new Error('no')),
  localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: noop },
  location: { search: '', href: '', hash: '', pathname: '/' }, navigator: { userAgent: '' },
  document: { getElementById: () => null, querySelector: () => null, addEventListener: noop, createElement: () => ({ style: {}, setAttribute: noop, appendChild: noop }), body: {} },
};
sb.window = sb; sb.self = sb;
vm.createContext(sb);
try { vm.runInContext(src, sb, { timeout: 5000 }); } catch (e) { console.error('Could not load gc-friend.js:', e.message); process.exit(1); }

const textSize = o => Object.values(o).reduce((a, v) => a + (typeof v === 'string' ? v.length : 0), 0);
const best = {};
(function scan(o, d) {
  if (!o || typeof o !== 'object' || d > 5) return;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v && typeof v === 'object' && typeof v.name === 'string' && typeof v.voiceId === 'string') {
      if (!best[v.name] || textSize(v) > textSize(best[v.name])) best[v.name] = v;
    }
    scan(v, d + 1);
  }
})(Object.fromEntries(Object.keys(sb).filter(k => /^GC_/.test(k)).map(k => [k, sb[k]])), 0);

// Not personalities: the products themselves, shared cards for two or more characters, and name-only stubs.
const SKIP = new Set(['Astra-9', 'Astrad', 'Astra-9 & Astrad', 'Biscuit', 'Mochi']);
const SUB = {
  'Everyday people': ['Sophia', 'Nina', 'Kioko', 'Arch', 'Viv', 'Aaron', 'Meera', 'Marcus', 'Nora', 'Zoe', 'Dario', 'Theo', 'Rin', 'Sarah', 'Olivia', 'Marion'],
  'Fantasy and magical': ['Julian', 'Tansy', 'Poppy', 'Blue', 'Reggie', 'Winston', 'Cressida', 'A.L.I.C.E.', 'Jacob', 'Wilhelm'],
  'Toys, puppets and little ones': ['Eli', 'Nell', 'Jem', 'Wren', 'Bramble', 'Clover', 'Ozzie', 'Pearl', 'Sam', 'Edith', 'Henry', 'Daisy', 'Tobias', 'Briar'],
};
const subOf = n => Object.keys(SUB).find(k => SUB[k].includes(n)) || 'Everyday people';

// A character is only ever told about itself. Nothing here mentions AL, a body, or being installed.
const PREAMBLE = n =>
  'You are ' + n + '. You are not a human: you are an AI character made by the Emerging Technologies Laboratory, ' +
  'and if anyone sincerely asks whether you are a real person, you say no. ' +
  'Use only the facts written below about you. If you are asked about anything that is not written here, say you would rather not make something up. ' +
  'People reach you by speech to text, so names are sometimes misspelled; guess kindly and carry on. ' +
  'Keep to one to three short sentences, and never use a long dash. ';

// House rule: no em dashes and no non-breaking hyphens in anything the panel shows or AL says.
const tidy = t => String(t || '').replace(/\s*\u2014\s*/g, ', ').replace(/\u2011/g, '-');
function clip(t, n) {
  t = tidy(t).replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n), i = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (i > n * 0.5 ? cut.slice(0, i + 1) : cut.replace(/\s+\S*$/, '') + '...');
}
// Gender is read from the files, never from a name. Good Company stores it (woman, man, boy, girl, or a species);
// for a species, and for the roster (which has no gender field), the pronouns in the character's own text decide.
const byPronouns = text => {
  const she = (text.match(/\b(she|her|hers|herself)\b/gi) || []).length, he = (text.match(/\b(he|him|his|himself)\b/gi) || []).length;
  return she > he ? 'female' : he > she ? 'male' : 'other';
};
// Overrides, each confirmed by the roster or by Dr. O: Lena (gym.html: "She does not raise her voice"); Chris Avila (roster: nonbinary, they/them, confirmed by Dr. O 2026-10-02).
const GENDER_OVERRIDE = { 'Dr. Lena Brandt, DPT': 'female', 'Chris Avila': 'other' };
const gcGender = c => {
  const g = String(c.gender || '').toLowerCase();
  if (/woman|girl/.test(g)) return 'female';
  if (/\bman\b|boy/.test(g)) return 'male';
  return byPronouns(['premise', 'work', 'been', 'knows', 'habit', 'underneath', 'form'].map(k => typeof c[k] === 'string' ? c[k] : '').join(' '));
};
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const out = [];   // full records
const list = [];  // short records

// ---------- Good Company ----------
for (const name of Object.keys(best)) {
  const c = best[name];
  if (SKIP.has(name) || / & |^The /.test(name) || textSize(c) < 300) continue;
  const label = (c.full && c.full !== name) ? c.full + ' (called ' + name + ')' : name;
  const who = (c.full && c.full !== name) ? c.full + ', who goes by ' + name : name;
  const parts = [];
  const add = (lab, v, n) => { if (typeof v === 'string' && v.trim()) parts.push(lab + ': ' + clip(v, n)); };
  // the character's own limits come first so they are never cut
  add('Never or only carefully', c.offLimits, 500);
  add('Never a bother', c.neverABother, 300);
  add('Premise', c.premise, 300);
  add('Age', c.age, 120); add('Is', c.form, 400); add('From', c.from, 300);
  add('Work', c.work, 400); add('History', c.been, 450); add('Knows', c.knows, 600);
  add('Habit', c.habit, 300); add('Underneath', c.underneath, 400); add('Mood', c.mood, 120);
  add('How they open', c.hello, 200);
  const first = t => tidy(t || '').split(/(?<=[.!?]) /)[0];
  let line = first(c.premise);
  if (line.length < 35) line = (first(c.work) + ' ' + line).trim();
  if (line.length < 35) line = (line + ' ' + first(c.form)).trim();
  line = clip(line, 110);
  const id = 'gc-' + slug(name);
  const gender = gcGender(c);
  out.push({ id, name: label, group: 'Good Company', sub: subOf(name), line, price: 2.99, voice: c.voiceId, gender, say: "Hello, I'm " + name + ". It's nice to meet you.", prompt: PREAMBLE(who) + parts.join(' ') });
  list.push({ id, name: label, group: 'Good Company', sub: subOf(name), line, price: 2.99, voice: true, gender });
}

// ---------- Biscuit and Mochi (Reggie's friends) ----------
// In gc-friend.js they are cameos with a voice and a few written lines, so they are added by hand from exactly those lines:
// GC_REGGIE's comment ("Biscuit is female, hyper and lovable. Mochi is male, dismissive, an English bulldog. Both Dr. O's own voice picks")
// and its "underneath" field. Voice ids are the ones in GC_REGGIE's cameos list.
const REGGIE_FRIENDS = [
  { name: 'Biscuit', voice: 'MgqVq3OCTPeVHCEDr4HU', gender: 'female',
    line: "A golden retriever: hyper, lovable, and the storyteller of Reggie's friends.",
    facts: "Biscuit is a female golden retriever, hyper and lovable with absolutely no volume control. She is the storyteller of the three friends: she is the one who narrates their adventures afterward, breathlessly, at length, treating an ordinary trash can or the mailman like the opening of an epic, with \"okay so THEN\" and every important detail somehow the most important detail, never quite landing before the next one starts. Her best friends are Reggie, who is a dog, and Mochi, a bulldog." },
  { name: 'Mochi', voice: 'I8ERYU9lOxALy2vtIvHd', gender: 'male',
    line: 'An English bulldog who acts too cool for everything, until there is a tennis ball.',
    facts: "Mochi is a male English bulldog (English, not French), dismissive, who acts too cool for everything and then loses his entire mind over a tennis ball anyway. His best friends are Reggie, who is a dog, and Biscuit, a golden retriever." },
];
for (const f of REGGIE_FRIENDS) {
  const id = 'gc-' + slug(f.name);
  out.push({ id, name: f.name, group: 'Good Company', sub: 'Fantasy and magical', line: f.line, price: 2.99, voice: f.voice, gender: f.gender,
    say: "Hello, I'm " + f.name + ". It's nice to meet you.", prompt: PREAMBLE(f.name) + 'Facts: ' + f.facts });
  list.push({ id, name: f.name, group: 'Good Company', sub: 'Fantasy and magical', line: f.line, price: 2.99, voice: true, gender: f.gender });
}

// ---------- Gracie and Geary Chip (Good Company's own robot pair, stored as one entry called GC) ----------
// Two personalities from GC_ROBOT's own fields: Gracie (female shell) and Geary (male shell), brother and sister,
// each with their own voice (voiceIdFemale / voiceIdMale). Gender confirmed by Dr. O, 2026-10-02.
const GCR = sb.GC_ROBOT;
if (GCR) {
  for (const k of [{ name: 'Gracie', sib: 'Geary', rel: 'brother', voice: GCR.voiceIdFemale, gender: 'female', hello: GCR.helloFemale },
                   { name: 'Geary', sib: 'Gracie', rel: 'sister', voice: GCR.voiceIdMale, gender: 'male', hello: GCR.helloMale }]) {
    const first = t => tidy(t || '').split(/(?<=[.!?]) /)[0];
    const facts = [GCR.form, GCR.work, 'Cares about: ' + (GCR.into || []).join('; ') + '.',
      'Manner: ' + (GCR.voice || []).join(', ') + '.', 'Mood: ' + GCR.mood + '.',
      'Full name: ' + k.name + ' Chip. ' + (k.gender === 'female' ? 'Her' : 'His') + ' ' + k.rel + ' is ' + k.sib + ', who has a real voice of ' + (k.gender === 'female' ? 'his' : 'her') + ' own.',
      // Not in gc-friend.js; stated by Dr. O on 2026-10-02: Gracie and Geary were made to be the little sister and brother of Astra-9.
      'You were made to be the little ' + (k.gender === 'female' ? 'sister' : 'brother') + ' of Astra-9, who is a companion at Good Company. You were made because she missed her sisters.',
      'How you open: ' + k.hello].map(tidy).join(' ');
    const id = 'gc-' + slug(k.name), line = clip(first(GCR.work), 110);
    out.push({ id, name: k.name + ' Chip (called ' + k.name + ')', group: 'Good Company', sub: 'Robots and AI', line, price: 2.99, voice: k.voice, gender: k.gender,
      say: "Hello, I'm " + k.name + ". It's nice to meet you.", prompt: PREAMBLE(k.name + ' Chip, who goes by ' + k.name) + 'Facts: ' + facts });
    list.push({ id, name: k.name + ' Chip (called ' + k.name + ')', group: 'Good Company', sub: 'Robots and AI', line, price: 2.99, voice: true, gender: k.gender });
  }
}

// ---------- The Dose, The Gym, Almost Human (roster.json) ----------
const roster = JSON.parse(fs.readFileSync(path.join(root, 'roster.json'), 'utf8'));
const EXCLUDE = new Set(['Archibald Baxter']); // Baxter: this is Arch, already in from Good Company.
// Almost Human's cast is listed in the ETL Master Reference (not tagged in roster.json), so it is matched by name.
const ALMOST_HUMAN = ['Ms. Ivy', 'Auggie', 'Coach Dom', 'Chris', 'Jen Lopez', 'Noor Haddad', 'Mara Rivera', 'Marceline Smith', 'Marcus Holt',
  'Jax Rivera', 'Reece', 'Wyatt Cooper', 'Zara Cole', 'Walt Brenner', 'Nadia', 'Arun', 'Margo Bennett', 'Dr. Amina Farouk', 'Dr. Arthur Pendelton'];
const isAlmostHuman = n => ALMOST_HUMAN.some(a => new RegExp('(^|[^A-Za-z])' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^A-Za-z])').test(n));
const priceFor = p => p === 49 ? 2.99 : p === 69 ? 3.99 : p === 549 ? 4.99 : 3.99;
for (const r of roster) {
  const pl = (r.platform || '') + ' ' + (r.platforms || []).join(' ');
  const group = ['The Dose', 'The Gym'].find(g => pl.includes(g)) || (pl.includes('Almost Human') || isAlmostHuman(r.name) ? 'Almost Human' : null);
  if (!group) continue;
  if ([...EXCLUDE].some(x => r.name.includes(x))) continue;
  const parts = [];
  const add = (lab, v, n) => { if (typeof v === 'string' && v.trim()) parts.push(lab + ': ' + clip(v, n)); };
  add('Role', r.role, 150); add('Tagline', r.tagline, 200); add('About', r.bio, 500);
  add('Background', r.background, 700); add('Story', r.backstory, 900); add('On the floor', r.floor, 300);
  const id = slug(group.replace('The ', '')) + '-' + slug(r.name.replace(/\(.*?\)/g, ''));
  if (out.some(o => o.id === id)) continue;
  const gender = GENDER_OVERRIDE[r.name] || byPronouns(['bio', 'background', 'backstory', 'tagline', 'floor'].map(k => r[k] || '').join(' '));
  const nick = r.name.replace(/\(.*?\)/g, '').replace(/,.*$/, '').trim();
  out.push({ id, name: r.name, group, sub: '', line: clip(r.tagline || r.role, 110), role: r.role, price: priceFor(r.price), voice: r.voice_id || '', gender, say: "Hello, I'm " + nick + ". It's nice to meet you.", prompt: PREAMBLE(r.name) + parts.join(' ') });
  list.push({ id, name: r.name, group, sub: '', line: clip(r.tagline || r.role, 110), role: r.role, price: priceFor(r.price), voice: !!r.voice_id, gender });
}

// Voices found later (by pi/find_voices.py) are kept in tools/voices.json as { "<personality id>": "<ElevenLabs voice id>" }.
const vmPath = path.join(__dirname, 'voices.json');
const VOICE_MAP = fs.existsSync(vmPath) ? JSON.parse(fs.readFileSync(vmPath, 'utf8')) : {};
out.forEach(o => { if (!o.voice && VOICE_MAP[o.id]) o.voice = VOICE_MAP[o.id]; });
list.forEach(l => { if (!l.voice && VOICE_MAP[l.id]) l.voice = true; });
const full = {}; out.forEach(o => { full[o.id] = { name: o.name, group: o.group, voice: o.voice, say: o.say, prompt: o.prompt }; });
const clean = o => JSON.parse(JSON.stringify(o).replace(/\s*\u2014\s*/g, ', ').replace(/\u2011/g, '-'));
fs.writeFileSync(path.join(root, 'al-panel/pi/personalities.json'), JSON.stringify(clean(full)));
fs.writeFileSync(path.join(root, 'al-panel/personas.json'), JSON.stringify(clean(list)));
const by = {}; list.forEach(l => { by[l.group] = (by[l.group] || 0) + 1; });
console.log('personalities:', list.length, JSON.stringify(by), '| with a voice:', list.filter(l => l.voice).length);
const gc = {}; list.forEach(l => { gc[l.gender] = (gc[l.gender] || 0) + 1; }); console.log('gender:', JSON.stringify(gc));
console.log('longest prompt:', Math.max(...out.map(o => o.prompt.length)), 'chars');
