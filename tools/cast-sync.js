/* cast-sync — roster.json is the source. Everything else is downstream of it.
 *
 *   node tools/cast-sync.js          report only, changes nothing
 *   node tools/cast-sync.js --write  regenerate what is safe to regenerate
 *
 * WHY THIS EXISTS
 * ---------------
 * There was never a drift problem between three copies of one file. There was
 * a dead build pipeline and a live file that was never part of it:
 *
 *     ETL_Agent_Roster.xlsx -> build_agent_data.py -> data/agents.generated.json
 *                                                  -> data/etl-agents-roster.json
 *
 * That pipeline last ran on 2026-06-08. The spreadsheet was last touched on
 * 2026-07-08. Every character change since has gone into roster.json, which
 * the pipeline has never heard of. So each attempt to "fix the drift" was
 * hand-editing build outputs of a spreadsheet nobody updates: it looked fixed
 * and could not hold, because the files still said "do not hand-edit" and
 * still pointed at a source that had moved on without them.
 *
 * THE TWO DOWNSTREAM FILES ARE NOT THE SAME KIND OF THING
 * ------------------------------------------------------
 * data/agents.generated.json is a thin index, {name, platform, hasMCP} plus
 * totals. Purely derived. This script rebuilds it.
 *
 * data/etl-agents-roster.json is NOT a copy. It carries its own schema and its
 * own authored content: consent, real_person_disclosure, price_monthly,
 * interview_protocol_ref, person_type, and six people who exist in no other
 * file, including Dr. O herself, flagged real_living_person with a consent
 * record. Regenerating it from roster.json would delete her and destroy
 * consent data. So this script NEVER writes it. It reports on it and stops.
 *
 * If you are a future session told to "fix the drift": do not rebuild the
 * studio file. Read the paragraph above twice.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WRITE = process.argv.includes('--write');
const read = (p) => {
  const raw = fs.readFileSync(path.join(ROOT, p), 'utf8');
  return { raw, bom: raw.charCodeAt(0) === 0xFEFF, data: JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw) };
};

const roster = read('roster.json').data;
if (!Array.isArray(roster)) throw new Error('roster.json is not an array any more');

let problems = 0;
/* Counted separately, because only these can fail a deploy: they are faults in
   the source that this script cannot repair. See the exit code at the bottom. */
let sourceProblems = 0;
const say = (ok, line) => { if (!ok) problems++; console.log((ok ? '  ok    ' : '  FAIL  ') + line); };
const saySource = (ok, line) => { if (!ok) sourceProblems++; say(ok, line); };

console.log('\nroster.json  ' + roster.length + ' characters   (the source)');

/* ── 1. Integrity of the source itself. ─────────────────────────────────── */
console.log('\nthe source');
const names = roster.map((a) => a.name);
saySource(new Set(names).size === names.length, 'every name is unique');

