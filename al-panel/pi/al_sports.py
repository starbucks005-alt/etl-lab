"""Real scores and schedules for a robot whose entry has "sports": true. Added 2026-11-15, Dr. O: Astrad (Ted) "knows sports, that could
be his thing". When a question names a team, its last game, live score, record and next game are looked up on ESPN's public scoreboard
(free, no account) and handed to the reply as facts, so he never has to make up a score. If nothing is found, or the scoreboard does not
answer, nothing is added and his own rule applies: he did not catch it.

ESPN's scoreboard is not an official service with a promise behind it. If it changes, this quietly returns nothing.
Any team in the leagues below can be asked about, so a visitor's team works too. The home teams are listed so a short name like
"the Reds" or "the Raiders" finds the right one first.
"""
import datetime
import json
import os
import re
import time

import requests

BASE = "https://site.api.espn.com/apis/site/v2/sports/"
LEAGUES = [
    ("baseball/mlb", "baseball"),
    ("football/nfl", "football"),
    ("basketball/nba", "basketball"),
    ("hockey/nhl", "hockey"),
    ("basketball/wnba", "WNBA basketball"),
    ("football/college-football", "college football"),
    ("basketball/mens-college-basketball", "men's college basketball"),
    ("basketball/womens-college-basketball", "women's college basketball"),
]
SPORT_NAME = dict(LEAGUES)
# Dr. O's teams, 2026-11-15: the Reds and Ohio State (his secret favorites), the Wright State Raiders (the game he wants an invite to),
# and the Bengals. Each short name points at the team it means around here.
HOME = [
    (("wright state", "raiders"), [("basketball/mens-college-basketball", "2750")]),
    (("ohio state", "buckeyes", "osu"), [("football/college-football", "194"), ("basketball/mens-college-basketball", "194")]),
    (("cincinnati reds", "reds"), [("baseball/mlb", "17")]),
    (("cincinnati bengals", "bengals"), [("football/nfl", "4")]),
]
TEAMS_FOR = 7 * 24 * 3600
SCHEDULE_FOR = 120
TIMEOUT = 6
_cache = {}


def _get(url, params=None, keep=SCHEDULE_FOR):
    key = url + json.dumps(params or {}, sort_keys=True)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < keep:
        return hit[1]
    r = requests.get(url, params=params, timeout=TIMEOUT)
    r.raise_for_status()
    j = r.json()
    _cache[key] = (time.time(), j)
    return j


def _team_index(here):
    """Every team in every league, as (league, id, full name, short name, location). Kept on disk for a week."""
    path = os.path.join(here, "sports_teams.json")
    try:
        d = json.load(open(path, encoding="utf-8"))
        if time.time() - d.get("t", 0) < TEAMS_FOR and d.get("teams"):
            return d["teams"]
    except (OSError, ValueError):
        pass
    out = []
    for lg, _name in LEAGUES:
        try:
            j = _get(BASE + lg + "/teams", {"limit": 1000}, keep=TEAMS_FOR)
            for t in j["sports"][0]["leagues"][0]["teams"]:
                t = t["team"]
                out.append([lg, str(t["id"]), t.get("displayName", ""), t.get("name") or t.get("shortDisplayName", ""), t.get("location", "")])
        except Exception:
            continue
    if out:
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"t": time.time(), "teams": out}, f)
        except OSError:
            pass
    return out


def _words(text):
    return " " + re.sub(r"[^a-z0-9 ]+", " ", (text or "").lower()) + " "


def find_teams(text, here, limit=2):
    """[(league, id)] for the teams this question names, home teams first. Empty when it names none."""
    w = _words(text)
    found = []
    for names, picks in HOME:
        if any(" %s " % n in w for n in names):
            # "the Raiders" alone means Wright State here, unless the question says Las Vegas
            if names[0] == "wright state" and " las vegas " in w:
                continue
            found += [p for p in picks if p not in found]
    home_words = {n for names, _p in HOME for n in names}
    for lg, tid, full, short, loc in _team_index(here):
        if (lg, tid) in found:
            continue
        full_w = _words(full).strip()
        short_w = _words(short).strip()
        if full_w and " %s " % full_w in w:
            found.append((lg, tid))
        elif lg in ("baseball/mlb", "football/nfl", "basketball/nba", "hockey/nhl") and short_w and short_w not in home_words and " %s " % short_w in w:
            found.append((lg, tid))      # a pro team's nickname is enough ("the Browns"); a college one needs its school
    return found[:limit]


