#!/usr/bin/env python3
"""The Guardian's latchkey mode (written 2026-11-24, Dr. O's Guardian skills: a home guardian for a child who comes home to an empty house).

The parent sets it up on the panel: the child's name, the after-school window, the time the child is expected home, and a few reminders.
Then, on school days (or every day, the parent picks):
  Arrival    The first time her motion sensor sees someone in the window, she takes one announced photo of the door, writes the arrival time in a log that shows
             if anyone alters it, and sends the parent a notice with the time. The photo is on the panel for the parent to look at.
  Expected   If the expected time passes and nobody has come in, the parent gets a notice that the child is not home yet.
  Reminders  At the times the parent sets, she says them out loud: "Time to start your homework."
The notice goes to the web address the parent put in the Guardian setup (the same one the front desk uses). Everything else stays on this robot.
Off until the parent switches it on.
"""
import json
import os
import re
import threading
import time

import al_chain

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(HERE, "latchkey.json")
LOG_FILE = os.path.join(HERE, "latchkey_log.jsonl")
MAX_REMINDERS = 8
_lock = threading.Lock()
HHMM = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")


def _load(path):
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        d = {}
    return {"on": bool(d.get("on")), "child": str(d.get("child", ""))[:40], "start": str(d.get("start", "15:00")), "end": str(d.get("end", "18:30")),
            "expected": str(d.get("expected", "")), "school_days": bool(d.get("school_days", True)),
            "reminders": [r for r in d.get("reminders", []) if isinstance(r, dict)][:MAX_REMINDERS],
            "arrived_on": str(d.get("arrived_on", "")), "late_told_on": str(d.get("late_told_on", "")), "fired": d.get("fired", {}) if isinstance(d.get("fired"), dict) else {}}


def _save(path, d):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f)
    os.replace(tmp, path)


def state(path=None):
    return _load(path or STATE_FILE)


def _minutes(hhmm):
    m = HHMM.match(hhmm or "")
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def configure(d, path=None, log=None):
    s = _load(path or STATE_FILE)
    for k in ("start", "end", "expected"):
        v = str(d.get(k, s[k])).strip()
        if v and not HHMM.match(v):
            raise ValueError("Times look like 15:30.")
        s[k] = v
    s["child"] = re.sub(r"[^A-Za-z .'-]", "", str(d.get("child", s["child"])))[:40].strip()
    s["school_days"] = bool(d.get("school_days", s["school_days"]))
    rems = []
    for r in (d.get("reminders", s["reminders"]) or [])[:MAX_REMINDERS]:
        t, text = str(r.get("time", "")).strip(), re.sub(r"\s+", " ", str(r.get("text", ""))).strip()[:140]
        if HHMM.match(t) and text:
            rems.append({"time": t, "text": text})
    s["reminders"] = rems
    if "on" in d:
        s["on"] = bool(d["on"])
    _save(path or STATE_FILE, s)
    al_chain.append(log or LOG_FILE, "configured", {"on": s["on"], "reminders": len(rems)})
    return s


def _today(now):
    return time.strftime("%Y-%m-%d", time.localtime(now))


def _clock(now):
    t = time.localtime(now)
    return t.tm_hour * 60 + t.tm_min


def _is_day(s, now):
    return (not s["school_days"]) or time.localtime(now).tm_wday < 5


def in_window(s, now):
    a, b = _minutes(s["start"]), _minutes(s["end"])
    return a is not None and b is not None and _is_day(s, now) and a <= _clock(now) < b


def _say_time(now):
    return time.strftime("%I:%M %p", time.localtime(now)).lstrip("0")


def due(now=None, path=None):
    """True when a motion right now would be the day's arrival (so the robot knows to take the photo instead of a greeting)."""
    now = time.time() if now is None else now
    s = _load(path or STATE_FILE)
    return bool(s["on"] and in_window(s, now) and s["arrived_on"] != _today(now))


def on_motion(photo_fn, notify=None, now=None, path=None, log=None):
    """The sensor saw someone. Records the day's first arrival in the window. Returns what happened, or None when nothing was due."""
    now = time.time() if now is None else now
    with _lock:
        s = _load(path or STATE_FILE)
        if not s["on"] or not in_window(s, now) or s["arrived_on"] == _today(now):
            return None
        s["arrived_on"] = _today(now)
        _save(path or STATE_FILE, s)
        r = photo_fn() or {}
        photo = r.get("name") if r.get("ok") else None
        al_chain.append(log or LOG_FILE, "arrival", {"time": _say_time(now), "photo": photo, "why": None if r.get("ok") else r.get("why", "no photo")}, now=now)
        who = s["child"] or "Someone"
        if notify:
            try:
                notify("%s arrived at %s." % (who, _say_time(now)) + (" A photo of the door is on the panel." if photo else ""))
            except Exception:
                pass
        return {"arrived": _say_time(now), "photo": photo}


def tick(speak=None, notify=None, now=None, path=None, log=None):
    """Called about once a minute. Says due reminders, and tells the parent if the child is not home by the expected time."""
    now = time.time() if now is None else now
    with _lock:
        s = _load(path or STATE_FILE)
        if not s["on"] or not _is_day(s, now):
            return []
        did = []
        today, cur = _today(now), _clock(now)
        for i, r in enumerate(s["reminders"]):
            at = _minutes(r["time"])
            key = "%s|%s" % (today, i)
            if at is not None and cur >= at and cur < at + 10 and key not in s["fired"]:
                s["fired"][key] = 1
                did.append(("reminder", r["text"]))
                al_chain.append(log or LOG_FILE, "reminder", {"text": r["text"]}, now=now)
                if speak:
                    try:
                        speak(((s["child"] + ", ") if s["child"] else "") + r["text"])
                    except Exception:
                        pass
        exp = _minutes(s["expected"])
        if exp is not None and cur >= exp and s["arrived_on"] != today and s["late_told_on"] != today and in_window(s, now):
            s["late_told_on"] = today
            did.append(("late", s["expected"]))
            al_chain.append(log or LOG_FILE, "not_home_yet", {"expected": s["expected"]}, now=now)
            if notify:
                try:
                    notify("%s is not home yet. Expected by %s." % (s["child"] or "Nobody", s["expected"]))
                except Exception:
                    pass
        s["fired"] = {k: v for k, v in s["fired"].items() if k.startswith(today)}
        _save(path or STATE_FILE, s)
        return did


def watcher(speak=None, notify=None, stop=None):
    while not (stop and stop.is_set()):
        try:
            tick(speak, notify)
        except Exception as e:
            print("LATCHKEY problem:", str(e)[:120], flush=True)
        for _ in range(30):
            if stop and stop.is_set():
                return
            time.sleep(1)


def view(path=None, log=None):
    s = _load(path or STATE_FILE)
    ok, count = al_chain.verify(log or LOG_FILE)
    return dict({k: s[k] for k in ("on", "child", "start", "end", "expected", "school_days", "reminders")}, arrived_today=s["arrived_on"] == _today(time.time()),
                log_ok=ok, log_count=count, log=al_chain.recent(log or LOG_FILE, 30))
