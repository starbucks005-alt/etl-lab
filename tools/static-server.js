/* A plain static server, so a page can be looked at before it is shipped.

   No dependencies on purpose: this exists to answer "what does that actually
   look like on screen", which is the question that would have saved the most
   time on this product. */
const http = require('http');
const fs = require('fs');
const path = require('path');

/* Anchored to the site rather than to wherever this was launched from, so it
   serves the same paths the deployed site does no matter who starts it. */
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url === '/' ? '/index.html' : url);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('no'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found: ' + url); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
                         'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(4173, () => console.log('looking at the castle on http://localhost:4173'));
