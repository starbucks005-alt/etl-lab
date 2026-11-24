#!/usr/bin/env python3
"""The Guardian's live lookup (written 2026-11-24, at Dr. O's word: "Build a Guardian-specific lookup").

She answers three kinds of question from real public sources, says which source it was, and never fills a gap from memory:
  weather    "what is the weather in Dayton"        National Weather Service forecast, and active alerts for that place
  cyber      "any new vulnerabilities today"        CISA Known Exploited Vulnerabilities list (the newest additions)
  fact       "look up the Wright brothers"          Wikipedia's short summary of the best match
If a source cannot be reached, or has nothing, she says so. She does not guess, and the question is NOT passed on to a model to answer from memory.

What leaves the robot: only the place name you spoke (to find its coordinates), the coordinates (to the weather service), or the search words
(to Wikipedia). Nothing else, and no key. Everything used here is free, so a question costs nothing to answer.
She has no stored address in this file. A place the owner sets later goes in place.json as {"lat": .., "lon": .., "name": ".."} and is never spoken
or shown to a visitor: she says only the forecast for it.

Switch off by creating a file named lookup_off.txt next to this one.
"""
import json
import os
import re

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
PLACE_FILE = os.path.join(HERE, "place.json")
OFF_FILE = os.path.join(HERE, "lookup_off.txt")
TIMEOUT = 8
HEADERS = {"User-Agent": "ETL-Guardian-lookup", "Accept": "application/json"}
KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"

WEATHER_RE = re.compile(r"\b(weather|forecast|temperature|how (hot|cold|warm)|(will|is) it (rain|snow|storm)\w*|going to (rain|snow))\b", re.I)
ALERT_RE = re.compile(r"\b(weather )?(alerts?|warnings?|watch(es)?|advisor(y|ies)|severe)\b", re.I)
CYBER_RE = re.compile(r"\b(cyber ?security (news|alerts?|advisor\w+)|vulnerabilit\w+|known exploited|cisa|zero[- ]day|\bcves?\b|new exploits?)\b", re.I)
FACT_RE = re.compile(r"\b(?:look ?up|search (?:the (?:web|internet) )?for|google|find out about|tell me about|who (?:is|was|were)|what (?:is|was|are|were) (?:a |an |the )?)\s+(.{3,80})$", re.I)
PLACE_IN_RE = re.compile(r"\b(?:in|for|at|near)\s+([A-Za-z][A-Za-z .'-]{1,40}?)(?:\s*,\s*([A-Za-z][A-Za-z ]{1,18}?))?(?:\s+(?:today|tonight|tomorrow|right now|now|this (?:week|weekend)))?\s*[?.!]*$", re.I)
ZIP_RE = re.compile(r"\b(\d{5})\b")
# Questions about her, the person talking, or the room are never lookups ("what is your name", "who is here", "what is the time").
SELF_RE = re.compile(r"\b(you|your|yours|yourself|my|me|myself|i|we|us|our|here|this|that|these|those|it|time|date|day|today|tonight|going on|happening|wrong)\b", re.I)
TRAILING = re.compile(r"[?.!,\s]+$")


def is_off():
    return os.path.exists(OFF_FILE)


def _get_json(get, url, params=None):
    r = get(url, params=params, headers=HEADERS, timeout=TIMEOUT)
    if getattr(r, "status_code", 200) != 200:
        raise RuntimeError("status %s" % r.status_code)
    return r.json()


def kind_of(text):
    """'weather', 'cyber', 'fact' or None. Ordinary talk is None, so it goes on to the usual answer."""
    t = (text or "").strip()
    if not t:
        return None
    if CYBER_RE.search(t):
        return "cyber"
    if WEATHER_RE.search(t) or (ALERT_RE.search(t) and re.search(r"\b(weather|storm|tornado|flood|heat|winter|snow|wind)\b", t, re.I)):
        return "weather"
    m = FACT_RE.search(t)
    if m and not SELF_RE.search(m.group(1)):
        return "fact"
    return None


# ---------- weather ----------
def saved_place(path=None):
    try:
        with open(path or PLACE_FILE, encoding="utf-8") as f:
            d = json.load(f)
        return float(d["lat"]), float(d["lon"]), str(d.get("name") or "")
    except (OSError, ValueError, KeyError, TypeError):
        return None


def spoken_place(text):
    """The place the person named, as (name, state_or_None), or a ZIP as ('ZIP 45431', None). None when no place was named."""
    z = ZIP_RE.search(text)
    if z:
        return z.group(1), "zip"
    m = PLACE_IN_RE.search(text.strip())
    if not m:
        return None
    name = TRAILING.sub("", m.group(1)).strip()
    if re.fullmatch(r"(?i)(the )?(weather|forecast|morning|evening|afternoon|area|world|us|usa|america|general|case|fact|order)", name):
        return None
    return name, (m.group(2) or None)


def geocode(place, get):
    name, extra = place
    q = name
    params = {"name": name, "count": 5, "language": "en", "format": "json"}
    if extra == "zip":
        # Open-Meteo does not search ZIP codes; the US Census does not either without a street. Say so rather than guess.
        return None
    d = _get_json(get, "https://geocoding-api.open-meteo.com/v1/search", params)
    results = [x for x in d.get("results", []) if x.get("country_code") == "US"] or d.get("results", [])
    if extra and not extra == "zip":
        want = extra.lower()
        pick = [x for x in results if (x.get("admin1_code") or "").lower() == want or want in (x.get("admin1") or "").lower()]
        results = pick or results
    if not results:
        return None
    x = results[0]
    label = x.get("name", q) + ((", " + x["admin1"]) if x.get("admin1") else "")
    return float(x["latitude"]), float(x["longitude"]), label


