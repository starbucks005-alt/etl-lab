#!/usr/bin/env python3
"""The Guardian's asset watch (written 2026-11-24, Dr. O's Guardian skills: watch the equipment, and notice when something is moved or taken).

The owner sets her up once:
  1. She takes a reference photo of the room (announced out loud, like every photo).
  2. On the panel the owner draws a box around each item to watch and names it: "Laptop cart", "Projector".
Then she checks the room whenever asked, and on a schedule if the owner switches that on. Each check is one announced photo. For every box she compares
what she sees now with the reference and says what changed: "Projector: looks the same", or "Laptop cart: it changed". A change is photographed, shown on
the panel with the box marked, and written to a log that shows if anyone alters it (al_chain.py).
She tells a change in the item from a change in the room's light, so a cloud does not set her off. If the camera is moved she tells the owner to take a fresh reference.
Everything stays on this robot.
"""
import json
import os
import re
import shutil
import threading
import time

from PIL import Image, ImageChops, ImageStat

import al_chain

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(HERE, "assets.json")
REF_FILE = os.path.join(HERE, "asset_reference.jpg")
LOG_FILE = os.path.join(HERE, "assets_log.jsonl")
THRESHOLD = 22.0        # average difference, out of 255, after the light is evened out
LIGHT_SHIFT = 38.0      # when the whole picture shifts by this much, it is the light and not the item
SIZE = (48, 48)
MAX_ITEMS = 12
INTERVALS = (0, 5, 15, 30, 60)      # minutes; 0 is only when asked
_lock = threading.Lock()


def _load(path):
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        d = {}
    items = [i for i in d.get("items", []) if isinstance(i, dict)]
    return {"items": items, "interval": int(d.get("interval") or 0), "ref_at": float(d.get("ref_at") or 0), "last_check": float(d.get("last_check") or 0),
            "last": d.get("last", [])}


def _save(path, d):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f)
    os.replace(tmp, path)


def state(path=None):
    return _load(path or STATE_FILE)


def _clean_name(n):
    return re.sub(r"[^A-Za-z0-9 .'&-]", "", str(n or "")).strip()[:40]


def set_items(items, path=None, log=None):
    """items: [{name, x, y, w, h}] as fractions of the picture (0 to 1)."""
    clean = []
    for i in (items or [])[:MAX_ITEMS]:
        try:
            x, y, w, h = (max(0.0, min(1.0, float(i[k]))) for k in ("x", "y", "w", "h"))
        except (KeyError, TypeError, ValueError):
            continue
        name = _clean_name(i.get("name"))
        if name and w > 0.01 and h > 0.01:
            clean.append({"name": name, "x": x, "y": y, "w": min(w, 1 - x), "h": min(h, 1 - y)})
    s = _load(path or STATE_FILE)
    s["items"] = clean
    _save(path or STATE_FILE, s)
    al_chain.append(log or LOG_FILE, "items_set", {"items": [c["name"] for c in clean]})
    return s


def set_interval(minutes, path=None, log=None):
    m = int(minutes)
    if m not in INTERVALS:
        raise ValueError("Pick one of: " + ", ".join(str(i) for i in INTERVALS))
    s = _load(path or STATE_FILE)
    s["interval"] = m
    _save(path or STATE_FILE, s)
    al_chain.append(log or LOG_FILE, "interval", {"minutes": m})
    return s


def _crop(img, it):
    w, h = img.size
    box = (int(it["x"] * w), int(it["y"] * h), max(int(it["x"] * w) + 2, int((it["x"] + it["w"]) * w)), max(int(it["y"] * h) + 2, int((it["y"] + it["h"]) * h)))
    return img.crop(box).convert("L").resize(SIZE)


def _mean(img):
    return ImageStat.Stat(img).mean[0]


