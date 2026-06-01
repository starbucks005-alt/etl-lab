/* ─────────────────────────────────────────────────────────────────────────────
   press-admin — HTML dashboard for managing ETL Press Hub pieces.

   GET /.netlify/functions/press-admin (pretty: /press-admin)
   Gated by HTTP Basic auth against PRESS_ADMIN_USER + PRESS_ADMIN_PASS env vars.
   If either env var is unset, returns 503 and refuses to render.

   Renders a single-page dashboard listing every piece from the press_index
   'order' blob, newest first, with inline Edit and Delete affordances. Edit
   POSTs to /.netlify/functions/press-update and Delete POSTs to
   /.netlify/functions/press-delete. Both rely on the browser's cached Basic
   credentials being auto-sent on same-origin requests.

   NOTE on logout: Basic Auth credentials cannot be reliably cleared from the
   browser without closing the tab. There is no Logout button. Terry is the
   only user for v2; if multi-user admin is ever needed, switch to a token
   cookie flow.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const PLATFORM_LABELS = {
  gauntlet:   'The Gauntlet',
  greylander: 'Greylander Press',
  lab:        'Emerging Technologies Laboratory',
};

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function requireBasicAuth(event) {
  const user = process.env.PRESS_ADMIN_USER;
  const pass = process.env.PRESS_ADMIN_PASS;
  if (!user || !pass) {
    return {
      ok: false,
      response: {
        statusCode: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: 'Admin not configured. Set PRESS_ADMIN_USER and PRESS_ADMIN_PASS in Netlify env vars.',
      },
    };
  }
  const header = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const m = /^Basic\s+(.+)$/i.exec(header);
  if (!m) {
    return {
      ok: false,
      response: {
        statusCode: 401,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'WWW-Authenticate': 'Basic realm="ETL Press Admin", charset="UTF-8"',
        },
        body: 'Authentication required.',
      },
    };
  }
  let decoded = '';
  try { decoded = Buffer.from(m[1], 'base64').toString('utf8'); } catch { decoded = ''; }
  const idx = decoded.indexOf(':');
  const u = idx >= 0 ? decoded.slice(0, idx) : '';
  const p = idx >= 0 ? decoded.slice(idx + 1) : '';
  if (u !== user || p !== pass) {
    return {
      ok: false,
      response: {
        statusCode: 401,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'WWW-Authenticate': 'Basic realm="ETL Press Admin", charset="UTF-8"',
        },
        body: 'Invalid credentials.',
      },
    };
  }
  return { ok: true };
}

function renderDashboard(pieces) {
  const total = pieces.length;
  const rows = pieces.map((p) => {
    const slug = esc(p.slug || '');
    const title = esc(p.title || '');
    const dek = esc(p.dek || '');
    const body = esc(p.body || '');
    const source_url = esc(p.source_url || '');
    const source_label = esc(p.source_label || '');
    const author = esc(p.author || '');
    const platform = esc(p.platform || 'lab');
    const platformLabel = esc(PLATFORM_LABELS[p.platform] || p.platform || 'lab');
    const date = p.published_at ? new Date(p.published_at).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    const hero = p.hero_image_url ? esc(p.hero_image_url) : '';
    const thumb = hero
      ? `<img class="row-thumb" src="${hero}" alt="" loading="lazy">`
      : `<div class="row-thumb row-thumb-placeholder" aria-hidden="true"></div>`;
    return `
    <li class="row" data-slug="${slug}">
      <div class="row-main">
        ${thumb}
        <div class="row-meta">
          <div class="row-tag">${platformLabel} &middot; <time>${esc(date)}</time></div>
          <div class="row-title">${title}</div>
          <div class="row-sub">${source_label ? source_label + ' &middot; ' : ''}<a href="/press/${slug}" target="_blank" rel="noopener">/press/${slug}</a></div>
        </div>
        <div class="row-actions">
          <button type="button" class="btn btn-ghost" data-action="toggle-edit">Edit</button>
          <button type="button" class="btn btn-danger" data-action="delete">Delete</button>
        </div>
      </div>
      <form class="row-edit" hidden>
        <label>Title <input name="title" value="${title}" minlength="8" maxlength="200" required></label>
        <label>Dek <input name="dek" value="${dek}" maxlength="300"></label>
        <label>Body <textarea name="body" rows="10" minlength="200" maxlength="10000" required>${body}</textarea></label>
        <label>Source URL <input name="source_url" type="url" value="${source_url}" required></label>
        <label>Source label <input name="source_label" value="${source_label}" maxlength="140"></label>
        <label>Author <input name="author" value="${author}" maxlength="140"></label>
        <div class="row-edit-actions">
          <span class="row-edit-status" role="status"></span>
          <button type="submit" class="btn btn-primary">Save</button>
          <button type="button" class="btn btn-ghost" data-action="cancel-edit">Cancel</button>
        </div>
      </form>
    </li>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ETL Press Admin</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="/img/etl-favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700&family=DM+Mono:wght@300;400&family=Cormorant+Garamond:ital,wght@0,400;0,600&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:#f7f3ea;color:#1a1a1a;font-family:'Cormorant Garamond',Georgia,serif;font-size:1.02rem;line-height:1.6;min-height:100vh;}
  .nav{background:#0e0c08;padding:1rem 2rem;display:flex;align-items:center;justify-content:space-between;}
  .nav-logo{font-family:'Playfair Display',serif;font-size:1rem;letter-spacing:0.1em;color:#b8922a;text-decoration:none;}
  .nav-logo strong{color:#f4ede0;font-weight:400;}
  .nav-back{font-family:'DM Mono',monospace;font-size:0.62rem;letter-spacing:0.22em;text-transform:uppercase;color:#a89c88;text-decoration:none;}
  .nav-back:hover{color:#d4aa4a;}

  header.head{max-width:1100px;margin:0 auto;padding:2.5rem 2rem 1.5rem;}
  .eyebrow{font-family:'DM Mono',monospace;font-size:0.62rem;letter-spacing:0.22em;text-transform:uppercase;color:#a3811c;margin-bottom:0.85rem;}
  .h1{font-family:'Playfair Display',serif;font-size:clamp(1.8rem, 4vw, 2.6rem);font-weight:700;line-height:1.1;color:#0e0c08;margin-bottom:0.5rem;}
  .stat{font-family:'DM Mono',monospace;font-size:0.65rem;letter-spacing:0.2em;text-transform:uppercase;color:#5a5240;}
  .stat strong{color:#b8922a;}

  main{max-width:1100px;margin:0 auto;padding:1rem 2rem 4rem;}
  .rows{list-style:none;}
  .row{background:#fff;border:1px solid rgba(184,146,42,0.25);margin-bottom:1rem;}
  .row-main{display:flex;align-items:center;gap:1rem;padding:1rem 1.25rem;}
  .row-thumb{width:64px;height:64px;object-fit:cover;border:1px solid rgba(184,146,42,0.3);flex:0 0 64px;background:#f0e9d8;}
  .row-thumb-placeholder{background:linear-gradient(135deg,#e8dcb8,#b8922a);}
  .row-meta{flex:1 1 auto;min-width:0;}
  .row-tag{font-family:'DM Mono',monospace;font-size:0.6rem;letter-spacing:0.18em;text-transform:uppercase;color:#5a5240;margin-bottom:0.3rem;}
  .row-title{font-family:'Playfair Display',serif;font-size:1.15rem;font-weight:700;color:#0e0c08;margin-bottom:0.2rem;overflow:hidden;text-overflow:ellipsis;}
  .row-sub{font-family:'DM Mono',monospace;font-size:0.62rem;letter-spacing:0.06em;color:#5a5240;}
  .row-sub a{color:#a3811c;text-decoration:none;}
  .row-sub a:hover{color:#b8922a;text-decoration:underline;}
  .row-actions{display:flex;gap:0.5rem;flex:0 0 auto;}
  .btn{font-family:'DM Mono',monospace;font-size:0.62rem;letter-spacing:0.18em;text-transform:uppercase;padding:0.55rem 0.9rem;border:1px solid #b8922a;background:transparent;color:#0e0c08;cursor:pointer;transition:background 0.15s,color 0.15s;}
  .btn:hover{background:rgba(184,146,42,0.1);}
  .btn-primary{background:#b8922a;color:#fff;border-color:#b8922a;}
  .btn-primary:hover{background:#a3811c;color:#fff;}
  .btn-danger{border-color:#9a2a2a;color:#9a2a2a;}
  .btn-danger:hover{background:rgba(154,42,42,0.1);}
  .btn-ghost{background:transparent;}
  .btn[disabled]{opacity:0.5;cursor:not-allowed;}

  .row-edit{padding:0 1.25rem 1.25rem;border-top:1px dashed rgba(184,146,42,0.3);margin-top:0.5rem;display:flex;flex-direction:column;gap:0.75rem;}
  .row-edit label{display:flex;flex-direction:column;gap:0.3rem;font-family:'DM Mono',monospace;font-size:0.62rem;letter-spacing:0.16em;text-transform:uppercase;color:#5a5240;}
  .row-edit input,.row-edit textarea{font-family:'Cormorant Garamond',Georgia,serif;font-size:1rem;line-height:1.5;color:#0e0c08;border:1px solid rgba(184,146,42,0.4);background:#fdfbf5;padding:0.55rem 0.7rem;border-radius:0;}
  .row-edit textarea{resize:vertical;min-height:200px;font-family:'Cormorant Garamond',Georgia,serif;}
  .row-edit input:focus,.row-edit textarea:focus{outline:none;border-color:#b8922a;background:#fff;}
  .row-edit-actions{display:flex;align-items:center;justify-content:flex-end;gap:0.75rem;padding-top:0.5rem;}
  .row-edit-status{font-family:'DM Mono',monospace;font-size:0.6rem;letter-spacing:0.14em;text-transform:uppercase;color:#5a5240;flex:1 1 auto;}
  .row-edit-status.ok{color:#3a6a2a;}
  .row-edit-status.err{color:#9a2a2a;}

  .empty{padding:3rem;text-align:center;color:#5a5240;font-style:italic;background:#fff;border:1px dashed rgba(184,146,42,0.3);}

  footer{max-width:1100px;margin:0 auto;padding:2rem;border-top:1px solid rgba(184,146,42,0.25);font-family:'DM Mono',monospace;font-size:0.6rem;letter-spacing:0.18em;text-transform:uppercase;color:#5a5240;}
</style>
</head>
<body>

<nav class="nav">
  <a class="nav-logo" href="/"><strong>ETL</strong> &middot; PRESS ADMIN</a>
  <a class="nav-back" href="/press">View public hub &rarr;</a>
</nav>

<header class="head">
  <div class="eyebrow">Emerging Technologies Laboratory</div>
  <h1 class="h1">Press Admin</h1>
  <div class="stat"><strong>${total}</strong> piece${total === 1 ? '' : 's'} on file</div>
</header>

<main>
  ${total === 0 ? '<div class="empty">No press pieces yet.</div>' : `<ul class="rows">${rows}</ul>`}
</main>

<footer>
  <span>ETL Press Admin &middot; basic-auth gated</span>
</footer>

<script>
(function(){
  function $(sel, root){ return (root||document).querySelector(sel); }
  function $$(sel, root){ return Array.from((root||document).querySelectorAll(sel)); }

  $$('.row').forEach(function(row){
    var slug = row.getAttribute('data-slug');
    var editForm = $('.row-edit', row);
    var status = $('.row-edit-status', row);

    $$('button[data-action]', row).forEach(function(btn){
      var action = btn.getAttribute('data-action');
      btn.addEventListener('click', function(){
        if (action === 'toggle-edit') {
          editForm.hidden = !editForm.hidden;
          if (status) { status.textContent = ''; status.className = 'row-edit-status'; }
        } else if (action === 'cancel-edit') {
          editForm.hidden = true;
        } else if (action === 'delete') {
          if (!window.confirm('Delete "' + slug + '" permanently? This cannot be undone.')) return;
          btn.disabled = true;
          fetch('/.netlify/functions/press-delete', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug: slug }),
          }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j }; }); })
            .then(function(res){
              if (res.ok && res.j && res.j.ok) {
                row.parentNode.removeChild(row);
              } else {
                btn.disabled = false;
                window.alert('Delete failed: ' + (res.j && res.j.error ? res.j.error : 'unknown'));
              }
            }).catch(function(err){
              btn.disabled = false;
              window.alert('Delete failed: ' + (err && err.message ? err.message : 'network error'));
            });
        }
      });
    });

    if (editForm) {
      editForm.addEventListener('submit', function(ev){
        ev.preventDefault();
        var fd = new FormData(editForm);
        var payload = { slug: slug };
        ['title','dek','body','source_url','source_label','author'].forEach(function(k){
          payload[k] = String(fd.get(k) == null ? '' : fd.get(k));
        });
        var saveBtn = editForm.querySelector('button[type="submit"]');
        if (saveBtn) saveBtn.disabled = true;
        if (status) { status.textContent = 'Saving...'; status.className = 'row-edit-status'; }
        fetch('/.netlify/functions/press-update', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j }; }); })
          .then(function(res){
            if (saveBtn) saveBtn.disabled = false;
            if (res.ok && res.j && res.j.ok) {
              if (status) { status.textContent = 'Saved.'; status.className = 'row-edit-status ok'; }
              var titleEl = $('.row-title', row);
              if (titleEl) titleEl.textContent = payload.title;
            } else {
              if (status) { status.textContent = 'Error: ' + (res.j && res.j.error ? res.j.error : 'save failed'); status.className = 'row-edit-status err'; }
            }
          }).catch(function(err){
            if (saveBtn) saveBtn.disabled = false;
            if (status) { status.textContent = 'Error: ' + (err && err.message ? err.message : 'network'); status.className = 'row-edit-status err'; }
          });
      });
    }
  });
})();
</script>

</body>
</html>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
    return { statusCode: 405, headers: { 'Content-Type': 'text/plain' }, body: 'method not allowed' };
  }

  const auth = requireBasicAuth(event);
  if (!auth.ok) return auth.response;

  try { connectLambda(event); } catch (err) {
    console.error('[press-admin] connectLambda failed', err && err.message);
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: 'blobs connect failed' };
  }

  // Read the press_index order for the canonical newest-first listing, then
  // hydrate each entry by fetching the full piece JSON from press_pieces so
  // the Edit form has body, source_url, author, etc.
  let order = [];
  try {
    const indexStore = getStore('press_index');
    const arr = await indexStore.get('order', { type: 'json' });
    if (Array.isArray(arr)) order = arr;
  } catch (err) {
    console.error('[press-admin] press_index read failed', err && err.message);
  }

  // Defensive: also surface any pieces present in press_pieces but missing
  // from the index (in case the index ever drifts). Newest first by published_at.
  const piecesStore = getStore('press_pieces');
  const seen = new Set(order.map(o => o && o.slug).filter(Boolean));
  try {
    const listing = await piecesStore.list();
    const keys = (listing && listing.blobs) ? listing.blobs.map(b => b.key) : [];
    for (const key of keys) {
      if (!seen.has(key)) {
        order.push({ slug: key });
        seen.add(key);
      }
    }
  } catch (err) {
    console.error('[press-admin] press_pieces list failed', err && err.message);
  }

  const hydrated = [];
  for (const entry of order) {
    if (!entry || !entry.slug) continue;
    try {
      const full = await piecesStore.get(entry.slug, { type: 'json' });
      if (full && typeof full === 'object') {
        hydrated.push(Object.assign({}, entry, full));
      } else {
        hydrated.push(entry);
      }
    } catch (err) {
      hydrated.push(entry);
    }
  }

  hydrated.sort((a, b) => {
    const da = a && a.published_at ? Date.parse(a.published_at) : 0;
    const db = b && b.published_at ? Date.parse(b.published_at) : 0;
    return db - da;
  });

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
    body: renderDashboard(hydrated),
  };
};
