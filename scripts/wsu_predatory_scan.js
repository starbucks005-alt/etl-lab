'use strict';

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { URL, URLSearchParams } = require('url');

// ── Config ────────────────────────────────────────────────────────────────────
const OPENALEX_BASE      = 'https://api.openalex.org';
const EMAIL              = 'research@emerging-tech-lab.com';
const CACHE_DIR          = path.join(__dirname, '.wsu_scan_cache');
const SPJ_JOURNALS_URL   = 'https://raw.githubusercontent.com/stop-predatory-journals/stop-predatory-journals.github.io/master/_data/journals.csv';
const SPJ_PUBLISHERS_URL = 'https://raw.githubusercontent.com/stop-predatory-journals/stop-predatory-journals.github.io/master/_data/publishers.csv';
const FROM_DATE          = '2021-07-01';
const TO_DATE            = '2026-06-30';

// ── HTTP helper ───────────────────────────────────────────────────────────────
function httpGet(urlStr) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const lib    = parsed.protocol === 'https:' ? https : http;
    const opts   = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      headers:  { 'User-Agent': `WSU-PredatoryScan/1.0 (mailto:${EMAIL})` },
    };
    lib.get(opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpGet(res.headers.location));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} from ${urlStr}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Cache helpers ─────────────────────────────────────────────────────────────
function cachePath(name) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  return path.join(CACHE_DIR, name);
}
function readCache(name) {
  const p = cachePath(name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}
function writeCache(name, content) {
  fs.writeFileSync(cachePath(name), content, 'utf8');
}

// ── CSV parser ────────────────────────────────────────────────────────────────
function splitLine(line) {
  const result = [];
  let current  = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  if (!lines.length) return [];
  const headers = splitLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = splitLine(lines[i]);
    const obj  = {};
    headers.forEach((h, j) => { obj[h] = (vals[j] || '').trim(); });
    rows.push(obj);
  }
  return rows;
}

// ── OpenAlex ──────────────────────────────────────────────────────────────────
async function getWsuId() {
  const body = await httpGet(
    `${OPENALEX_BASE}/institutions?search=Wright+State+University&per-page=5&mailto=${EMAIL}`
  );
  const data = JSON.parse(body);
  for (const inst of (data.results || [])) {
    if ((inst.display_name || '').toLowerCase().includes('wright state')) {
      return inst.id.split('/').pop();
    }
  }
  throw new Error('Wright State University not found in OpenAlex.');
}

async function fetchAllWorks(institutionId, fromDate, toDate) {
  const works  = [];
  let cursor   = '*';
  let page     = 0;
  const filter = `institutions.id:${institutionId},from_publication_date:${fromDate},to_publication_date:${toDate}`;
  const select = 'id,title,publication_year,primary_location,authorships,type';

  while (true) {
    page++;
    const params = new URLSearchParams({ filter, 'per-page': '200', cursor, select, mailto: EMAIL });
    process.stdout.write(`\r  Page ${page} — ${works.length.toLocaleString()} works so far…`);
    const body  = await httpGet(`${OPENALEX_BASE}/works?${params}`);
    const data  = JSON.parse(body);
    const batch = data.results || [];
    if (!batch.length) break;
    works.push(...batch);
    cursor = (data.meta || {}).next_cursor;
    if (!cursor) break;
    await sleep(120);
  }
  process.stdout.write(`\r  Fetched ${works.length.toLocaleString()} works total.                    \n`);
  return works;
}

