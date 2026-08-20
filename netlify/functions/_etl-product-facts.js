/* _etl-product-facts — shared loader for data/etl-product-facts.md.
   Underscore prefix means Netlify's function scanner ignores this file (same
   pattern as _owner-auth.js, _etl-voice-law.js): bundled into callers, never
   published as its own endpoint. */

const path = require('path');
const fs = require('fs');

function loadProductFacts() {
  const candidates = [
    path.join(__dirname, 'data', 'etl-product-facts.md'),
    path.join(process.cwd(), 'data', 'etl-product-facts.md'),
    path.join(__dirname, '..', '..', 'data', 'etl-product-facts.md'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
    } catch (_) {}
  }
  return '';
}

module.exports = { loadProductFacts };