const missing = roster.filter((a) => {
  const u = String(a.image_url || '');
  if (!u) return true;
  return !fs.existsSync(path.join(ROOT, decodeURIComponent(u.replace(/^https?:\/\/[^/]+\//, ''))));
});
saySource(missing.length === 0, 'every portrait resolves' + (missing.length ? ' (' + missing.length + ' do not: ' + missing.slice(0, 4).map((a) => a.name).join(', ') + ')' : ''));

const byFile = {};
roster.forEach((a) => {
  const f = String(a.image_url || '').split('/').pop();
  if (f) (byFile[f] = byFile[f] || []).push(a.name);
});
const shared = Object.entries(byFile).filter(([, who]) => who.length > 1);
saySource(shared.length === 0, 'nobody is wearing anybody else’s face' +
  (shared.length ? ' (' + shared.map(([f, w]) => f + ' <- ' + w.join(' + ')).join('; ') + ')' : ''));

/* Where an agent works, said twice and having to match.

   platform is a display string joined with " / " and platforms is the array.
   Nothing had ever compared them, so Von Gupta spent months recorded as
   working in one place by the string and two by the array, when the answer was
   three. A field nobody checks is a field that quietly rots. */
const placeMismatch = roster.filter((a) => {
  const fromString = String(a.platform || "").split(" / ").map((x) => x.trim()).filter(Boolean);
  const list = Array.isArray(a.platforms) ? a.platforms : [];
  return fromString.length !== list.length || !fromString.every((x) => list.includes(x));
});
saySource(placeMismatch.length === 0, "platform and platforms agree" +
  (placeMismatch.length ? " (" + placeMismatch.length + " do not: " + placeMismatch.slice(0, 3).map((a) => a.name).join(", ") + ")" : ""));

/* Mis-encoded text. Ã and Â before another high character mean UTF-8 was read
   once as Latin-1: that is how "Ben-SaÃ¯d" and "Core Â· six-pack" happened. */
const mojibake = read('roster.json').raw.match(/[Â-Ã][-¿]/g) || [];
saySource(mojibake.length === 0, 'no mis-encoded characters' + (mojibake.length ? ' (' + mojibake.length + ' found)' : ''));

/* ── 2. The derived index. Rebuilt from the roster. ─────────────────────── */
console.log('\ndata/agents.generated.json   derived, safe to rebuild');
const genPath = 'data/agents.generated.json';
const gen = read(genPath).data;
const hasMcp = (a) => (/^\s*yes/i.test(String(a.mcp || '')) ? 1 : 0);

/* The backpack rate is displayed on the neighbourhood page, so it has to keep
   meaning what it has always meant: how much of the whole cast carries tools.

   I nearly changed that definition on a false premise. I had recorded the
   thirty new characters as carrying nothing, which would have dropped the
   figure from 65% to 54% and made a staff-only rate look like the honest
   repair. Dr. O said to verify it, and twenty of the thirty do carry tools:
   Kronborg, the Sherlock standing cast and the PTX 4990 pair all reach
   Wikipedia, and Sherlock also pulls the real observed weather and light for
   Dayton. Only the ten princesses carry nothing, which is right for a wing
   built to be free.

   So the original definition stands and the number goes UP. The staff count
   sits beside it for anyone who wants the narrower figure. */
const staff = roster.filter((a) => a.hireable);
const backpack = roster.filter(hasMcp).length;
const rebuilt = {
  _comment: 'GENERATED by tools/cast-sync.js from roster.json, which is the source. Do not hand-edit. Run: node tools/cast-sync.js --write',
  total: roster.length,
  staff: staff.length,
  safe_floor: (Math.floor(roster.length / 25) * 25) + '+',
  backpack,
  /* Of the whole cast, which is what it has always meant. */
  backpack_pct: Math.round((backpack / roster.length) * 100),
  /* platforms as well as platform. Twenty-one agents work in more than one
     place, and the string joins them with " / ", so anything grouping by the
     string alone invents a platform called "The Dose / The Gym" and files
     Wyatt under it instead of under both. */
  agents: roster.map((a) => ({
    name: a.name,
    platform: a.platform,
    platforms: Array.isArray(a.platforms) && a.platforms.length ? a.platforms : [a.platform],
    hasMCP: hasMcp(a),
  })),
};
const same = JSON.stringify(gen) === JSON.stringify(rebuilt);
if (same) say(true, 'already matches the roster (' + gen.agents.length + ')');
else if (WRITE) {
  fs.writeFileSync(path.join(ROOT, genPath), JSON.stringify(rebuilt, null, 2) + '\n');
  console.log('  built   ' + gen.agents.length + ' -> ' + rebuilt.agents.length + ' characters');
} else {
  say(false, 'out of date: ' + gen.agents.length + ' here vs ' + roster.length + ' in the roster. Run with --write');
}

/* ── 3. The studio file. Reported on, never written. ────────────────────── */
console.log('\ndata/etl-agents-roster.json  NOT derived, never rebuilt by this script');
const studio = read('data/etl-agents-roster.json').data;
const sAgents = studio.agents || [];
const inRoster = new Set(names);
const onlyStudio = sAgents.filter((a) => !inRoster.has(a.name));
const sNames = new Set(sAgents.map((a) => a.name));
const sellable = roster.filter((a) => a.hireable && !sNames.has(a.name));
console.log('  holds ' + sAgents.length + ', with its own schema: consent, real_person_disclosure, price_monthly, person_type');
console.log('  only here, and must never be deleted: ' + onlyStudio.length);
onlyStudio.forEach((a) => console.log('     ' + a.name + (a.person_type ? '  [' + a.person_type + ']' : '') + (a.consent ? '  [has a consent record]' : '')));
console.log('  hireable in the roster but absent here: ' + sellable.length + (sellable.length ? '  (' + sellable.slice(0, 6).map((a) => a.name).join(', ') + (sellable.length > 6 ? ', …' : '') + ')' : ''));
console.log('  -> these are for a person to decide, one at a time. This script will not touch them.');

/* ── 4. The retired pipeline. ───────────────────────────────────────────── */
console.log('\nthe old pipeline');
const dead = [
  '../EMERGING_TECH_LAB/ETL_Agent_Roster.xlsx',
  '../EMERGING_TECH_LAB/build_agent_data.py',
];
dead.forEach((p) => {
  const full = path.join(ROOT, p);
  console.log('  ' + (fs.existsSync(full) ? 'still on disk, RETIRED, do not run: ' : 'gone: ') + p.replace('../', ''));
});
console.log('  it last ran 2026-06-08 and predates roster.json as the working file.');

/* What is worth failing a deploy over, and what is not.
 *
 * This runs as the Netlify build command, so a non-zero exit here stops the
 * site from deploying. That is a serious thing to hand to a script, and the
 * line is drawn deliberately:
 *
 *   A STALE DERIVED INDEX IS NOT A FAILURE. In --write mode it was just
 *   rebuilt, so the deploy carries the correct file. Failing over a problem
 *   the script has already fixed would block an urgent change for no reason.
 *
 *   A BROKEN SOURCE IS A FAILURE. A missing portrait, two characters sharing
 *   one face, a duplicate name, mis-encoded text: those cannot be fixed here
 *   and they are exactly the faults that have shipped unnoticed before,
 *   because nothing about them looks broken on the page. Better a failed
 *   deploy than another month of an agent wearing somebody else's face.
 */
const sourceBroken = problems > 0 && (WRITE ? sourceProblems > 0 : true);
console.log('\n' + (problems ? problems + ' problem(s)' : 'all checks pass') + (WRITE ? '' : '   (report only; pass --write to rebuild the derived index)'));
if (WRITE && sourceProblems > 0) console.log('FAILING THE BUILD: the source itself has ' + sourceProblems + ' problem(s), which this script cannot fix.');
process.exit(sourceBroken ? 1 : 0);