// ── Predatory lists ───────────────────────────────────────────────────────────
async function loadPredatoryLists(noCache) {
  async function fetchList(fetchUrl, cacheName) {
    if (!noCache) {
      const cached = readCache(cacheName);
      if (cached) return cached;
    }
    console.log(`  Downloading ${cacheName}…`);
    try {
      const text = await httpGet(fetchUrl);
      writeCache(cacheName, text);
      return text;
    } catch (e) {
      console.log(`  WARNING: could not download ${cacheName}: ${e.message}`);
      return '';
    }
  }

  const journalsCSV   = await fetchList(SPJ_JOURNALS_URL,   'spj_journals.csv');
  const publishersCSV = await fetchList(SPJ_PUBLISHERS_URL, 'spj_publishers.csv');

  const badIssns      = new Map();
  const badJNames     = new Set();
  const badPublishers = new Set();

  if (journalsCSV) {
    for (const row of parseCSV(journalsCSV)) {
      const name = (row['Journal'] || row['journal'] || row['Name'] || row['name'] || '').trim();
      const issn = (row['ISSN'] || row['issn'] || row['Print ISSN'] || row['Online ISSN'] || '').trim().replace(/-/g, '');
      if (issn) badIssns.set(issn, name);
      if (name) badJNames.add(name.toLowerCase());
    }
  }
  if (publishersCSV) {
    for (const row of parseCSV(publishersCSV)) {
      const pub = (row['Publisher'] || row['publisher'] || row['Name'] || row['name'] || '').trim().toLowerCase();
      if (pub) badPublishers.add(pub);
    }
  }
  return { badIssns, badJNames, badPublishers };
}

// ── Department / College extraction ───────────────────────────────────────────
const DEPT_TO_COLLEGE = {
  'anatomy':               'Boonshoft School of Medicine',
  'biochemistry':          'Boonshoft School of Medicine',
  'community health':      'Boonshoft School of Medicine',
  'emergency medicine':    'Boonshoft School of Medicine',
  'geriatric':             'Boonshoft School of Medicine',
  'internal medicine':     'Boonshoft School of Medicine',
  'neuroscience':          'Boonshoft School of Medicine',
  'obstetrics':            'Boonshoft School of Medicine',
  'oncology':              'Boonshoft School of Medicine',
  'orthopedic':            'Boonshoft School of Medicine',
  'pathology':             'Boonshoft School of Medicine',
  'pediatric':             'Boonshoft School of Medicine',
  'pharmacology':          'Boonshoft School of Medicine',
  'physiology':            'Boonshoft School of Medicine',
  'psychiatry':            'Boonshoft School of Medicine',
  'radiology':             'Boonshoft School of Medicine',
  'surgery':               'Boonshoft School of Medicine',
  'urology':               'Boonshoft School of Medicine',
  'boonshoft':             'Boonshoft School of Medicine',
  'school of medicine':    'Boonshoft School of Medicine',
  'biological sciences':   'College of Science and Mathematics',
  'chemistry':             'College of Science and Mathematics',
  'earth and environmental':'College of Science and Mathematics',
  'geological':            'College of Science and Mathematics',
  'math':                  'College of Science and Mathematics',
  'physics':               'College of Science and Mathematics',
  'statistics':            'College of Science and Mathematics',
  'biomedical engineering':'College of Engineering and Computer Science',
  'chemical engineering':  'College of Engineering and Computer Science',
  'computer science':      'College of Engineering and Computer Science',
  'computer engineering':  'College of Engineering and Computer Science',
  'electrical engineering':'College of Engineering and Computer Science',
  'mechanical':            'College of Engineering and Computer Science',
  'industrial':            'College of Engineering and Computer Science',
  'systems engineering':   'College of Engineering and Computer Science',
  'human factors':         'College of Engineering and Computer Science',
  'art history':           'College of Liberal Arts',
  'classics':              'College of Liberal Arts',
  'communication':         'College of Liberal Arts',
  'english':               'College of Liberal Arts',
  'film':                  'College of Liberal Arts',
  'history':               'College of Liberal Arts',
  'international studies': 'College of Liberal Arts',
  'liberal arts':          'College of Liberal Arts',
  'modern languages':      'College of Liberal Arts',
  'music':                 'College of Liberal Arts',
  'philosophy':            'College of Liberal Arts',
  'political science':     'College of Liberal Arts',
  'psychology':            'College of Liberal Arts',
  'religion':              'College of Liberal Arts',
  'social work':           'College of Liberal Arts',
  'sociology':             'College of Liberal Arts',
  'theatre':               'College of Liberal Arts',
  'accountancy':           'Raj Soin College of Business',
  'accounting':            'Raj Soin College of Business',
  'economics':             'Raj Soin College of Business',
  'finance':               'Raj Soin College of Business',
  'information systems':   'Raj Soin College of Business',
  'management':            'Raj Soin College of Business',
  'marketing':             'Raj Soin College of Business',
  'supply chain':          'Raj Soin College of Business',
  'raj soin':              'Raj Soin College of Business',
  'nursing':               'College of Nursing and Health',
  'population health':     'College of Nursing and Health',
  'public health':         'College of Nursing and Health',
  'rehabilitation':        'College of Nursing and Health',
  'counseling':            'College of Education and Human Services',
  'curriculum':            'College of Education and Human Services',
  'educational':           'College of Education and Human Services',
  'human services':        'College of Education and Human Services',
  'kinesiology':           'College of Education and Human Services',
  'leadership studies':    'College of Education and Human Services',
  'teacher':               'College of Education and Human Services',
  'lake campus':           'Wright State University Lake Campus',
};

