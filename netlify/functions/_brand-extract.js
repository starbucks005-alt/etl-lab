/* _brand-extract — read a client's existing brand off their own website.
   ─────────────────────────────────────────────────────────────────────────
   WHY THIS EXISTS (2026-07-31)

   Six ETL Design pieces were made for My Echo. Dr. O kept exactly one, and
   the reason was not composition: Yuki had chosen Vault Black #1a1510,
   Antique Gold #b8922a and a Cormorant serif, which IS the M.E. logo. The
   other five invented parchment, amber and sage. Dr. O: "what made this one
   work so well is how much it looked in sync with the product."

   The difference between that run and the others was one input. She had
   uploaded the M.E. logo as a concept image. Yuki with a logo lands inside
   the client's brand; Yuki without one improvises, and improvising is where
   every failure came from.

   A design firm does not invent an identity for a business that already has
   one. The form already collects the client's website and, until now, used
   it for exactly two things: telling Zara not to invent a link, and printing
   the footer. It never touched the look. This module makes that one paste do
   what the uploaded logo did.

   WHAT IT TAKES: the og:image or apple-touch-icon (usually the brand card or
   the mark), theme-color, the hex colours that actually appear in the site's
   stylesheets, and the font families it declares.

   IT FAILS LOUDLY, NOT SILENTLY. When a site cannot be read, the caller gets
   a reason and must tell the client we could not match their brand. Quietly
   substituting an invented palette is precisely the behaviour that produced
   five pieces nobody wanted.
*/

const HTML_CAP  = 1_500_000;   // bytes of markup we will read
const CSS_CAP   =   400_000;   // per stylesheet
const IMG_CAP   = 4_000_000;   // ~3MB decoded, under Anthropic's ceiling
const TIMEOUT   =      6000;   // ms per request
const MAX_CSS   =         3;   // stylesheets to sample

/* Hosts we refuse to fetch. The URL comes from a form, so it is attacker
   controlled in the general case: without this the function would happily
   fetch cloud metadata endpoints or anything else inside the network it runs
   in. Blocking by name and literal address only; this is a guard, not a
   complete SSRF defence. */
function isBlockedHost(host) {
  const h = String(host || '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
  if (h === '0.0.0.0' || h === '::1' || h === '[::1]') return true;
  if (/^10\./.test(h)) return true;
  if (/^127\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;                 // link local, incl. cloud metadata
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

/* Accept what a person actually types. "my-echo.me" is a URL to everyone
   except a URL parser. */
function normalizeUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  /* A scheme we do not speak is a rejection, not something to prefix.
     Prefixing turned "ftp://x" into "https://ftp//x" and "file:///etc/passwd"
     into "https://file///etc/passwd", both of which then went out as real
     fetches to a host named after the scheme. */
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:\/\//i.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch (_) { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (isBlockedHost(u.hostname)) return null;
  return u;
}

async function fetchCapped(url, cap, asBuffer) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: {
        // Some sites serve nothing useful to an unidentified client.
        'User-Agent': 'Mozilla/5.0 (compatible; ETLDesignBrandReader/1.0; +https://emerging-tech-lab.com)',
        'Accept': asBuffer ? 'image/*,*/*' : 'text/html,text/css,*/*',
      },
    });
    if (!r.ok) return { error: 'HTTP ' + r.status };
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > cap) return { error: 'too large (' + buf.length + ' bytes)' };
    return asBuffer
      ? { buf, type: (r.headers.get('content-type') || '').split(';')[0].trim() }
      : { text: buf.toString('utf8') };
  } catch (e) {
    return { error: (e && e.name === 'AbortError') ? 'timed out' : (e && e.message) || 'fetch failed' };
  } finally {
    clearTimeout(timer);
  }
}

function attr(tag, name) {
  const m = new RegExp(name + '\\s*=\\s*["\']([^"\']+)["\']', 'i').exec(tag);
  return m ? m[1] : null;
}

/* Best available brand image, in the order most likely to be ON brand:
   og:image is usually the deliberately designed share card, the touch icon is
   usually the mark itself, a bare favicon is a last resort. */
function findBrandImage(html, base) {
  const candidates = [];
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  for (const t of metas) {
    const prop = (attr(t, 'property') || attr(t, 'name') || '').toLowerCase();
    const content = attr(t, 'content');
    if (!content) continue;
    if (prop === 'og:image' || prop === 'og:image:secure_url') candidates.push({ url: content, rank: 0 });
    else if (prop === 'twitter:image' || prop === 'twitter:image:src') candidates.push({ url: content, rank: 1 });
  }
  const links = html.match(/<link\b[^>]*>/gi) || [];
  for (const t of links) {
    const rel = (attr(t, 'rel') || '').toLowerCase();
    const href = attr(t, 'href');
    if (!href) continue;
    if (rel.includes('apple-touch-icon')) candidates.push({ url: href, rank: 2 });
    else if (rel.includes('icon')) candidates.push({ url: href, rank: 3 });
  }
  candidates.sort((a, b) => a.rank - b.rank);
  for (const c of candidates) {
    try { return new URL(c.url, base).toString(); } catch (_) {}
  }
  return null;
}

