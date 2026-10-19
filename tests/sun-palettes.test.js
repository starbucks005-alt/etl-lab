/* The Rising Sun panel's palettes come from Good Company's gc-skin.css. Light or dark is measured from each palette's own background, and every pair the panel reads is checked for contrast. */
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/../rising-sun/panel.html', 'utf8');
const gc = fs.readFileSync(__dirname + '/../good-company/gc-skin.css', 'utf8');
let bad = 0;
const check = (ok, label) => { if (!ok) bad++; console.log((ok ? '  ok    ' : '  FAIL  ') + label); };
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (h) => { const n = parseInt(h.slice(1, 7), 16); return 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const gcNames = [...gc.matchAll(/\[data-skin="([a-z-]+)"\]\s*\{/g)].map((m) => m[1]);
const mine = [...html.matchAll(/:root\[data-palette="([a-z-]+)"\]\{([^}]*)\}/g)];
check(mine.length === gcNames.length, 'every Good Company palette is in the panel (' + mine.length + ' of ' + gcNames.length + ')');
mine.forEach(([, n, body]) => {
  const v = Object.fromEntries([...body.matchAll(/((?:--)?[a-z0-9-]+):([^;]+)/g)].map((m) => [m[1], m[2]]));
  const dark = lum(v['--bg']) < 0.2;
  check(v['color-scheme'] === (dark ? 'dark' : 'light'), n + ': measured ' + (dark ? 'dark' : 'light') + ', declared the same');
  check(ratio(v['--ink'], v['--bg']) >= 7, n + ': text on the page is at least 7:1');
  check(ratio(v['--ink'], v['--panel']) >= 7, n + ': text on a card is at least 7:1');
  check(ratio(v['--mute'], v['--panel']) >= 4.5, n + ': soft text on a card is at least 4.5:1');
  check(ratio(v['--on-accent'], v['--accent']) >= 4.5, n + ': button text is at least 4.5:1');
  check(ratio(v['--link'], v['--bg']) >= 4.5 && ratio(v['--link'], v['--panel']) >= 4.5, n + ': links and accent text are at least 4.5:1');
});
const opts = [...html.matchAll(/<option value="([a-z-]+)">/g)].map((m) => m[1]);
check(gcNames.every((n) => opts.indexOf(n) > -1), 'every palette is in the picker');

/* The web page carries the same palettes, and the same measuring. */
const land = fs.readFileSync(__dirname + '/../rising-sun/index.html', 'utf8');
const lmine = [...land.matchAll(/:root\[data-palette="([a-z-]+)"\]\{([^}]*)\}/g)];
check(lmine.length === gcNames.length, 'the web page has every Good Company palette (' + lmine.length + ' of ' + gcNames.length + ')');
lmine.forEach(([, n, body]) => {
  const v = Object.fromEntries([...body.matchAll(/((?:--)?[a-z0-9-]+):([^;]+)/g)].map((m) => [m[1], m[2]]));
  const dark = lum(v['--bg']) < 0.2;
  check(v['color-scheme'] === (dark ? 'dark' : 'light'), 'page ' + n + ': light or dark measured and declared the same');
  check(ratio(v['--ink'], v['--bg']) >= 7 && ratio(v['--ink'], v['--panel']) >= 7, 'page ' + n + ': text is at least 7:1');
  check(ratio(v['--mute'], v['--bg']) >= 4.5 && ratio(v['--mute'], v['--panel']) >= 4.5, 'page ' + n + ': soft text is at least 4.5:1');
  check(ratio(v['--on'], v['--accent']) >= 4.5, 'page ' + n + ': button text is at least 4.5:1');
  check(ratio(v['--link'], v['--bg']) >= 4.5 && ratio(v['--link'], v['--panel']) >= 4.5, 'page ' + n + ': links are at least 4.5:1');
});
check(/id="pal"/.test(land) && gcNames.every((n) => land.indexOf('<option value="' + n + '">') > -1), 'the web page has the palette picker');
check(/\.wrap\{max-width:none;margin:0;padding:0\}/.test(land), 'the web page has no side padding');
process.exit(bad ? 1 : 0);
