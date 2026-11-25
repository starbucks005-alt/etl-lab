#!/usr/bin/env python3
"""The Guardian's briefing (written 2026-11-25, Dr. O's Guardian skills, item 3).

"Brief me" gives what is true right now, each part from a real source and named, and says so when a source cannot be reached:
  Weather      active alerts and the forecast for the saved place, from the National Weather Service (the place is never named)
  Exploited    the newest additions to the CISA Known Exploited Vulnerabilities list
  Her own      her last security check and any alerts still on her panel
  The room     the sensor beside her, when there is one and she has heard from it
  Refresher    one short reminder the OWNER wrote or approved, rotating by day. She ships with none and never writes her own.
Nothing here is invented. There is no made up "intelligence", no guess at what is coming, and no claim to see InfraGard member alerts.
A part with no source says "I do not have" or "I could not reach", it is never filled in.
She is a helper and does not replace 911 or the official alerts.
"""
import json
import os
import re
import time

try:
    import al_lookup
except ImportError:
    al_lookup = None
try:
    import al_chain
except ImportError:
    al_chain = None

HERE = os.path.dirname(os.path.abspath(__file__))
REFRESH_FILE = os.path.join(HERE, "refreshers.json")
STATE_FILE = os.path.join(HERE, "briefing.json")
LOG_FILE = os.path.join(HERE, "briefing_log.jsonl")
MAX_REFRESHERS = 30
MAX_LEN = 240
KEV_COUNT = 3

ASK_RE = re.compile(r"\b(brief me|(?:give|get) me (?:a |the |my )?(?:daily |morning |security |situation )?(?:briefing|brief|rundown|update)|(?:daily|morning|security|situation|threat) (?:briefing|brief|report|rundown)|situation report|sitrep|what(?:'s| is) (?:the )?situation|catch me up)\b", re.I)


def wants(text):
    return bool(ASK_RE.search(text or ""))


# ---------- the owner's refreshers ----------
def load_refreshers(path=None):
    try:
        with open(path or REFRESH_FILE, encoding="utf-8") as f:
            d = json.load(f)
        return [str(x)[:MAX_LEN] for x in d if str(x).strip()][:MAX_REFRESHERS]
    except (OSError, ValueError, TypeError):
        return []


def save_refreshers(lines, path=None, log=None):
    """The owner's list, one reminder per line. Returns what was kept."""
    kept = [re.sub(r"\s+", " ", str(x)).strip()[:MAX_LEN] for x in (lines or []) if str(x).strip()][:MAX_REFRESHERS]
    with open(path or REFRESH_FILE, "w", encoding="utf-8") as f:
        json.dump(kept, f)
    if al_chain:
        try:
            al_chain.append(log or LOG_FILE, "refreshers_set", {"count": len(kept)})
        except OSError:
            pass
    return kept


