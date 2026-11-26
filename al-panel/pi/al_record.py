#!/usr/bin/env python3
"""The Guardian's conversation recording (written 2026-11-26, Dr. O's Guardian skills, the "record conversations when allowed" item).

What it is: while recording is ON, she keeps a copy of each stretch of speech she was already listening to. It adds no second microphone
and listens to nothing new. Nothing is recorded unless ALL of these are true:
  1. the owner switched recording on, on the panel, and ticked that they are responsible for how it is used (off by default), AND
  2. a recording period is running: the owner pressed Record on the panel, or armed Sentry saw motion (a short period starts).
A period always ends by itself (the owner picks the length, never longer than MAX_MINUTES).

Where it goes: her own storage only. Never uploaded, never sent to a model, never read by her. Only the owner can play or delete a clip on the panel.
Clips delete themselves after the number of days the owner chose (7 to start), the space is capped, and the log (id, time, length, why) never holds the words.
If anyone asks whether she is recording she answers truthfully, from this file, before any model is asked.
She also says the truth about the speech service: to understand people at all, what she hears is sent to an online speech service, saved or not.

NOT built, on purpose: deciding that a conversation is "hostile". Guessing from tone or words gives false accusations.
Whether to post a notice that recording may happen is the owner's decision, and the law on recording other people's conversations is the owner's to check.
"""
import json
import os
import re
import shutil
import time
import wave

try:
    import al_chain
except ImportError:
    al_chain = None

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(HERE, "record.json")
DIR = os.path.join(HERE, "recordings")
INDEX_FILE = os.path.join(HERE, "recordings.json")
LOG_FILE = os.path.join(HERE, "record_log.jsonl")
DEFAULT_DAYS = 7
MAX_DAYS = 30
MAX_MINUTES = 60
SENTRY_MINUTES = 5
MAX_CLIPS = 300
MAX_BYTES = 300 * 1024 * 1024
MIN_FREE_FRACTION = 0.10
ASK_RE = re.compile(r"\b(are you (?:currently |now )?(?:recording|taping|taking (?:a )?recording)|is (?:this|that|the (?:room|conversation)|anything) (?:being )?(?:recorded|taped)|(?:am i|are we) being (?:recorded|taped)|(?:are you|is it) (?:recording|saving) (?:me|us|this|anything|audio|what)|do you record)\b", re.I)


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
        except (OSError, TypeError):
            try:
                al_chain.append(log or LOG_FILE, kind, data)
            except OSError:
                pass


def state(path=None):
    d = _load(path or STATE_FILE, {})
    return {"allowed": bool(d.get("allowed")), "ack_t": d.get("ack_t"), "days": int(d.get("days") or DEFAULT_DAYS), "until": float(d.get("until") or 0), "reason": d.get("reason", "")}


def _put(st, path=None):
    _save(path or STATE_FILE, st)


def set_allowed(on, ack=False, days=None, path=None, log=None, now=None):
    """The owner's switch. Turning it ON needs the responsibility tick. Turning it OFF also ends any recording period."""
    now = time.time() if now is None else now
    st = state(path)
    if on:
        if not ack:
            raise ValueError("Tick the box to say you are responsible for how recording is used.")
        st["allowed"], st["ack_t"] = True, int(now)
    else:
        st["allowed"], st["until"], st["reason"] = False, 0, ""
    if days is not None:
        st["days"] = max(1, min(MAX_DAYS, int(days)))
    _put(st, path)
    _log("allowed" if on else "not_allowed", {"days": st["days"]}, now, log)
    return st


def set_days(days, path=None):
    st = state(path)
    st["days"] = max(1, min(MAX_DAYS, int(days)))
    _put(st, path)
    return st


def is_on(now=None, path=None):
    now = time.time() if now is None else now
    st = state(path)
    return st["allowed"] and st["until"] > now


def start(reason, minutes=10, now=None, path=None, log=None):
    """Begins a recording period. Returns True, or False when recording is not allowed (nothing happens then)."""
    now = time.time() if now is None else now
    st = state(path)
    if not st["allowed"]:
        return False
    minutes = max(1, min(MAX_MINUTES, int(minutes)))
    st["until"] = max(st["until"], now + minutes * 60)
    st["reason"] = str(reason)[:40]
    _put(st, path)
    _log("started", {"reason": st["reason"], "minutes": minutes}, now, log)
    return True


def stop(path=None, log=None, now=None):
    st = state(path)
    was = st["until"] > (time.time() if now is None else now)
    st["until"], st["reason"] = 0, ""
    _put(st, path)
    if was:
        _log("stopped", {}, now, log)
    return was


# ---------- the clips ----------
def _index(index=None):
    d = _load(index or INDEX_FILE, [])
    return d if isinstance(d, list) else []


