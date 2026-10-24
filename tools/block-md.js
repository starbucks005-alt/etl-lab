#!/usr/bin/env node
/* block-md: keeps every .md file in the repository off the public website.
   Netlify cannot match "every .md file" in one rule, so netlify.toml lists each one between
   "# BEGIN MD BLOCK" and "# END MD BLOCK". Run this after adding a .md file:  node tools/block-md.js
   Dr. O, 2026-10-24: "block or hide the md files". It only changes the web address; the files stay in the repository. */
const fs = require('fs');
const { execFileSync } = require('child_process');
const toml = 'netlify.toml';
const files = execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' }).split('\n').filter(Boolean).sort();
const rule = (from) => `[[redirects]]\n  from = "${from}"\n  to = "/404.html"\n  status = 404\n  force = true\n`;
let s = fs.readFileSync(toml, 'utf8');
const a = s.indexOf('# BEGIN MD BLOCK'), b = s.indexOf('# END MD BLOCK');
if (a < 0 || b < 0) { console.error('The markers are missing from netlify.toml.'); process.exit(1); }
const body = ['# BEGIN MD BLOCK', rule('/specs/*'), ...files.map((f) => rule('/' + f))].join('\n') + '\n';
s = s.slice(0, a) + body + s.slice(b);
fs.writeFileSync(toml, s);
console.log('Blocked ' + files.length + ' .md files plus the specs folder.');