const DEPT_PATTERNS = [
  /\bDept(?:artment)?\.?\s+of\s+([^,;]+)/i,
  /\bDivision\s+of\s+([^,;]+)/i,
  /\bSchool\s+of\s+([^,;]+)/i,
  /\bProgram(?:s)?\s+in\s+([^,;]+)/i,
  /\bInstitute\s+(?:of|for)\s+([^,;]+)/i,
  /\bCenter\s+(?:for|of)\s+([^,;]+)/i,
  /([A-Z][^,;]{3,40}?)\s+Department\b/i,
];
const SKIP_RE = /^(OH|USA|US|Dayton|Ohio|United States)$/i;

function extractDeptCollege(rawAffs) {
  let dept    = '';
  let college = '';
  for (const aff of (rawAffs || [])) {
    if (!aff.toLowerCase().includes('wright state')) continue;
    if (!dept) {
      for (const pat of DEPT_PATTERNS) {
        const m = pat.exec(aff);
        if (m) {
          const candidate = m[1].trim().replace(/[.,;]+$/, '');
          if (candidate.length > 4 && !SKIP_RE.test(candidate)) {
            dept = candidate;
            break;
          }
        }
      }
    }
    if (dept && !college) {
      const lo = dept.toLowerCase();
      for (const [kw, col] of Object.entries(DEPT_TO_COLLEGE)) {
        if (lo.includes(kw)) { college = col; break; }
      }
    }
    if (dept && college) break;
  }
  return { dept, college };
}

// ── Predatory check ───────────────────────────────────────────────────────────
function checkPredatory(venue, badIssns, badJNames, badPublishers) {
  if (!venue) return { flagged: false, reason: '' };
  const source    = venue.source || {};
  const jNameLo   = (source.display_name || '').trim().toLowerCase();
  const publisher = (source.host_organization_name || '').trim().toLowerCase();
  const issns     = (source.issn || []).map(i => i.replace(/-/g, ''));

  for (const issn of issns) {
    if (issn && badIssns.has(issn)) return { flagged: true, reason: `ISSN ${issn}` };
  }
  if (jNameLo && badJNames.has(jNameLo)) return { flagged: true, reason: 'journal name' };
  if (publisher) {
    for (const bad of badPublishers) {
      if (bad && (publisher.includes(bad) || bad.includes(publisher))) {
        return { flagged: true, reason: `publisher: ${publisher}` };
      }
    }
  }
  return { flagged: false, reason: '' };
}

