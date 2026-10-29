/* A stand-in website for tests/al_fireside_test.py: the real director (netlify/functions/fireside.js) with its rows kept in memory.
   Run: node tests/fireside_test_server.js PORT */
const http = require('http');
const fn = require('../netlify/functions/fireside.js');
const rows = [];
let clock = 0;
const mem = {
  async load() {
    if (!rows.length) return { rev: 0, state: null };
    const top = Math.max(...rows.map(x => x.rev));
    const w = rows.filter(x => x.rev === top).sort((a, b) => a.at - b.at)[0];
    return { rev: w.rev, state: JSON.parse(JSON.stringify(w.state)) };
  },
  async commit(room, rev, state) {
    await new Promise(r => setTimeout(r, Math.random() * 5));          // as if the database took a moment, so changes can cross
    const row = { rev, state: JSON.parse(JSON.stringify(state)), at: ++clock };
    rows.push(row);
    return rows.filter(x => x.rev === rev).sort((a, b) => a.at - b.at)[0] === row && Math.max(...rows.map(x => x.rev)) === rev;
  },
};
fn._setStore(() => mem);
http.createServer((req, res) => {
  let b = '';
  req.on('data', d => { b += d; });
  req.on('end', async () => {
    const r = await fn.handler({ httpMethod: req.method, body: b });
    res.writeHead(r.statusCode, r.headers);
    res.end(r.body);
  });
}).listen(Number(process.argv[2]), '127.0.0.1', () => console.log('ready'));
