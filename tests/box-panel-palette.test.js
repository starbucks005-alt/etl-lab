// The box panel's Palette menu: every palette in Good Company's list is offered, the choice is remembered and applied before the
// page paints, and each palette's text colours read at 4.5 to 1 or better on its own background (measured, not hand-kept).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'rising-sun', 'box-panel.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'good-company', 'gc-skin.js'), 'utf8');
let bad = 0;
function ok(c, m) { if (!c) { bad++; console.log('FAIL ' + m); } }

const keys = [...js.matchAll(/key:'([a-z]+)',\s*label:'([^']+)'/g)].map(m => m[1]);
ok(keys.length >= 26, 'Good Company lists at least 26 palettes, found ' + keys.length);
ok(html.includes('id="palBtn"'), 'the Palette button is in the header');
ok(html.includes("localStorage.getItem('panel-skin')"), 'the saved palette is applied before the page paints');
for (const k of keys) {
  ok(html.includes('html:root[data-skin="' + k + '"]'), 'palette ' + k + ' has its colours on the box panel');
}

function lum(h) { const c = [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4)); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; }
function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
for (const k of keys) {
  const m = html.match(new RegExp('html:root\\[data-skin="' + k + '"\\]\\{([^}]*)\\}'));
  if (!m) continue;
  const v = Object.fromEntries([...m[1].matchAll(/(--[a-z-]+):(#[0-9a-fA-F]{6})/g)].map(x => [x[1], x[2]]));
  const pairs = [['--ink', '--panel'], ['--text', '--panel'], ['--mute', '--panel'], ['--accent', '--panel'], ['--on-accent', '--accent'], ['--status', '--status-bg']];
  for (const [a, b] of pairs) ok(v[a] && v[b] && ratio(v[a], v[b]) >= 4.49, k + ': ' + a + ' on ' + b + ' is ' + (v[a] && v[b] ? ratio(v[a], v[b]).toFixed(2) : 'missing'));
}
console.log(bad ? bad + ' check(s) failed' : 'box panel palettes: all ' + keys.length + ' present and readable');
process.exit(bad ? 1 : 0);
