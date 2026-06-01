/* ─────────────────────────────────────────────────────────────────────────────
   press-piece — render a single press piece as a full HTML page with SEO.

   GET /.netlify/functions/press-piece?slug=foo (also reached via the
   pretty redirect /press/<slug> in netlify.toml).

   Returns a complete HTML document with:
     - <title> and <meta name=description> from the piece
     - OG tags (og:title, og:description, og:url, og:type=article)
     - Twitter Card tags
     - JSON-LD Article schema with publisher = Emerging Technologies Laboratory
     - canonical link to the press piece URL
     - dofollow backlink to the source_url (the client's site) in the byline
       AND at the foot of the article
     - footer link back to the platform of origin (Gauntlet / Greylander / Lab)

   This is the SEO surface that gives the source site a backlink from
   emerging-tech-lab.com.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const SITE_BASE = 'https://emerging-tech-lab.com';

const PLATFORM_LABELS = {
  gauntlet:   { label: 'The Gauntlet',     url: 'https://thegauntlet.studio/' },
  greylander: { label: 'Greylander Press', url: 'https://greylanderpress.com/' },
  lab:        { label: 'Emerging Technologies Laboratory', url: 'https://emerging-tech-lab.com/' },
};

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function renderBody(text) {
  // Split on blank lines into paragraphs, escape, preserve single newlines as <br>.
  return String(text || '')
    .split(/\n\s*\n/)
    .map(para => '<p>' + esc(para.trim()).replace(/\n/g, '<br>') + '</p>')
    .join('\n');
}

function renderPiece(piece) {
  const platform = PLATFORM_LABELS[piece.platform] || PLATFORM_LABELS.lab;
  const url = SITE_BASE + '/press/' + piece.slug;
  const sourceLabel = piece.source_label || (() => { try { return new URL(piece.source_url).hostname.replace(/^www\./, ''); } catch { return 'the source'; } })();
  const date = piece.published_at || new Date().toISOString();
  const dateHuman = new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const description = piece.dek || piece.body.slice(0, 220).replace(/\s+/g, ' ').trim() + (piece.body.length > 220 ? '...' : '');

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": piece.title,
    "description": description,
    "datePublished": date,
    "dateModified": date,
    "author": piece.author ? { "@type": "Person", "name": piece.author } : { "@type": "Organization", "name": sourceLabel },
    "publisher": {
      "@type": "Organization",
      "name": "Emerging Technologies Laboratory",
      "url": SITE_BASE,
      "logo": { "@type": "ImageObject", "url": SITE_BASE + "/img/etl-favicon.png" }
    },
    "mainEntityOfPage": { "@type": "WebPage", "@id": url },
    "url": url,
    "isBasedOn": piece.source_url
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(piece.title)} | ETL Press Hub</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<link rel="icon" href="/img/etl-favicon.png">

<meta property="og:type" content="article">
<meta property="og:title" content="${esc(piece.title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:site_name" content="ETL Press Hub">
<meta property="article:published_time" content="${esc(date)}">
<meta property="article:author" content="${esc(piece.author || sourceLabel)}">

<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(piece.title)}">
<meta name="twitter:description" content="${esc(description)}">

<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>

<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=DM+Mono:wght@300;400&family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:#f7f3ea;color:#1a1a1a;font-family:'Cormorant Garamond',Georgia,serif;font-size:1.1rem;line-height:1.75;min-height:100vh;}
  .nav{background:#0e0c08;padding:1rem 2rem;display:flex;align-items:center;justify-content:space-between;}
  .nav-logo{font-family:'Playfair Display',serif;font-size:1rem;letter-spacing:0.1em;color:#b8922a;text-decoration:none;}
  .nav-logo strong{color:#f4ede0;font-weight:400;}
  .nav-back{font-family:'DM Mono',monospace;font-size:0.62rem;letter-spacing:0.22em;text-transform:uppercase;color:#a89c88;text-decoration:none;}
  .nav-back:hover{color:#d4aa4a;}

  .ribbon{background:#1a1612;color:#a89c88;font-family:'DM Mono',monospace;font-size:0.6rem;letter-spacing:0.22em;text-transform:uppercase;text-align:center;padding:0.55rem 1rem;border-bottom:1px solid rgba(184,146,42,0.25);}
  .ribbon span{color:#d4aa4a;}

  article{max-width:760px;margin:0 auto;padding:2.5rem 2rem 4rem;}
  .meta-line{font-family:'DM Mono',monospace;font-size:0.62rem;letter-spacing:0.22em;text-transform:uppercase;color:#5a5240;margin-bottom:1.6rem;}
  .meta-line a{color:#a3811c;text-decoration:none;border-bottom:1px solid rgba(184,146,42,0.4);}
  .meta-line a:hover{color:#0e0c08;}
  h1{font-family:'Playfair Display',serif;font-size:clamp(1.9rem, 4.5vw, 2.8rem);font-weight:700;line-height:1.15;margin-bottom:0.7rem;color:#0e0c08;}
  .dek{font-family:'Cormorant Garamond',serif;font-style:italic;font-size:1.25rem;color:#5a5240;margin-bottom:2rem;line-height:1.5;}
  .body{font-size:1.1rem;color:#1a1a1a;}
  .body p{margin-bottom:1.1rem;}
  .body p:first-of-type::first-letter{font-family:'Playfair Display',serif;font-size:3.4rem;float:left;line-height:1;padding:0.35rem 0.55rem 0 0;color:#b8922a;font-weight:700;}

  .byline{margin-top:2.2rem;padding-top:1.4rem;border-top:1px solid rgba(184,146,42,0.3);font-family:'DM Mono',monospace;font-size:0.7rem;letter-spacing:0.16em;text-transform:uppercase;color:#5a5240;}
  .byline a{color:#a3811c;text-decoration:none;border-bottom:1px solid rgba(184,146,42,0.4);}
  .byline a:hover{color:#0e0c08;}

  .source-cta{margin-top:2.5rem;padding:1.5rem 1.8rem;background:#fff;border:1px solid rgba(184,146,42,0.4);border-left:4px solid #b8922a;}
  .source-cta-label{font-family:'DM Mono',monospace;font-size:0.6rem;letter-spacing:0.22em;text-transform:uppercase;color:#a3811c;margin-bottom:0.4rem;}
  .source-cta-text{font-family:'Cormorant Garamond',serif;font-size:1.05rem;color:#1a1a1a;margin-bottom:0.8rem;line-height:1.55;}
  .source-cta-link{display:inline-block;font-family:'DM Mono',monospace;font-size:0.65rem;letter-spacing:0.2em;text-transform:uppercase;color:#fff;background:#0e0c08;padding:0.7rem 1.4rem;text-decoration:none;border:1px solid #0e0c08;font-weight:600;}
  .source-cta-link:hover{background:#b8922a;border-color:#b8922a;color:#0e0c08;}

  footer{max-width:760px;margin:0 auto;padding:2rem 2rem 4rem;border-top:1px solid rgba(184,146,42,0.25);}
  .foot-row{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;font-family:'DM Mono',monospace;font-size:0.6rem;letter-spacing:0.18em;text-transform:uppercase;color:#5a5240;}
  .foot-row a{color:#a3811c;text-decoration:none;}
  .foot-row a:hover{color:#0e0c08;}

  @media (max-width: 640px){
    article{padding:1.8rem 1.25rem 3rem;}
    .body p:first-of-type::first-letter{font-size:2.6rem;}
  }
</style>
</head>
<body>

<nav class="nav">
  <a class="nav-logo" href="/"><strong>ETL</strong> &middot; PRESS HUB</a>
  <a class="nav-back" href="/press">&larr; All releases</a>
</nav>

<div class="ribbon">
  Published by <span>Emerging Technologies Laboratory</span> &middot; via ${esc(platform.label)}
</div>

<article>
  <div class="meta-line">
    <time datetime="${esc(date)}">${esc(dateHuman)}</time>
    &nbsp;&middot;&nbsp;
    <a href="${esc(piece.source_url)}" rel="noopener">${esc(sourceLabel)}</a>
  </div>

  <h1>${esc(piece.title)}</h1>
  ${piece.dek ? `<p class="dek">${esc(piece.dek)}</p>` : ''}

  <div class="body">
    ${renderBody(piece.body)}
  </div>

  <div class="byline">
    ${piece.author ? `By ${esc(piece.author)} &middot; ` : ''}
    Source: <a href="${esc(piece.source_url)}" rel="noopener">${esc(sourceLabel)}</a>
  </div>

  <div class="source-cta">
    <div class="source-cta-label">Read more at the source</div>
    <p class="source-cta-text">This release was originally distributed via ${esc(platform.label)}. Visit ${esc(sourceLabel)} for the full story, related releases, and contact information.</p>
    <a class="source-cta-link" href="${esc(piece.source_url)}" rel="noopener">Visit ${esc(sourceLabel)} &rarr;</a>
  </div>
</article>

<footer>
  <div class="foot-row">
    <span>ETL Press Hub &middot; Emerging Technologies Laboratory</span>
    <a href="${esc(platform.url)}">Originated at ${esc(platform.label)} &rarr;</a>
  </div>
</footer>

</body>
</html>`;
}

function notFoundHtml(slug) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Not found | ETL Press Hub</title><meta name="robots" content="noindex"></head><body style="font-family:Georgia,serif;max-width:600px;margin:4rem auto;padding:0 1.5rem;color:#333;"><h1>This press release could not be found.</h1><p>The slug <code>${esc(slug)}</code> is not in the press hub.</p><p><a href="/press">See all releases &rarr;</a></p></body></html>`;
}

exports.handler = async (event) => {
  const slug = (event.queryStringParameters && event.queryStringParameters.slug) || '';
  if (!slug) {
    return { statusCode: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: notFoundHtml('(no slug provided)') };
  }
  try { connectLambda(event); } catch (err) {
    console.error('[press-piece] connectLambda failed', err && err.message);
    return { statusCode: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: notFoundHtml(slug) };
  }
  const store = getStore('press_pieces');
  let piece;
  try { piece = await store.get(slug, { type: 'json' }); }
  catch (err) { console.error('[press-piece] blob read failed', err && err.message); }
  if (!piece) {
    return { statusCode: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: notFoundHtml(slug) };
  }
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Light caching for SEO; 5 min edge / 1 hour stale-while-revalidate.
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
    },
    body: renderPiece(piece),
  };
};
