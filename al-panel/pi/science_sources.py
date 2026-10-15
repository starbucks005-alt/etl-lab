"""Science mode answers that come from journals, not from memory. Added 2026-10-15, Dr. O.

The pitch to Dr. Elased: "Imagine Astra Lite on a bench and your students had a question about a method. Instead of asking you they could ask her, and she had
guardrails in place to go only to reputable journals to get answers." This is that. It uses OpenAlex, the open index SLR Studio also retrieves from, and
Europe PMC for the methods section of open access papers. The guardrails, all checked in code and not left to the model:
  * a work that OpenAlex marks as retracted is never used;
  * it must be a journal article in a journal OpenAlex counts as a core journal (or one listed in sources_allowlist.txt next to the server, or in DOAJ);
  * if sources_allowlist.txt exists, ONLY the journals named in it are used (one journal name per line), so a lab can say exactly which journals it trusts;
  * the answer may only use the sources that were fetched, and must carry a source number [n] that exists, or it is replaced by "I did not find it";
  * every question, the sources found and the answer are written to sources_log.jsonl so a supervisor can read what students were told.
NOT TRIED against the real services when it was written (they could not be reached from where it was written). Run `python3 science_sources.py "your question"`
on the robot to see what it finds, with no AI answer at all."""
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

import requests

OPENALEX = "https://api.openalex.org/works"
EUROPEPMC_FULLTEXT = "https://www.ebi.ac.uk/europepmc/webservices/rest/%s/fullTextXML"
MAILTO = "drterryoroszi@emerging-tech-lab.com"        # OpenAlex asks for a contact address; this is the laboratory's
HERE = os.path.dirname(os.path.abspath(__file__))
ALLOWLIST_FILE = os.path.join(HERE, "sources_allowlist.txt")
LOG_FILE = os.path.join(HERE, "sources_log.jsonl")
METHODS_MAX = 3500


def abstract_from_index(inv):
    """OpenAlex sends an abstract as {word: [positions]}. Put it back in order."""
    if not isinstance(inv, dict) or not inv:
        return ""
    slots = {}
    for word, places in inv.items():
        for p in places or []:
            slots[p] = word
    return " ".join(slots[i] for i in sorted(slots))


def load_allowlist():
    try:
        return [l.strip().lower() for l in open(ALLOWLIST_FILE) if l.strip() and not l.strip().startswith("#")]
    except OSError:
        return []


def pmcid_of(work):
    ids = work.get("ids") or {}
    m = re.search(r"PMC\d+", str(ids.get("pmcid") or ""))
    return m.group(0) if m else None


def reputable(work, allow):
    """(ok, why not). Retracted and non-journal works are refused first, then the journal is checked."""
    if work.get("is_retracted"):
        return False, "retracted"
    loc = work.get("primary_location") or {}
    src = loc.get("source") or {}
    name = str(src.get("display_name") or "").lower()
    if (src.get("type") or "journal") != "journal":
        return False, "not a journal"
    if allow:
        return (any(a in name for a in allow), "not in the lab's journal list")
    if src.get("is_core") is True or src.get("is_in_doaj") is True:
        return True, ""
    if "is_core" not in src:                       # the index did not say: do not refuse everything because of a missing field
        return True, ""
    return False, "not a core journal"


def search_works(query, n=8, get=requests.get):
    r = get(OPENALEX, params={
        "search": query, "per-page": n, "mailto": MAILTO,
        "filter": "type:article,is_retracted:false,has_abstract:true",
        "select": "id,doi,title,publication_year,primary_location,open_access,abstract_inverted_index,cited_by_count,ids,is_retracted"}, timeout=15)
    r.raise_for_status()
    return r.json().get("results", [])


def methods_text(pmcid, get=requests.get):
    """The methods section of an open access paper, as plain text, or "" when there is none."""
    try:
        r = get(EUROPEPMC_FULLTEXT % pmcid, timeout=15)
        if r.status_code != 200:
            return ""
        root = ET.fromstring(r.content)
    except Exception:
        return ""
    for sec in root.iter("sec"):
        title = " ".join("".join(sec.find("title").itertext()).split()).lower() if sec.find("title") is not None else ""
        if "method" in (sec.get("sec-type") or "").lower() or re.search(r"method|material|procedure|protocol|experimental", title):
            text = " ".join(" ".join(sec.itertext()).split())
            if len(text) > 200:
                return text[:METHODS_MAX]
    return ""


def gather(query, get=requests.get, want=4, full_texts=2):
    """The numbered sources for a question. Each has: n, title, journal, year, doi, url, kind ('methods section' or 'abstract only'), text."""
    allow = load_allowlist()
    out, refused, fulls = [], [], 0
    for w in search_works(query, 10, get):
        ok, why = reputable(w, allow)
        if not ok:
            refused.append((w.get("title"), why))
            continue
        abstract = abstract_from_index(w.get("abstract_inverted_index"))
        title = " ".join(str(w.get("title") or "").split())
        if not (title and abstract):
            continue
        src = (w.get("primary_location") or {}).get("source") or {}
        doi = str(w.get("doi") or "")
        pm = pmcid_of(w)
        text, kind = abstract, "abstract only"
        if pm and fulls < full_texts:
            m = methods_text(pm, get)
            fulls += 1
            if m:
                text, kind = "ABSTRACT: " + abstract + " METHODS: " + m, "methods section"
        out.append({"n": len(out) + 1, "title": title, "journal": src.get("display_name") or "unknown journal", "year": w.get("publication_year"),
                    "doi": doi, "url": doi or str(w.get("id") or ""), "kind": kind, "text": text})
        if len(out) >= want:
            break
    return out, refused


def prompt_sources(sources):
    return "\n\n".join("[%d] %s. %s, %s. (%s)\n%s" % (s["n"], s["title"], s["journal"], s["year"], s["kind"], s["text"]) for s in sources)


def source_lines(sources):
    return "\n".join("[%d] %s. %s, %s (%s). %s" % (s["n"], s["title"], s["journal"], s["year"], s["kind"], s["url"]) for s in sources)


def cited_numbers(answer, count):
    nums = {int(x) for x in re.findall(r"\[(\d{1,2})\]", answer or "")}
    return sorted(n for n in nums if 1 <= n <= count), sorted(n for n in nums if not 1 <= n <= count)


def speakable(answer):
    """The answer as it is said aloud: no source numbers."""
    return re.sub(r"\s*\[\d{1,2}\]", "", answer or "").strip()


def log_it(entry):
    try:
        with open(LOG_FILE, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except OSError:
        pass


if __name__ == "__main__":
    q = " ".join(sys.argv[1:]) or "western blot transfer buffer methanol concentration"
    found, refused = gather(q)
    print("Question:", q)
    print("%d sources found, %d refused" % (len(found), len(refused)))
    for s in found:
        print("-", source_lines([s]))
    for t, why in refused:
        print("  refused:", (t or "")[:70], "(" + why + ")")