def todays_refresher(now=None, path=None):
    items = load_refreshers(path)
    if not items:
        return None
    day = int((time.time() if now is None else now) // 86400)
    return items[day % len(items)]


# ---------- the parts ----------
def _weather(get, place_path):
    if al_lookup is None:
        return {"id": "weather", "ok": None, "spoken": "I do not have the weather lookup on this robot.", "lines": []}
    where = al_lookup.saved_place(place_path)
    if where is None:
        return {"id": "weather", "ok": None, "spoken": "I do not have a place saved, so no weather.", "lines": []}
    try:
        periods = al_lookup.nws_forecast(where[0], where[1], get)
        alerts = al_lookup.nws_alerts(where[0], where[1], get)
    except Exception:
        return {"id": "weather", "ok": False, "spoken": "I could not reach the National Weather Service just now.", "lines": []}
    names = sorted({a["event"] for a in alerts})
    lines = ["- " + (a["headline"] or a["event"]) for a in alerts[:5]]
    if names:
        sp = "Active weather alerts: " + ", ".join(names[:3]) + "."
    else:
        sp = "The National Weather Service lists no active alerts for your area."
    if periods:
        p = periods[0]
        sp += " %s: %s, %s degrees." % (p["name"], str(p["shortForecast"]).rstrip("."), p["temperature"])
    return {"id": "weather", "ok": True, "alerts": len(alerts), "spoken": sp, "lines": lines, "source": "National Weather Service"}


def _kev(get):
    if al_lookup is None:
        return {"id": "kev", "ok": None, "spoken": "I do not have the CISA lookup on this robot.", "lines": []}
    try:
        d = al_lookup._get_json(get, al_lookup.KEV_URL)
        items = sorted(d.get("vulnerabilities", []), key=lambda v: v.get("dateAdded", ""), reverse=True)[:KEV_COUNT]
    except Exception:
        return {"id": "kev", "ok": False, "spoken": "I could not reach the CISA list just now.", "lines": []}
    if not items:
        return {"id": "kev", "ok": None, "spoken": "The CISA list returned nothing I can read.", "lines": []}
    sp = "Newest on the CISA exploited vulnerabilities list: " + "; ".join("%s %s" % (v.get("vendorProject", "unknown vendor"), v.get("product", "unknown product")) for v in items) + "."
    lines = ["- %s: %s %s (added %s)" % (v.get("cveID", ""), v.get("vendorProject", ""), v.get("product", ""), v.get("dateAdded", "")) for v in items]
    return {"id": "kev", "ok": True, "spoken": sp, "lines": lines, "source": "CISA Known Exploited Vulnerabilities"}


def _feed(get, path, now):
    try:
        import al_feeds
    except ImportError:
        return {"id": "ics", "ok": None, "spoken": "I do not have the advisory feeds on this robot.", "lines": []}
    feed = al_feeds.get_feed("ics", get, now, path)
    if not feed["ok"]:
        return {"id": "ics", "ok": False, "spoken": "I could not reach the CISA industrial control advisories just now.", "lines": []}
    sp, _ = al_feeds.say("ics", feed, now, count=2)
    return {"id": "ics", "ok": True, "spoken": sp, "lines": ["- %s (%s)" % (i["title"], al_feeds.day_of(i["date"]) or "no date") for i in feed["items"][:5]], "source": al_feeds.FEEDS["ics"]["name"]}


def _notes(path):
    try:
        import al_inbox
        line = al_inbox.briefing_line(path)
    except Exception:
        return None
    return {"id": "notes", "ok": True, "spoken": line, "lines": [], "source": "notes you gave me"} if line else None


def _call(modname, fn):
    try:
        return getattr(__import__(modname), fn)()
    except Exception:
        return None


def _herself(audit_last, alerts_view):
    bits, lines = [], []
    a = audit_last() if audit_last else None
    if a:
        n = a.get("attention", 0)
        bits.append("My last security check found %d thing%s needing attention." % (n, "" if n == 1 else "s") if n else "My last security check found nothing needing attention.")
        lines += ["- " + r["name"] + ": " + r["detail"] for r in a.get("checks", []) if r.get("status") == "attention"][:6]
    else:
        bits.append("I have not run a security check yet.")
    v = alerts_view() if alerts_view else None
    if v is not None:
        k = len(v.get("active", []))
        bits.append("%d alert%s on my panel." % (k, "" if k == 1 else "s") if k else "Nothing on my alert panel.")
        lines += ["- %s alert, %s: %s" % (x.get("name", ""), x.get("source", ""), x.get("text", "")) for x in v.get("active", [])[:5]]
    return {"id": "herself", "ok": True, "spoken": " ".join(bits), "lines": lines, "source": "my own checks"}


def _room(room_view):
    v = room_view() if room_view else None
    if not v or not v.get("configured"):
        return None
    r = v.get("reading")
    if not r or v.get("stale"):
        return {"id": "room", "ok": None, "spoken": "I have not heard from the room sensor lately.", "lines": [], "source": "the room sensor"}
    s = "It is %d degrees with %d percent humidity in here" % (round(r["temp_f"]), r["humidity"])
    s += (" and the CO2 is %d parts per million." % r["co2"]) if r.get("co2") else "."
    return {"id": "room", "ok": True, "spoken": s, "lines": [], "source": "the room sensor"}


def build(now=None, get=None, place_path=None, refresh_path=None, audit_last=None, alerts_view=None, room_view=None, feed_path=None, inbox_path=None):
    """The whole briefing: {t, parts, spoken, shown}. Parts that cannot be had say so."""
    now = time.time() if now is None else now
    if get is None:
        import requests
        get = requests.get
    if audit_last is None:
        audit_last = lambda: _call("al_audit", "last")
    if alerts_view is None:
        alerts_view = lambda: _call("al_alert", "view")
    if room_view is None:
        room_view = lambda: _call("al_room", "view")
    parts = [_weather(get, place_path), _kev(get), _herself(audit_last, alerts_view)]
    rm = _room(room_view)
    if rm:
        parts.append(rm)
    parts.append(_feed(get, feed_path, now))
    nt = _notes(inbox_path)
    if nt:
        parts.append(nt)
    rf = todays_refresher(now, refresh_path)
    if rf:
        parts.append({"id": "refresher", "ok": True, "spoken": "Today's reminder: " + rf, "lines": [], "source": "your own list"})
    spoken = "Here is your briefing. " + " ".join(p["spoken"] for p in parts)
    shown = spoken + "\n\n" + "\n\n".join(("%s:\n" % p["id"].title()) + "\n".join(p["lines"]) + (("\nSource: " + p["source"]) if p.get("source") else "") for p in parts if p["lines"] or p.get("source"))
    shown += "\n\nI do not see InfraGard member alerts. What your own list holds is yours. I am a helper, not a replacement for 911 or the official alerts."
    return {"t": int(now), "parts": parts, "spoken": spoken, "shown": shown}


def save(res, state=None, log=None):
    try:
        with open(state or STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(res, f)
    except OSError:
        pass
    if al_chain:
        try:
            al_chain.append(log or LOG_FILE, "briefing", {"parts": [(p["id"], p["ok"]) for p in res["parts"]]}, now=res["t"])
        except OSError:
            pass


def last(state=None):
    try:
        with open(state or STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def view(state=None, refresh_path=None):
    return {"last": last(state), "refreshers": load_refreshers(refresh_path), "max": MAX_REFRESHERS}


def reply(text, **kw):
    """(spoken, shown) when she is asked for a briefing, built now."""
    if not wants(text):
        return None
    res = build(**kw)
    save(res)
    return res["spoken"], res["shown"]
