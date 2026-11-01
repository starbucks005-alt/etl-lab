// The panel's own script: every variable it keeps is declared. A missing "var" once left the story library dead (opening it threw an error before anything drew).
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'rising-sun', 'box-panel.html'), 'utf8');
const script = html.split('<script>').map((x) => x.split('</script>')[0]).filter((x) => /function openLib/.test(x))[0] || '';
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
ok(script.length > 1000, 'found the panel script');
try { new Function(script); } catch (e) { ok(false, 'the panel script has a syntax error: ' + e.message); }
// every name the story library keeps between calls must have a var
for (const n of ['lastErr', 'recorded', 'recording', 'written', 'armed', 'playingId', 'audioEl', 'pollTimer', 'RECORDABLE']) {
  ok(new RegExp('\\bvar\\b[^;]*\\b' + n + '\\b\\s*=').test(script), n + ' is declared');
}
console.log(bad ? bad + ' check(s) failed' : 'box panel script: parses, and the library\'s names are declared');
process.exit(bad ? 1 : 0);
