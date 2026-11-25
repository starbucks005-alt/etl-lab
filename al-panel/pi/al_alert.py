#!/usr/bin/env python3
"""Alert tiers for the Guardian (written 2026-11-25, Dr. O: "Pulse or Strobe", silent if noise could put someone in danger).

Three tiers, each with its own look on the panel and on the red mouth strip:
  1 NOTICE   a line on the panel. No light, no sound. Things worth knowing.
  2 WATCH    the panel banner, plus the mouth strip breathes slowly (a pulse). An unknown device, a changed item, a child not home.
  3 URGENT   the panel banner in red, plus the mouth strip flashes. Never more than 2 flashes a second.
             Only raised on purpose: by the owner from the panel, or by a source that is certain (a leak or a high CO2 reading).
Voice is off by default. A loud robot can put people in danger, so she shows the alert and stays quiet unless the owner ticks "Speak alerts aloud".
Alerts stay on the panel until the owner clears them. The pulse stops by itself after PULSE_MINUTES so a missed alert does not blink forever;
the banner stays. A flash never stops by itself.
Every raise and every clear goes in a hash chained log (al_chain), so the owner has a record that holds up.
The strip service (al_eyes.py) reads /tmp/al_alert.json, which this file writes: {"tier": 0 to 3}.
"""
import json
import math
import os
import threading
import time

try:
    import al_chain
except ImportError:                       # the log is a nicety, the alert is not
    al_chain = None

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(HERE, "alerts.json")
LOG_FILE = os.path.join(HERE, "alerts_log.jsonl")
LIGHT_FILE = "/tmp/al_alert.json"
PULSE_MINUTES = 15
MAX_FLASHES_PER_SECOND = 2
TIERS = {1: "notice", 2: "watch", 3: "urgent"}
_lock = threading.Lock()


def _load(path=None):
    try:
        with open(path or STATE_FILE, encoding="utf-8") as f:
            d = json.load(f)
        d.setdefault("speak", False)
        d["active"] = [a for a in d.get("active", []) if isinstance(a, dict) and a.get("tier") in TIERS]
        return d
    except (OSError, ValueError):
        return {"speak": False, "active": []}


def _save(d, path=None):
    p = path or STATE_FILE
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f)
    os.replace(tmp, p)


def _log(event, data, log=None):
    if al_chain:
        try:
            al_chain.append(log or LOG_FILE, event, data)
        except OSError:
            pass


def light_tier(d=None, now=None):
    """The tier the strip should show right now: 3 for any urgent, 2 for a watch still inside its pulse time, else 0."""
    d = d or _load()
    now = time.time() if now is None else now
    tier = 0
    for a in d["active"]:
        if a["tier"] == 3:
            return 3
        if a["tier"] == 2 and now - a["t"] <= PULSE_MINUTES * 60:
            tier = 2
    return tier


def write_light(d=None, now=None, light_file=None):
    """Tells the strip service. Quiet failure: no /tmp on a test machine is not an alert problem."""
    try:
        with open(light_file or LIGHT_FILE, "w") as f:
            json.dump({"tier": light_tier(d, now)}, f)
    except OSError:
        pass


def raise_alert(source, text, tier=2, speak=None, path=None, log=None, now=None, light_file=None):
    """Adds an alert, or refreshes the same one from the same source. speak(text) is only called when the owner switched voice on."""
    if tier not in TIERS:
        raise ValueError("tier must be 1, 2 or 3")
    now = time.time() if now is None else now
    text = str(text)[:200]
    source = str(source)[:40]
    with _lock:
        d = _load(path)
        for a in d["active"]:
            if a["source"] == source and a["text"] == text:
                a["tier"] = max(a["tier"], tier)
                a["t"] = now
                a["n"] = a.get("n", 1) + 1
                break
        else:
            a = {"id": "%d-%d" % (int(now * 1000), len(d["active"])), "source": source, "text": text, "tier": tier, "t": now, "n": 1}
            d["active"].append(a)
            d["active"] = d["active"][-30:]
        _save(d, path)
    _log("raise", {"source": source, "text": text, "tier": tier}, log)
    write_light(d, now, light_file)
    if speak and d.get("speak"):
        try:
            speak(text)
        except Exception:
            pass
    return a


def clear(alert_id=None, who="owner", path=None, log=None, now=None, light_file=None):
    """Clears one alert, or all of them when alert_id is None. Returns how many were cleared."""
    with _lock:
        d = _load(path)
        keep = [a for a in d["active"] if alert_id is not None and a["id"] != alert_id]
        gone = len(d["active"]) - len(keep)
        d["active"] = keep
        _save(d, path)
    if gone:
        _log("clear", {"id": alert_id or "all", "count": gone, "by": who}, log)
    write_light(d, now, light_file)
    return gone


def set_speak(on, path=None, log=None):
    with _lock:
        d = _load(path)
        d["speak"] = bool(on)
        _save(d, path)
    _log("speak_on" if on else "speak_off", {}, log)
    return bool(on)


def view(path=None, log=None, now=None):
    d = _load(path)
    now = time.time() if now is None else now
    act = sorted(d["active"], key=lambda a: (-a["tier"], -a["t"]))
    return {"speak": d["speak"], "tier": max([a["tier"] for a in act] or [0]), "light": light_tier(d, now),
            "active": [dict(a, name=TIERS[a["tier"]], age=int(now - a["t"])) for a in act],
            "log": al_chain.recent(log or LOG_FILE, 20) if al_chain else []}


def alert_frame(n, t, tier):
    """Brightness 0 to 1 for each light of the mouth strip. Tier 2 breathes (about 3 seconds a breath), tier 3 flashes MAX_FLASHES_PER_SECOND times
    a second. Anything else is dark, and the caller lets the speaking sweep show instead."""
    if n <= 0 or tier not in (2, 3):
        return [0.0] * max(0, n)
    if tier == 3:
        on = (t * MAX_FLASHES_PER_SECOND * 2) % 2.0 < 1.0
        return [1.0 if on else 0.0] * n
    wave = (1 - math.cos(2 * math.pi * t / 3.0)) / 2
    return [0.12 + 0.88 * wave] * n
