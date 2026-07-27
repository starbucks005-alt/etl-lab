/* ─────────────────────────────────────────────────────────────────────────────
   studio-jax-apply-background

   Jax's APPLY half — closes the loop from "audit drafted" to "fix on live
   site." Reads a saved scan report from blob storage, identifies the
   safe-auto-apply fixes (deterministic markup, no human judgment needed),
   looks up the target's GitHub repo, edits the relevant file's <head>
   block, and commits the change directly to main with a [jax-auto] prefix.
   Netlify then auto-deploys.

   Per Dr. Oroszi's branching rule: all work happens on main. No PRs, no
   branches. Direct commits only.

   Inputs (POST body): { job_id }
     - job_id: the scan report to apply from

   Output: nothing returned (background). Writes back to the report blob
   with apply_status / apply_commit_sha / apply_commit_url / applied[] /
   skipped[] so Auggie's status reply can surface what landed.

   Auth: trigger gates with Supabase JWT; background invoked internally.
   Requires GITHUB_APPLY_TOKEN env var — fine-grained PAT scoped to the
   target repos with contents:write permission.
   ───────────────────────────────────────────────────────────────────────────── */

const { getStore, connectLambda } = require('@netlify/blobs');

const GH_API = 'https://api.github.com';
const APPLY_BRANCH = 'main';

/* ── Repo map ────────────────────────────────────────────────────────────
   Target URL → { owner, repo, path } for the file containing the <head>
   block to edit. Add new entries as more sites come online; for sites
   without a mapping the apply step fails gracefully with a note Terry
   can fix.

   Subpath products under emerging-tech-lab.com share the etl-lab repo
   but each has its own file. The path mapping reflects how those pages
   are served (e.g. /office-hours → office-hours.html).
   ──────────────────────────────────────────────────────────────────────── */
const SUBPATH_FILE = {
  '': 'index.html',
  '/': 'index.html',
  '/office-hours': 'office-hours.html',
  '/prep-room': 'prep-room.html',
  '/boardroom': 'boardroom.html',
  '/job-fair': 'job-fair.html',
  '/press': 'press.html',
  '/studio': 'studio.html',
  '/studios': 'studios.html',
  '/founder-studio.html': 'founder-studio.html',
  '/from-the-gauntlet.html': 'from-the-gauntlet.html',
  '/almost-human': 'almost-human.html',
  '/gym': 'gym.html',
  '/restaurant': 'restaurant.html',
  '/classrooms': 'classrooms.html',
  '/deskworks': 'deskworks.html',
  '/tailor-shop': 'tailor-shop.html',
  '/build-your-own-agent': 'build-your-own-agent.html',
  '/export-your-agent': 'export-your-agent.html',
  '/hiring-pool': 'hiring-pool.html',
  '/court': 'court.html',
  '/city-government': 'city-government.html',
};

function resolveTargetRepo(targetUrl) {
  try {
    const u = new URL(targetUrl);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/$/, '');

    if (host === 'emerging-tech-lab.com') {
      // No silent fallback to index.html for an unmapped path — that was
      // the bug: any page not explicitly listed here (e.g. /almost-human,
      // before this fix) resolved to the campus HOMEPAGE, so Jax would
      // have committed the wrong page's title/meta/OG tags onto index.html
      // the moment GITHUB_APPLY_TOKEN actually had write access. Only ''
      // and '/' mean the homepage; anything else must be an explicit entry
      // or apply fails with no_repo_mapping instead of hitting the wrong file.
      const file = SUBPATH_FILE[path];
      if (!file) return null;
      return { owner: 'starbucks005-alt', repo: 'etl-lab', path: file };
    }
    if (host === 'thegauntlet.studio') {
      return { owner: 'starbucks005-alt', repo: 'The-Gauntlet', path: 'index.html' };
    }
    if (host === 'greylanderpress.com') {
      return { owner: 'starbucks005-alt', repo: 'greylander-press', path: 'index.html' };
    }
    if (host === 'opsec-gauntlet.com' || host === 'opsec-gauntlet.netlify.app') {
      return { owner: 'starbucks005-alt', repo: 'opsec-gauntlet', path: 'index.html' };
    }
    // Locked 2026-06-08 (Terry provided the full repo list).
    if (host === 'thedose.net') {
      return { owner: 'starbucks005-alt', repo: 'the-dose', path: 'index.html' };
    }
    // The real live domain is gandhi-king-center-for-nonviolence.org (see
    // index.html's platforms array / the Social Posts site picker). The old
    // netlify.app hostname was never the actual site, so any real scan of
    // the live domain silently found no repo mapping at all.
    if (host === 'gandhi-king-center-for-nonviolence.org' || host === 'gandhi-king.netlify.app') {
      return { owner: 'starbucks005-alt', repo: 'gandhi-king-center', path: 'index.html' };
    }
    if (host === 'slrstudio.online') {
      return { owner: 'starbucks005-alt', repo: 'SLR_Studio', path: 'index.html' };
    }
    return null;
  } catch (_) { return null; }
}

