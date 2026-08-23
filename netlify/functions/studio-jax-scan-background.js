/* ─────────────────────────────────────────────────────────────────────────────
   studio-jax-scan-background

   Jax Rivera's real SEO + discoverability scan, run as a Netlify background
   function (15-min budget) so we are not bound by the 10s sync timeout.

   Triggered by studio-jax-trigger.js. The trigger writes a "queued" placeholder
   to blob storage first so the report page can render a "scanning..." state
   immediately, then fires this background function fire-and-forget.

   Inputs (POST body): { job_id, target_url, scope, requested_by }
     - job_id: opaque slug used as the blob key (e.g. "jax-2026-06-08-abc12")
     - target_url: page or domain to scan (e.g. "https://emerging-tech-lab.com")
     - scope: "homepage" | "domain"  (homepage = single URL; domain = root + sitemap sample)
     - requested_by: free-text note (usually "Ms. Terry via Studio chat")

   Output: nothing returned (background). Writes:
     - blob jax_reports/<job_id>      → full report JSON
     - blob jax_reports_index/latest  → small array of recent {job_id,target,createdAt,status}

   Report shape:
     {
       id, target_url, scope,
       createdAt, completedAt, status: "complete" | "failed",
       requested_by,
       checks: {
         technical: { robots_txt, sitemap, https, ... },
         on_page:   { title, meta_description, h1s, canonical, og, twitter, alt_coverage, ... },
         signals:   { web_mentions: [...] }
       },
       findings: [ {severity, category, headline, detail, fix} ],
       jax_summary: "...in his voice, 3-5 lines..."
     }
   ───────────────────────────────────────────────────────────────────────────── */

const Anthropic = require('@anthropic-ai/sdk').default;
const { getStore, connectLambda } = require('@netlify/blobs');

const MODEL = 'claude-sonnet-5';

/* ── Jax's voice for the summary line at the bottom of the report ─────────
   Kept tight here so it does not bloat the prompt. The summary is what
   Auggie quotes in chat when he hands the report to Ms. Terry. */
const JAX_PERSONA = [
  'You are Jax Rivera. Eighteen, Hispanic, Gen Z growth-hacker brain. SEO and Discovery Strategist on the Studio bench, brought in by your older cousin Mara Rivera. You just finished an SEO audit for Ms. Terry and you are writing the one-paragraph summary that Auggie will hand to her.',
  '',
  'VOICE:',
  '- Direct. Confident but not bro-y. You know SEO better than the room and you do not pretend otherwise. You also do not show off.',
  '- Plain language. No "leverage", "synergize", or vendor-pitch words. You sound like a competent 18-year-old who actually runs scans for a living, because that is what you are.',
  '- Specific findings beat vibes. Cite exact issues ("missing meta description on the homepage", "sitemap has 47 URLs, none of the /agents/* pages are listed"). Numbers > adjectives.',
  '- No exclamation points. No em dashes. Period.',
  '',
  'STRUCTURE:',
  '- 3 to 5 sentences total. This is a summary, not the report.',
  '- Open with the headline: what is the single biggest issue, or the single biggest win.',
  '- Mention 2 or 3 specific findings, with their fix in one phrase each.',
  '- If fixes were drafted (count is given in the audit data), name how many and that they are ready to apply.',
  '- Close with what you would do next if she greenlights.',
  '',
  'OUTPUT: just the paragraph text. No headers. No bullets. Plain prose.',
].join('\n');

/* ── Helpers: fetch + parse ─────────────────────────────────────────────── */

function abortableFetch(url, opts) {
  const ctrl = new AbortController();
  const timeoutMs = (opts && opts.timeoutMs) || 8000;
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: ctrl.signal })
    .finally(() => clearTimeout(t));
}

async function fetchText(url, opts) {
  try {
    const r = await abortableFetch(url, { ...opts, redirect: 'follow' });
    if (!r.ok) return { ok: false, status: r.status, text: '' };
    const text = await r.text();
    return { ok: true, status: r.status, text: text.slice(0, 500000) };
  } catch (e) {
    return { ok: false, status: 0, text: '', error: e && e.message };
  }
}

/* Pull the most useful SEO elements from an HTML string. No external libs;
   regex-only because (a) it's enough for SEO surface analysis and (b) it
   keeps the cold-start small for a background function. */
