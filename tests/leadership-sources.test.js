/* leadership-sources.test.js, the promise that a leader never invents a link.
   Plain node, no framework, no install needed: `node tests/leadership-sources.test.js`.

   The ETL Leadership Classroom tells students, on the page and in every
   persona, that these agents hand over real sources and fabricate nothing.
   That promise has two halves and both can rot quietly:

   1. A NEW AGENT ADDED WITHOUT THE SOURCE RULES. The rules are appended to
      every persona in one loop for exactly this reason, and this test fails if
      any agent slips out of it.
   2. A LINK TYPED FROM MEMORY. Every address a leader is allowed to say is in
      ARCHIVES, checked against the holding institution when it was added. A URL
      that appears anywhere else in a prompt is one nobody verified, which is
      the failure mode the whole design exists to prevent.

   The Anthropic and Netlify packages are stubbed below so this runs on a bare
   checkout. Nothing here reaches the network: the live lookup is exercised
   against a fake fetch, which is the parsing, not the catalogue.
*/

const Module = require('module');
const origLoad = Module._load;
Module._load = function (request) {
  if (request === '@anthropic-ai/sdk') return { default: class Stub {} };
  if (request === '@netlify/blobs') return { getStore: () => null, connectLambda: () => {} };
  return origLoad.apply(this, arguments);
};

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? ', ' + detail : ''}`); }
}

const chat = require('../netlify/functions/leadership-chat.js');
const voice = require('../netlify/functions/leadership-voice.js');
const { AGENTS, ARCHIVES, TOOLS } = chat;

console.log('\nThe backpack');
const toolNames = TOOLS.map((t) => t.name);
check('the leaders carry a real source lookup as well as Wikipedia',
  toolNames.includes('find_scholarship') && toolNames.includes('get_wikipedia_info'));
check('and still finish every turn through deliver_reply', toolNames.includes('deliver_reply'));

console.log('\nEvery persona, no exceptions');
Object.keys(AGENTS).forEach((key) => {
  const system = AGENTS[key].system || '';
  check(`${key} carries the source rules`, system.includes('GIVING A STUDENT A SOURCE'));
  check(`${key} is told what their own record is`, /YOUR OWN RECORD/.test(system));
  check(`${key} is told not to pretend to have read what came after them`,
    /published after your own lifetime/.test(system));
  check(`${key} has no em dash`, !system.includes('—'));
});

console.log('\nNo address nobody checked');
const URL_RE = /https?:\/\/[^\s,)"']+/g;
Object.keys(AGENTS).forEach((key) => {
  const known = (ARCHIVES[key] || []).join(' ');
  const strays = (AGENTS[key].system.match(URL_RE) || []).filter((u) => !known.includes(u));
  check(`${key} says only addresses that are in ARCHIVES`, strays.length === 0, strays.join(' '));
});
Object.keys(ARCHIVES).forEach((key) => {
  const bad = ARCHIVES[key].filter((line) => !/https:\/\//.test(line) || /[.,;]$/.test(line.trim()));
  check(`${key}'s archive lines are https and end on the address itself`, bad.length === 0, bad.join(' | '));
});

console.log('\nThe live lookup');
(async () => {
  const realFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      results: [{
        display_name: 'Leading in extremis',
        publication_year: 2019,
        doi: 'https://doi.org/10.1000/xyz',
        authorships: [{ author: { display_name: 'A. Researcher' } }],
        primary_location: { source: { display_name: 'Journal of Leadership Studies' } },
        open_access: { oa_url: 'https://example.org/open.pdf' },
      }],
    }),
  });
  const found = await chat.executeTool('find_scholarship', { query: 'crisis leadership' });
  check('a found paper comes back with its real link', found.includes('https://example.org/open.pdf'));
  check('and the agent is told to add nothing to the list', /do not add a source/i.test(found));

  global.fetch = async () => ({ ok: false, status: 503 });
  const failed = await chat.executeTool('find_scholarship', { query: 'crisis leadership' });
  check('a failed lookup says so instead of naming a paper',
    /did not come back/.test(failed) && !/https?:\/\//.test(failed));
  global.fetch = realFetch;

  console.log('\nWhat the room actually hears');
  const spoken = voice.spokenText('Read it at https://www.gutenberg.org/ebooks/5199.');
  check('an address is not spelled out loud', !/gutenberg/.test(spoken) && /on your screen/.test(spoken));
  check('and a reply without one is left alone',
    voice.spokenText('No address here.') === 'No address here.');

  console.log(failures === 0 ? '\nThe leaders can hand over a source, and cannot invent one.\n'
    : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
