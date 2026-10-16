"""Pet Companion, added 2026-10-16, Dr. O: "a skill for pet owners that feel bad about leaving their pet alone all day."

While the owner is out she says a few gentle words to the pet by name, now and then, in the quiet hours' gaps. She keeps her head still and her eyes steady so nothing startles the animal.
It is company for the pet, and a log for the owner. It makes no claim about easing worry or treating anything, and it is not in children's friend mode.

The settings are kept in pet.json next to the server (kept out of git): the pet's name and kind, how often she speaks, the quiet hours, whether she is on, and when the daily note goes.
The daily note is only a count of how many times she spoke, plus whatever else is added later. It goes to the notice address the care check-in already uses. Nothing here listens for barking yet.

Not tried with a real animal as of 2026-10-16."""
import json
import os
import random
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PET_FILE = os.path.join(HERE, "pet.json")
LOG_FILE = os.path.join(HERE, "pet_log.json")
DEFAULT = {"name": "", "kind": "dog", "every_min": 40, "quiet_start": "21:00", "quiet_end": "07:00", "on": False, "note_at": "18:00", "toys": []}
KINDS = ("dog", "cat", "other")
# soft, short and true: nothing here promises the owner is coming at a time, or claims to know how the animal feels
PHRASES = {
    "dog": ["Hi {n}. You are okay. I am here.", "{n}, you are a good dog. Rest easy.", "Hello {n}. It is quiet, and that is fine.",
            "{n}, I am still here with you.", "Good dog, {n}. Take a nap if you like.", "Hi {n}. Everything is all right.",
            "{n}, you are doing so well.", "Hello, sweet {n}. I am keeping you company."],
    "cat": ["Hi {n}. You are okay. I am here.", "{n}, you are a good cat. Rest easy.", "Hello {n}. It is quiet, and that is fine.",
            "{n}, I am still here with you.", "Hi {n}. Everything is all right.", "Hello, sweet {n}. I am keeping you company."],
    "other": ["Hi {n}. You are okay. I am here.", "Hello {n}. It is quiet, and that is fine.", "{n}, I am still here with you.",
              "Hi {n}. Everything is all right.", "Hello, sweet {n}. I am keeping you company."],
}


# 2026-10-16, Dr. O: "favorite toys reminder so Elle can say something about fav toys". The owner lists them and she mentions one now and then. She only says what is listed.
TOY_PHRASES = ["{n}, your {t} is waiting for you.", "Hi {n}. Maybe it is a good time to find your {t}.", "{n}, do you remember your {t}?",
               "Hello {n}. I wonder where your {t} is.", "{n}, your {t} is right where you left it, maybe."]
MAX_TOYS = 6


def _toys(v):
    """A list of toy names from a list or from words separated by commas. Letters, numbers, spaces and hyphens only, so nothing odd is ever spoken."""
    raw = v if isinstance(v, list) else str(v or "").split(",")
    out = []
    for t in raw:
        t = " ".join(str(t).split())[:30]
        if t and all(c.isalnum() or c in " -'" for c in t) and t.lower() not in [x.lower() for x in out]:
            out.append(t)
    return out[:MAX_TOYS]


def _hhmm(v, default):
    try:
        h, m = (int(x) for x in str(v).split(":"))
        if 0 <= h <= 23 and 0 <= m <= 59:
            return "%02d:%02d" % (h, m)
    except (ValueError, TypeError):
        pass
    return default


def load():
    try:
        d = json.load(open(PET_FILE))
        d = d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        d = {}
    cfg = dict(DEFAULT)
    cfg.update({k: d[k] for k in DEFAULT if k in d})
    cfg["toys"] = _toys(cfg.get("toys"))
    return cfg


