#!/usr/bin/env python3
"""
wsu_predatory_scan.py
=====================
Scans Wright State University faculty publications (2020-present) and
cross-references each journal against known predatory journal lists.

Sources
-------
  OpenAlex API (https://api.openalex.org)      — free, no key required
  Stop Predatory Journals dataset               — community Beall's-successor
  Beall's archived publisher list               — fallback

Output
------
  wsu_predatory_results.csv    — every publication with predatory flag + reason
  wsu_predatory_report.html    — visual report with summary stats, top offenders

Usage
-----
  pip install requests
  python wsu_predatory_scan.py

  Optional flags:
    --from-year 2021            override start year (default 2020)
    --out-dir   /path/to/dir    output directory (default: current dir)
    --no-cache                  re-download predatory lists even if cached
"""

import argparse
import csv
import os
import sys
import time
import requests
from collections import Counter
from datetime import datetime
from html import escape

# ── Config ────────────────────────────────────────────────────────────────────
OPENALEX_BASE  = "https://api.openalex.org"
EMAIL          = "research@emerging-tech-lab.com"   # OpenAlex polite pool
CACHE_DIR      = ".wsu_scan_cache"

# Stop Predatory Journals (community-maintained Beall's successor)
SPJ_JOURNALS_URL   = (
    "https://raw.githubusercontent.com/stop-predatory-journals/"
    "stop-predatory-journals.github.io/master/_data/journals.csv"
)
SPJ_PUBLISHERS_URL = (
    "https://raw.githubusercontent.com/stop-predatory-journals/"
    "stop-predatory-journals.github.io/master/_data/publishers.csv"
)

HEADERS = {"User-Agent": f"WSU-PredatoryScan/1.0 (mailto:{EMAIL})"}


# ── Argument parsing ──────────────────────────────────────────────────────────
def parse_args():
    p = argparse.ArgumentParser(description="WSU predatory journal scan")
    p.add_argument("--from-year", type=int, default=2020)
    p.add_argument("--out-dir",   type=str, default=".")
    p.add_argument("--no-cache",  action="store_true")
    return p.parse_args()


# ── Cache helpers ─────────────────────────────────────────────────────────────
def _cache_path(filename):
    os.makedirs(CACHE_DIR, exist_ok=True)
    return os.path.join(CACHE_DIR, filename)

def _read_cache(filename):
    p = _cache_path(filename)
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            return f.read()
    return None

def _write_cache(filename, content):
    with open(_cache_path(filename), "w", encoding="utf-8") as f:
        f.write(content)


# ── OpenAlex ──────────────────────────────────────────────────────────────────
def get_wsu_institution_id():
    """Resolve Wright State University to its OpenAlex institution ID."""
    url    = f"{OPENALEX_BASE}/institutions"
    params = {"search": "Wright State University", "per-page": 5, "mailto": EMAIL}
    r      = requests.get(url, params=params, headers=HEADERS, timeout=15)
    r.raise_for_status()
    for inst in r.json().get("results", []):
        if "wright state" in inst.get("display_name", "").lower():
            # OpenAlex IDs are returned as full URLs; extract the short form
            return inst["id"].split("/")[-1]
    raise RuntimeError("Wright State University not found in OpenAlex. Check spelling.")


def fetch_all_works(institution_id, from_year):
    """Paginate through every WSU work from from_year onward."""
    works  = []
    cursor = "*"
    page   = 0
    filter_str = (
        f"institutions.id:{institution_id},"
        f"from_publication_date:{from_year}-01-01"
    )
    while True:
        page += 1
        params = {
            "filter":  filter_str,
            "per-page": 200,
            "cursor":  cursor,
            "select":  "id,title,publication_year,primary_location,authorships,type",
            "mailto":  EMAIL,
        }
        sys.stdout.write(f"\r  Page {page} — {len(works):,} works so far…")
        sys.stdout.flush()
        r = requests.get(
            f"{OPENALEX_BASE}/works",
            params=params,
            headers=HEADERS,
            timeout=30,
        )
        r.raise_for_status()
        data  = r.json()
        batch = data.get("results", [])
        if not batch:
            break
        works.extend(batch)
        cursor = data.get("meta", {}).get("next_cursor")
        if not cursor:
            break
        time.sleep(0.12)   # polite pool: ~8 req/s ceiling
    print(f"\r  Fetched {len(works):,} works total.                    ")
    return works


