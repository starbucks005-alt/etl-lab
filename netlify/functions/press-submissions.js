/* ─────────────────────────────────────────────────────────────────────────────
   press-submissions — admin inbox for contact-form messages received via
   press-contact (reader -> reporter / desk messages).

   GET  /.netlify/functions/press-submissions               -- HTML inbox view
   POST /.netlify/functions/press-submissions?action=mark   -- mark id read

   Admin-gated via HTTP Basic (PRESS_ADMIN_USER + PRESS_ADMIN_PASS).

   Note: contributor APPLICATIONS go through Netlify Forms (file uploads
   require native form handling), so applications land in the Netlify
   dashboard under Forms - NOT here. This inbox is for reader/reporter
   contact messages only.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

function requireBasicAuth(event) {
  const user = process.env.PRESS_ADMIN_USER;
  const pass = process.env.PRESS_ADMIN_PASS;
  if (!user || !pass) return { ok: false, response: { statusCode: 503, body: 'admin disabled' } };
  const header = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!header.toLowerCase().startsWith('basic ')) {
    return { ok: false, response: { statusCode: 401, headers: { 'WWW-Authenticate': 'Basic realm="ETL Press Admin"' }, body: 'auth required' } };
  }
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
    const idx = decoded.indexOf(':');
    if (idx === -1) throw new Error();
    if (decoded.slice(0, idx) !== user || decoded.slice(idx + 1) !== pass) {
      return { ok: false, response: { statusCode: 401, headers: { 'WWW-Authenticate': 'Basic realm="ETL Press Admin"' }, body: 'invalid credentials' } };
    }
  } catch {
    return { ok: false, response: { statusCode: 401, headers: { 'WWW-Authenticate': 'Basic realm="ETL Press Admin"' }, body: 'invalid auth' } };
  }
  return { ok: true };
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let REPORTERS = null;
function getReporterName(id) {
  if (!id) return null;
  if (!REPORTERS) {
    try {
      const data = require('../../config/newswire-reporters.json');
      REPORTERS = (data.reporters || []).reduce((acc, r) => { acc[r.id] = r.name; return acc; }, {});
    } catch (_) { REPORTERS = {}; }
  }
  return REPORTERS[id] || id;
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(+d)) return iso;
    return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  } catch (_) { return iso; }
}

exports.handler = async (event) => {
  const auth = requireBasicAuth(event);
  if (!auth.ok) return auth.response;

  try { connectLambda(event); } catch (err) {
    console.error('[press-submissions] connectLambda failed', err && err.message);
    return { statusCode: 500, body: 'blobs connect failed' };
  }

  const store = getStore('press_submissions');

  // POST = mutate (mark-read or delete)
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return { statusCode: 400, body: 'invalid json' }; }
    const id = String(body.id || '').trim();
    if (!id || id === '_index') return { statusCode: 400, body: 'id required' };
    const action = String(body.action || '').trim();
    try {
      if (action === 'delete') {
        await store.delete(id);
        let index = [];
        try { const arr = await store.get('_index', { type: 'json' }); if (Array.isArray(arr)) index = arr; } catch (_) {}
        const filtered = index.filter(x => x !== id);
        if (filtered.length !== index.length) await store.setJSON('_index', filtered);
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, deleted: id }) };
      }
      // default action: mark-read toggle
      const existing = await store.get(id, { type: 'json' });
      if (!existing) return { statusCode: 404, body: 'not found' };
      existing.read = body.read === false ? false : true;
      await store.setJSON(id, existing);
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, id, read: existing.read }) };
    } catch (err) {
      console.error('[press-submissions] mutate failed', err && err.message);
      return { statusCode: 500, body: 'mutate failed' };
    }
  }

  // GET = render inbox
  let index = [];
  try { const arr = await store.get('_index', { type: 'json' }); if (Array.isArray(arr)) index = arr; } catch (_) {}

  const items = [];
  for (const id of index.slice(0, 200)) {
    if (id === '_index') continue;
    try {
      const sub = await store.get(id, { type: 'json' });
      if (sub) items.push(sub);
    } catch (_) {}
  }
  const unreadCount = items.filter(i => !i.read).length;

  const rowsHtml = items.length
    ? items.map(s => `
      <li class="row${s.read ? '' : ' unread'}" data-id="${esc(s.id)}">
        <div class="row-head">
          <span class="row-tag">${esc((s.type || 'contact').toUpperCase())}</span>
          ${s.reporter_id ? `<span class="row-reporter">for ${esc(getReporterName(s.reporter_id))}</span>` : '<span class="row-reporter">general newsroom</span>'}
          <time class="row-date">${esc(fmtDate(s.received_at))}</time>
        </div>
        <div class="row-from"><strong>${esc(s.sender_name)}</strong> &middot; <a href="mailto:${esc(s.sender_email)}">${esc(s.sender_email)}</a></div>
        ${s.subject ? `<div class="row-subject">${esc(s.subject)}</div>` : ''}
        <div class="row-msg">${esc(s.message)}</div>
        <div class="row-actions">
          <button class="btn btn-ghost" data-action="toggle-read">${s.read ? 'Mark unread' : 'Mark read'}</button>
          <button class="btn btn-danger" data-action="delete">Delete</button>
          <a class="btn btn-ghost" href="mailto:${esc(s.sender_email)}?subject=Re: ${esc(s.subject || 'your message to ETL Newswire')}">Reply by email</a>
        </div>
      </li>`).join('\n')
    : '<li class="empty">No messages yet. Reader contact-form submissions land here when they happen.</li>';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Submissions Inbox &middot; ETL Press Admin</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Cormorant Garamond',Georgia,serif;background:#f4ebd6;color:#0e0c08;}
.topbar{background:#0e0c08;color:#d4aa4a;padding:0.6rem 2rem;font-family:'DM Mono',monospace;font-size:0.62rem;letter-spacing:0.22em;text-transform:uppercase;display:flex;justify-content:space-between;align-items:center;}
.topbar a{color:#d4aa4a;text-decoration:none;}
.topbar a:hover{color:#fff;}
main{max-width:980px;margin:0 auto;padding:2.4rem 2rem 4rem;}
.eyebrow{font-family:'DM Mono',monospace;font-size:0.62rem;letter-spacing:0.22em;text-transform:uppercase;color:#5a5240;margin-bottom:0.6rem;}
h1{font-family:'Playfair Display',serif;font-size:2.4rem;font-weight:900;line-height:1;color:#0e0c08;margin-bottom:0.3rem;}
.subtitle{font-family:'Cormorant Garamond',serif;font-style:italic;color:#5a5240;margin-bottom:0.5rem;}
.stats{font-family:'DM Mono',monospace;font-size:0.65rem;letter-spacing:0.18em;text-transform:uppercase;color:#5a5240;margin-bottom:2rem;}
.stats strong{color:#0e0c08;}
.notice{background:rgba(184,146,42,0.1);border:1px solid rgba(184,146,42,0.3);padding:0.9rem 1.1rem;margin-bottom:2rem;font-family:'Cormorant Garamond',serif;font-size:0.95rem;color:#3a3424;}
.notice a{color:#a3811c;font-weight:600;}
ul.rows{list-style:none;}
.row{background:#fff;border:1px solid rgba(184,146,42,0.3);padding:1rem 1.2rem 1.1rem;margin-bottom:1rem;}
.row.unread{border-left:4px solid #b8922a;}
.row-head{display:flex;flex-wrap:wrap;align-items:center;gap:0.7rem;margin-bottom:0.5rem;}
.row-tag{font-family:'DM Mono',monospace;font-size:0.55rem;letter-spacing:0.22em;text-transform:uppercase;background:#0e0c08;color:#d4aa4a;padding:0.15rem 0.5rem;}
.row-reporter{font-family:'DM Mono',monospace;font-size:0.6rem;letter-spacing:0.2em;text-transform:uppercase;color:#a3811c;}
.row-date{font-family:'DM Mono',monospace;font-size:0.6rem;color:#5a5240;margin-left:auto;}
.row-from{font-family:'Cormorant Garamond',serif;font-size:1rem;color:#0e0c08;margin-bottom:0.3rem;}
.row-from a{color:#a3811c;}
.row-subject{font-family:'Playfair Display',serif;font-size:1.1rem;font-weight:700;color:#0e0c08;margin-bottom:0.5rem;}
.row-msg{font-family:'Cormorant Garamond',serif;font-size:1rem;line-height:1.55;color:#3a3424;white-space:pre-wrap;margin-bottom:0.9rem;}
.row-actions{display:flex;gap:0.5rem;flex-wrap:wrap;}
.btn{font-family:'DM Mono',monospace;font-size:0.6rem;letter-spacing:0.18em;text-transform:uppercase;padding:0.5rem 0.85rem;border:1px solid #b8922a;background:transparent;color:#0e0c08;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;}
.btn:hover{background:#b8922a;color:#fff;}
.btn-danger{border-color:#9a2a2a;color:#9a2a2a;}
.btn-danger:hover{background:#9a2a2a;color:#fff;}
.empty{padding:3rem;text-align:center;color:#5a5240;font-style:italic;background:#fff;border:1px dashed rgba(184,146,42,0.3);}
</style>
</head>
<body>
<div class="topbar"><span><a href="/press-admin">&larr; Press Admin</a> &middot; Submissions Inbox</span><span><a href="/press">ETL Newswire</a></span></div>
<main>
<div class="eyebrow">Editorial inbox &middot; contact messages</div>
<h1>Submissions</h1>
<p class="subtitle">Reader and tipster messages to staff reporters or the general newsroom.</p>
<div class="stats">${items.length} total &middot; <strong>${unreadCount} unread</strong></div>

<div class="notice"><strong>Contributor applications</strong> (resume + samples uploads from <a href="/press/careers">/press/careers</a>) go through Netlify Forms instead of this inbox. Check the Netlify dashboard &rarr; <em>Forms</em> tab to review applications.</div>

<ul class="rows" id="rows">${rowsHtml}</ul>
</main>
<script>
(function(){
  function api(payload){
    return fetch('/.netlify/functions/press-submissions', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload),
    }).then(function(r){return r.json().then(function(j){return {ok:r.ok, j:j};});});
  }
  Array.from(document.querySelectorAll('.row')).forEach(function(row){
    var id = row.getAttribute('data-id');
    row.querySelectorAll('button[data-action]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var action = btn.getAttribute('data-action');
        if (action === 'delete') {
          if (!confirm('Delete this message permanently?')) return;
          btn.disabled = true;
          api({id:id, action:'delete'}).then(function(res){
            if (res.ok && res.j && res.j.ok) row.parentNode.removeChild(row);
            else { alert('Delete failed'); btn.disabled = false; }
          });
        } else if (action === 'toggle-read') {
          var nowUnread = row.classList.contains('unread');
          api({id:id, read: nowUnread}).then(function(res){
            if (res.ok && res.j && res.j.ok) {
              row.classList.toggle('unread', !res.j.read);
              btn.textContent = res.j.read ? 'Mark unread' : 'Mark read';
            }
          });
        }
      });
    });
  });
})();
</script>
</body>
</html>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
    body: html,
  };
};