def _when(iso, now=None):
    dt = datetime.datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone()
    now = now or datetime.datetime.now().astimezone()
    days = (dt.date() - now.date()).days
    day = "today" if days == 0 else "tomorrow" if days == 1 else "yesterday" if days == -1 else dt.strftime("%A, %B ") + str(dt.day)
    clock = str(dt.hour % 12 or 12) + (":%02d" % dt.minute if dt.minute else "") + (" AM" if dt.hour < 12 else " PM")
    return day, clock


def _score(c):
    s = c.get("score")
    if isinstance(s, dict):
        s = s.get("displayValue")
    return s


def _game_line(e, tid, now=None):
    c = e["competitions"][0]
    me = next((x for x in c["competitors"] if str(x["team"]["id"]) == tid), None)
    them = next((x for x in c["competitors"] if str(x["team"]["id"]) != tid), None)
    if not me or not them:
        return None, None
    opp = them["team"].get("displayName", "another team")
    where = "at home" if me.get("homeAway") == "home" else "away"
    venue = (c.get("venue") or {}).get("fullName")
    state = c["status"]["type"].get("state")       # pre, in, post
    day, clock = _when(e["date"], now)
    if state == "post":
        a, b = _score(me), _score(them)
        if c["status"]["type"].get("name") in ("STATUS_POSTPONED", "STATUS_CANCELED"):
            return "post", "the game against %s %s was %s" % (opp, day, c["status"]["type"].get("description", "called off").lower())
        won = me.get("winner")
        if won:
            return "post", "%s they beat %s, %s to %s, %s" % (day[:1].upper() + day[1:], opp, a, b, where)
        return "post", "%s they lost to %s, %s to %s, %s" % (day[:1].upper() + day[1:], opp, b, a, where)
    if state == "in":
        return "in", "they're playing %s right now, %s %s, %s" % (opp, _score(me), _score(them), c["status"]["type"].get("shortDetail", ""))
    return "pre", "next game is %s at %s against %s, %s%s" % (day, clock, opp, where, (" at " + venue) if venue else "")


def _schedule(lg, tid, season=None):
    p = {"season": season} if season else None
    return _get(BASE + "%s/teams/%s/schedule" % (lg, tid), p)


def team_facts(lg, tid, now=None):
    j = _schedule(lg, tid)
    team = j.get("team", {})
    name = team.get("displayName", "the team")
    events = j.get("events", [])
    lines = {"post": None, "in": None, "pre": None}
    for e in events:
        kind, line = _game_line(e, tid, now)
        if kind == "post":
            lines["post"] = line                   # the last finished one wins
        elif kind == "in" and not lines["in"]:
            lines["in"] = line
        elif kind == "pre" and not lines["pre"]:
            lines["pre"] = line
    season = (j.get("requestedSeason") or {}).get("year")
    last_season = False
    if not lines["post"] and season:               # a new season is posted and nothing is played yet: the last game is in the one before
        try:
            for e in _schedule(lg, tid, season - 1).get("events", []):
                kind, line = _game_line(e, tid, now)
                if kind == "post":
                    lines["post"] = line + " (that was the last game of last season)"
                    last_season = True
        except Exception:
            pass
    rec = team.get("recordSummary")
    bits = [name + " " + SPORT_NAME.get(lg, "") + ":"]
    if rec:
        bits.append("%s %s." % ("record last season" if last_season else "record this season", rec.replace("-", " and ")))
    for k in ("in", "post", "pre"):
        if lines[k]:
            bits.append(lines[k] + ".")
    if not lines["pre"] and not lines["in"]:
        bits.append("No next game is posted yet.")
    return " ".join(bits)


def facts_for(text, here, now=None):
    """A note to add to the question, or '' when it names no team or the scoreboard did not answer."""
    try:
        teams = find_teams(text, here)
    except Exception as e:
        print("SPORTS could not read the team list:", str(e)[:100], flush=True)
        return ""
    if not teams:
        return ""
    facts = []
    for lg, tid in teams:
        try:
            facts.append(team_facts(lg, tid, now))
        except Exception as e:
            print("SPORTS lookup failed for %s %s: %s" % (lg, tid, str(e)[:100]), flush=True)
    if not facts:
        return ""
    print("SPORTS looked up: %s" % " | ".join(facts)[:300], flush=True)
    return (" (Sports facts just looked up for this question from the live scoreboard: " + " ".join(facts) +
            " Use only these for any score, record, date, time or opponent, say them like a fan talking, not like a list, and round nothing. "
            "If what they asked is not in these facts, say you didn't catch it.)")
