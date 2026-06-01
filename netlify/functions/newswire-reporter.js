/* ─────────────────────────────────────────────────────────────────────────────
   newswire-reporter — public reporter profile page.

   GET /press/reporter/:slug   (slug = id with underscores → dashes)
       e.g. /press/reporter/marcus-reyes

   Renders a full bio + tier badge + desk link + latest 10 pieces by that
   reporter, pulled from the press_index.

   Public (no auth). Cached 60s.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const SITE_BASE = 'https://emerging-tech-lab.com';
const DESK_LABELS = {
  us: 'US', world: 'World', business: 'Business', technology: 'Technology',
  security: 'Security', science: 'Science', health: 'Health',
  entertainment: 'Entertainment', sports: 'Sports',
};

let REPORTERS_CACHE = null;
function loadReporters() {
  if (REPORTERS_CACHE) return REPORTERS_CACHE;
  try {
    const data = require('../../config/newswire-reporters.json');
    REPORTERS_CACHE = (data.reporters || []).reduce((acc, r) => {
      acc[r.id] = r;
      acc[r.id.replace(/_/g, '-')] = r; // also reachable via dashed slug
      return acc;
    }, {});
  } catch (_) { REPORTERS_CACHE = {}; }
  return REPORTERS_CACHE;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function shortDate(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(+d)) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (_) { return ''; }
}

function notFound(slug) {
  return {
    statusCode: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html><html><head><title>Reporter not found - ETL Newswire</title></head>
<body style="font-family:Georgia,serif;max-width:42rem;margin:6rem auto;padding:0 1.5rem;text-align:center;">
<h1 style="font-family:'Playfair Display',Georgia,serif;">Reporter not found.</h1>
<p>No reporter on staff with slug <code>${esc(slug)}</code>.</p>
<p><a href="/press">Back to ETL Newswire</a></p>
</body></html>`,
  };
}

exports.handler = async (event) => {
  const slugRaw = (event.queryStringParameters && event.queryStringParameters.slug) || '';
  const slug = String(slugRaw).trim();
  if (!slug) return notFound(slug);

  const reporters = loadReporters();
  const reporter = reporters[slug] || reporters[slug.replace(/-/g, '_')];
  if (!reporter) return notFound(slug);

  try { connectLambda(event); } catch (_) {}

  // Pull recent pieces by this reporter from press_index 'order'.
  let order = [];
  try {
    const indexStore = getStore('press_index');
    const arr = await indexStore.get('order', { type: 'json' });
    if (Array.isArray(arr)) order = arr;
  } catch (err) {
    console.error('[newswire-reporter] index read failed', err && err.message);
  }
  const byReporter = order
    .filter(p => p && p.reporter_id === reporter.id && p.byline_kind === 'reporter' && p.title)
    .slice(0, 10);

  const profileUrl = `${SITE_BASE}/press/reporter/${reporter.id.replace(/_/g, '-')}`;
  const deskLabel = DESK_LABELS[reporter.desk] || '';
  const tierLabel = reporter.tier_label || 'Reporter';

  const piecesHtml = byReporter.length
    ? byReporter.map(p => `
        <li class="piece-row">
          <a class="piece-title" href="/press/${esc(p.slug)}">${esc(p.title)}</a>
          ${p.dek ? `<div class="piece-dek">${esc(p.dek)}</div>` : ''}
          <div class="piece-meta">${esc(shortDate(p.published_at))} &middot; <a href="/press?desk=${esc(p.desk || reporter.desk)}">${esc(DESK_LABELS[p.desk] || deskLabel)}</a></div>
        </li>`).join('')
    : `<li class="empty">No pieces filed yet.</li>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(reporter.name)} - ${esc(tierLabel)}, ${esc(deskLabel)} Desk - ETL Newswire</title>
<meta name="description" content="${esc(reporter.bio.slice(0, 200))}">
<meta property="og:title" content="${esc(reporter.name)} - ${esc(tierLabel)}, ETL Newswire">
<meta property="og:description" content="${esc(reporter.bio.slice(0, 200))}">
<meta property="og:type" content="profile">
<meta property="og:url" content="${esc(profileUrl)}">
<link rel="canonical" href="${esc(profileUrl)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Cormorant Garamond',Georgia,serif;background:#f4ebd6;color:#0e0c08;line-height:1.55;}
.topbar{background:#0e0c08;color:#d4aa4a;padding:0.6rem 2rem;font-family:'DM Mono',monospace;font-size:0.62rem;letter-spacing:0.22em;text-transform:uppercase;display:flex;justify-content:space-between;align-items:center;}
.topbar a{color:#d4aa4a;text-decoration:none;}
.topbar a:hover{color:#fff;}
.wrap{max-width:1080px;margin:0 auto;padding:2.4rem 2rem 4rem;}
.crumb{font-family:'DM Mono',monospace;font-size:0.62rem;letter-spacing:0.22em;text-transform:uppercase;color:#5a5240;margin-bottom:1.4rem;}
.crumb a{color:#5a5240;text-decoration:underline;}
.profile-head{display:grid;grid-template-columns:200px 1fr;gap:2.4rem;align-items:start;padding-bottom:2rem;border-bottom:2px solid #0e0c08;}
@media (max-width:720px){.profile-head{grid-template-columns:1fr;}}
.portrait{width:200px;height:200px;background:#fdfbf5;border:1px solid rgba(184,146,42,0.4);border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;}
.portrait img{width:100%;height:100%;object-fit:cover;}
.portrait-placeholder{font-family:'Playfair Display',Georgia,serif;font-size:3.6rem;font-weight:700;color:#b8922a;}
.profile-name{font-family:'Playfair Display',Georgia,serif;font-size:2.6rem;font-weight:700;line-height:1.1;color:#0e0c08;margin-bottom:0.4rem;}
.profile-tier{font-family:'DM Mono',monospace;font-size:0.72rem;letter-spacing:0.22em;text-transform:uppercase;color:#b8922a;margin-bottom:0.8rem;}
.profile-tier .sep{color:#5a5240;margin:0 0.5rem;}
.profile-beat{font-family:'Cormorant Garamond',Georgia,serif;font-size:1.15rem;font-style:italic;color:#3a3424;margin-bottom:1.1rem;}
.profile-bio{font-family:'Cormorant Garamond',Georgia,serif;font-size:1.05rem;color:#0e0c08;line-height:1.55;}
.section-h{font-family:'Playfair Display',Georgia,serif;font-size:1.5rem;font-weight:700;color:#0e0c08;margin:2.4rem 0 1rem;padding-bottom:0.5rem;border-bottom:1px solid rgba(14,12,8,0.18);}
.pieces-list{list-style:none;padding:0;}
.piece-row{padding:1rem 0;border-bottom:1px solid rgba(14,12,8,0.1);}
.piece-row:last-child{border-bottom:none;}
.piece-title{font-family:'Playfair Display',Georgia,serif;font-size:1.25rem;font-weight:700;color:#0e0c08;text-decoration:none;}
.piece-title:hover{color:#b8922a;}
.piece-dek{font-family:'Cormorant Garamond',Georgia,serif;font-size:1rem;color:#3a3424;margin-top:0.3rem;}
.piece-meta{font-family:'DM Mono',monospace;font-size:0.62rem;letter-spacing:0.18em;text-transform:uppercase;color:#5a5240;margin-top:0.4rem;}
.piece-meta a{color:#5a5240;text-decoration:none;border-bottom:1px solid rgba(184,146,42,0.4);}
.piece-meta a:hover{color:#b8922a;border-bottom-color:#b8922a;}
.empty{font-style:italic;color:#5a5240;padding:1rem 0;}
footer{max-width:1080px;margin:0 auto;padding:2rem;border-top:1px solid rgba(184,146,42,0.25);font-family:'DM Mono',monospace;font-size:0.6rem;letter-spacing:0.18em;text-transform:uppercase;color:#5a5240;display:flex;justify-content:space-between;flex-wrap:wrap;gap:0.6rem;}
footer a{color:#5a5240;text-decoration:underline;}
</style>
</head>
<body>
<div class="topbar"><span><a href="https://emerging-tech-lab.com">ETL</a> &middot; <a href="/press">ETL Newswire</a></span><span>${esc(deskLabel)} Desk</span></div>
<main class="wrap">
<div class="crumb"><a href="/press">All desks</a> &nbsp;/&nbsp; <a href="/press?desk=${esc(reporter.desk)}">${esc(deskLabel)}</a> &nbsp;/&nbsp; ${esc(reporter.name)}</div>
<header class="profile-head">
  <div class="portrait">
    <span class="portrait-placeholder">${esc(reporter.portrait_placeholder || reporter.name.split(' ').map(s => s[0]).join('').slice(0, 2))}</span>
  </div>
  <div>
    <h1 class="profile-name">${esc(reporter.name)}</h1>
    <div class="profile-tier">${esc(tierLabel)}<span class="sep">&middot;</span><a href="/press?desk=${esc(reporter.desk)}" style="color:#b8922a;text-decoration:none;">${esc(deskLabel)} Desk</a></div>
    <p class="profile-beat">${esc(reporter.beat)}</p>
    <p class="profile-bio">${esc(reporter.bio)}</p>
  </div>
</header>
<h2 class="section-h">Recent reporting from ${esc(reporter.name.split(' ').slice(-1)[0])}</h2>
<ul class="pieces-list">${piecesHtml}</ul>
</main>
<footer>
  <span>ETL Newswire &middot; A publication of the Emerging Technologies Laboratory</span>
  <span><a href="/press-about">About this newsroom</a> &middot; <a href="/press.rss">RSS</a></span>
</footer>
</body>
</html>`;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
    },
    body: html,
  };
};
