/* ─────────────────────────────────────────────────────────────────────────────
   press-index — render the ETL Press Hub homepage at /press.

   Lists every published press piece in reverse chronological order, grouped
   by platform of origin. Reads from press_index blob 'order'.

   This is the page Google crawls to discover all the pieces, and the page a
   client sees when they share "the press hub" with their team.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const SITE_BASE = 'https://emerging-tech-lab.com';

const PLATFORM_LABELS = {
  gauntlet:   'The Gauntlet',
  greylander: 'Greylander Press',
  lab:        'Emerging Technologies Laboratory',
};

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function renderHub(pieces) {
  const total = pieces.length;
  const groups = { gauntlet: [], greylander: [], lab: [] };
  pieces.forEach(p => { (groups[p.platform] || groups.lab).push(p); });

  function section(platformKey) {
    const items = groups[platformKey] || [];
    if (!items.length) return '';
    return `<section class="group">
      <h2 class="group-h">${esc(PLATFORM_LABELS[platformKey])}</h2>
      <ul class="feed">
        ${items.map(p => {
          const date = p.published_at ? new Date(p.published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
          return `<li class="feed-item">
            <a class="feed-link" href="/press/${esc(p.slug)}">
              <div class="feed-meta"><time>${esc(date)}</time>${p.source_label ? ' &middot; ' + esc(p.source_label) : ''}</div>
              <div class="feed-title">${esc(p.title)}</div>
              ${p.dek ? `<div class="feed-dek">${esc(p.dek)}</div>` : ''}
            </a>
          </li>`;
        }).join('\n')}
      </ul>
    </section>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ETL Press Hub | Emerging Technologies Laboratory</title>
<meta name="description" content="Press releases and announcements from companies and authors connected to the Emerging Technologies Laboratory, The Gauntlet, and Greylander Press.">
<link rel="canonical" href="${SITE_BASE}/press">
<link rel="icon" href="/img/etl-favicon.png">
<meta property="og:title" content="ETL Press Hub">
<meta property="og:description" content="Press releases and announcements from companies and authors in the ETL network.">
<meta property="og:url" content="${SITE_BASE}/press">
<meta property="og:type" content="website">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=DM+Mono:wght@300;400&family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:#f7f3ea;color:#1a1a1a;font-family:'Cormorant Garamond',Georgia,serif;font-size:1.05rem;line-height:1.65;min-height:100vh;}
  .nav{background:#0e0c08;padding:1rem 2rem;display:flex;align-items:center;justify-content:space-between;}
  .nav-logo{font-family:'Playfair Display',serif;font-size:1rem;letter-spacing:0.1em;color:#b8922a;text-decoration:none;}
  .nav-logo strong{color:#f4ede0;font-weight:400;}
  .nav-back{font-family:'DM Mono',monospace;font-size:0.62rem;letter-spacing:0.22em;text-transform:uppercase;color:#a89c88;text-decoration:none;}
  .nav-back:hover{color:#d4aa4a;}

  header.hub-head{max-width:960px;margin:0 auto;padding:3rem 2rem 1.5rem;}
  .eyebrow{font-family:'DM Mono',monospace;font-size:0.62rem;letter-spacing:0.22em;text-transform:uppercase;color:#a3811c;margin-bottom:0.85rem;}
  .hub-h1{font-family:'Playfair Display',serif;font-size:clamp(2rem, 5vw, 3rem);font-weight:700;line-height:1.1;color:#0e0c08;margin-bottom:0.6rem;}
  .hub-h1 em{font-style:italic;color:#b8922a;}
  .hub-lede{font-family:'Cormorant Garamond',serif;font-style:italic;color:#5a5240;max-width:680px;font-size:1.15rem;line-height:1.6;margin-bottom:1rem;}
  .hub-stat{font-family:'DM Mono',monospace;font-size:0.65rem;letter-spacing:0.2em;text-transform:uppercase;color:#5a5240;}
  .hub-stat strong{color:#b8922a;}

  main.hub-body{max-width:960px;margin:0 auto;padding:1rem 2rem 4rem;}
  .group{margin-bottom:3rem;}
  .group-h{font-family:'DM Mono',monospace;font-size:0.7rem;letter-spacing:0.25em;text-transform:uppercase;color:#a3811c;border-bottom:1px solid rgba(184,146,42,0.4);padding-bottom:0.5rem;margin-bottom:1.4rem;}
  .feed{list-style:none;}
  .feed-item{margin-bottom:1.1rem;border:1px solid rgba(184,146,42,0.25);background:#fff;}
  .feed-link{display:block;padding:1.2rem 1.5rem;text-decoration:none;color:inherit;transition:background 0.15s,border-color 0.15s;}
  .feed-item:hover{border-color:#b8922a;}
  .feed-link:hover{background:rgba(184,146,42,0.06);}
  .feed-meta{font-family:'DM Mono',monospace;font-size:0.6rem;letter-spacing:0.16em;text-transform:uppercase;color:#5a5240;margin-bottom:0.45rem;}
  .feed-title{font-family:'Playfair Display',serif;font-size:1.35rem;font-weight:700;line-height:1.25;color:#0e0c08;margin-bottom:0.4rem;}
  .feed-dek{font-family:'Cormorant Garamond',serif;font-style:italic;font-size:1rem;color:#5a5240;line-height:1.55;}

  .empty{padding:2rem;text-align:center;color:#5a5240;font-style:italic;}

  footer{max-width:960px;margin:0 auto;padding:2rem;border-top:1px solid rgba(184,146,42,0.25);font-family:'DM Mono',monospace;font-size:0.6rem;letter-spacing:0.18em;text-transform:uppercase;color:#5a5240;display:flex;justify-content:space-between;flex-wrap:wrap;gap:1rem;}
  footer a{color:#a3811c;text-decoration:none;}
</style>
</head>
<body>

<nav class="nav">
  <a class="nav-logo" href="/"><strong>ETL</strong> &middot; PRESS HUB</a>
  <a class="nav-back" href="/">&larr; Home</a>
</nav>

<header class="hub-head">
  <div class="eyebrow">Emerging Technologies Laboratory</div>
  <h1 class="hub-h1">Press <em>Hub</em></h1>
  <p class="hub-lede">Releases and announcements from companies and authors connected to the ETL network. Every piece links back to its source. Browse by platform of origin below.</p>
  <div class="hub-stat"><strong>${total}</strong> release${total === 1 ? '' : 's'} published</div>
</header>

<main class="hub-body">
  ${total === 0 ? '<div class="empty">No releases published yet. Imani and Jess are warming up.</div>' : ''}
  ${section('gauntlet')}
  ${section('greylander')}
  ${section('lab')}
</main>

<footer>
  <span>ETL Press Hub &middot; Emerging Technologies Laboratory</span>
  <a href="/press-sitemap.xml">Sitemap</a>
</footer>

</body>
</html>`;
}

exports.handler = async (event) => {
  try { connectLambda(event); } catch (err) { console.error('[press-index] connectLambda failed', err && err.message); }
  let pieces = [];
  try {
    const indexStore = getStore('press_index');
    const order = await indexStore.get('order', { type: 'json' });
    if (Array.isArray(order)) pieces = order;
  } catch (err) {
    console.error('[press-index] blob read failed', err && err.message);
  }
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
    },
    body: renderHub(pieces),
  };
};