# ── Predatory lists ───────────────────────────────────────────────────────────
def load_predatory_lists(no_cache=False):
    """Download (or load from cache) the SPJ journal + publisher lists."""
    def _get(url, cache_name):
        if not no_cache:
            cached = _read_cache(cache_name)
            if cached:
                return cached
        print(f"  Downloading {url} …")
        try:
            r = requests.get(url, headers=HEADERS, timeout=20)
            r.raise_for_status()
            text = r.text
            _write_cache(cache_name, text)
            return text
        except Exception as exc:
            print(f"  WARNING: could not download {cache_name}: {exc}")
            return ""

    journals_csv   = _get(SPJ_JOURNALS_URL,   "spj_journals.csv")
    publishers_csv = _get(SPJ_PUBLISHERS_URL, "spj_publishers.csv")

    bad_issns      = {}   # issn (no dash) -> journal name
    bad_j_names    = set()
    bad_publishers = set()

    if journals_csv:
        for row in csv.DictReader(journals_csv.splitlines()):
            # Column names vary; try common variants
            name = (
                row.get("Journal") or row.get("journal") or
                row.get("Name") or row.get("name") or ""
            ).strip()
            issn = (
                row.get("ISSN") or row.get("issn") or
                row.get("Print ISSN") or row.get("Online ISSN") or ""
            ).strip().replace("-", "")
            if issn:
                bad_issns[issn] = name
            if name:
                bad_j_names.add(name.lower())

    if publishers_csv:
        for row in csv.DictReader(publishers_csv.splitlines()):
            pub = (
                row.get("Publisher") or row.get("publisher") or
                row.get("Name") or row.get("name") or ""
            ).strip().lower()
            if pub:
                bad_publishers.add(pub)

    return bad_issns, bad_j_names, bad_publishers


# ── Department / College extraction ──────────────────────────────────────────
import re

