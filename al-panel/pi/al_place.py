#!/usr/bin/env python3
"""Where the Guardian stands (written 2026-11-24, Dr. O: "when she gets the address she maps the location: police and fire, and national disaster threats").

The owner gives a home or work address on the panel. She turns it into map coordinates, then builds, once, a place card:
  nearest police and fire stations      OpenStreetMap (Nominatim), with a phone number when the map lists one
  disaster risks for the county         FEMA National Risk Index, each hazard rated Very Low to Very High
  live weather alerts for the spot      National Weather Service (al_lookup.py)
Free services, no key. The card is saved, so showing it at an event does not need the internet.

Privacy, by design: the street address is used for the lookup and is NOT kept. Only the coordinates, rounded to about 100 metres, are saved in
place.json, with the Home or Work label. The panel shows the card to the owner. She never speaks or shows the address or the coordinates to a visitor.
"""
import json
import math
import os
import re
import time

import requests

import al_chain
import al_lookup

HERE = os.path.dirname(os.path.abspath(__file__))
PLACE_FILE = os.path.join(HERE, "place.json")
LOG_FILE = os.path.join(HERE, "place_log.jsonl")
HEADERS = {"User-Agent": "ETL-Guardian-lookup (education robot)", "Accept": "application/json"}
TIMEOUT = 20
FEMA_URL = "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Counties/FeatureServer/0/query"
HAZARDS = {"AVLN": "Avalanche", "CFLD": "Coastal flooding", "CWAV": "Cold wave", "DRGT": "Drought", "ERQK": "Earthquake", "HAIL": "Hail", "HWAV": "Heat wave",
           "HRCN": "Hurricane", "ISTM": "Ice storm", "LNDS": "Landslide", "LTNG": "Lightning", "IFLD": "River flooding", "SWND": "Strong wind",
           "TRND": "Tornado", "TSUN": "Tsunami", "VLCN": "Volcano", "WFIR": "Wildfire", "WNTW": "Winter weather"}
RANK = {"Very High": 5, "Relatively High": 4, "Relatively Moderate": 3, "Relatively Low": 2, "Very Low": 1}
POLICE_WORDS = ("police", "police department", "sheriff")
FIRE_WORDS = ("fire station",)
KINDS = ("home", "work")


def _json(get, url, params=None):
    r = get(url, params=params, headers=HEADERS, timeout=TIMEOUT)
    if getattr(r, "status_code", 200) != 200:
        raise RuntimeError("status %s" % r.status_code)
    return r.json()


def geocode(text, get=requests.get):
    """(lat, lon) from 'lat, lon', a 5 digit ZIP, a street address (US Census) or a city and state. None when it is not found."""
    t = (text or "").strip()
    m = re.fullmatch(r"(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)", t)
    if m:
        return float(m.group(1)), float(m.group(2))
    if re.fullmatch(r"\d{5}", t):
        p = _json(get, "https://api.zippopotam.us/us/" + t)["places"][0]
        return float(p["latitude"]), float(p["longitude"])
    if re.search(r"\d", t):
        d = _json(get, "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress",
                  {"address": t, "benchmark": "Public_AR_Current", "format": "json"})
        hits = d.get("result", {}).get("addressMatches", [])
        if hits:
            return float(hits[0]["coordinates"]["y"]), float(hits[0]["coordinates"]["x"])
    w = al_lookup.geocode((re.sub(r"\s*,\s*", ", ", t).split(",")[0].strip(), (t.split(",")[1].strip() if "," in t else None)), get)
    return (w[0], w[1]) if w else None