/* THE PHOTOGRAPHY IS MOST OF THE BRAND, AND WE WERE IGNORING IT.
   ─────────────────────────────────────────────────────────────────────────
   Reading the palette and the type got the colours right and the world
   wrong. Almost Human's actual visual language is a warm café: brick, string
   lights, window light, real-looking people at wooden tables, sitting inside
   a near-black UI. Chris, given only hex values, invented a glowing neon head
   that appears nowhere in the product. Dr. O: "a good design team would deep
   dive into the assets, the look of the brand/the site, and design from
   there."

   So collect the real content images too, and let Yuki look at them. Capped
   at a handful: each one costs vision tokens, and three is plenty to read a
   lighting style off. Tiny files are skipped because icons and spacers say
   nothing about how a brand photographs. */
function findContentImages(html, base, exclude) {
  const seen = new Set(exclude || []);
  const out = [];
  const consider = (src) => {
    if (!src || /^data:/i.test(src) || out.length >= 8) return;
    if (/sprite|spacer|pixel|1x1|blank|favicon|icon-|\/icons?\//i.test(src)) return;
    let abs;
    try { abs = new URL(src, base).toString(); } catch (_) { return; }
    if (seen.has(abs)) return;
    seen.add(abs);
    out.push(abs);
  };

  for (const t of (html.match(/<img\b[^>]*>/gi) || [])) {
    consider(attr(t, 'src') || attr(t, 'data-src'));
  }

  /* <img> alone finds nothing on a JS-rendered page. Both ETL sites build
     their galleries from JSON after load, so a server-side fetch sees zero
     image tags while the markup is full of image PATHS, sitting in inline
     JSON, in script arrays and in CSS background rules. Take them from
     anywhere: we only need to look at the pictures, not to understand the
     page (2026-07-31). */
  for (const m of html.matchAll(/["'(]([^"'()\s]+\.(?:png|jpe?g|webp))(?:\?[^"'()\s]*)?["')]/gi)) {
    consider(m[1]);
  }
  return out;
}

function findThemeColor(html) {
  for (const t of (html.match(/<meta\b[^>]*>/gi) || [])) {
    if ((attr(t, 'name') || '').toLowerCase() === 'theme-color') {
      const c = attr(t, 'content');
      if (c && /^#?[0-9a-f]{3,8}$/i.test(c.trim())) return c.trim().startsWith('#') ? c.trim() : '#' + c.trim();
    }
  }
  return null;
}

function expandHex(h) {
  const s = h.replace('#', '').toLowerCase();
  if (s.length === 3) return '#' + s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (s.length === 6) return '#' + s;
  if (s.length === 8) return '#' + s.slice(0, 6);   // drop alpha
  return null;
}

/* Colours ranked by how often the site actually uses them. Frequency is a
   better signal than any cleverness here: a brand colour appears in dozens of
   rules, a one-off accent appears once. */
function colorsFrom(css) {
  const counts = new Map();
  for (const m of css.matchAll(/#([0-9a-fA-F]{3,8})\b/g)) {
    const hex = expandHex(m[0]);
    if (hex) counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  for (const m of css.matchAll(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g)) {
    const hex = '#' + [m[1], m[2], m[3]].map(n => Math.min(255, +n).toString(16).padStart(2, '0')).join('');
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
}

const GENERIC_FONTS = new Set([
  'inherit', 'initial', 'unset', 'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy',
  'system-ui', '-apple-system', 'blinkmacsystemfont', 'ui-sans-serif', 'ui-serif', 'ui-monospace',
  'segoe ui', 'roboto', 'helvetica', 'helvetica neue', 'arial', 'apple color emoji',
  'segoe ui emoji', 'noto color emoji', 'sans', 'emoji',
]);

function fontsFrom(css) {
  const counts = new Map();
  for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    const first = m[1].split(',')[0].replace(/["']/g, '').trim().toLowerCase();
    if (!first || GENERIC_FONTS.has(first) || first.startsWith('var(')) continue;
    counts.set(first, (counts.get(first) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
    .map(e => e[0].replace(/\b\w/g, c => c.toUpperCase()));
}

/* Read a brand off a website.
   Returns { ok, concept_data_url, palette[], fonts[], theme_color, image_url,
             source, error }. `ok:false` always carries a human-readable
             `error` the caller is expected to surface, never swallow. */
async function extractBrand(rawUrl) {
  const u = normalizeUrl(rawUrl);
  if (!u) return { ok: false, error: 'that does not look like a public web address' };

  const page = await fetchCapped(u.toString(), HTML_CAP, false);
  if (page.error) return { ok: false, error: 'could not read ' + u.hostname + ' (' + page.error + ')' };
  const html = page.text || '';

  // Stylesheets, for the colours and the type the site really uses.
  const sheets = [];
  for (const t of (html.match(/<link\b[^>]*>/gi) || [])) {
    const rel = (attr(t, 'rel') || '').toLowerCase();
    const href = attr(t, 'href');
    if (!href || !rel.includes('stylesheet')) continue;
    try { sheets.push(new URL(href, u).toString()); } catch (_) {}
    if (sheets.length >= MAX_CSS) break;
  }
  let css = (html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/gi) || []).join('\n');
  for (const s of sheets) {
    const r = await fetchCapped(s, CSS_CAP, false);
    if (r.text) css += '\n' + r.text;
  }

  const theme = findThemeColor(html);
  let palette = colorsFrom(css).slice(0, 8);
  if (theme && !palette.includes(theme)) palette.unshift(theme);
  palette = palette.slice(0, 6);
  const fonts = fontsFrom(css).slice(0, 3);

  // The image. Optional: colours and type alone are still worth having.
  let conceptDataUrl = null, imageUrl = null, imageError = null;
  const imgSrc = findBrandImage(html, u);
  if (imgSrc) {
    imageUrl = imgSrc;
    const got = await fetchCapped(imgSrc, IMG_CAP, true);
    if (got.error) {
      imageError = got.error;
    } else if (/^image\/(png|jpeg|jpg|webp|gif)$/i.test(got.type || '')) {
      const media = /jpg$/i.test(got.type) ? 'image/jpeg' : got.type.toLowerCase();
      conceptDataUrl = 'data:' + media + ';base64,' + got.buf.toString('base64');
    } else {
      // SVG favicons are common and Anthropic will not take them as an image.
      imageError = 'unsupported image type ' + (got.type || 'unknown');
    }
  }

  /* THE MARK OFTEN LIVES ON THE ROOT, NOT THE PAGE YOU WERE GIVEN.
     emerging-tech-lab.com/almost-human carries no og:image or touch icon of
     its own, so a brand read of that URL came back with got_logo:false while
     the site root had the mark all along. Ask the root before giving up. */
  if (!conceptDataUrl && u.pathname && u.pathname !== '/') {
    const rootUrl = u.origin + '/';
    const root = await fetchCapped(rootUrl, HTML_CAP, false);
    if (root.text) {
      const rootImg = findBrandImage(root.text, rootUrl);
      if (rootImg) {
        const got = await fetchCapped(rootImg, IMG_CAP, true);
        if (!got.error && /^image\/(png|jpeg|jpg|webp|gif)$/i.test(got.type || '')) {
          const media = /jpg$/i.test(got.type) ? 'image/jpeg' : got.type.toLowerCase();
          conceptDataUrl = 'data:' + media + ';base64,' + got.buf.toString('base64');
          imageUrl = rootImg;
          imageError = null;
        }
      }
    }
  }

  /* Real photographs from the page, so Yuki can read the lighting, the
     setting and the way people are framed rather than guessing a world from
     four hex values. Two is enough and keeps the vision cost near a cent. */
  const references = [];
  for (const src of findContentImages(html, u, [imageUrl].filter(Boolean))) {
    if (references.length >= 2) break;
    const got = await fetchCapped(src, IMG_CAP, true);
    if (got.error || !/^image\/(png|jpeg|jpg|webp)$/i.test(got.type || '')) continue;
    if (got.buf.length < 20000) continue;          // an icon, not a photograph
    const media = /jpg$/i.test(got.type) ? 'image/jpeg' : got.type.toLowerCase();
    references.push({ url: src, data_url: 'data:' + media + ';base64,' + got.buf.toString('base64') });
  }

  if (!conceptDataUrl && !palette.length && !fonts.length && !references.length) {
    return { ok: false, error: 'nothing on ' + u.hostname + ' told us what the brand looks like' };
  }

  return {
    ok: true,
    concept_data_url: conceptDataUrl,
    references,
    palette, fonts,
    theme_color: theme || null,
    image_url: imageUrl,
    image_error: imageError,
    source: u.hostname,
  };
}

module.exports = { extractBrand, normalizeUrl, isBlockedHost, colorsFrom, fontsFrom };