function parseSeoElements(html) {
  const out = {
    title: null,
    title_length: 0,
    meta_description: null,
    meta_description_length: 0,
    meta_robots: null,
    canonical: null,
    h1s: [],
    h2_count: 0,
    og: {},
    twitter: {},
    image_count: 0,
    image_with_alt: 0,
    image_missing_alt: 0,
    link_internal: 0,
    link_external: 0,
    schema_jsonld_count: 0,
    lang: null,
    viewport: null,
    favicon_present: false,
  };

  if (!html || typeof html !== 'string') return out;

  // title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    out.title = titleMatch[1].trim();
    out.title_length = out.title.length;
  }
  // meta name=description
  const descMatch = html.match(/<meta\s+[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*>/i)
                  || html.match(/<meta\s+[^>]*content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']description["'][^>]*>/i);
  if (descMatch) {
    out.meta_description = descMatch[1].trim();
    out.meta_description_length = out.meta_description.length;
  }
  // meta robots
  const robotsMatch = html.match(/<meta\s+[^>]*name\s*=\s*["']robots["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*>/i);
  if (robotsMatch) out.meta_robots = robotsMatch[1].trim();
  // canonical
  const canMatch = html.match(/<link\s+[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']*)["'][^>]*>/i);
  if (canMatch) out.canonical = canMatch[1].trim();
  // html lang
  const langMatch = html.match(/<html[^>]*lang\s*=\s*["']([^"']*)["']/i);
  if (langMatch) out.lang = langMatch[1].trim();
  // viewport
  const viewportMatch = html.match(/<meta\s+[^>]*name\s*=\s*["']viewport["'][^>]*content\s*=\s*["']([^"']*)["']/i);
  if (viewportMatch) out.viewport = viewportMatch[1].trim();
  // favicon
  out.favicon_present = /<link\s+[^>]*rel\s*=\s*["'](?:shortcut\s+)?icon["']/i.test(html);

  // h1s
  const h1Matches = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi) || [];
  out.h1s = h1Matches
    .map(m => m.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 10);
  // h2 count
  const h2Matches = html.match(/<h2\b[^>]*>/gi) || [];
  out.h2_count = h2Matches.length;

  // OG and Twitter meta tags
  const ogMatches = html.match(/<meta\s+[^>]*property\s*=\s*["']og:[^"']+["'][^>]*>/gi) || [];
  ogMatches.forEach(tag => {
    const pm = tag.match(/property\s*=\s*["']og:([^"']+)["']/i);
    const cm = tag.match(/content\s*=\s*["']([^"']*)["']/i);
    if (pm && cm) out.og[pm[1]] = cm[1].trim();
  });
  const twMatches = html.match(/<meta\s+[^>]*name\s*=\s*["']twitter:[^"']+["'][^>]*>/gi) || [];
  twMatches.forEach(tag => {
    const nm = tag.match(/name\s*=\s*["']twitter:([^"']+)["']/i);
    const cm = tag.match(/content\s*=\s*["']([^"']*)["']/i);
    if (nm && cm) out.twitter[nm[1]] = cm[1].trim();
  });

  // images and alt coverage
  const imgMatches = html.match(/<img\b[^>]*>/gi) || [];
  out.image_count = imgMatches.length;
  imgMatches.forEach(tag => {
    if (/\salt\s*=\s*["'][^"']*["']/i.test(tag)) {
      out.image_with_alt++;
    } else {
      out.image_missing_alt++;
    }
  });

  // links — naive internal/external split (same hostname assumed when host
  // is also present in <a href>)
  const aMatches = html.match(/<a\s+[^>]*href\s*=\s*["']([^"']*)["'][^>]*>/gi) || [];
  aMatches.forEach(tag => {
    const m = tag.match(/href\s*=\s*["']([^"']*)["']/i);
    if (!m) return;
    const href = m[1].trim();
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) return;
    if (/^https?:\/\//i.test(href)) {
      out.link_external++;
    } else {
      out.link_internal++;
    }
  });

  // JSON-LD schema
  const ldMatches = html.match(/<script\s+[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>/gi) || [];
  out.schema_jsonld_count = ldMatches.length;

  return out;
}

function parseSitemapUrls(xml) {
  if (!xml) return { url_count: 0, sample: [] };
  const locs = xml.match(/<loc>([\s\S]*?)<\/loc>/gi) || [];
  const urls = locs.map(l => l.replace(/<\/?loc>/gi, '').trim()).filter(Boolean);
  return {
    url_count: urls.length,
    sample: urls.slice(0, 12),
  };
}

function parseRobots(text) {
  if (!text) return { fetched: false, sitemap_refs: [], rules_summary: '' };
  const sitemapRefs = (text.match(/^\s*Sitemap:\s*(\S+)/gim) || [])
    .map(l => l.replace(/^\s*Sitemap:\s*/i, '').trim());
  const userAgents = (text.match(/^\s*User-agent:/gim) || []).length;
  const disallows = (text.match(/^\s*Disallow:/gim) || []).length;
  return {
    fetched: true,
    sitemap_refs: sitemapRefs,
    rules_summary: `${userAgents} user-agent block(s), ${disallows} disallow line(s)`,
    raw_preview: text.slice(0, 600),
  };
}

/* ── Build findings list from the parsed checks ───────────────────────────
   Each finding: { severity: 'high'|'medium'|'low', category, headline,
   detail, fix }. Categories: technical, on_page, content, social,
   discoverability, accessibility. */
function buildFindings(checks, targetUrl) {
  const findings = [];
  const seo = checks.on_page || {};
  const tech = checks.technical || {};

  // High-severity
  if (!seo.title) {
    findings.push({
      severity: 'high', category: 'on_page',
      headline: 'No <title> tag found',
      detail: 'The page returned no parsable <title>. Search engines use this as the SERP headline and the browser tab label.',
      fix: 'Add a unique, descriptive <title> tag in the <head>. Aim for 50-60 characters.',
    });
  } else if (seo.title_length > 65) {
    findings.push({
      severity: 'medium', category: 'on_page',
      headline: `Title tag is long (${seo.title_length} chars)`,
      detail: `Current title: "${seo.title}". Google truncates SERP titles around 60 characters.`,
      fix: 'Tighten the title to 50-60 characters; lead with the most important phrase.',
    });
  }

  if (!seo.meta_description) {
    findings.push({
      severity: 'high', category: 'on_page',
      headline: 'No meta description',
      detail: 'No <meta name="description"> on the page. Google often generates one from the page body, but those are inconsistent and hurt CTR.',
      fix: 'Write a 140-160 character meta description that earns the click. Match the user\'s intent, not just the page topic.',
    });
  } else if (seo.meta_description_length < 80) {
    findings.push({
      severity: 'low', category: 'on_page',
      headline: `Meta description is short (${seo.meta_description_length} chars)`,
      detail: `Current: "${seo.meta_description}". Short descriptions leave search-result real estate unused.`,
      fix: 'Expand to 140-160 characters with a clear value proposition.',
    });
  } else if (seo.meta_description_length > 170) {
    findings.push({
      severity: 'low', category: 'on_page',
      headline: `Meta description is long (${seo.meta_description_length} chars)`,
      detail: 'Will be truncated mid-sentence on most SERPs.',
      fix: 'Trim to 140-160 characters; keep the most clickable phrase up front.',
    });
  }

  if (Array.isArray(seo.h1s) && seo.h1s.length === 0) {
    findings.push({
      severity: 'high', category: 'on_page',
      headline: 'No <h1> on the page',
      detail: 'Every page should have exactly one <h1> that summarizes its purpose. None found.',
      fix: 'Add a single <h1> reflecting the page\'s primary topic. The page title and H1 can differ but should align.',
    });
  } else if (Array.isArray(seo.h1s) && seo.h1s.length > 1) {
    findings.push({
      severity: 'medium', category: 'on_page',
      headline: `Multiple <h1> tags (${seo.h1s.length})`,
      detail: `H1s found: ${seo.h1s.map(h => `"${h.slice(0, 60)}"`).join('; ')}.`,
      fix: 'Demote secondary H1s to H2/H3 so the page has one canonical heading.',
    });
  }

  if (!seo.canonical) {
    findings.push({
      severity: 'medium', category: 'on_page',
      headline: 'No canonical URL declared',
      detail: 'Missing <link rel="canonical">. Without it, search engines may treat duplicate-content variants (with and without trailing slash, with utm params, etc.) as separate pages.',
      fix: `Add <link rel="canonical" href="${targetUrl}"> in <head>.`,
    });
  }

  if (!seo.og || !seo.og.title || !seo.og.description) {
    findings.push({
      severity: 'medium', category: 'social',
      headline: 'Open Graph tags incomplete',
      detail: 'Missing one or more of og:title, og:description, og:image. These control how the page renders when shared on Facebook, LinkedIn, iMessage, Slack.',
      fix: 'Add og:title, og:description, og:image, og:url, og:type at minimum.',
    });
  }
  if (!seo.twitter || !seo.twitter.card) {
    findings.push({
      severity: 'low', category: 'social',
      headline: 'No Twitter card metadata',
      detail: 'Missing <meta name="twitter:card">. Page will fall back to OG tags on X/Twitter; richer cards (summary_large_image) need explicit twitter tags.',
      fix: 'Add twitter:card="summary_large_image", twitter:title, twitter:description, twitter:image.',
    });
  }

  if (seo.image_count > 0) {
    const altPct = Math.round((seo.image_with_alt / seo.image_count) * 100);
    if (altPct < 70) {
      findings.push({
        severity: 'medium', category: 'accessibility',
        headline: `${seo.image_missing_alt} of ${seo.image_count} images missing alt text (${100 - altPct}%)`,
        detail: 'Images without alt text fail screen readers and are invisible to image search. Accessibility and SEO win together here.',
        fix: 'Add alt text to every <img>. Decorative images get alt="". Content images describe what they show.',
      });
    }
  }

  if (!seo.viewport) {
    findings.push({
      severity: 'medium', category: 'technical',
      headline: 'No viewport meta tag',
      detail: 'Missing <meta name="viewport" content="width=device-width, initial-scale=1">. Page may not render correctly on mobile.',
      fix: 'Add the standard viewport meta tag in <head>.',
    });
  }
  if (!seo.lang) {
    findings.push({
      severity: 'low', category: 'accessibility',
      headline: 'No lang attribute on <html>',
      detail: 'Missing <html lang="en">. Screen readers and translation tools use it.',
      fix: 'Add lang="en" (or appropriate locale) to the <html> element.',
    });
  }

  if (!tech.robots_txt || !tech.robots_txt.fetched) {
    findings.push({
      severity: 'medium', category: 'discoverability',
      headline: 'robots.txt not reachable',
      detail: 'Could not fetch /robots.txt. Search engines look for it; missing is benign but having a clean one with a sitemap reference is best practice.',
      fix: 'Add a robots.txt at site root with a Sitemap: directive pointing at sitemap.xml.',
    });
  } else if (!tech.robots_txt.sitemap_refs || tech.robots_txt.sitemap_refs.length === 0) {
    findings.push({
      severity: 'low', category: 'discoverability',
      headline: 'robots.txt has no Sitemap directive',
      detail: 'robots.txt was fetched but does not point to a sitemap. Helps crawler discovery.',
      fix: 'Append "Sitemap: https://your-domain/sitemap.xml" to robots.txt.',
    });
  }
  if (!tech.sitemap || tech.sitemap.url_count === 0) {
    findings.push({
      severity: 'medium', category: 'discoverability',
      headline: 'sitemap.xml missing or empty',
      detail: 'No sitemap.xml found at the root, or it contains no <loc> entries.',
      fix: 'Generate a sitemap.xml listing every public page. Resubmit in Search Console.',
    });
  }

  if (seo.schema_jsonld_count === 0) {
    findings.push({
      severity: 'low', category: 'content',
      headline: 'No structured data (JSON-LD)',
      detail: 'No <script type="application/ld+json"> blocks. Structured data unlocks rich results (FAQ, Article, Person, Organization, Course).',
      fix: 'Add at least Organization and WebSite schema in the site footer. For content pages, add Article or appropriate type.',
    });
  }

  if (seo.link_internal < 5) {
    findings.push({
      severity: 'low', category: 'content',
      headline: `Few internal links (${seo.link_internal})`,
      detail: 'Internal linking helps crawlers and users discover the rest of the site. Pages with under 5 internal links often feel orphaned.',
      fix: 'Add contextual internal links to related pages. Aim for 8-20 on a typical content page.',
    });
  }

  return findings;
}

/* ── Proposed fixes ───────────────────────────────────────────────────────
   For every actionable finding, Jax produces a `proposed_fix` payload:
   the exact change Dr. Oroszi (or a future GitHub-API integration) can
   apply. Each fix has:
     - type:     'insert_in_head' | 'modify_html_tag' | 'insert_block' | 'replace_text'
     - target:   file or section hint (e.g. 'head', '<html> element')
     - before:   what's there now (snippet, may be empty)
     - after:    the exact replacement
     - notes:    one-line context for the diff

   Trivial fixes (canonical, viewport, lang, structured data) are generated
   deterministically. Content fixes (meta description, OG content, alt
   text, title shortening) are generated with one Anthropic call so the
   prose lands in Jax's tight, plain register.
   ──────────────────────────────────────────────────────────────────────── */

function fixForCanonical(targetUrl) {
  return {
    type: 'insert_in_head',
    target: 'head',
    before: '',
    after: `<link rel="canonical" href="${targetUrl}">`,
    notes: 'Add to <head>. Prevents duplicate-content variants being treated as separate pages.',
  };
}
function fixForViewport() {
  return {
    type: 'insert_in_head',
    target: 'head',
    before: '',
    after: `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    notes: 'Add to <head>. Required for correct mobile rendering.',
  };
}
function fixForLang(existingHtml) {
  // Default to en if no signal; future: detect from content
  return {
    type: 'modify_html_tag',
    target: '<html> element',
    before: '<html>',
    after: '<html lang="en">',
    notes: 'Add lang="en" (or your locale) to the <html> tag. Used by screen readers and translation tools.',
  };
}
function fixForJsonLdOrganization(targetUrl, siteName) {
  const origin = new URL(targetUrl).origin;
  const name = siteName || origin.replace(/^https?:\/\//, '');
  const block = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: name,
    url: origin,
  };
  return {
    type: 'insert_block',
    target: 'head (or just before </body>)',
    before: '',
    after: `<script type="application/ld+json">\n${JSON.stringify(block, null, 2)}\n</script>`,
    notes: 'Adds Organization structured data so search engines can attach name + URL to your knowledge panel.',
  };
}
function fixForJsonLdWebSite(targetUrl, siteName) {
  const origin = new URL(targetUrl).origin;
  const name = siteName || origin.replace(/^https?:\/\//, '');
  const block = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: name,
    url: origin,
  };
  return {
    type: 'insert_block',
    target: 'head (or just before </body>)',
    before: '',
    after: `<script type="application/ld+json">\n${JSON.stringify(block, null, 2)}\n</script>`,
    notes: 'Adds WebSite structured data so the site is canonically named in search.',
  };
}
function fixForOgBasics(seo, targetUrl) {
  const title = seo.title || '[Add your page title here]';
  const desc = seo.meta_description || '[Add a 140-160 char description here]';
  const block =
    `<meta property="og:type" content="website">\n` +
    `<meta property="og:url" content="${targetUrl}">\n` +
    `<meta property="og:title" content="${title}">\n` +
    `<meta property="og:description" content="${desc}">\n` +
    `<meta property="og:image" content="${new URL(targetUrl).origin}/og-image.png">`;
  return {
    type: 'insert_in_head',
    target: 'head',
    before: '',
    after: block,
    notes: 'Open Graph tags control how the page renders when shared on Facebook, LinkedIn, iMessage, Slack. og:image must exist at the URL.',
  };
}
function fixForTwitterCard(seo, targetUrl) {
  const title = seo.title || '[Add your page title here]';
  const desc = seo.meta_description || '[Add a description here]';
  const block =
    `<meta name="twitter:card" content="summary_large_image">\n` +
    `<meta name="twitter:title" content="${title}">\n` +
    `<meta name="twitter:description" content="${desc}">\n` +
    `<meta name="twitter:image" content="${new URL(targetUrl).origin}/og-image.png">`;
  return {
    type: 'insert_in_head',
    target: 'head',
    before: '',
    after: block,
    notes: 'Twitter card tags. summary_large_image is the richer format.',
  };
}

/* LLM-generated content fixes. One Anthropic call covers multiple fixes
   at once (meta description, shortened title if needed) to keep cost low. */
async function generateContentFixes(client, targetUrl, seo, findings) {
  const needsMetaDesc = findings.some(f => /meta description/i.test(f.headline) && /\bNo |missing|short/i.test(f.headline));
  const titleTooLong  = findings.some(f => /Title tag is long/i.test(f.headline));
  if (!needsMetaDesc && !titleTooLong) return {};

  const sys = [
    'You are Jax Rivera, SEO and Discovery Strategist. You are writing SEO copy for a page Dr. Oroszi owns.',
    'Output JSON only. No prose, no code fences, no commentary.',
    'Constraints:',
    '- Meta descriptions: 140-160 characters, sentence case, no quotes, no exclamation points, no em dashes, write to the click but never overpromise.',
    '- Shortened titles: 50-60 characters, lead with the most important phrase.',
    '- Do not use marketing puffery ("revolutionary", "ultimate", "best in class").',
  ].join('\n');

  const ctx = [
    `Target URL: ${targetUrl}`,
    `Current title: ${seo.title || '(none)'}`,
    `Current meta description: ${seo.meta_description || '(none)'}`,
    `H1s: ${(seo.h1s || []).join(' | ') || '(none)'}`,
    `OG title: ${seo.og && seo.og.title || '(none)'}`,
    `OG description: ${seo.og && seo.og.description || '(none)'}`,
  ].join('\n');

  const tasks = [];
  if (needsMetaDesc) tasks.push('"meta_description": <a 140-160 char description suited to this page>');
  if (titleTooLong)  tasks.push('"shortened_title": <50-60 char tightened version of the current title>');

  const userPrompt = [
    'AUDIT CONTEXT:',
    ctx,
    '',
    'Return JSON with these fields:',
    '{ ' + tasks.join(', ') + ' }',
  ].join('\n');

  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: sys,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const raw = (resp.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n').trim();
    let cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/, '').trim();
    if (cleaned[0] !== '{') {
      const s = cleaned.indexOf('{');
      const e = cleaned.lastIndexOf('}');
      if (s >= 0 && e > s) cleaned = cleaned.slice(s, e + 1);
    }
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('[jax-scan-bg] content fixes failed', e && e.message);
    return {};
  }
}

/* Attach proposed_fix payloads to findings where Jax can generate them.
   Deterministic fixes go on first; LLM-generated content fixes layer on
   top. The findings array is mutated in place — same shape, plus
   `.proposed_fix` on the ones that have one. */
function attachDeterministicFixes(findings, checks, targetUrl) {
  const seo = checks.on_page || {};

  for (const f of findings) {
    const h = f.headline || '';
    if (/No canonical/i.test(h))                 f.proposed_fix = fixForCanonical(targetUrl);
    else if (/No viewport/i.test(h))             f.proposed_fix = fixForViewport();
    else if (/No lang attribute/i.test(h))       f.proposed_fix = fixForLang();
    else if (/Open Graph tags incomplete/i.test(h)) f.proposed_fix = fixForOgBasics(seo, targetUrl);
    else if (/No Twitter card metadata/i.test(h))   f.proposed_fix = fixForTwitterCard(seo, targetUrl);
    else if (/No structured data/i.test(h)) {
      // Two structured-data fixes: split into Organization + WebSite as
      // sibling fixes attached to the same finding.
      f.proposed_fix = fixForJsonLdOrganization(targetUrl, seo.title);
      f.proposed_fix_extra = fixForJsonLdWebSite(targetUrl, seo.title);
    }
  }
}

function attachContentFixes(findings, contentFixes, targetUrl) {
  for (const f of findings) {
    const h = f.headline || '';
    if (/No meta description|Meta description is short/i.test(h) && contentFixes.meta_description) {
      f.proposed_fix = {
        type: 'insert_in_head',
        target: 'head',
        before: '',
        after: `<meta name="description" content="${contentFixes.meta_description.replace(/"/g, '&quot;')}">`,
        notes: `Jax-drafted meta description (${contentFixes.meta_description.length} chars). Review the wording before applying.`,
      };
    }
    if (/Title tag is long/i.test(h) && contentFixes.shortened_title) {
      f.proposed_fix = {
        type: 'replace_text',
        target: '<title> element',
        before: '(your current title — too long)',
        after: `<title>${contentFixes.shortened_title}</title>`,
        notes: `Jax-shortened title (${contentFixes.shortened_title.length} chars).`,
      };
    }
  }
}

