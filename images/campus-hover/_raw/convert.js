// One-time batch convert: raw full-page PNG screenshots -> compressed WebP
// thumbnails sized for the campus card hover layer. Re-run if a card's
// screenshot needs refreshing (re-capture the PNG first, then re-run this).
const fs = require('fs');
const path = require('path');
const sharp = require(path.join(__dirname, '..', '..', '..', 'node_modules', 'sharp'));

const RAW = __dirname;
const OUT = path.join(__dirname, '..');

const files = fs.readdirSync(RAW).filter(f => f.endsWith('.png'));

(async () => {
  let ok = 0, fail = 0;
  for (const f of files) {
    const slug = f.replace(/\.png$/, '');
    const src = path.join(RAW, f);
    const dst = path.join(OUT, slug + '.webp');
    try {
      const stat = fs.statSync(src);
      if (stat.size < 2000) { console.log('SKIP (too small, likely failed capture):', f, stat.size); fail++; continue; }
      await sharp(src)
        .resize(640, 400, { fit: 'cover', position: 'top' })
        .webp({ quality: 68 })
        .toFile(dst);
      ok++;
      console.log('ok:', slug + '.webp');
    } catch (e) {
      fail++;
      console.log('FAILED:', f, e.message);
    }
  }
  console.log(`DONE: ${ok} converted, ${fail} failed`);
})();
