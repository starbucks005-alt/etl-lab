/* etl-icons.test.js, the promise that a page shows the right lab's mark.
   Plain node, no framework, no install needed: `node tests/etl-icons.test.js`.

   Dr. O, 2026-09-17, with a screenshot of the lab front page open on her
   phone: "when ETL webpage is open the AH logo is what shows, not ETL."

   Two faults were sitting behind that, and neither one looks broken in a
   diff, which is why they both lived here for months:

   1. index.html, the front door, named no icon at all. A browser with nothing
      on the page to go on asks for /favicon.ico, and /favicon.ico here is the
      Founder Studio mark. Twenty-seven more ETL pages had the same gap.
   2. Ten pages named /brand/etl-favicon.svg and one named img/etl-favicon.png.
      Neither file was in the repository. A 404 lands in exactly the same
      place: the Founder Studio mark.

   So this checks the two things a person cannot see by reading the page:
   that every icon a page names is really here, and that the front door names
   one at all.

   WHAT THIS DOES NOT CHECK, because it is not in this repository: which app
   an Android phone opens an emerging-tech-lab.com link in. See
   .well-known/assetlinks.json.
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? ', ' + detail : ''}`); }
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'tests']);
function pages(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...pages(full));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

const ICON_TAG = /<link[^>]*\brel=["']?(?:apple-touch-icon(?:-precomposed)?|shortcut icon|icon)["']?[^>]*>/gi;
const HREF = /\bhref=["']([^"']+)["']/i;

function iconHrefs(html) {
  const found = [];
  for (const tag of html.match(ICON_TAG) || []) {
    const m = tag.match(HREF);
    if (m) found.push(m[1]);
  }
  return found;
}

function resolves(href, pageFile) {
  if (/^(data:|https?:|\/\/)/i.test(href)) return true; // not ours to check
  const clean = href.split(/[?#]/)[0];
  const target = clean.startsWith('/')
    ? path.join(ROOT, clean.slice(1))
    : path.resolve(path.dirname(pageFile), clean);
  return fs.existsSync(target);
}

console.log('\nEvery icon a page names is really here');
const broken = [];
for (const page of pages(ROOT)) {
  const html = fs.readFileSync(page, 'utf8');
  for (const href of iconHrefs(html)) {
    if (!resolves(href, page)) broken.push(`${path.relative(ROOT, page)} -> ${href}`);
  }
}
check('no page points at an icon file that is not in the repository',
  broken.length === 0, broken.join('; '));

console.log('\nThe front door');
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const frontHrefs = iconHrefs(index);
check('index.html names an icon at all', frontHrefs.length > 0);
check('and it is an ETL mark, not another product on this domain',
  frontHrefs.length > 0 && frontHrefs.every((h) => /etl|favicon_etl/i.test(h)),
  frontHrefs.join(' '));
check('including one on a solid tile, for a phone home screen',
  /rel=["']apple-touch-icon["']/i.test(index));

console.log(failures === 0 ? '\nEvery page that names a mark names one that exists.\n'
  : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