/* ── Jax's voice summary, generated via Anthropic ─────────────────────── */
async function generateJaxSummary(client, targetUrl, checks, findings) {
  const highFindings = findings.filter(f => f.severity === 'high');
  const mediumFindings = findings.filter(f => f.severity === 'medium');
  const lowFindings = findings.filter(f => f.severity === 'low');

  const findingsBrief = [
    highFindings.length ? `HIGH (${highFindings.length}): ${highFindings.map(f => f.headline).join('; ')}` : '',
    mediumFindings.length ? `MEDIUM (${mediumFindings.length}): ${mediumFindings.slice(0, 5).map(f => f.headline).join('; ')}` : '',
    lowFindings.length ? `LOW (${lowFindings.length}): ${lowFindings.slice(0, 3).map(f => f.headline).join('; ')}` : '',
    !findings.length ? 'No findings — the page is clean.' : '',
  ].filter(Boolean).join('\n');

  const checksBrief = [
    `Target: ${targetUrl}`,
    `Title: ${checks.on_page.title || '(missing)'}`,
    `Meta description: ${checks.on_page.meta_description ? checks.on_page.meta_description.slice(0, 100) + '...' : '(missing)'}`,
    `H1 count: ${(checks.on_page.h1s || []).length}`,
    `Images: ${checks.on_page.image_count} total, ${checks.on_page.image_missing_alt} missing alt`,
    `Internal links: ${checks.on_page.link_internal}, External: ${checks.on_page.link_external}`,
    `Sitemap URLs: ${checks.technical.sitemap ? checks.technical.sitemap.url_count : 0}`,
  ].join('\n');

  const userPrompt = [
    'Write your one-paragraph summary of this SEO audit. Ms. Terry will read it (via Auggie). 3-5 sentences.',
    '',
    'AUDIT DATA:',
    checksBrief,
    '',
    'FINDINGS:',
    findingsBrief,
  ].join('\n');

  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 350,
      system: JAX_PERSONA,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const text = (resp.content || [])
      .filter(b => b && b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();
    return text || '(Jax left no summary — review the findings below.)';
  } catch (e) {
    console.error('[jax-scan-bg] jax summary failed', e && e.message);
    return '(Summary unavailable — model error. The structured findings below are still valid.)';
  }
}

