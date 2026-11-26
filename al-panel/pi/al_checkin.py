#!/usr/bin/env python3
"""Check-in photos at the front desk (written 2026-11-26, Dr. O's Guardian skills, the concierge half).

When a visitor checks in with her, she can take their photo and keep it with that visit. Unlike Sentry, this is NOT silent: it goes through the same
gate as every ordinary photo, so she says "I am taking a photo now" first, and if she cannot say it, no photo is taken.
Off until the owner switches it on and ticks that they are responsible. Photos stay on her, in their own folder, visible only to the owner on the panel,
and delete themselves after the days the owner chose (3 to start). The owner can delete any one. Nothing is sent anywhere.
The log keeps the time and the photo name, never a face, a name or a sentence.
"""
import json
import os
import re
import time

try:
    import al_chain
except ImportError:
    al_chain = None

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(HERE, "checkin.json")
INDEX_FILE = os.path.join(HERE, "checkin_index.json")
LOG_FILE = os.path.join(HERE, "checkin_log.jsonl")
DIR = os.path.join(os.path.expanduser("~"), "al_checkin_photos")
DEFAULT_DAYS = 3
MAX_DAYS = 30
MAX_KEPT = 200
DELAY_SECONDS = 1.5          # let her finish her welcome before the photo line


def _load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _save(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)


def _log(kind, data, now=None, log=None):
    if al_chain:
        try:
            al_chain.append(log or LOG_FILE, kind, data, now=int(now) if now else None)
        except OSError:
            pass


def state(path=None):
    d = _load(path or STATE_FILE, {})
    return {"on": bool(d.get("on")) and bool(d.get("ack_t")), "ack_t": d.get("ack_t"), "days": max(1, min(MAX_DAYS, int(d.get("days") or DEFAULT_DAYS)))}


def set_on(on, ack=False, days=None, now=None, path=None, log=None):
    now = time.time() if now is None else now
    if on and not ack:
        raise ValueError("Tick the box to say you are responsible for check-in photos.")
    st = state(path)
    s = {"on": bool(on), "ack_t": int(now) if on else st["ack_t"], "days": max(1, min(MAX_DAYS, int(days))) if days else st["days"]}
    _save(path or STATE_FILE, s)
    _log("switched_on" if on else "switched_off", {"days": s["days"]}, now, log)
    return state(path)


def _index(index=None):
    d = _load(index or INDEX_FILE, [])
    return d if isinstance(d, list) else []


def _clean(s, n):
    return re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f]", "", str(s or ""))).strip()[:n]


def add(photo, name="", host="", now=None, index=None, log=None):
    """Remembers that this photo goes with this visit. Returns the entry."""
    now = time.time() if now is None else now
    items = _index(index)
    item = {"t": int(now), "photo": photo, "name": _clean(name, 60), "host": _clean(host, 80)}
    items.append(item)
    _save(index or INDEX_FILE, items[-MAX_KEPT:])
    _log("photo", {"photo": photo}, now, log)
    return item


def purge(now=None, path=None, folder=None, index=None, log=None):
    """Deletes photos older than the chosen days. Returns how many."""
    now = time.time() if now is None else now
    days = state(path)["days"]
    items = _index(index)
    keep, gone = [], []
    for i in items:
        (gone if now - i["t"] > days * 86400 else keep).append(i)
    for i in gone:
        try:
            os.remove(os.path.join(folder or DIR, i["photo"]))
        except OSError:
            pass
    if gone:
        _save(index or INDEX_FILE, keep)
        _log("purged", {"count": len(gone), "days": days}, now, log)
    return len(gone)


def delete(photo, folder=None, index=None, log=None):
    items = _index(index)
    rest = [i for i in items if i["photo"] != photo]
    if len(rest) == len(items):
        return False
    try:
        os.remove(os.path.join(folder or DIR, photo))
    except OSError:
        pass
    _save(index or INDEX_FILE, rest)
    _log("deleted", {"photo": photo}, None, log)
    return True


def view(now=None, path=None, index=None, folder=None, log=None):
    ok, n = al_chain.verify(log or LOG_FILE) if al_chain else (True, 0)
    st = state(path)
    items = []
    for i in reversed(_index(index)):
        items.append(dict(i, kept=os.path.isfile(os.path.join(folder or DIR, i["photo"]))))
    return {"on": st["on"], "ack_t": st["ack_t"], "days": st["days"], "photos": items, "max_days": MAX_DAYS, "log_ok": ok, "log_count": n}


def take_for_visit(name, host, take_photo, now=None, path=None, index=None, log=None, folder=None):
    """Called when a visit is logged. take_photo(folder) is the ordinary announced photo. Returns the entry, or None when off or the photo was not taken."""
    if not state(path)["on"]:
        return None
    purge(now, path, folder, index, log)
    r = take_photo(folder or DIR) or {}
    if not r.get("ok"):
        _log("not_taken", {"why": str(r.get("why", ""))[:80]}, now, log)
        return None
    return add(r["name"], name, host, now, index, log)