# WSU department keyword → college. Keys are lowercase substrings; first match wins.
_DEPT_TO_COLLEGE = {
    # Boonshoft School of Medicine
    "anatomy":               "Boonshoft School of Medicine",
    "biochemistry":          "Boonshoft School of Medicine",
    "community health":      "Boonshoft School of Medicine",
    "emergency medicine":    "Boonshoft School of Medicine",
    "geriatric":             "Boonshoft School of Medicine",
    "internal medicine":     "Boonshoft School of Medicine",
    "neuroscience":          "Boonshoft School of Medicine",
    "obstetrics":            "Boonshoft School of Medicine",
    "oncology":              "Boonshoft School of Medicine",
    "orthopedic":            "Boonshoft School of Medicine",
    "pathology":             "Boonshoft School of Medicine",
    "pediatric":             "Boonshoft School of Medicine",
    "pharmacology":          "Boonshoft School of Medicine",
    "physiology":            "Boonshoft School of Medicine",
    "psychiatry":            "Boonshoft School of Medicine",
    "radiology":             "Boonshoft School of Medicine",
    "surgery":               "Boonshoft School of Medicine",
    "urology":               "Boonshoft School of Medicine",
    "boonshoft":             "Boonshoft School of Medicine",
    "school of medicine":    "Boonshoft School of Medicine",
    # College of Science and Mathematics
    "biological sciences":   "College of Science and Mathematics",
    "chemistry":             "College of Science and Mathematics",
    "earth and environmental":"College of Science and Mathematics",
    "geological":            "College of Science and Mathematics",
    "math":                  "College of Science and Mathematics",
    "physics":               "College of Science and Mathematics",
    "statistics":            "College of Science and Mathematics",
    # College of Engineering and Computer Science
    "biomedical engineering":"College of Engineering and Computer Science",
    "chemical engineering":  "College of Engineering and Computer Science",
    "computer science":      "College of Engineering and Computer Science",
    "computer engineering":  "College of Engineering and Computer Science",
    "electrical engineering":"College of Engineering and Computer Science",
    "mechanical":            "College of Engineering and Computer Science",
    "industrial":            "College of Engineering and Computer Science",
    "systems engineering":   "College of Engineering and Computer Science",
    "human factors":         "College of Engineering and Computer Science",
    # College of Liberal Arts
    "art history":           "College of Liberal Arts",
    "classics":              "College of Liberal Arts",
    "communication":         "College of Liberal Arts",
    "english":               "College of Liberal Arts",
    "film":                  "College of Liberal Arts",
    "history":               "College of Liberal Arts",
    "international studies": "College of Liberal Arts",
    "liberal arts":          "College of Liberal Arts",
    "modern languages":      "College of Liberal Arts",
    "music":                 "College of Liberal Arts",
    "philosophy":            "College of Liberal Arts",
    "political science":     "College of Liberal Arts",
    "psychology":            "College of Liberal Arts",
    "religion":              "College of Liberal Arts",
    "social work":           "College of Liberal Arts",
    "sociology":             "College of Liberal Arts",
    "theatre":               "College of Liberal Arts",
    # Raj Soin College of Business
    "accountancy":           "Raj Soin College of Business",
    "accounting":            "Raj Soin College of Business",
    "economics":             "Raj Soin College of Business",
    "finance":               "Raj Soin College of Business",
    "information systems":   "Raj Soin College of Business",
    "management":            "Raj Soin College of Business",
    "marketing":             "Raj Soin College of Business",
    "supply chain":          "Raj Soin College of Business",
    "raj soin":              "Raj Soin College of Business",
    # College of Nursing and Health
    "nursing":               "College of Nursing and Health",
    "population health":     "College of Nursing and Health",
    "public health":         "College of Nursing and Health",
    "rehabilitation":        "College of Nursing and Health",
    # College of Education and Human Services
    "counseling":            "College of Education and Human Services",
    "curriculum":            "College of Education and Human Services",
    "educational":           "College of Education and Human Services",
    "human services":        "College of Education and Human Services",
    "kinesiology":           "College of Education and Human Services",
    "leadership studies":    "College of Education and Human Services",
    "teacher":               "College of Education and Human Services",
    # Lake Campus
    "lake campus":           "Wright State University Lake Campus",
}

_DEPT_PATTERNS = [
    re.compile(r'\bDept(?:artment)?\.?\s+of\s+([^,;]+)',   re.IGNORECASE),
    re.compile(r'\bDivision\s+of\s+([^,;]+)',              re.IGNORECASE),
    re.compile(r'\bSchool\s+of\s+([^,;]+)',                re.IGNORECASE),
    re.compile(r'\bProgram(?:s)?\s+in\s+([^,;]+)',         re.IGNORECASE),
    re.compile(r'\bInstitute\s+(?:of|for)\s+([^,;]+)',     re.IGNORECASE),
    re.compile(r'\bCenter\s+(?:for|of)\s+([^,;]+)',        re.IGNORECASE),
    re.compile(r'([A-Z][^,;]{3,40}?)\s+Department\b',     re.IGNORECASE),
]
_SKIP = re.compile(r'^(OH|USA|US|Dayton|Ohio|United States)$', re.IGNORECASE)


def extract_dept_college(raw_affiliation_strings):
    """Parse department and college from raw OpenAlex affiliation strings.
    Only considers strings that mention Wright State."""
    dept = ""
    college = ""
    for aff in (raw_affiliation_strings or []):
        if "wright state" not in aff.lower():
            continue
        for pat in _DEPT_PATTERNS:
            m = pat.search(aff)
            if m:
                candidate = m.group(1).strip().rstrip(".,;")
                if len(candidate) > 4 and not _SKIP.match(candidate):
                    if not dept:
                        dept = candidate
                    break
        if not college and dept:
            dept_lo = dept.lower()
            for keyword, col in _DEPT_TO_COLLEGE.items():
                if keyword in dept_lo:
                    college = col
                    break
        if dept and college:
            break
    return dept, college