// ── Parse works ───────────────────────────────────────────────────────────────
function parseWorks(works, badIssns, badJNames, badPublishers) {
  return works.map(w => {
    const venue     = w.primary_location || {};
    const source    = venue.source || {};
    const journal   = (source.display_name || '').trim();
    const publisher = (source.host_organization_name || '').trim();
    const issns     = (source.issn || []).join(', ');

    const { flagged, reason } = checkPredatory(venue, badIssns, badJNames, badPublishers);

    const wsuAuthors = [];
    const allRawAffs = [];
    for (const auth of (w.authorships || [])) {
      const instNames = (auth.institutions || []).map(i => (i.display_name || '').toLowerCase());
      allRawAffs.push(...(auth.raw_affiliation_strings || []));
      if (instNames.some(n => n.includes('wright state'))) {
        wsuAuthors.push((auth.author || {}).display_name || 'Unknown');
      }
    }

    const { dept, college } = extractDeptCollege(allRawAffs);

    return {
      year:       w.publication_year || '',
      authors:    wsuAuthors.join('; ') || '(no WSU author listed)',
      department: dept,
      college,
      title:      (w.title || '(untitled)').trim(),
      type:       w.type || '',
      journal,
      publisher,
      issns,
      url:        venue.landing_page_url || '',
      predatory:  flagged ? 'YES' : 'no',
      reason,
    };
  });
}