def distance_km(a_lat, a_lon, b_lat, b_lon):
    p = math.pi / 180
    h = math.sin((b_lat - a_lat) * p / 2) ** 2 + math.cos(a_lat * p) * math.cos(b_lat * p) * math.sin((b_lon - a_lon) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def stations(lat, lon, words, get=requests.get, sleep=time.sleep, span=0.12, keep=3):
    """The nearest places the map lists for these search words, nearest first: [{name, km, phone}]."""
    found = {}
    for w in words:
        try:
            rows = _json(get, "https://nominatim.openstreetmap.org/search",
                         {"q": w, "format": "jsonv2", "viewbox": "%f,%f,%f,%f" % (lon - span, lat + span, lon + span, lat - span), "bounded": 1, "limit": 10, "extratags": 1})
        except Exception:
            rows = []
        for r in rows:
            key = (r.get("osm_type"), r.get("osm_id"))
            tags = r.get("extratags") or {}
            name = (r.get("name") or r.get("display_name", "").split(",")[0]).strip()
            found[key] = {"name": name or "Unnamed", "km": round(distance_km(lat, lon, float(r["lat"]), float(r["lon"])), 1),
                          "phone": tags.get("phone") or tags.get("contact:phone") or ""}
        sleep(1.1)
    return sorted(found.values(), key=lambda s: s["km"])[:keep]


def risks(lat, lon, get=requests.get):
    """The county's FEMA National Risk Index: ({'county','state','overall'}, [{'hazard','rating'} highest first])."""
    d = _json(get, FEMA_URL, {"geometry": "%f,%f" % (lon, lat), "geometryType": "esriGeometryPoint", "inSR": 4326, "spatialRel": "esriSpatialRelIntersects",
                              "outFields": "*", "returnGeometry": "false", "f": "json"})
    feats = d.get("features", [])
    if not feats:
        return None, []
    a = feats[0]["attributes"]
    rows = [{"hazard": HAZARDS[k], "rating": a.get(k + "_RISKR")} for k in HAZARDS if a.get(k + "_RISKR") in RANK]
    rows.sort(key=lambda r: -RANK[r["rating"]])
    return {"county": a.get("COUNTY", ""), "state": a.get("STATE", ""), "overall": a.get("RISK_RATNG", "")}, rows


def load(path=None):
    try:
        with open(path or PLACE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def build(text, kind, get=requests.get, sleep=time.sleep, path=None, log=None):
    """Finds the place, builds the card and saves it. Returns the card, or raises ValueError with words for the owner."""
    kind = (kind or "").lower()
    if kind not in KINDS:
        raise ValueError("Say whether this is a Home or a Work place.")
    try:
        ll = geocode(text, get)
    except Exception:
        raise ValueError("I could not reach the map service just now. Try again in a moment.")
    if not ll:
        raise ValueError("I could not find that address. Try the street, city and state, or just the ZIP code.")
    lat, lon = round(ll[0], 3), round(ll[1], 3)      # about 100 metres; the street address itself is never kept
    card = {"kind": kind, "lat": lat, "lon": lon, "set": int(time.time()), "police": [], "fire": [], "county": None, "risks": [], "notes": []}
    try:
        card["police"] = stations(lat, lon, POLICE_WORDS, get, sleep)
        card["fire"] = stations(lat, lon, FIRE_WORDS, get, sleep)
    except Exception:
        card["notes"].append("The station list is not available right now.")
    try:
        card["county"], card["risks"] = risks(lat, lon, get)
    except Exception:
        card["notes"].append("The disaster risk list is not available right now.")
    with open(path or PLACE_FILE, "w", encoding="utf-8") as f:
        json.dump(card, f)
    al_chain.append(log or LOG_FILE, "place_set", {"kind": kind})
    return card


def clear(path=None, log=None):
    try:
        os.remove(path or PLACE_FILE)
    except OSError:
        pass
    al_chain.append(log or LOG_FILE, "place_cleared", {})


def owner_view(path=None):
    """For the owner's panel only. Includes the coordinates so the owner can check the map pin; a visitor never gets this."""
    return load(path)


def threats_line(card):
    """One sentence for the panel, such as 'Highest risks here: Cold wave, Ice storm.' """
    top = [r["hazard"] for r in (card or {}).get("risks", []) if RANK.get(r["rating"], 0) >= 4][:4]
    return ("Highest risks here: " + ", ".join(top) + ".") if top else "No hazard is rated high for this county."


def live_alerts(card, get=requests.get):
    if not card:
        return []
    try:
        return al_lookup.nws_alerts(card["lat"], card["lon"], get)
    except Exception:
        return []