def compare(ref_path, now_path, items):
    """[{name, diff, changed}] and the whole picture's light shift. The light is evened out per box before comparing."""
    ref, now = Image.open(ref_path), Image.open(now_path)
    if ref.size != now.size:
        now = now.resize(ref.size)
    shift = _mean(now.convert("L").resize(SIZE)) - _mean(ref.convert("L").resize(SIZE))      # how much the whole room's light moved
    light = abs(shift)
    out = []
    for it in items:
        a, b = _crop(ref, it), _crop(now, it)
        b2 = b.point(lambda p, s=shift: max(0, min(255, int(p - s))))
        diff = _mean(ImageChops.difference(a, b2))
        out.append({"name": it["name"], "diff": round(diff, 1), "changed": diff > THRESHOLD})
    return out, round(light, 1)


def take_reference(photo_fn, path=None, ref_path=None, log=None, photo_dir=None):
    """photo_fn() is the announced, gated photo: returns {ok, name} or {ok False, why}."""
    r = photo_fn() or {}
    if not r.get("ok"):
        return {"ok": False, "why": r.get("why", "no photo")}
    src = os.path.join(photo_dir, r["name"])
    shutil.copyfile(src, ref_path or REF_FILE)
    s = _load(path or STATE_FILE)
    s["ref_at"] = time.time()
    s["last"] = []
    _save(path or STATE_FILE, s)
    al_chain.append(log or LOG_FILE, "reference_taken", {"photo": r["name"]})
    return {"ok": True}


def check(photo_fn, photo_dir, path=None, ref_path=None, log=None, on_change=None):
    """One announced photo, compared box by box with the reference. Returns {ok, results, light, photo} or {ok False, why}."""
    if not _lock.acquire(blocking=False):
        return {"ok": False, "why": "a check is already running"}
    try:
        ref = ref_path or REF_FILE
        s = _load(path or STATE_FILE)
        if not os.path.exists(ref):
            return {"ok": False, "why": "take the reference photo first"}
        if not s["items"]:
            return {"ok": False, "why": "draw a box around at least one item first"}
        r = photo_fn() or {}
        if not r.get("ok"):
            return {"ok": False, "why": r.get("why", "no photo")}
        results, light = compare(ref, os.path.join(photo_dir, r["name"]), s["items"])
        s["last_check"] = time.time()
        s["last"] = results
        _save(path or STATE_FILE, s)
        if light > LIGHT_SHIFT:
            al_chain.append(log or LOG_FILE, "check", {"photo": r["name"], "note": "the light changed a lot, so the camera view may have moved"})
            return {"ok": True, "results": results, "light": light, "photo": r["name"], "moved": True}
        changed = [x["name"] for x in results if x["changed"]]
        al_chain.append(log or LOG_FILE, "change" if changed else "check", {"photo": r["name"], "changed": changed})
        if changed and on_change:
            try:
                on_change(changed, r["name"])
            except Exception:
                pass
        return {"ok": True, "results": results, "light": light, "photo": r["name"], "moved": False}
    finally:
        _lock.release()


def watcher(do_check, stop=None):
    """Background loop: when an interval is set, runs do_check() that often."""
    while not (stop and stop.is_set()):
        try:
            s = _load(STATE_FILE)
            if s["interval"] and os.path.exists(REF_FILE) and s["items"] and time.time() - s["last_check"] >= s["interval"] * 60:
                do_check()
        except Exception as e:
            print("ASSETS problem:", str(e)[:120], flush=True)
        for _ in range(30):
            if stop and stop.is_set():
                return
            time.sleep(1)


def view(path=None, ref_path=None, log=None):
    s = _load(path or STATE_FILE)
    ok, count = al_chain.verify(log or LOG_FILE)
    return {"items": s["items"], "interval": s["interval"], "intervals": list(INTERVALS), "has_reference": os.path.exists(ref_path or REF_FILE),
            "ref_at": s["ref_at"], "last_check": s["last_check"], "last": s["last"], "log_ok": ok, "log_count": count, "log": al_chain.recent(log or LOG_FILE, 30)}
