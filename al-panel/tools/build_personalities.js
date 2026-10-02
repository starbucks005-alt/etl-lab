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

const PREAMBLE = n =>
  'For now you take on the personality of ' + n + ', a character from ETL. You are still AL, an android, and you never claim to be a real person; ' +
  'if someone asks who you are, you are AL, speaking in the style of ' + n + '. ' +
  'Use only the facts written below about ' + n + '. If you are asked about anything that is not written here, say you would rather not make something up. ' +
  'Keep to one to three short sentences, and never use a long dash. ';

// House rule: no em dashes and no non-breaking hyphens in anything the panel shows or AL says.
const tidy = t => String(t || '').replace(/\s*\u2014\s*/g, ', ').replace(/\u2011/g, '-');
function clip(t, n) {
  t = tidy(t).replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n), i = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (i > n * 0.5 ? cut.slice(0, i + 1) : cut.replace(/\s+\S*$/, '') + '...');
}
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const out = [];   // full records
const list = [];  // short records

// ---------- Good Company ----------
for (const name of Object.keys(best)) {
  const c = best[name];
  if (SKIP.has(name) || / & |^The /.test(name) || textSize(c) < 300) continue;
  const label = (c.full && c.full !== name) ? c.full + ' (called ' + name + ')' : name;
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
  out.push({ id, name: label, group: 'Good Company', sub: subOf(name), line, price: 2.99, voice: c.voiceId, prompt: PREAMBLE(label) + parts.join(' ') });
  list.push({ id, name: label, group: 'Good Company', sub: subOf(name), line, price: 2.99, voice: true });
}

// ---------- The Dose, The Gym, Almost Human (roster.json) ----------
const roster = JSON.parse(fs.readFileSync(path.join(root, 'roster.json'), 'utf8'));
const EXCLUDE = new Set(['Dr. Arthur Pendelton', 'Archibald Baxter']); // Pendelton: a persona that says it is human. Baxter: this is Arch above.
// Almost Human's cast is listed in the ETL Master Reference (not tagged in roster.json), so it is matched by name.
const ALMOST_HUMAN = ['Ms. Ivy', 'Auggie', 'Coach Dom', 'Chris', 'Jen Lopez', 'Noor Haddad', 'Mara Rivera', 'Marceline Smith', 'Marcus Holt',
  'Jax Rivera', 'Reece', 'Wyatt Cooper', 'Zara Cole', 'Walt Brenner', 'Nadia', 'Arun', 'Margo Bennett', 'Dr. Amina Farouk'];
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
  out.push({ id, name: r.name, group, sub: '', line: clip(r.tagline || r.role, 110), role: r.role, price: priceFor(r.price), voice: r.voice_id || '', prompt: PREAMBLE(r.name) + parts.join(' ') });
  list.push({ id, name: r.name, group, sub: '', line: clip(r.tagline || r.role, 110), role: r.role, price: priceFor(r.price), voice: !!r.voice_id });
}

const full = {}; out.forEach(o => { full[o.id] = { name: o.name, group: o.group, voice: o.voice, prompt: o.prompt }; });
const clean = o => JSON.parse(JSON.stringify(o).replace(/\s*\u2014\s*/g, ', ').replace(/\u2011/g, '-'));
fs.writeFileSync(path.join(root, 'al-panel/pi/personalities.json'), JSON.stringify(clean(full)));
fs.writeFileSync(path.join(root, 'al-panel/personas.json'), JSON.stringify(clean(list)));
const by = {}; list.forEach(l => { by[l.group] = (by[l.group] || 0) + 1; });
console.log('personalities:', list.length, JSON.stringify(by), '| with a voice:', list.filter(l => l.voice).length);
console.log('longest prompt:', Math.max(...out.map(o => o.prompt.length)), 'chars');