// ── CSV output ────────────────────────────────────────────────────────────────
function writeCSV(rows, outPath) {
  if (!rows.length) { console.log('  No rows.'); return; }
  const keys  = Object.keys(rows[0]);
  const lines = [keys.join(',')];
  for (const row of rows) {
    lines.push(keys.map(k => {
      const v = String(row[k] == null ? '' : row[k]).replace(/"/g, '""');
      return /[,"\n\r]/.test(v) ? `"${v}"` : v;
    }).join(','));
  }
  fs.writeFileSync(outPath, lines.join('\r\n'), 'utf8');
  console.log(`  CSV  -> ${outPath}`);
}

// ── HTML output ───────────────────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function topN(arr, n) {
  const counts = {};
  for (const item of arr) { if (item) counts[item] = (counts[item] || 0) + 1; }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function writeHTML(rows, outPath, fromDate, toDate, generatedAt) {
  const flagged     = rows.filter(r => r.predatory === 'YES');
  const total       = rows.length;
  const nFlag       = flagged.length;
  const pct         = total ? (nFlag / total * 100).toFixed(1) : '0.0';
  const topJournals = topN(flagged.map(r => r.journal), 15);

  const authorArr = [];
  for (const r of flagged) {
    for (const a of r.authors.split('; ')) {
      if (a && a !== '(no WSU author listed)') authorArr.push(a);
    }
  }
  const topAuthors = topN(authorArr, 20);

  function tr(r) {
    const cls  = r.predatory === 'YES' ? ' class="flag"' : '';
    const link = r.url ? `<a href="${esc(r.url)}" target="_blank">↗</a>` : '';
    const auth = esc(r.authors.length > 90 ? r.authors.slice(0, 90) + '…' : r.authors);
    const ttl  = esc(r.title.length > 110 ? r.title.slice(0, 110) + '…' : r.title);
    return `<tr${cls}><td>${esc(r.year)}</td><td class="auth">${auth}</td>`
      + `<td class="auth">${esc(r.department)}</td><td class="auth">${esc(r.college)}</td>`
      + `<td>${ttl}</td><td>${esc(r.journal)}</td><td>${esc(r.publisher)}</td>`
      + `<td class="fc">${esc(r.predatory)}</td><td>${esc(r.reason)}</td><td>${link}</td></tr>`;
  }

  const byYearDesc = (a, b) => String(b.year).localeCompare(String(a.year));
  const flaggedRows = flagged.sort(byYearDesc).map(tr).join('')
    || '<tr><td colspan="10" style="color:#8b949e;padding:12px">No flagged publications found.</td></tr>';
  const allRows     = [...rows].sort(byYearDesc).map(tr).join('');
  const topJRows    = topJournals.map(([j, n]) => `<tr><td>${esc(j)}</td><td>${n}</td></tr>`).join('')
    || '<tr><td colspan="2" style="color:#8b949e">None flagged</td></tr>';
  const topARows    = topAuthors.map(([a, n]) => `<tr><td>${esc(a)}</td><td>${n}</td></tr>`).join('')
    || '<tr><td colspan="2" style="color:#8b949e">None flagged</td></tr>';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WSU Predatory Journal Scan — ${generatedAt.slice(0, 10)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0d1117;color:#c9d1d9;font-family:'Segoe UI',sans-serif;font-size:14px;padding:40px 32px}
h1{font-family:'Courier New',monospace;color:#58a6ff;font-size:20px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:4px}
.sub{color:#8b949e;font-family:'Courier New',monospace;font-size:11px;margin-bottom:36px}
.eye{font-family:'Courier New',monospace;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#c9d1d9;background:#28527a;padding:2px 10px;display:inline-block;margin-bottom:10px}
.stats{display:flex;gap:20px;flex-wrap:wrap;margin-bottom:40px}
.stat{background:#161b22;border:1px solid #21262d;border-left:3px solid #28527a;padding:18px 24px;min-width:140px}
.stat .v{font-size:34px;font-weight:700;color:#58a6ff;font-family:'Courier New',monospace;line-height:1}
.stat .v.r{color:#f85149}.stat .l{font-size:10px;color:#8b949e;text-transform:uppercase;letter-spacing:.1em;margin-top:5px}
h2{font-family:'Courier New',monospace;font-size:12px;color:#58a6ff;letter-spacing:.12em;text-transform:uppercase;margin:36px 0 10px;border-bottom:1px solid #21262d;padding-bottom:6px}
.note{font-size:11px;color:#8b949e;font-family:'Courier New',monospace;margin-bottom:12px}
table{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:12.5px}
th{background:#161b22;color:#8b949e;text-align:left;padding:7px 10px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;border-bottom:2px solid #21262d;white-space:nowrap}
td{padding:6px 10px;border-bottom:1px solid #0d1117;vertical-align:top;line-height:1.45}
tr:hover td{background:#161b22}tr.flag td{background:#1a0808}tr.flag:hover td{background:#1e0d0d}
.fc{font-weight:700;color:#f85149}.auth{color:#8b949e;font-size:11.5px}
a{color:#58a6ff;text-decoration:none}a:hover{text-decoration:underline}
.cols{display:flex;gap:32px;flex-wrap:wrap}.cols>div{flex:1;min-width:280px}
.scr{overflow-x:auto}
.disc{background:#161b22;border:1px solid #21262d;padding:14px 18px;font-size:11px;color:#8b949e;line-height:1.6;margin:40px 0 16px;font-family:'Courier New',monospace}
</style>
</head>
<body>
<div class="eye">§ ETL Research Integrity Report</div>
<h1>Wright State University — Predatory Journal Scan</h1>
<div class="sub">Publications ${fromDate} to ${toDate} · Generated ${generatedAt.slice(0, 10)} · OpenAlex API · Stop Predatory Journals</div>
<div class="stats">
  <div class="stat"><div class="v">${total.toLocaleString()}</div><div class="l">Total Publications</div></div>
  <div class="stat"><div class="v r">${nFlag.toLocaleString()}</div><div class="l">Flagged Predatory</div></div>
  <div class="stat"><div class="v r">${pct}%</div><div class="l">Flag Rate</div></div>
  <div class="stat"><div class="v">${topJournals.length}</div><div class="l">Distinct Predatory Journals</div></div>
</div>
<div class="cols">
<div><h2>Top Predatory Journals</h2>
<table><thead><tr><th>Journal</th><th>#</th></tr></thead><tbody>${topJRows}</tbody></table></div>
<div><h2>Top Flagged Authors (WSU-affiliated)</h2>
<table><thead><tr><th>Author</th><th># Flagged Pubs</th></tr></thead><tbody>${topARows}</tbody></table></div>
</div>
<h2>Flagged Publications (${nFlag.toLocaleString()})</h2>
<p class="note">Rows highlighted red. Match types: ISSN · journal name · publisher substring.</p>
<div class="scr"><table>
<thead><tr><th>Year</th><th>WSU Authors</th><th>Department</th><th>College</th><th>Title</th><th>Journal</th><th>Publisher</th><th>Flag</th><th>Reason</th><th>Link</th></tr></thead>
<tbody>${flaggedRows}</tbody></table></div>
<h2>All Publications (${total.toLocaleString()})</h2>
<p class="note">Flagged rows highlighted. Download the CSV for ISSNs and full author lists.</p>
<div class="scr"><table>
<thead><tr><th>Year</th><th>WSU Authors</th><th>Department</th><th>College</th><th>Title</th><th>Journal</th><th>Publisher</th><th>Flag</th><th>Reason</th><th>Link</th></tr></thead>
<tbody>${allRows}</tbody></table></div>
<div class="disc">DISCLAIMER — This report is generated programmatically using the Stop Predatory Journals community dataset and OpenAlex metadata. A "YES" flag means the journal matched a list compiled by community editors — not a formal institutional determination. Verify flagged entries manually before using for personnel or accreditation decisions. False positives occur. Absence of a flag does not certify a journal as legitimate.</div>
</body></html>`;

  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`  HTML -> ${outPath}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const fromDate    = process.argv[2] || FROM_DATE;
  const toDate      = process.argv[3] || TO_DATE;
  const noCache     = process.argv.includes('--no-cache');
  const generatedAt = new Date().toISOString();
  const outCSV      = path.join(__dirname, 'wsu_predatory_results.csv');
  const outHTML     = path.join(__dirname, 'wsu_predatory_report.html');

  console.log('============================================================');
  console.log('  WSU Publication Integrity Scan');
  console.log(`  Publications ${fromDate} to ${toDate}`);
  console.log('============================================================');

  console.log('\n[1/4] Resolving Wright State University in OpenAlex...');
  let wsuId;
  try { wsuId = await getWsuId(); }
  catch (e) { console.error(`  ERROR: ${e.message}`); process.exit(1); }
  console.log(`  Institution ID: ${wsuId}`);

  console.log('\n[2/4] Loading predatory journal lists...');
  const { badIssns, badJNames, badPublishers } = await loadPredatoryLists(noCache);
  console.log(`  ${badIssns.size.toLocaleString()} ISSNs · ${badJNames.size.toLocaleString()} journal names · ${badPublishers.size.toLocaleString()} publishers`);

  console.log('\n[3/4] Fetching WSU publications from OpenAlex...');
  let works;
  try { works = await fetchAllWorks(wsuId, fromDate, toDate); }
  catch (e) { console.error(`\n  ERROR: ${e.message}`); process.exit(1); }

  if (!works.length) {
    console.log('  No works returned.');
    process.exit(0);
  }

  console.log('\n[4/4] Cross-referencing and writing output...');
  const rows  = parseWorks(works, badIssns, badJNames, badPublishers);
  const nFlag = rows.filter(r => r.predatory === 'YES').length;

  writeCSV(rows, outCSV);
  writeHTML(rows, outHTML, fromDate, toDate, generatedAt);

  console.log('');
  console.log('============================================================');
  console.log('  COMPLETE');
  console.log(`  ${rows.length.toLocaleString()} publications scanned`);
  console.log(`  ${nFlag.toLocaleString()} flagged (${rows.length ? (nFlag / rows.length * 100).toFixed(1) : 0}%)`);
  console.log('============================================================');
}

main().catch(e => {
  console.error('\nFatal error:', e.message);
  process.exit(1);
});