def nws_forecast(lat, lon, get):
    p = _get_json(get, "https://api.weather.gov/points/%.4f,%.4f" % (lat, lon))
    props = p["properties"]
    f = _get_json(get, props["forecast"])["properties"]["periods"]
    return f[:2]


def nws_alerts(lat, lon, get):
    d = _get_json(get, "https://api.weather.gov/alerts/active", {"point": "%.4f,%.4f" % (lat, lon)})
    out = []
    for f in d.get("features", []):
        p = f.get("properties", {})
        out.append({"event": p.get("event", "alert"), "severity": p.get("severity", ""), "headline": p.get("headline", "")})
    return out


def weather_reply(text, get=requests.get, place_path=None):
    wants_alerts = bool(ALERT_RE.search(text))
    sp = spoken_place(text)
    where = None
    try:
        if sp:
            where = geocode(sp, get)
            if where is None:
                return ("I could not find that place by name. Say a city and state, like Dayton, Ohio.",) * 2
        else:
            where = saved_place(place_path)
            if where is None:
                return ("Tell me a city and state and I will look it up. I do not have a place saved yet.",) * 2
        lat, lon, label = where
        spoken_label = label if sp else "your area"
        periods = nws_forecast(lat, lon, get)
        alerts = nws_alerts(lat, lon, get)
    except Exception as e:
        print("LOOKUP weather problem:", str(e)[:120], flush=True)
        return ("I could not reach the National Weather Service just now, so I will not guess.",) * 2
    bits = []
    if alerts:
        names = sorted({a["event"] for a in alerts})
        bits.append("Active alerts for %s: %s." % (spoken_label, ", ".join(names[:3])))
    elif wants_alerts:
        bits.append("The National Weather Service lists no active alerts for %s right now." % spoken_label)
    if not wants_alerts or alerts:
        bits.append("Forecast for %s." % spoken_label)
        for p in periods[:2]:
            bits.append("%s: %s, %s degrees. %s" % (p["name"], p["shortForecast"].rstrip("."), p["temperature"], ""))
    spoken = " ".join(b.strip() for b in bits).strip() + " Source: National Weather Service."
    shown = spoken
    if alerts:
        shown += "\n\n" + "\n".join("- " + (a["headline"] or a["event"]) for a in alerts[:5])
    shown += "\n\nI am a helper, not a replacement for official alerts or 911."
    return spoken, shown


# ---------- cyber ----------
def cyber_reply(text, get=requests.get):
    try:
        d = _get_json(get, KEV_URL)
        items = sorted(d.get("vulnerabilities", []), key=lambda v: v.get("dateAdded", ""), reverse=True)[:3]
    except Exception as e:
        print("LOOKUP cyber problem:", str(e)[:120], flush=True)
        return ("I could not reach the CISA list just now, so I will not guess.",) * 2
    if not items:
        return ("The CISA list returned nothing I can read.",) * 2
    spoken = "From the CISA Known Exploited Vulnerabilities list, the newest additions: " + "; ".join(
        "%s %s, %s" % (v.get("vendorProject", "unknown vendor"), v.get("product", "unknown product"), v.get("cveID", "")) for v in items) + ". Full details are on the panel."
    shown = spoken + "\n\n" + "\n".join("- %s: %s %s. %s (added %s)" % (v.get("cveID", ""), v.get("vendorProject", ""), v.get("product", ""), v.get("shortDescription", ""), v.get("dateAdded", "")) for v in items)
    return spoken, shown


# ---------- fact ----------
def _first_sentences(text, n=2, chars=260):
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    out = " ".join(parts[:n])
    return out if len(out) <= chars else out[:chars].rsplit(" ", 1)[0] + "."


def fact_reply(text, get=requests.get):
    m = FACT_RE.search(text.strip())
    q = TRAILING.sub("", m.group(1)).strip() if m else ""
    q = re.sub(r"^(the )?(web|internet)\s+(for\s+)?", "", q, flags=re.I)
    if not q:
        return None
    try:
        s = _get_json(get, "https://en.wikipedia.org/w/rest.php/v1/search/title", {"q": q, "limit": 1})
        pages = s.get("pages", [])
        if not pages:
            return ("I looked for %s on Wikipedia and found nothing. I do not know that one." % q,) * 2
        title = pages[0]["key"]
        sm = _get_json(get, "https://en.wikipedia.org/api/rest_v1/page/summary/" + requests.utils.quote(title, safe=""))
    except Exception as e:
        print("LOOKUP fact problem:", str(e)[:120], flush=True)
        return ("I could not reach Wikipedia just now, so I will not guess.",) * 2
    extract = sm.get("extract") or ""
    if not extract or sm.get("type") == "disambiguation":
        return ("That name has more than one meaning. Tell me a little more and I will look again.",) * 2
    spoken = _first_sentences(extract) + " That is from Wikipedia."
    return spoken, extract + "\n\nSource: Wikipedia, " + sm.get("title", title)


def lookup_reply(text, get=requests.get, place_path=None):
    """(spoken, shown) for a question one of these sources can answer, else None so the usual answer goes ahead."""
    if is_off():
        return None
    k = kind_of(text)
    if k == "weather":
        return weather_reply(text, get, place_path)
    if k == "cyber":
        return cyber_reply(text, get)
    if k == "fact":
        return fact_reply(text, get)
    return None


if __name__ == "__main__":
    import sys
    r = lookup_reply(" ".join(sys.argv[1:]) or "what is the weather in Dayton, Ohio")
    print(r[1] if r else "(not a lookup question)")