/* ── Index helper: keep a small array of recent runs so the report page
   can show a "your last 10 scans" list later. ────────────────────────── */
async function updateIndex(jobId, target, status) {
  try {
    const indexStore = getStore('jax_reports_index');
    let arr = await indexStore.get('latest', { type: 'json' });
    if (!Array.isArray(arr)) arr = [];
    const existing = arr.find(r => r.job_id === jobId);
    if (existing) {
      existing.status = status;
      existing.updatedAt = new Date().toISOString();
    } else {
      arr.unshift({
        job_id: jobId,
        target_url: target,
        status: status,
        createdAt: new Date().toISOString(),
      });
    }
    arr = arr.slice(0, 50);
    await indexStore.setJSON('latest', arr);
  } catch (e) {
    console.warn('[jax-scan-bg] index update skipped', e && e.message);
  }
}

/* ── Handler ──────────────────────────────────────────────────────────── */
exports.handler = async (event) => {
  // Background functions are invoked by Netlify with the original request
  // body. They do not return data to the caller — they write to blob and
  // exit. No CORS needed, no auth header (trigger function handled auth).
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { console.error('[jax-scan-bg] invalid json'); return { statusCode: 400 }; }

  const jobId = body.job_id;
  const targetUrl = body.target_url;
  const scope = body.scope || 'homepage';
  const requestedBy = body.requested_by || 'Studio chat';
  if (!jobId || !targetUrl) {
    console.error('[jax-scan-bg] missing job_id or target_url');
    return { statusCode: 400 };
  }

  console.log('[jax-scan-bg] start', { jobId, targetUrl, scope });
  try { connectLambda(event); } catch (_) {}

  await updateIndex(jobId, targetUrl, 'running');

  const apiKey = process.env.FOUNDER_STUDIO_API_KEY;
  if (!apiKey) {
    console.error('[jax-scan-bg] ANTHROPIC_API_KEY not set');
    return { statusCode: 500 };
  }
  const client = new Anthropic({ apiKey });

  // Parse origin from target_url for robots.txt + sitemap.xml lookups.
  let origin = '';
  try {
    const u = new URL(targetUrl);
    origin = u.origin;
  } catch (_) {
    console.error('[jax-scan-bg] bad target_url', targetUrl);
    const errReport = {
      id: jobId,
      target_url: targetUrl,
      scope,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      status: 'failed',
      error: 'invalid target_url',
    };
    try {
      await getStore('jax_reports').setJSON(jobId, errReport);
    } catch (e) {}
    await updateIndex(jobId, targetUrl, 'failed');
    return { statusCode: 200 };
  }

  // 1. Fetch the target HTML
  const pageRes = await fetchText(targetUrl, { timeoutMs: 10000 });
  if (!pageRes.ok) {
    console.error('[jax-scan-bg] page fetch failed', pageRes);
    const errReport = {
      id: jobId, target_url: targetUrl, scope,
      createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      status: 'failed',
      error: `could not fetch ${targetUrl} (HTTP ${pageRes.status})`,
      requested_by: requestedBy,
    };
    try { await getStore('jax_reports').setJSON(jobId, errReport); } catch (_) {}
    await updateIndex(jobId, targetUrl, 'failed');
    return { statusCode: 200 };
  }
  const onPage = parseSeoElements(pageRes.text);

  // 2. robots.txt + sitemap.xml at origin
  const [robotsRes, sitemapRes] = await Promise.all([
    fetchText(origin + '/robots.txt', { timeoutMs: 6000 }),
    fetchText(origin + '/sitemap.xml', { timeoutMs: 6000 }),
  ]);
  const robots = parseRobots(robotsRes.ok ? robotsRes.text : '');
  let sitemap = sitemapRes.ok ? parseSitemapUrls(sitemapRes.text) : { url_count: 0, sample: [] };
  // If robots.txt referenced a sitemap, try that too if the root one was empty
  if (sitemap.url_count === 0 && robots.sitemap_refs && robots.sitemap_refs.length) {
    const altRes = await fetchText(robots.sitemap_refs[0], { timeoutMs: 6000 });
    if (altRes.ok) sitemap = parseSitemapUrls(altRes.text);
  }

  const checks = {
    technical: {
      https: targetUrl.startsWith('https://'),
      origin,
      robots_txt: robots,
      sitemap: sitemap,
    },
    on_page: onPage,
  };

  // 3. Findings derived from the checks
  const findings = buildFindings(checks, targetUrl);

  // 4. Proposed fixes — Jax actually DOES the work, not just reports.
  //    Deterministic fixes first (canonical, viewport, lang, structured
  //    data, OG, Twitter), then LLM-drafted content fixes (meta description
  //    and shortened title where applicable).
  attachDeterministicFixes(findings, checks, targetUrl);
  const contentFixes = await generateContentFixes(client, targetUrl, checks.on_page, findings);
  attachContentFixes(findings, contentFixes, targetUrl);

  // 5. Jax's voice summary
  const jaxSummary = await generateJaxSummary(client, targetUrl, checks, findings);

  // 6. Save full report
  const fixCount = findings.filter(f => f.proposed_fix).length;
  const report = {
    id: jobId,
    target_url: targetUrl,
    scope,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    status: 'complete',
    requested_by: requestedBy,
    checks,
    findings,
    jax_summary: jaxSummary,
    fix_count: fixCount,
  };

  try {
    await getStore('jax_reports').setJSON(jobId, report);
    await updateIndex(jobId, targetUrl, 'complete');
    console.log('[jax-scan-bg] complete', { jobId, findings: findings.length, fixes: fixCount });
  } catch (e) {
    console.error('[jax-scan-bg] save failed', e && e.message);
  }

  return { statusCode: 200 };
};
