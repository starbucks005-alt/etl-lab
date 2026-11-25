#!/usr/bin/env python3
"""The Guardian's public infrastructure feeds (written 2026-11-25, Dr. O's Guardian skills, item 6, the public half).

Two free CISA feeds, read when she is asked and kept for half an hour so she does not hammer the site:
  ICS advisories   industrial control system advisories (energy, water, manufacturing and the rest of the OT world)
  CISA alerts      the alerts list
She says the title, the date and where it is from. She does not summarize, rank or guess what an advisory means for this place,
and she does not map an advisory to a sector, because the feed does not say.
If CISA cannot be reached she says so, and if she has an older copy she says how old it is.
InfraGard has no public feed. What InfraGard shares with its members reaches her only when her owner types it into her notes (al_inbox.py).
"""
import html
import json
import os
import re
import time

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_FILE = os.path.join(HERE, "feeds_cache.json")
TTL = 30 * 60
HEADERS = {"User-Agent": "ETL-Guardian-lookup (education robot)", "Accept": "application/rss+xml, application/xml"}
TIMEOUT = 15
LOOK = 300000      # characters read from the top of a feed; the newest items come first
FEEDS = {
    "ics": {"name": "CISA industrial control system advisories", "short": "ICS advisories", "url": "https://www.cisa.gov/cybersecurity-advisories/ics-advisories.xml"},
    "alerts": {"name": "CISA alerts", "short": "CISA alerts", "url": "https://www.cisa.gov/cybersecurity-advisories/alerts.xml"},
}
ICS_RE = re.compile(r"\b(ics|ot|scada|industrial control|control system)s? (advisor\w+|alerts?|bulletins?)\b|\b(advisor\w+) (for|on) (ics|industrial control|scada)\b|\bics\b.*\b(advisor\w+|alerts?)\b", re.I)
ALERT_RE = re.compile(r"\bcisa (?:alerts?|advisor\w+|bulletins?)\b|\b(?:new|latest|recent) cisa\b|\bany (?:new )?cisa\b", re.I)


def parse(text, keep=10):
    """[{title, link, date}] from an RSS text, newest first as the feed gives them."""
    out = []
    for body in re.findall(r"<item>(.*?)</item>", (text or "")[:LOOK], re.S):
        def tag(n):
            m = re.search(r"<%s>(.*?)</%s>" % (n, n), body, re.S)
            return html.unescape(re.sub(r"<!\[CDATA\[|\]\]>", "", m.group(1))).strip() if m else ""
        title = re.sub(r"\s+", " ", tag("title"))
        if title:
            out.append({"title": title[:160], "link": tag("link")[:200], "date": tag("pubDate")[:40]})
        if len(out) >= keep:
            break
    return out


def day_of(date):
    """'Tue, 24 Nov 26 12:00:00 +0000' to 'November 24', or '' when it cannot be read."""
    for fmt in ("%a, %d %b %y %H:%M:%S %z", "%a, %d %b %Y %H:%M:%S %z"):
        try:
            return time.strftime("%B %d", time.strptime(date, fmt)).replace(" 0", " ")
        except ValueError:
            continue
    return ""


def _load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def get_feed(key, get=None, now=None, path=None):
    """{'items', 'fetched', 'stale', 'ok'}. Fresh copy when the cache is young, else a live read, else the old copy marked stale, else nothing."""
    now = time.time() if now is None else now
    path = path or CACHE_FILE
    f = FEEDS[key]
    cache = _load(path)
    c = cache.get(key)
    if c and now - c["t"] < TTL:
        return {"items": c["items"], "fetched": c["t"], "stale": False, "ok": True}
    try:
        if get is None:
            import requests
            get = requests.get
        r = get(f["url"], headers=HEADERS, timeout=TIMEOUT)
        if getattr(r, "status_code", 200) != 200:
            raise RuntimeError("status %s" % r.status_code)
        items = parse(r.text)
        if not items:
            raise RuntimeError("no items")
        cache[key] = {"t": int(now), "items": items}
        try:
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(cache, fh)
        except OSError:
            pass
        return {"items": items, "fetched": int(now), "stale": False, "ok": True}
    except Exception:
        if c:
            return {"items": c["items"], "fetched": c["t"], "stale": True, "ok": True}
        return {"items": [], "fetched": None, "stale": False, "ok": False}


def _age(sec):
    m = int(sec // 60)
    return "%d minutes" % m if m < 90 else "%d hours" % int(sec // 3600)


def say(key, feed, now=None, count=3):
    """(spoken, shown) for one feed."""
    now = time.time() if now is None else now
    f = FEEDS[key]
    if not feed["ok"]:
        s = "I could not reach the %s just now, and I have no older copy, so I will not guess." % f["name"]
        return s, s
    its = feed["items"][:count]
    heads = []
    for i in its:
        d = day_of(i["date"])
        heads.append(i["title"] + (", " + d if d else ""))
    s = "The newest %s: " % f["short"] + "; ".join(heads) + "."
    if feed["stale"]:
        s += " I could not reach CISA just now, so this is from my last look, %s ago." % _age(now - feed["fetched"])
    shown = s + "\n\n" + "\n".join("- %s (%s)%s" % (i["title"], day_of(i["date"]) or i["date"] or "no date", (" " + i["link"]) if i["link"] else "") for i in feed["items"][:8])
    shown += "\n\nSource: " + f["name"] + ". I read titles and dates only. What an advisory means for a place is for the people who run it to judge."
    return s, shown


def wants(text):
    t = text or ""
    if ICS_RE.search(t):
        return "ics"
    if ALERT_RE.search(t):
        return "alerts"
    return None


def reply(text, get=None, now=None, path=None):
    k = wants(text)
    if not k:
        return None
    return say(k, get_feed(k, get, now, path), now)
