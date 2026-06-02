/* ─────────────────────────────────────────────────────────────────────────────
   press-index — render the ETL Newswire homepage at /press.

   Newsroom-shaped surface, not a directory. Masthead, desk nav strip
   (US / World / Business / Technology / Science / Health / Entertainment /
   Sports), hero featured story, main chronological feed, sidebar with
   latest-per-desk mini-lists. Filterable by query string ?desk=<desk_id>.

   Data: reads press_index 'order' (most-recent first, with desk/byline_kind/
   reporter_id additions).
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const SITE_BASE = 'https://emerging-tech-lab.com';
const NEWSROOM_NAME = 'ETL Newswire';
const NEWSROOM_TAGLINE = 'Releases, reporting, and analysis from the ETL network';

const DESKS = [
  { id: 'us',            label: 'US'            },
  { id: 'world',         label: 'World'         },
  { id: 'business',      label: 'Business'      },
  { id: 'technology',    label: 'Technology'    },
  { id: 'security',      label: 'Security'      },
  { id: 'science',       label: 'Science'       },
  { id: 'health',        label: 'Health'        },
  { id: 'entertainment', label: 'Entertainment' },
  { id: 'sports',        label: 'Sports'        },
];
const DESK_LABEL = DESKS.reduce((acc, d) => { acc[d.id] = d.label; return acc; }, {});
const DESK_IDS = new Set(DESKS.map(d => d.id));

let REPORTERS = null;
function getReporters() {
  if (REPORTERS) return REPORTERS;
  try {
    const data = require('../../config/newswire-reporters.json');
    REPORTERS = (data.reporters || []).reduce((acc, r) => { acc[r.id] = r; return acc; }, {});
  } catch (_) { REPORTERS = {}; }
  return REPORTERS;
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function fmtDateLong(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch { return ''; }
}
function fmtDateShort(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return ''; }
}
function fmtMasthead() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

// Returns SAFE HTML (already escaped). The reporter byline includes a link
// to the reporter profile + the tier label.
function bylineHTML(p) {
  if (p.byline_kind === 'reporter' && p.reporter_id) {
    const r = getReporters()[p.reporter_id];
    if (r) {
      const profileSlug = r.id.replace(/_/g, '-');
      const tier = r.tier_label ? `, ${esc(r.tier_label)}` : '';
      return `By <a href="/press/reporter/${esc(profileSlug)}" style="color:inherit;border-bottom:1px solid rgba(184,146,42,0.4);text-decoration:none;">${esc(r.name)}</a>${tier}`;
    }
  }
  return p.source_label ? `Source: ${esc(p.source_label)}` : '';
}

function renderDeskNav(activeDesk) {
  return `
  <nav class="desk-nav" aria-label="Desks">
    <a href="/press" class="desk-link${!activeDesk ? ' active' : ''}">All</a>
    ${DESKS.map(d => `<a href="/press?desk=${d.id}" class="desk-link${activeDesk === d.id ? ' active' : ''}">${esc(d.label)}</a>`).join('')}
  </nav>`;
}

function renderHero(p) {
  if (!p) return '';
  // Same fallback chain as feed cards: explicit hero -> reporter portrait
  // -> none. Lets the hero panel show the reporter's face when the AI
  // reporter did not attach a hero image.
  let hero = p.hero_image_url || '';
  if (!hero && p.byline_kind === 'reporter' && p.reporter_id) {
    const file = p.reporter_id.split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('_');
    hero = `/agents/${file}.png`;
  }
  hero = hero ? esc(hero) : '';
  const date = fmtDateLong(p.published_at);
  const byline = bylineHTML(p);
  const deskLabel = p.desk ? (DESK_LABEL[p.desk] || p.desk) : '';
  return `
  <article class="hero">
    ${hero ? `<a class="hero-image" href="/press/${esc(p.slug)}" style="background-image:url('${hero}');" aria-label="${esc(p.title)}"></a>` : ''}
    <div class="hero-body">
      <div class="hero-eyebrow">
        ${deskLabel ? `<a class="hero-desk" href="/press?desk=${esc(p.desk)}">${esc(deskLabel)}</a>` : ''}
        ${p.piece_type && p.piece_type !== 'news' ? `<span class="piece-type-tag piece-type-${esc(p.piece_type)}">${esc(p.piece_type.toUpperCase())}</span>` : ''}
        <span class="hero-date">${esc(date)}</span>
      </div>
      <h2 class="hero-title"><a href="/press/${esc(p.slug)}">${esc(p.title)}</a></h2>
      ${p.dek ? `<p class="hero-dek">${esc(p.dek)}</p>` : ''}
      <div class="hero-foot">
        ${byline ? `<span class="hero-byline">${byline}</span>` : ''}
        <a class="hero-cta" href="/press/${esc(p.slug)}">Read the story &rarr;</a>
      </div>
    </div>
  </article>`;
}

function renderFeedCard(p) {
  const date = fmtDateShort(p.published_at);
  const byline = bylineHTML(p);
  const deskLabel = p.desk ? (DESK_LABEL[p.desk] || p.desk) : '';
  // Thumb fallback chain: explicit hero_image_url -> reporter portrait (if a
  // staff reporter wrote it) -> beige placeholder. AI reporters do not
  // attach hero photos to pieces, so without this fallback every wire card
  // was empty.
  let thumbUrl = p.hero_image_url || '';
  if (!thumbUrl && p.byline_kind === 'reporter' && p.reporter_id) {
    const file = p.reporter_id.split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('_');
    thumbUrl = `/agents/${file}.png`;
  }
  // Card structure: the thumb/title/dek are wrapped in the piece-link
  // anchor (clicks go to the full piece). The byline lives OUTSIDE that
  // anchor as a sibling, so its inner reporter-profile <a> can be clicked
  // independently. (Nested <a> tags are invalid HTML and break click
  // routing - browsers split them and the inner click stops navigating.)
  return `
    <li class="feed-card">
      <a class="feed-link" href="/press/${esc(p.slug)}">
        ${thumbUrl ? `<span class="feed-thumb" style="background-image:url('${esc(thumbUrl)}');"></span>` : '<span class="feed-thumb feed-thumb-empty"></span>'}
        <span class="feed-text">
          <span class="feed-meta">
            ${deskLabel ? `<span class="feed-desk">${esc(deskLabel)}</span>` : ''}
            ${p.piece_type && p.piece_type !== 'news' ? `<span class="piece-type-tag piece-type-${esc(p.piece_type)}">${esc(p.piece_type.toUpperCase())}</span>` : ''}
            <time>${esc(date)}</time>
          </span>
          <span class="feed-title">${esc(p.title)}</span>
          ${p.dek ? `<span class="feed-dek">${esc(p.dek)}</span>` : ''}
        </span>
      </a>
      ${byline ? `<div class="feed-byline">${byline}</div>` : ''}
    </li>`;
}

function renderSidebarBlock(label, deskId, pieces) {
  const items = (pieces || []).slice(0, 4);
  if (!items.length) return `<section class="side-block"><h3 class="side-h"><a href="/press?desk=${esc(deskId)}">${esc(label)}</a></h3><p class="side-empty">Quiet on this desk.</p></section>`;
  return `
    <section class="side-block">
      <h3 class="side-h"><a href="/press?desk=${esc(deskId)}">${esc(label)}</a></h3>
      <ul class="side-list">
        ${items.map(p => `
          <li class="side-item">
            <a href="/press/${esc(p.slug)}">
              <span class="side-date">${esc(fmtDateShort(p.published_at))}</span>
              <span class="side-title">${esc(p.title)}</span>
            </a>
          </li>
        `).join('')}
      </ul>
    </section>`;
}

function renderNewsroom(pieces, activeDesk) {
  const total = pieces.length;
  const filtered = activeDesk ? pieces.filter(p => p.desk === activeDesk) : pieces;
  const hero = filtered[0] || null;
  const rest = filtered.slice(1);

  // Sidebar shows latest from a rotation of desks, pulled from the FULL list
  // not the filtered list, so visitors browsing a single desk still see what
  // is happening elsewhere.
  const sidebar = ['business', 'technology', 'science', 'health', 'world']
    .filter(d => d !== activeDesk)
    .slice(0, 3)
    .map(d => ({ id: d, label: DESK_LABEL[d], items: pieces.filter(p => p.desk === d) }));

  const masthead = fmtMasthead();
  const filterLabel = activeDesk ? ` &middot; ${esc(DESK_LABEL[activeDesk])} desk` : '';
  const pageTitle = activeDesk ? `${esc(DESK_LABEL[activeDesk])} | ${NEWSROOM_NAME}` : `${NEWSROOM_NAME} | Emerging Technologies Laboratory`;
  const pageDesc = activeDesk
    ? `${esc(DESK_LABEL[activeDesk])} desk reporting, releases, and analysis from the Emerging Technologies Laboratory network.`
    : `${NEWSROOM_NAME}. ${NEWSROOM_TAGLINE}. The Gauntlet, Greylander Press, the lab itself.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${pageTitle}</title>
<meta name="description" content="${pageDesc}">
<link rel="canonical" href="${SITE_BASE}/press${activeDesk ? '?desk=' + activeDesk : ''}">
<link rel="alternate" type="application/rss+xml" title="${NEWSROOM_NAME} RSS" href="${SITE_BASE}/press.rss">
<link rel="icon" href="/img/etl-favicon.png">
<meta property="og:title" content="${NEWSROOM_NAME}${filterLabel}">
<meta property="og:description" content="${pageDesc}">
<meta property="og:url" content="${SITE_BASE}/press${activeDesk ? '?desk=' + activeDesk : ''}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${NEWSROOM_NAME}">
<meta property="og:image" content="${SITE_BASE}/agents/newswire_logo.png">
<meta property="og:image:alt" content="ETL Newswire">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${NEWSROOM_NAME}${filterLabel}">
<meta name="twitter:description" content="${pageDesc}">
<meta name="twitter:image" content="${SITE_BASE}/agents/newswire_logo.png">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700&family=DM+Mono:wght@300;400;500&family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:#f7f3ea;color:#1a1a1a;font-family:'Cormorant Garamond',Georgia,serif;font-size:1.05rem;line-height:1.65;min-height:100vh;}
  a{color:inherit;}

  .topbar{background:#0e0c08;padding:0.85rem 2rem;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(184,146,42,0.25);}
  .topbar-logo{font-family:'Playfair Display',serif;font-size:0.95rem;letter-spacing:0.08em;color:#b8922a;text-decoration:none;}
  .topbar-logo strong{color:#f4ede0;font-weight:400;}
  .topbar-back{font-family:'DM Mono',monospace;font-size:0.6rem;letter-spacing:0.22em;text-transform:uppercase;color:#a89c88;text-decoration:none;}
  .topbar-back:hover{color:#d4aa4a;}

  .masthead{max-width:1180px;margin:0 auto;padding:2.6rem 2rem 1.2rem;text-align:center;border-bottom:1px solid #0e0c08;}
  .masthead-meta-top{font-family:'DM Mono',monospace;font-size:0.6rem;letter-spacing:0.22em;text-transform:uppercase;color:#5a5240;margin-bottom:1.4rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;}
  .masthead-meta-top a{color:#5a5240;text-decoration:none;border-bottom:1px solid rgba(90,82,64,0.25);}
  .masthead-meta-top a:hover{color:#0e0c08;border-bottom-color:#0e0c08;}
  .masthead-title{font-family:'Playfair Display',serif;font-size:clamp(2.6rem, 8vw, 5.2rem);font-weight:900;line-height:1;color:#0e0c08;letter-spacing:-0.02em;margin-bottom:0.5rem;text-transform:uppercase;}
  .masthead-tag{font-family:'Cormorant Garamond',serif;font-style:italic;color:#5a5240;font-size:1.1rem;}
  .masthead-rule{max-width:1180px;margin:0 auto;border-top:3px double #0e0c08;height:6px;}
  /* Above the Fold audio band, hidden until populated by JS */
  .briefing-band{background:#f4ebd6;color:#0e0c08;padding:1rem 0;display:none;border-top:1px solid #b8922a;border-bottom:1px solid #b8922a;}
  .briefing-band.is-ready{display:block;}
  .briefing-band-inner{max-width:1180px;margin:0 auto;padding:0 2rem;display:grid;grid-template-columns:1fr auto;gap:1.4rem;align-items:center;}
  @media (max-width:720px){.briefing-band-inner{grid-template-columns:1fr;}}
  .briefing-band-eyebrow{font-family:'DM Mono',monospace;font-size:0.6rem;letter-spacing:0.22em;text-transform:uppercase;color:#8a6a1c;margin-bottom:0.25rem;}
  .briefing-band-title{font-family:'Playfair Display',serif;font-size:1.3rem;font-weight:700;color:#0e0c08;line-height:1.15;margin-bottom:0.15rem;}
  .briefing-band-sub{font-family:'Cormorant Garamond',serif;font-style:italic;color:#5a5240;font-size:0.88rem;}
  .briefing-band-audio audio{width:300px;max-width:100%;height:36px;}
  @media (max-width:720px){.briefing-band-audio audio{width:100%;}}
  .briefing-share{display:flex;align-items:center;gap:0.5rem;margin-top:0.4rem;font-family:'DM Mono',monospace;font-size:0.55rem;letter-spacing:0.16em;text-transform:uppercase;color:#8a6a1c;flex-wrap:wrap;}
  .briefing-share a, .briefing-share button{font-family:inherit;font-size:inherit;letter-spacing:inherit;text-transform:inherit;color:#8a6a1c;background:transparent;border:1px solid #b8922a;padding:0.2rem 0.5rem;cursor:pointer;text-decoration:none;}
  .briefing-share a:hover, .briefing-share button:hover{background:#b8922a;color:#fff;}
  .briefing-share .copied{color:#3a6a2a;border-color:#3a6a2a;}
  /* Piece type tags - rendered for everything except 'news' so readers always know what they are reading. */
  .piece-type-tag{display:inline-block;font-family:'DM Mono',monospace;font-size:0.52rem;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;padding:0.18rem 0.45rem;border-radius:2px;}
  .piece-type-opinion{background:#3a6a8a;color:#fff;}
  .piece-type-satire{background:#8a3a6a;color:#fff;}
  .piece-type-community{background:#3a8a4a;color:#fff;}
  .piece-type-feature{background:#8a6a3a;color:#fff;}
  .piece-type-analysis{background:#5a5240;color:#fff;}

  /* Desk nav strip */
  .desk-nav{max-width:1180px;margin:0 auto;padding:0.9rem 2rem;display:flex;flex-wrap:wrap;gap:0.4rem 1.4rem;align-items:center;justify-content:center;border-bottom:1px solid rgba(14,12,8,0.18);font-family:'DM Mono',monospace;font-size:0.62rem;letter-spacing:0.22em;text-transform:uppercase;}
  .desk-link{color:#5a5240;text-decoration:none;padding:0.35rem 0.1rem;border-bottom:2px solid transparent;}
  .desk-link:hover{color:#0e0c08;}
  .desk-link.active{color:#0e0c08;border-bottom-color:#b8922a;}

  /* Hero */
  .hero-band{max-width:1180px;margin:0 auto;padding:2rem 2rem 1rem;}
  .hero{background:#fff;border:1px solid rgba(184,146,42,0.4);padding:0;position:relative;display:flex;flex-direction:column;}
  .hero-image{display:block;width:100%;aspect-ratio:16 / 9;background-color:#e9dfc6;background-size:cover;background-position:center;text-decoration:none;}
  .hero-body{padding:2rem 2.2rem;display:flex;flex-direction:column;}
  .hero-eyebrow{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.8rem;margin-bottom:0.9rem;font-family:'DM Mono',monospace;font-size:0.6rem;letter-spacing:0.22em;text-transform:uppercase;color:#5a5240;}
  .hero-desk{color:#a3811c;text-decoration:none;background:rgba(184,146,42,0.08);padding:0.3rem 0.55rem;border:1px solid rgba(184,146,42,0.35);}
  .hero-desk:hover{background:#b8922a;color:#fff;}
  .hero-date{color:#5a5240;}
  .hero-title{font-family:'Playfair Display',serif;font-size:clamp(1.8rem, 4.5vw, 2.9rem);font-weight:700;line-height:1.1;margin-bottom:0.7rem;}
  .hero-title a{text-decoration:none;color:#0e0c08;border-bottom:0;}
  .hero-title a:hover{color:#a3811c;}
  .hero-dek{font-family:'Cormorant Garamond',serif;font-style:italic;font-size:1.2rem;color:#5a5240;line-height:1.5;margin-bottom:1.4rem;max-width:680px;}
  .hero-foot{display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;}
  .hero-byline{font-family:'DM Mono',monospace;font-size:0.6rem;letter-spacing:0.2em;text-transform:uppercase;color:#5a5240;}
  .hero-cta{display:inline-block;font-family:'DM Mono',monospace;font-size:0.62rem;letter-spacing:0.2em;text-transform:uppercase;color:#fff;background:#0e0c08;padding:0.7rem 1.4rem;text-decoration:none;border:1px solid #0e0c08;font-weight:600;}
  .hero-cta:hover{background:#b8922a;border-color:#b8922a;color:#0e0c08;}

  /* Main content split */
  .news-body{max-width:1180px;margin:0 auto;padding:1.2rem 2rem 4rem;display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:2.6rem;}
  @media (max-width:880px){ .news-body{grid-template-columns:1fr;gap:2rem;} }

  .feed-h{font-family:'DM Mono',monospace;font-size:0.65rem;letter-spacing:0.25em;text-transform:uppercase;color:#0e0c08;border-bottom:1px solid #0e0c08;padding-bottom:0.55rem;margin-bottom:1.2rem;}
  .feed{list-style:none;}
  .feed-card{margin-bottom:1.2rem;background:#fff;border:1px solid rgba(184,146,42,0.25);transition:border-color 0.15s;}
  .feed-card:hover{border-color:#b8922a;}
  .feed-link{display:flex;gap:1.1rem;align-items:flex-start;padding:1.1rem 1.3rem;text-decoration:none;color:inherit;}
  .feed-thumb{flex:0 0 auto;display:block;width:110px;height:82px;background-color:#e9dfc6;background-size:cover;background-position:center;border:1px solid rgba(184,146,42,0.3);}
  .feed-thumb-empty{background-image:linear-gradient(135deg, rgba(184,146,42,0.10), rgba(184,146,42,0.02));}
  .feed-text{display:flex;flex-direction:column;flex:1 1 auto;min-width:0;}
  .feed-meta{display:flex;flex-wrap:wrap;gap:0.6rem;align-items:center;font-family:'DM Mono',monospace;font-size:0.55rem;letter-spacing:0.18em;text-transform:uppercase;color:#5a5240;margin-bottom:0.45rem;}
  .feed-desk{color:#a3811c;}
  .feed-title{font-family:'Playfair Display',serif;font-size:1.25rem;font-weight:700;line-height:1.25;color:#0e0c08;margin-bottom:0.35rem;}
  .feed-dek{font-family:'Cormorant Garamond',serif;font-style:italic;font-size:0.98rem;color:#5a5240;line-height:1.5;margin-bottom:0.4rem;}
  .feed-byline{font-family:'DM Mono',monospace;font-size:0.55rem;letter-spacing:0.18em;text-transform:uppercase;color:#7a6f5a;}
  @media (max-width:520px){ .feed-link{flex-direction:column;} .feed-thumb{width:100%;height:140px;} }

  .sidebar{display:flex;flex-direction:column;gap:1.6rem;}
  .side-block{background:#fff;border:1px solid rgba(184,146,42,0.25);padding:1.3rem 1.4rem;}
  .side-h{font-family:'DM Mono',monospace;font-size:0.6rem;letter-spacing:0.24em;text-transform:uppercase;color:#a3811c;border-bottom:1px solid rgba(184,146,42,0.3);padding-bottom:0.55rem;margin-bottom:0.9rem;}
  .side-h a{color:inherit;text-decoration:none;}
  .side-h a:hover{color:#0e0c08;}
  .side-list{list-style:none;}
  .side-item{padding:0.55rem 0;border-bottom:1px solid rgba(184,146,42,0.18);}
  .side-item:last-child{border-bottom:none;}
  .side-item a{display:flex;flex-direction:column;gap:0.2rem;text-decoration:none;color:inherit;}
  .side-item a:hover .side-title{color:#a3811c;}
  .side-date{font-family:'DM Mono',monospace;font-size:0.55rem;letter-spacing:0.18em;text-transform:uppercase;color:#5a5240;}
  .side-title{font-family:'Playfair Display',serif;font-size:0.98rem;font-weight:600;line-height:1.3;color:#0e0c08;transition:color 0.15s;}
  .side-empty{font-family:'Cormorant Garamond',serif;font-style:italic;color:#5a5240;font-size:0.95rem;}

  .empty{padding:3rem 2rem;text-align:center;color:#5a5240;font-style:italic;font-size:1.1rem;background:#fff;border:1px solid rgba(184,146,42,0.25);}
  .empty strong{color:#0e0c08;font-style:normal;font-weight:600;display:block;font-family:'Playfair Display',serif;font-size:1.4rem;margin-bottom:0.6rem;}

  footer.newsroom-foot{max-width:1180px;margin:0 auto;padding:1.6rem 2rem 3rem;border-top:1px solid rgba(14,12,8,0.2);font-family:'DM Mono',monospace;font-size:0.58rem;letter-spacing:0.18em;text-transform:uppercase;color:#5a5240;display:flex;justify-content:space-between;flex-wrap:wrap;gap:1rem;align-items:center;}
  footer.newsroom-foot a{color:#5a5240;text-decoration:none;border-bottom:1px solid rgba(90,82,64,0.25);}
  footer.newsroom-foot a:hover{color:#0e0c08;border-bottom-color:#0e0c08;}
  footer.newsroom-foot .foot-right{display:flex;gap:1rem;flex-wrap:wrap;}
  footer.newsroom-foot .foot-admin{opacity:0.55;}
</style>
</head>
<body>

<nav class="topbar">
  <a class="topbar-logo" href="/"><strong>ETL</strong> &middot; ${NEWSROOM_NAME}</a>
  <a class="topbar-back" href="/">&larr; ETL Home</a>
</nav>

<header class="masthead">
  <div class="masthead-meta-top">
    <span>${esc(masthead)}${total ? ` &middot; ${total} on file` : ''}</span>
    <span><a href="/press-about">About this newsroom</a> &middot; <a href="/press.rss">RSS</a></span>
  </div>
  <h1 class="masthead-title">${NEWSROOM_NAME}</h1>
  <p class="masthead-tag">${NEWSROOM_TAGLINE}${activeDesk ? ' &middot; <strong>' + esc(DESK_LABEL[activeDesk]) + '</strong> desk' : ''}</p>
</header>
<div class="masthead-rule"></div>

<section class="briefing-band" id="briefing-card" aria-label="5 in Under 5 audio briefing">
  <div class="briefing-band-inner">
    <div>
      <div class="briefing-band-eyebrow">Above the Fold &middot; Morning briefing from the wire desk</div>
      <div class="briefing-band-title">Today's top stories, above the fold.</div>
      <div class="briefing-band-sub" id="briefing-sub"></div>
    </div>
    <div class="briefing-band-audio">
      <audio id="briefing-audio" controls preload="none"></audio>
      <div class="briefing-share" id="briefing-share">
        <span>Share:</span>
        <button type="button" data-share="link">Copy link</button>
        <button type="button" data-share="embed">Copy embed</button>
        <a href="https://twitter.com/intent/tweet?text=Today%27s%20wire%2C%20above%20the%20fold.&url=https%3A%2F%2Femerging-tech-lab.com%2Fpress" target="_blank" rel="noopener">Tweet</a>
        <a href="/press/above-the-fold.xml" target="_blank" rel="noopener">Podcast RSS</a>
      </div>
    </div>
  </div>
</section>
<script>
(function(){
  var share = document.getElementById('briefing-share');
  if (share) {
    share.addEventListener('click', function(ev){
      var btn = ev.target.closest('button[data-share]');
      if (!btn) return;
      var mode = btn.getAttribute('data-share');
      var text = mode === 'embed'
        ? '<iframe src="https://emerging-tech-lab.com/press/above-the-fold/embed" width="680" height="120" style="border:0;" loading="lazy" title="Above the Fold from ETL Newswire"></iframe>'
        : 'https://emerging-tech-lab.com/press';
      var orig = btn.textContent;
      var copy = navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject();
      copy.then(function(){
        btn.textContent = 'Copied';
        btn.classList.add('copied');
        setTimeout(function(){ btn.textContent = orig; btn.classList.remove('copied'); }, 1800);
      }).catch(function(){ window.prompt('Copy this:', text); });
    });
  }
  fetch('/.netlify/functions/newswire-briefing-latest', { credentials: 'omit' })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(meta){
      if (!meta || !meta.available || !meta.audio_url) return;
      var card = document.getElementById('briefing-card');
      var audio = document.getElementById('briefing-audio');
      var sub = document.getElementById('briefing-sub');
      if (!card || !audio) return;
      audio.src = meta.audio_url;
      if (sub && meta.generated_at) {
        var dt = new Date(meta.generated_at);
        sub.textContent = isNaN(+dt) ? '' : 'Recorded ' + dt.toLocaleDateString('en-US',{weekday:'long', month:'long', day:'numeric'}) + ' at ' + dt.toLocaleTimeString('en-US',{hour:'numeric', minute:'2-digit'});
      }
      card.classList.add('is-ready');
    })
    .catch(function(){});
})();
</script>

${renderDeskNav(activeDesk)}

${hero ? `<section class="hero-band">${renderHero(hero)}</section>` : ''}

<div class="news-body">
  <main>
    ${rest.length ? `<h2 class="feed-h">${activeDesk ? 'More on the ' + esc(DESK_LABEL[activeDesk]) + ' desk' : 'More from the wire'}</h2><ul class="feed">${rest.map(renderFeedCard).join('\n')}</ul>` : (filtered.length === 0 ? `<div class="empty"><strong>Quiet on the wire.</strong>${activeDesk ? 'No pieces on the ' + esc(DESK_LABEL[activeDesk]) + ' desk yet. The reporter is on it.' : 'No releases on file yet. Imani and Jess are warming up.'}</div>` : '')}
  </main>

  <aside class="sidebar">
    ${sidebar.map(s => renderSidebarBlock(s.label, s.id, s.items)).join('\n')}
  </aside>
</div>

<footer class="newsroom-foot">
  <span>${NEWSROOM_NAME} &middot; A publication of the Emerging Technologies Laboratory</span>
  <span class="foot-right">
    <a href="/press-about">About</a>
    <a href="/press/careers">Careers</a>
    <a href="/press.rss">RSS</a>
    <a href="/press-sitemap.xml">Sitemap</a>
    <a class="foot-admin" href="/press-admin" rel="nofollow noindex">Admin</a>
  </span>
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
  const deskQ = (event.queryStringParameters && event.queryStringParameters.desk) || '';
  const activeDesk = DESK_IDS.has(deskQ.toLowerCase()) ? deskQ.toLowerCase() : '';
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
    },
    body: renderNewsroom(pieces, activeDesk),
  };
};