def check_predatory(venue, bad_issns, bad_j_names, bad_publishers):
    """Return (is_predatory: bool, reason: str)."""
    if not venue:
        return False, ""

    source      = venue.get("source") or {}
    j_name      = (source.get("display_name") or "").strip()
    j_name_lo   = j_name.lower()
    publisher   = (source.get("host_organization_name") or "").strip().lower()
    issns       = [i.replace("-", "") for i in (source.get("issn") or [])]

    # 1. ISSN match — most reliable
    for issn in issns:
        if issn and issn in bad_issns:
            return True, f"ISSN {issn}"

    # 2. Exact journal name match
    if j_name_lo and j_name_lo in bad_j_names:
        return True, "journal name"

    # 3. Publisher substring match
    if publisher:
        for bad_pub in bad_publishers:
            if bad_pub and (bad_pub in publisher or publisher in bad_pub):
                return True, f"publisher: {publisher}"

    return False, ""


# ── Parse works ───────────────────────────────────────────────────────────────
def parse_works(works, bad_issns, bad_j_names, bad_publishers):
    rows = []
    for w in works:
        title    = (w.get("title") or "(untitled)").strip()
        year     = w.get("publication_year") or ""
        wtype    = w.get("type") or ""
        venue    = w.get("primary_location") or {}
        source   = (venue.get("source") or {})
        journal  = (source.get("display_name") or "").strip()
        publisher = (source.get("host_organization_name") or "").strip()
        issns    = ", ".join(source.get("issn") or [])
        oa_url   = venue.get("landing_page_url") or ""
        doi_raw  = (w.get("id") or "")  # OpenAlex ID, not DOI

        flagged, reason = check_predatory(venue, bad_issns, bad_j_names, bad_publishers)

        # Collect authors affiliated with Wright State; gather raw affiliation strings
        wsu_authors = []
        all_raw_affs = []
        for auth in (w.get("authorships") or []):
            inst_names = [
                (i.get("display_name") or "").lower()
                for i in (auth.get("institutions") or [])
            ]
            raw_affs = auth.get("raw_affiliation_strings") or []
            all_raw_affs.extend(raw_affs)
            if any("wright state" in n for n in inst_names):
                aname = (auth.get("author") or {}).get("display_name") or "Unknown"
                wsu_authors.append(aname)

        dept, college = extract_dept_college(all_raw_affs)

        rows.append({
            "year":       year,
            "authors":    "; ".join(wsu_authors) or "(no WSU author listed)",
            "department": dept,
            "college":    college,
            "title":      title,
            "type":       wtype,
            "journal":    journal,
            "publisher":  publisher,
            "issns":      issns,
            "url":        oa_url,
            "predatory":  "YES" if flagged else "no",
            "reason":     reason,
        })

    return rows


# ── CSV output ────────────────────────────────────────────────────────────────
def write_csv(rows, out_path):
    if not rows:
        print("  No rows to write.")
        return
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"  CSV → {out_path}")