def _free_fraction(folder):
    try:
        u = shutil.disk_usage(folder)
        return u.free / u.total
    except OSError:
        return 1.0


def _seconds(path):
    try:
        with wave.open(path, "rb") as w:
            return round(w.getnframes() / float(w.getframerate() or 1), 1)
    except Exception:
        return 0.0


def keep(src, now=None, path=None, folder=None, index=None, log=None, free=None):
    """Called with each stretch of speech she heard. Copies it only while a period is running. Returns the clip id, or None."""
    now = time.time() if now is None else now
    if not is_on(now, path):
        return None
    folder = folder or DIR
    try:
        os.makedirs(folder, exist_ok=True)
    except OSError:
        return None
    purge(now, path, folder, index, log)
    items = _index(index)
    size = sum(i.get("bytes", 0) for i in items)
    ff = free if free is not None else _free_fraction(folder)
    try:
        add = os.path.getsize(src)
    except OSError:
        return None
    if len(items) >= MAX_CLIPS or size + add > MAX_BYTES or ff < MIN_FREE_FRACTION:
        _log("full", {"clips": len(items)}, now, log)
        return None
    cid = "r%d" % (max([int(i["id"][1:]) for i in items] or [0]) + 1)
    name = cid + ".wav"
    try:
        shutil.copyfile(src, os.path.join(folder, name))
        os.chmod(os.path.join(folder, name), 0o600)
    except OSError:
        return None
    st = state(path)
    items.append({"id": cid, "file": name, "t": int(now), "seconds": _seconds(os.path.join(folder, name)), "bytes": add, "reason": st["reason"]})
    _save(index or INDEX_FILE, items)
    _log("clip", {"id": cid, "seconds": items[-1]["seconds"], "reason": st["reason"]}, now, log)
    return cid


def purge(now=None, path=None, folder=None, index=None, log=None):
    """Deletes clips older than the chosen days. Returns how many."""
    now = time.time() if now is None else now
    folder = folder or DIR
    days = state(path)["days"]
    items = _index(index)
    keep_, gone = [], []
    for i in items:
        (gone if now - i["t"] > days * 86400 else keep_).append(i)
    for i in gone:
        try:
            os.remove(os.path.join(folder, i["file"]))
        except OSError:
            pass
    if gone:
        _save(index or INDEX_FILE, keep_)
        _log("purged", {"count": len(gone), "days": days}, now, log)
    return len(gone)


def clips(index=None):
    return list(reversed(_index(index)))


def audio_path(cid, folder=None, index=None):
    for i in _index(index):
        if i["id"] == cid:
            p = os.path.join(folder or DIR, i["file"])
            return p if os.path.isfile(p) else None
    return None


def delete(cid, folder=None, index=None, log=None):
    items = _index(index)
    rest = [i for i in items if i["id"] != cid]
    if len(rest) == len(items):
        return False
    for i in items:
        if i["id"] == cid:
            try:
                os.remove(os.path.join(folder or DIR, i["file"]))
            except OSError:
                pass
    _save(index or INDEX_FILE, rest)
    _log("deleted", {"id": cid}, None, log)
    return True


def delete_all(folder=None, index=None, log=None):
    n = 0
    for i in _index(index):
        n += 1 if delete(i["id"], folder, index, log) else 0
    return n


def view(now=None, path=None, index=None, log=None):
    now = time.time() if now is None else now
    st = state(path)
    ok, n = al_chain.verify(log or LOG_FILE) if al_chain else (True, 0)
    items = clips(index)
    return {"allowed": st["allowed"], "ack_t": st["ack_t"], "days": st["days"], "recording": st["allowed"] and st["until"] > now,
            "left": max(0, int(st["until"] - now)) if st["allowed"] else 0, "reason": st["reason"], "clips": items,
            "count": len(items), "max_clips": MAX_CLIPS, "max_days": MAX_DAYS, "max_minutes": MAX_MINUTES, "log_ok": ok, "log_count": n}


# ---------- she is asked ----------
def asked(text):
    return bool(ASK_RE.search(text or ""))


def reply(text, now=None, path=None):
    """(spoken, shown) when someone asks whether she is recording. Always the truth from the state, never from the model."""
    if not asked(text):
        return None
    now = time.time() if now is None else now
    st = state(path)
    speech = " To understand people, what I hear is sent to an online speech service, whether or not I am saving anything."
    if st["allowed"] and st["until"] > now:
        s = ("Yes. I am saving the speech I hear in this room as audio on my own storage. Only my owner can play it, it is never sent anywhere from me, and it is deleted after %d day%s." % (st["days"], "" if st["days"] == 1 else "s")) + speech
    else:
        s = "No. I am not saving any audio right now." + speech
    return s, s