def save(d):
    cfg = dict(DEFAULT)
    cfg.update(load())
    if "name" in d:
        name = " ".join(str(d["name"]).split())[:30]
        if any(c in name for c in "<>{}\\"):
            raise ValueError("the name can only be letters and spaces")
        cfg["name"] = name
    if "kind" in d:
        if d["kind"] not in KINDS:
            raise ValueError("kind must be dog, cat or other")
        cfg["kind"] = d["kind"]
    if "every_min" in d:
        try:
            n = int(d["every_min"])
        except (ValueError, TypeError):
            raise ValueError("how often must be a number of minutes")
        cfg["every_min"] = max(10, min(240, n))            # not more often than every 10 minutes, so she never nags the animal
    for k in ("quiet_start", "quiet_end", "note_at"):
        if k in d:
            cfg[k] = _hhmm(d[k], cfg[k])
    if "toys" in d:
        cfg["toys"] = _toys(d["toys"])
    if "on" in d:
        cfg["on"] = bool(d["on"])
    if cfg["on"] and not cfg["name"]:
        raise ValueError("give the pet a name first")
    tmp = PET_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(cfg, f)
    os.replace(tmp, PET_FILE)
    return cfg


def in_quiet_hours(cfg, now=None):
    t = time.localtime(now or time.time())
    cur = t.tm_hour * 60 + t.tm_min
    a = int(cfg["quiet_start"][:2]) * 60 + int(cfg["quiet_start"][3:])
    b = int(cfg["quiet_end"][:2]) * 60 + int(cfg["quiet_end"][3:])
    if a == b:
        return False
    return (a <= cur < b) if a < b else (cur >= a or cur < b)


def phrase(cfg, last=None):
    toys = cfg.get("toys") or []
    if toys and random.random() < 0.4:                                               # now and then, one of the favorite toys
        toy = random.choice(toys)
        opts = [p.format(n=cfg["name"], t=toy) for p in TOY_PHRASES]
        opts = [o for o in opts if o != last] or opts
        return random.choice(opts)
    pool = PHRASES.get(cfg["kind"], PHRASES["other"])
    options = [p for p in pool if p.format(n=cfg["name"]) != last] or pool          # the last one said is the formatted text, so compare it formatted
    return random.choice(options).format(n=cfg["name"])


def due(cfg, last_spoken, now=None):
    """True when she should speak to the pet now. last_spoken is when she last did (epoch seconds, 0 for never)."""
    now = now or time.time()
    return bool(cfg["on"] and cfg["name"]) and not in_quiet_hours(cfg, now) and (now - last_spoken) >= cfg["every_min"] * 60


def _log():
    try:
        d = json.load(open(LOG_FILE))
        return d if isinstance(d, list) else []
    except (OSError, ValueError):
        return []


def log_spoken(text, now=None):
    now = now or time.time()
    items = _log()
    items.append({"t": int(now), "day": time.strftime("%Y-%m-%d", time.localtime(now)), "time": time.strftime("%H:%M", time.localtime(now)), "text": text[:120]})
    items = items[-600:]
    tmp = LOG_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(items, f)
    os.replace(tmp, LOG_FILE)


def today_note(cfg, now=None):
    """The note for the owner. Only what is true: how many times she spoke and when she first and last did. No guesses about the animal."""
    now = now or time.time()
    day = time.strftime("%Y-%m-%d", time.localtime(now))
    mine = [i for i in _log() if i.get("day") == day]
    name = cfg["name"] or "your pet"
    if not mine:
        return "I did not speak to %s today." % name
    return "I spoke to %s %d time%s today, first at %s and last at %s. I do not listen for barking yet, so I cannot tell you how %s was." % (
        name, len(mine), "" if len(mine) == 1 else "s", mine[0]["time"], mine[-1]["time"], name)


def note_due(cfg, last_note_day, now=None):
    """True once a day, after the note time, when the skill is on and a note was not already sent today."""
    now = now or time.time()
    t = time.localtime(now)
    day = time.strftime("%Y-%m-%d", t)
    at = int(cfg["note_at"][:2]) * 60 + int(cfg["note_at"][3:])
    return bool(cfg["on"] and cfg["name"]) and last_note_day != day and (t.tm_hour * 60 + t.tm_min) >= at