# ── HTML report ───────────────────────────────────────────────────────────────
def write_html(rows, out_path, from_year, generated_at):
    flagged  = [r for r in rows if r["predatory"] == "YES"]
    total    = len(rows)
    n_flag   = len(flagged)
    pct      = round(n_flag / total * 100, 1) if total else 0

    top_journals = Counter(r["journal"] for r in flagged if r["journal"]).most_common(15)
    top_authors  = Counter()
    for r in flagged:
        for a in r["authors"].split("; "):
            if a.strip() and a.strip() != "(no WSU author listed)":
                top_authors[a.strip()] += 1
    top_authors = top_authors.most_common(20)

    def tr(r):
        cls   = ' class="flag"' if r["predatory"] == "YES" else ""
        url   = r.get("url", "")
        link  = (f'<a href="{escape(url)}" target="_blank">↗</a>' if url else "")
        auth  = escape(r["authors"][:90]) + ("…" if len(r["authors"]) > 90 else "")
        ttl   = escape(r["title"][:110]) + ("…" if len(r["title"]) > 110 else "")
        return (
            f'<tr{cls}>'
            f'<td>{escape(str(r["year"]))}</td>'
            f'<td class="auth">{auth}</td>'
            f'<td class="auth">{escape(r.get("department",""))}</td>'
            f'<td class="auth">{escape(r.get("college",""))}</td>'
            f'<td>{ttl}</td>'
            f'<td>{escape(r["journal"])}</td>'
            f'<td>{escape(r["publisher"])}</td>'
            f'<td class="fc">{escape(r["predatory"])}</td>'
            f'<td>{escape(r["reason"])}</td>'
            f'<td>{link}</td>'
            f'</tr>'
        )

    flagged_rows  = "".join(tr(r) for r in sorted(flagged, key=lambda r: str(r["year"]), reverse=True))
    all_rows      = "".join(tr(r) for r in sorted(rows,    key=lambda r: str(r["year"]), reverse=True))
    top_j_rows    = "".join(f'<tr><td>{escape(j)}</td><td>{n}</td></tr>' for j, n in top_journals)
    top_a_rows    = "".join(f'<tr><td>{escape(a)}</td><td>{n}</td></tr>' for a, n in top_authors)

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WSU Predatory Journal Scan — {generated_at[:10]}</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:#0d1117;color:#c9d1d9;font-family:'Segoe UI','Public Sans',sans-serif;font-size:14px;padding:40px 32px}}
h1{{font-family:'Courier New',monospace;color:#58a6ff;font-size:20px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:4px}}
.sub{{color:#8b949e;font-family:'Courier New',monospace;font-size:11px;margin-bottom:36px}}
.eye{{font-family:'Courier New',monospace;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#c9d1d9;background:#28527a;padding:2px 10px;display:inline-block;margin-bottom:10px}}
.stats{{display:flex;gap:20px;flex-wrap:wrap;margin-bottom:40px}}
.stat{{background:#161b22;border:1px solid #21262d;border-left:3px solid #28527a;padding:18px 24px;min-width:140px}}
.stat .v{{font-size:34px;font-weight:700;color:#58a6ff;font-family:'Courier New',monospace;line-height:1}}
.stat .v.r{{color:#f85149}}
.stat .l{{font-size:10px;color:#8b949e;text-transform:uppercase;letter-spacing:.1em;margin-top:5px}}
h2{{font-family:'Courier New',monospace;font-size:12px;color:#58a6ff;letter-spacing:.12em;text-transform:uppercase;margin:36px 0 10px;border-bottom:1px solid #21262d;padding-bottom:6px}}
.note{{font-size:11px;color:#8b949e;font-family:'Courier New',monospace;margin-bottom:12px}}
table{{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:12.5px}}
th{{background:#161b22;color:#8b949e;text-align:left;padding:7px 10px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;border-bottom:2px solid #21262d;white-space:nowrap}}
td{{padding:6px 10px;border-bottom:1px solid #0d1117;vertical-align:top;line-height:1.45}}
tr:hover td{{background:#161b22}}
tr.flag td{{background:#1a0808}}
tr.flag:hover td{{background:#1e0d0d}}
.fc{{font-weight:700;color:#f85149}}
.auth{{color:#8b949e;font-size:11.5px}}
a{{color:#58a6ff;text-decoration:none}}
a:hover{{text-decoration:underline}}
.cols{{display:flex;gap:32px;flex-wrap:wrap}}
.cols>div{{flex:1;min-width:280px}}
.scr{{overflow-x:auto}}
.disc{{background:#161b22;border:1px solid #21262d;padding:14px 18px;font-size:11px;color:#8b949e;line-height:1.6;margin:40px 0 16px;font-family:'Courier New',monospace}}
</style>
</head>
<body>
<div class="eye">§ ETL Research Integrity Report</div>
<h1>Wright State University — Predatory Journal Scan</h1>
<div class="sub">Publications {from_year}–2025 · Generated {generated_at[:10]} · Sources: OpenAlex API · Stop Predatory Journals</div>

<div class="stats">
  <div class="stat"><div class="v">{total:,}</div><div class="l">Total Publications</div></div>
  <div class="stat"><div class="v r">{n_flag:,}</div><div class="l">Flagged Predatory</div></div>
  <div class="stat"><div class="v r">{pct}%</div><div class="l">Flag Rate</div></div>
  <div class="stat"><div class="v">{len(top_journals)}</div><div class="l">Distinct Predatory Journals</div></div>
</div>

<div class="cols">
<div>
<h2>Top Predatory Journals</h2>
<table>
<thead><tr><th>Journal</th><th>#</th></tr></thead>
<tbody>{top_j_rows or '<tr><td colspan="2" style="color:#8b949e">None flagged</td></tr>'}</tbody>
</table>
</div>
<div>
<h2>Top Flagged Authors (WSU-affiliated)</h2>
<table>
<thead><tr><th>Author</th><th># Flagged Pubs</th></tr></thead>
<tbody>{top_a_rows or '<tr><td colspan="2" style="color:#8b949e">None flagged</td></tr>'}</tbody>
</table>
</div>
</div>

<h2>Flagged Publications ({n_flag:,})</h2>
<p class="note">Rows highlighted red. Match types: ISSN · journal name · publisher substring.</p>
<div class="scr">
<table>
<thead><tr><th>Year</th><th>WSU Authors</th><th>Department</th><th>College</th><th>Title</th><th>Journal</th><th>Publisher</th><th>Flag</th><th>Reason</th><th>Link</th></tr></thead>
<tbody>{flagged_rows or '<tr><td colspan="8" style="color:#8b949e;padding:12px">No flagged publications found.</td></tr>'}</tbody>
</table>
</div>

<h2>All Publications ({total:,})</h2>
<p class="note">Flagged rows highlighted. Download the CSV for ISSNs and full author lists.</p>
<div class="scr">
<table>
<thead><tr><th>Year</th><th>WSU Authors</th><th>Department</th><th>College</th><th>Title</th><th>Journal</th><th>Publisher</th><th>Flag</th><th>Reason</th><th>Link</th></tr></thead>
<tbody>{all_rows}</tbody>
</table>
</div>

<div class="disc">
DISCLAIMER — This report is generated programmatically using the Stop Predatory Journals
community dataset and OpenAlex metadata. A "YES" flag means the journal matched a list
compiled by community editors — not a formal institutional determination. Verify flagged
entries manually before using for personnel or accreditation decisions. False positives
occur. Absence of a flag does not certify a journal as legitimate.
</div>
</body>
</html>"""

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"  HTML → {out_path}")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    args         = parse_args()
    from_year    = args.from_year
    out_dir      = args.out_dir
    no_cache     = args.no_cache
    generated_at = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    out_csv      = os.path.join(out_dir, "wsu_predatory_results.csv")
    out_html     = os.path.join(out_dir, "wsu_predatory_report.html")

    print("=" * 60)
    print("  WSU Publication Integrity Scan")
    print(f"  Publications {from_year} – 2025")
    print("=" * 60)

    print("\n[1/4] Resolving Wright State University in OpenAlex…")
    try:
        wsu_id = get_wsu_institution_id()
    except Exception as exc:
        print(f"  ERROR: {exc}")
        sys.exit(1)
    print(f"  Institution ID: {wsu_id}")

    print("\n[2/4] Loading predatory journal lists…")
    bad_issns, bad_j_names, bad_publishers = load_predatory_lists(no_cache)
    print(
        f"  {len(bad_issns):,} ISSNs · "
        f"{len(bad_j_names):,} journal names · "
        f"{len(bad_publishers):,} publishers"
    )
    if not bad_issns and not bad_j_names:
        print("  WARNING: predatory lists empty — check network and try --no-cache")

    print("\n[3/4] Fetching WSU publications from OpenAlex…")
    try:
        works = fetch_all_works(wsu_id, from_year)
    except Exception as exc:
        print(f"\n  ERROR fetching works: {exc}")
        sys.exit(1)

    if not works:
        print("  No works returned. Check institution ID and date range.")
        sys.exit(0)

    print("\n[4/4] Cross-referencing and writing output…")
    rows    = parse_works(works, bad_issns, bad_j_names, bad_publishers)
    n_flag  = sum(1 for r in rows if r["predatory"] == "YES")

    write_csv(rows, out_csv)
    write_html(rows, out_html, from_year, generated_at)

    print()
    print("=" * 60)
    print(f"  COMPLETE")
    print(f"  {len(rows):,} publications scanned")
    print(f"  {n_flag:,} flagged ({round(n_flag/len(rows)*100,1) if rows else 0}%)")
    print(f"  Output: {out_csv}")
    print(f"  Output: {out_html}")
    print("=" * 60)
    print()


if __name__ == "__main__":
    main()