/* Safe-auto-apply fix types — deterministic markup, no judgment needed.
   Anything outside this set falls back to "draft only, owner reviews." */
const AUTO_APPLY_TYPES = new Set(['insert_in_head', 'insert_block']);

/* Idempotency check — has this fix's content already landed in the file?
   Prevents re-applying on every run. Uses signature markers per fix kind
   rather than exact-string equality so small whitespace differences do
   not trigger a duplicate insert. */
function alreadyApplied(html, fix) {
  if (!fix || !fix.after) return false;
  const snippet = String(fix.after).trim();
  if (!snippet) return false;
  // Meta description — Jax drafts fresh wording on every scan, so an exact-
  // text match never catches an existing tag with different copy, and the
  // generic fallback below would insert a second (then third...) description
  // tag every time this fix reappears. Presence of ANY description tag
  // counts as already applied, same as canonical/viewport below (2026-07-11:
  // this exact gap put 3 competing description tags on almost-human.html).
  if (/name=["']description["']/i.test(snippet)) {
    return /<meta\s+[^>]*name=["']description["']/i.test(html);
  }
  // Canonical
  if (/rel=["']canonical["']/i.test(snippet)) {
    return /<link\s+[^>]*rel=["']canonical["']/i.test(html);
  }
  // Open Graph block (any og:* present means OG is wired)
  if (/property=["']og:type["']/i.test(snippet)) {
    return /property=["']og:type["']/i.test(html);
  }
  // Twitter card
  if (/name=["']twitter:card["']/i.test(snippet)) {
    return /name=["']twitter:card["']/i.test(html);
  }
  // JSON-LD Organization
  if (/@type["']\s*:\s*["']Organization["']/i.test(snippet)) {
    return /@type["']\s*:\s*["']Organization["']/i.test(html);
  }
  // JSON-LD WebSite
  if (/@type["']\s*:\s*["']WebSite["']/i.test(snippet)) {
    return /@type["']\s*:\s*["']WebSite["']/i.test(html);
  }
  // Viewport
  if (/name=["']viewport["']/i.test(snippet)) {
    return /name=["']viewport["']/i.test(html);
  }
  // Lang on <html>
  if (/lang=["']en["']/i.test(snippet) && /<html\b/i.test(snippet)) {
    return /<html\s+[^>]*lang=/i.test(html);
  }
  // Generic fallback: exact-text contains
  return html.includes(snippet);
}

/* Insert a snippet into the file's <head>. We insert just before </head>
   so existing fonts/scripts ordering stays intact. */
function insertBeforeHeadClose(html, snippet) {
  if (!/<\/head>/i.test(html)) return null; // no <head>, refuse
  return html.replace(/<\/head>/i, '\n' + snippet + '\n</head>');
}

/* ── GitHub Contents API helpers (raw fetch, no Octokit dependency) ─── */

async function ghGetFile(owner, repo, path, token) {
  const url = GH_API + '/repos/' + owner + '/' + repo + '/contents/' + encodeURIComponent(path).replace(/%2F/gi, '/');
  const r = await fetch(url, {
    headers: {
      'Authorization': 'token ' + token,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'jax-apply-background',
    },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error('GitHub GET ' + owner + '/' + repo + '/' + path + ' ' + r.status + ' ' + text.slice(0, 200));
  }
  const j = await r.json();
  if (!j || !j.content) throw new Error('GitHub GET returned no content');
  return { sha: j.sha, content: Buffer.from(j.content, 'base64').toString('utf8') };
}

async function ghPutFile(owner, repo, path, content, sha, message, token) {
  const url = GH_API + '/repos/' + owner + '/' + repo + '/contents/' + encodeURIComponent(path).replace(/%2F/gi, '/');
  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': 'token ' + token,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'jax-apply-background',
    },
    body: JSON.stringify({
      message: message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      sha: sha,
      branch: APPLY_BRANCH,
    }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error('GitHub PUT ' + owner + '/' + repo + '/' + path + ' ' + r.status + ' ' + text.slice(0, 200));
  }
  const j = await r.json();
  return {
    sha: j && j.commit && j.commit.sha,
    url: j && j.commit && j.commit.html_url,
    file_sha: j && j.content && j.content.sha,
  };
}

/* ── Handler ──────────────────────────────────────────────────────────── */

exports.handler = async (event) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { console.error('[jax-apply-bg] invalid json'); return { statusCode: 400 }; }

  const jobId = body.job_id;
  if (!jobId) {
    console.error('[jax-apply-bg] missing job_id');
    return { statusCode: 400 };
  }

  try { connectLambda(event); } catch (_) {}

  const ghToken = process.env.GITHUB_APPLY_TOKEN;
  if (!ghToken) {
    console.error('[jax-apply-bg] GITHUB_APPLY_TOKEN not set');
    return { statusCode: 500 };
  }

  const reportStore = getStore('jax_reports');
  let report;
  try {
    report = await reportStore.get(jobId, { type: 'json' });
  } catch (e) {
    console.error('[jax-apply-bg] report read failed', e && e.message);
    return { statusCode: 500 };
  }
  if (!report) {
    console.error('[jax-apply-bg] report not found', jobId);
    return { statusCode: 404 };
  }

  // Stamp apply_status early so any reader sees we are working
  report.apply_status = 'applying';
  report.apply_started_at = new Date().toISOString();
  try { await reportStore.setJSON(jobId, report); } catch (_) {}

  const repo = resolveTargetRepo(report.target_url);
  if (!repo) {
    report.apply_status = 'no_repo_mapping';
    report.apply_error = 'no repo configured for ' + report.target_url + '. tell Auggie which repo this site lives in and i will add it to the map.';
    report.apply_completed_at = new Date().toISOString();
    try { await reportStore.setJSON(jobId, report); } catch (_) {}
    console.warn('[jax-apply-bg] no repo mapping for', report.target_url);
    return { statusCode: 200 };
  }

  // Collect every safe-auto-apply fix from the report
  const fixes = [];
  for (const finding of (report.findings || [])) {
    if (finding.proposed_fix && AUTO_APPLY_TYPES.has(finding.proposed_fix.type)) {
      fixes.push({ finding: finding, fix: finding.proposed_fix });
    }
    if (finding.proposed_fix_extra && AUTO_APPLY_TYPES.has(finding.proposed_fix_extra.type)) {
      fixes.push({ finding: finding, fix: finding.proposed_fix_extra });
    }
  }

  if (fixes.length === 0) {
    report.apply_status = 'nothing_to_apply';
    report.apply_note = 'no safe-auto-apply fixes in this report (insert_in_head / insert_block only).';
    report.apply_completed_at = new Date().toISOString();
    try { await reportStore.setJSON(jobId, report); } catch (_) {}
    return { statusCode: 200 };
  }

  try {
    const file = await ghGetFile(repo.owner, repo.repo, repo.path, ghToken);
    let html = file.content;
    const applied = [];
    const skipped = [];

    for (const entry of fixes) {
      if (alreadyApplied(html, entry.fix)) {
        skipped.push({ headline: entry.finding.headline, reason: 'already present' });
        continue;
      }
      const next = insertBeforeHeadClose(html, entry.fix.after);
      if (!next) {
        skipped.push({ headline: entry.finding.headline, reason: 'no </head> in file' });
        continue;
      }
      html = next;
      applied.push({ headline: entry.finding.headline, category: entry.finding.category, severity: entry.finding.severity });
    }

    if (applied.length === 0) {
      report.apply_status = 'nothing_new';
      report.apply_skipped = skipped;
      report.apply_completed_at = new Date().toISOString();
      report.apply_repo = repo;
      try { await reportStore.setJSON(jobId, report); } catch (_) {}
      console.log('[jax-apply-bg] nothing new to apply for', jobId);
      return { statusCode: 200 };
    }

    const commitMsg =
      '[jax-auto] ' + applied.length + ' SEO fix' + (applied.length === 1 ? '' : 'es') + ' on ' + repo.path + '\n\n' +
      applied.map((a, i) => (i + 1) + '. ' + a.headline).join('\n') + '\n\n' +
      'Generated by Jax\'s SEO Backpack from report ' + jobId + '. ' +
      'Safe-auto-apply categories only (canonical, JSON-LD blocks, OG/Twitter completions).';

    const commit = await ghPutFile(repo.owner, repo.repo, repo.path, html, file.sha, commitMsg, ghToken);

    report.apply_status = 'applied';
    report.apply_completed_at = new Date().toISOString();
    report.apply_commit_sha = commit.sha;
    report.apply_commit_url = commit.url;
    report.apply_applied = applied;
    report.apply_skipped = skipped;
    report.apply_repo = repo;
    await reportStore.setJSON(jobId, report);

    console.log('[jax-apply-bg] applied', applied.length, 'to', repo.owner + '/' + repo.repo, 'sha', commit.sha);
    return { statusCode: 200 };
  } catch (e) {
    console.error('[jax-apply-bg] commit failed', e && e.message);
    report.apply_status = 'failed';
    report.apply_error = (e && e.message) || 'unknown';
    report.apply_completed_at = new Date().toISOString();
    report.apply_repo = repo;
    try { await reportStore.setJSON(jobId, report); } catch (_) {}
    return { statusCode: 200 };
  }
};
