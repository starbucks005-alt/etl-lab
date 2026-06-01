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
    const desk = esc(p.desk || '');
    const deskLabel = p.desk ? esc({us:'US',world:'World',business:'Business',technology:'Technology',science:'Science',health:'Health',entertainment:'Entertainment',sports:'Sports'}[p.desk] || p.desk) : '';
    const bylineKind = esc(p.byline_kind || 'client');
    const reporterId = esc(p.reporter_id || '');
    return `
    <li class="row" data-slug="${slug}" data-desk="${desk}">
      <div class="row-main">
        ${thumb}
        <div class="row-meta">
          <div class="row-tag">${platformLabel}${deskLabel ? ' &middot; ' + deskLabel : ''}${bylineKind === 'reporter' ? ' &middot; <em>reporter byline</em>' : ''} &middot; <time>${esc(date)}</time></div>
          <div class="row-title">${title}</div>
          <div class="row-sub">${source_label ? source_label + ' &middot; ' : ''}<a href="/press/${slug}" target="_blank" rel="noopener">/press/${slug}</a></div>
        </div>
        <div class="row-actions">
          <button type="button" class="btn btn-ghost" data-action="toggle-edit">Edit</button>
          <button type="button" class="btn btn-danger" data-action="delete">Delete</button>
        </div>
      </div>
      <form class="row-edit" novalidate hidden>
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

  /* Newsroom tools (commission + seed) */
  .newsroom-tools{margin-bottom:2.5rem;}
  .tools-h{font-family:'Playfair Display',serif;font-size:1.4rem;font-weight:700;color:#0e0c08;margin-bottom:0.9rem;border-bottom:1px solid #0e0c08;padding-bottom:0.45rem;}
  .tools-grid{display:grid;grid-template-columns:1fr 1fr;gap:1.4rem;}
  @media (max-width:760px){.tools-grid{grid-template-columns:1fr;}}
  .tool-card{background:#fff;border:1px solid rgba(184,146,42,0.4);padding:1.4rem 1.5rem;}
  .tool-title{font-family:'Playfair Display',serif;font-size:1.15rem;font-weight:700;color:#0e0c08;margin-bottom:0.35rem;}
  .tool-sub{font-family:'Cormorant Garamond',serif;font-style:italic;color:#5a5240;font-size:0.98rem;margin-bottom:1rem;line-height:1.55;}
  .tool-card form label{display:block;font-family:'DM Mono',monospace;font-size:0.55rem;letter-spacing:0.2em;text-transform:uppercase;color:#5a5240;margin-bottom:0.7rem;}
  .tool-card form input, .tool-card form select{display:block;width:100%;margin-top:0.3rem;background:#faf6ec;border:1px solid rgba(184,146,42,0.4);color:#0e0c08;font-family:'Cormorant Garamond',serif;font-size:1rem;padding:0.55rem 0.75rem;outline:none;}
  .tool-card form input:focus, .tool-card form select:focus{border-color:#b8922a;}
  .tool-checkbox{display:flex !important;align-items:center;gap:0.5rem;text-transform:none !important;letter-spacing:0 !important;color:#0e0c08 !important;font-family:'Cormorant Garamond',serif !important;font-size:0.95rem !important;}
  .tool-checkbox input{display:inline-block !important;width:auto !important;margin:0 !important;}
  .tool-actions{display:flex;justify-content:space-between;align-items:center;gap:0.8rem;flex-wrap:wrap;}
  .tool-status{font-family:'DM Mono',monospace;font-size:0.55rem;letter-spacing:0.18em;text-transform:uppercase;color:#5a5240;}
  .tool-status.busy{color:#b8922a;}
  .tool-status.error{color:#a83c2c;}
  .tool-status.success{color:#3c7a3c;}
  .tool-result{margin-top:1rem;font-family:'Cormorant Garamond',serif;font-size:0.95rem;line-height:1.5;color:#0e0c08;}
  .tool-result:empty{display:none;}
  .tool-result a{color:#a3811c;border-bottom:1px solid rgba(184,146,42,0.4);text-decoration:none;}
  .tool-result h4{font-family:'Playfair Display',serif;font-size:1.1rem;margin-bottom:0.4rem;}
  .seed-grid{display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;}
  .btn-seed{font-family:'DM Mono',monospace;font-size:0.6rem;letter-spacing:0.18em;text-transform:uppercase;color:#0e0c08;background:#faf6ec;border:1px solid rgba(184,146,42,0.5);padding:0.6rem 0.8rem;cursor:pointer;text-align:left;}
  .btn-seed:hover:not(:disabled){background:#b8922a;color:#fff;border-color:#b8922a;}
  .btn-seed:disabled{opacity:0.5;cursor:not-allowed;}

  /* Pieces list header + filter */
  .pieces-list .list-head{display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:1rem;margin-bottom:1.1rem;border-bottom:1px solid #0e0c08;padding-bottom:0.45rem;}
  .pieces-list .list-h{font-family:'Playfair Display',serif;font-size:1.4rem;font-weight:700;color:#0e0c08;}
  .list-filter label{display:flex;align-items:center;gap:0.5rem;font-family:'DM Mono',monospace;font-size:0.6rem;letter-spacing:0.2em;text-transform:uppercase;color:#5a5240;}
  .list-filter select{background:#faf6ec;border:1px solid rgba(184,146,42,0.4);color:#0e0c08;font-family:'Cormorant Garamond',serif;font-size:0.95rem;padding:0.4rem 0.6rem;outline:none;}
  .list-filter select:focus{border-color:#b8922a;}

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
  <section class="newsroom-tools">
    <h2 class="tools-h">Newsroom tools</h2>

    <div class="tools-grid">
      <div class="tool-card">
        <h3 class="tool-title">Commission a piece</h3>
        <p class="tool-sub">Pick a reporter. They use web search to find a real current story on their beat and file it.</p>
        <form id="form-commission">
          <label>Reporter
            <select name="reporter_id" required>
              <option value="marcus_reyes">Marcus Reyes &middot; US</option>
              <option value="elke_vogel">Elke Vogel &middot; World</option>
              <option value="sasha_park">Sasha Park &middot; Business</option>
              <option value="theo_okafor">Theo Okafor &middot; Technology</option>
              <option value="renee_kovac">Ren&eacute;e Kovac &middot; Security</option>
              <option value="maya_iyer">Dr. Maya Iyer &middot; Science</option>
              <option value="karen_bishop">Karen Bishop &middot; Health</option>
              <option value="jules_rivera">Jules Rivera &middot; Entertainment</option>
              <option value="frank_donovan">Frank Donovan &middot; Sports</option>
            </select>
          </label>
          <label>Topic seed (optional)
            <input name="topic_seed" maxlength="500" placeholder="e.g. 'recent AI regulation moves in California'">
          </label>
          <label class="tool-checkbox"><input type="checkbox" name="auto_publish" checked> Publish on completion</label>
          <div class="tool-actions">
            <span class="tool-status" id="commission-status"></span>
            <button type="submit" class="btn btn-primary">Run reporter &rarr;</button>
          </div>
        </form>
        <div class="tool-result" id="commission-result"></div>
      </div>

      <div class="tool-card">
        <h3 class="tool-title">Seed historical archive</h3>
        <p class="tool-sub">22 evergreen pieces per reporter dated Jan 1 - May 28, 2026. Click each button once. Each run takes a few minutes in the background; refresh the page later to see the pieces.</p>
        <div class="seed-grid">
          <button type="button" class="btn btn-seed" data-rid="marcus_reyes">Seed Marcus Reyes</button>
          <button type="button" class="btn btn-seed" data-rid="elke_vogel">Seed Elke Vogel</button>
          <button type="button" class="btn btn-seed" data-rid="sasha_park">Seed Sasha Park</button>
          <button type="button" class="btn btn-seed" data-rid="theo_okafor">Seed Theo Okafor</button>
          <button type="button" class="btn btn-seed" data-rid="renee_kovac">Seed Ren&eacute;e Kovac</button>
          <button type="button" class="btn btn-seed" data-rid="maya_iyer">Seed Maya Iyer</button>
          <button type="button" class="btn btn-seed" data-rid="karen_bishop">Seed Karen Bishop</button>
          <button type="button" class="btn btn-seed" data-rid="jules_rivera">Seed Jules Rivera</button>
          <button type="button" class="btn btn-seed" data-rid="frank_donovan">Seed Frank Donovan</button>
        </div>
        <div class="tool-result" id="seed-result"></div>
      </div>

      <div class="tool-card">
        <h3 class="tool-title">Above the Fold audio briefing</h3>
        <p class="tool-sub">Generate Marcus Reyes's wire-service-style daily briefing of today's top stories above the fold. Pulls up to 7 most-recent pieces. Renders the script via Anthropic, then renders mp3 via ElevenLabs. Audio appears on the ETL homepage AND on /press. Takes about 30-60 seconds total.</p>
        <div class="tool-actions" style="margin-top:0.8rem;">
          <span class="tool-status" id="briefing-status"></span>
          <button type="button" id="btn-regenerate-briefing" class="btn btn-primary">Regenerate today's briefing &rarr;</button>
        </div>
        <div class="tool-result" id="briefing-result"></div>
      </div>
    </div>
  </section>

  <section class="pieces-list">
    <div class="list-head">
      <h2 class="list-h">All pieces</h2>
      <div class="list-filter">
        <label>Filter by desk
          <select id="desk-filter">
            <option value="">All desks</option>
            <option value="us">US</option>
            <option value="world">World</option>
            <option value="business">Business</option>
            <option value="technology">Technology</option>
            <option value="security">Security</option>
            <option value="science">Science</option>
            <option value="health">Health</option>
            <option value="entertainment">Entertainment</option>
            <option value="sports">Sports</option>
          </select>
        </label>
      </div>
    </div>
    ${total === 0 ? '<div class="empty">No press pieces yet.</div>' : `<ul class="rows">${rows}</ul>`}
  </section>
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

// ─── Newsroom tools (separate IIFE so $$ stays in scope) ───
(function(){
  function $$(sel, root){ return Array.from((root||document).querySelectorAll(sel)); }
  function setStatus(el, msg, kind) { if (!el) return; el.textContent = msg || ''; el.className = 'tool-status' + (kind ? ' ' + kind : ''); }
  function escapeHTML(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }

  // Commission a piece. Background function: returns 202 immediately, then
  // the reporter runs for 1-3 minutes and the piece appears in the list.
  var commForm = document.getElementById('form-commission');
  if (commForm) {
    commForm.addEventListener('submit', function(ev){
      ev.preventDefault();
      var status = document.getElementById('commission-status');
      var result = document.getElementById('commission-result');
      result.innerHTML = '';
      setStatus(status, 'Queueing reporter...', 'busy');
      var btn = commForm.querySelector('button[type=submit]');
      btn.disabled = true;
      var fd = new FormData(commForm);
      var payload = {
        reporter_id: String(fd.get('reporter_id') || ''),
        topic_seed: String(fd.get('topic_seed') || ''),
        auto_publish: fd.get('auto_publish') === 'on' || fd.get('auto_publish') === 'true',
      };
      var reporterLabel = (commForm.querySelector('select[name="reporter_id"] option:checked') || {}).textContent || payload.reporter_id;
      fetch('/.netlify/functions/newswire-write-background', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(function(r){
        // Netlify background functions return 202 immediately with no body
        // (or a tiny one). Accept any 2xx as "queued".
        if (r.status >= 200 && r.status < 300) {
          btn.disabled = false;
          setStatus(status, 'Queued.', 'success');
          result.innerHTML =
            '<p><strong>' + escapeHTML(reporterLabel) + '</strong> is on it. The reporter takes 1-3 minutes to find a story, write it, and file. ' +
            'The piece will appear in the All Pieces list and on /press when ready. ' +
            '<a href="javascript:void(0)" onclick="window.location.reload()">Refresh the page</a> in a couple minutes to see it.</p>';
        } else {
          return r.json().catch(function(){ return { error: 'queue failed (status ' + r.status + ')' }; }).then(function(j){
            btn.disabled = false;
            setStatus(status, (j && j.error) || 'Failed to queue', 'error');
          });
        }
      }).catch(function(err){ btn.disabled = false; setStatus(status, err.message || 'network error', 'error'); });
    });
  }

  // Seed historical archive
  $$('.btn-seed').forEach(function(btn){
    btn.addEventListener('click', function(){
      var rid = btn.getAttribute('data-rid');
      if (!window.confirm('Seed 22 historical pieces for ' + (btn.textContent || rid).replace('Seed ','') + '? This takes a few minutes to run in the background.')) return;
      btn.disabled = true;
      btn.textContent = 'Queued...';
      var result = document.getElementById('seed-result');
      fetch('/.netlify/functions/press-seed-background', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reporter_id: rid }),
      }).then(function(r){ return r.json().catch(function(){ return { ok: r.ok }; }).then(function(j){ return { ok: r.ok, j: j }; }); })
        .then(function(res){
          if (res.ok) {
            btn.textContent = 'Queued. Pieces will appear over the next few minutes. Refresh.';
            if (result) result.innerHTML += '<p>Queued <strong>' + escapeHTML(rid) + '</strong>. The reporter will write 22 pieces dated Jan-May 2026. Refresh the page in 5-10 minutes to see them appear.</p>';
          } else {
            btn.disabled = false;
            btn.textContent = 'Retry: ' + (btn.getAttribute('data-rid'));
            if (result) result.innerHTML += '<p><strong>Failed:</strong> ' + escapeHTML((res.j && res.j.error) || 'unknown') + '</p>';
          }
        }).catch(function(err){
          btn.disabled = false;
          btn.textContent = 'Retry: ' + rid;
          if (result) result.innerHTML += '<p><strong>Error:</strong> ' + escapeHTML(err.message || 'network') + '</p>';
        });
    });
  });

  // Desk filter on the pieces list
  var deskFilter = document.getElementById('desk-filter');
  if (deskFilter) {
    deskFilter.addEventListener('change', function(){
      var v = deskFilter.value;
      $$('.row').forEach(function(row){
        var d = row.getAttribute('data-desk') || '';
        row.style.display = (!v || d === v) ? '' : 'none';
      });
    });
  }

  // 5 in Under 5 audio briefing regenerate
  var briefBtn = document.getElementById('btn-regenerate-briefing');
  if (briefBtn) {
    briefBtn.addEventListener('click', function(){
      var status = document.getElementById('briefing-status');
      var result = document.getElementById('briefing-result');
      result.innerHTML = '';
      setStatus(status, 'Marcus is writing the script (~10s) and recording (~20-40s)...', 'busy');
      briefBtn.disabled = true;
      fetch('/.netlify/functions/newswire-briefing-background', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).then(function(r){
        if (r.status >= 200 && r.status < 300) {
          return r.json().catch(function(){ return {}; }).then(function(j){
            briefBtn.disabled = false;
            setStatus(status, 'Briefing generated.', 'success');
            var pieces = (j && j.pieces) ? j.pieces : '5';
            result.innerHTML = '<p>Marcus recorded a ' + escapeHTML(String(j.word_count || '~600')) + '-word briefing over ' + escapeHTML(String(pieces)) + ' pieces. Audio is now live on the ETL homepage AND on /press. <a href="https://emerging-tech-lab.com/" target="_blank" rel="noopener">Visit the homepage to listen &rarr;</a></p>';
          });
        }
        return r.json().catch(function(){ return { error: 'unknown' }; }).then(function(j){
          briefBtn.disabled = false;
          setStatus(status, (j && j.error) || 'Briefing generation failed', 'error');
          if (j && j.detail) result.innerHTML = '<p>Detail: ' + escapeHTML(String(j.detail)) + '</p>';
        });
      }).catch(function(err){
        briefBtn.disabled = false;
        setStatus(status, err.message || 'network error', 'error');
      });
    });
  }
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
