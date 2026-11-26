#!/usr/bin/env python3
"""Words and sounds that may mean someone needs help (written 2026-11-26, Dr. O's "hostile conversation" item, built the honest way).

She does NOT decide that a person or a conversation is hostile. That is a guess about people, and a wrong guess accuses someone.
What she can honestly do is notice two things in the speech she was already listening to:
  1. certain plain words said aloud, such as "get off me", "leave me alone", "call 911", or a lone "help" or "stop it"
  2. a long stretch of very loud sound
She then raises a SILENT alert on the owner's panel, saying exactly what she heard and nothing more ("I only heard the words, I cannot tell what is happening").
Her anomaly rule (Dr. O): silent by default. Whether alerts are spoken aloud is the owner's single "Speak alerts aloud" switch, which this does not touch.
If the owner allows recording, a distress alert also starts a short recording period (al_record.py).

Off until the owner switches it on and ticks that they are responsible. Nothing here listens to anything new, and it keeps no audio and no sentences:
the log holds the time, the tier and the matched phrase, never the rest of what was said.
The loudness limit has NOT been tuned on her microphone yet (the words are reliable, the loudness is a rough first guess), so loudness alone only ever makes a tier 1 notice.
"""
import array
import json
import os
import re
import time
import wave

try:
    import al_chain
except ImportError:
    al_chain = None

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(HERE, "distress.json")
LOG_FILE = os.path.join(HERE, "distress_log.jsonl")
GAP_SECONDS = 60                # one alert a minute at most
FRAME_SECONDS = 0.1
LOUD_MIN = 3500                 # a first guess, not tuned: never below this, whatever the room
LOUD_TIMES_ROOM = 2.5           # and at least this many times the room's usual level
LOUD_SECONDS = 3.0              # in an unbroken stretch
RECORD_MINUTES = 5

# whole sentence, after dropping punctuation, "please" and "oh"
WHOLE = ("help", "help me", "stop", "stop it", "no stop", "let me go", "somebody help", "someone help", "help me please", "somebody help me", "someone help me",
         "call 911", "call the police", "call the cops", "call 9 1 1")
# anywhere in a sentence: only wordings that are not an ordinary request for directions or help
INSIDE = ("get off me", "get off of me", "let go of me", "leave me alone", "don't touch me", "do not touch me", "get away from me", "stay away from me",
          "i'm calling the police", "i am calling the police", "i'm calling 911", "i am calling 911", "someone call 911", "somebody call 911", "someone call the police", "somebody call the police")
_last = [0.0]


def _words(text):
    t = re.sub(r"[^a-z0-9' ]+", " ", (text or "").lower().replace("’", "'"))
    t = re.sub(r"\b(please|oh|hey|no)\b", " ", t) if t.strip() not in ("no stop",) else t
    return re.sub(r"\s+", " ", t).strip()


def phrase_in(text):
    """The phrase that matched, or None."""
    t = _words(text)
    if not t:
        return None
    if t in WHOLE:
        return t
    for p in INSIDE:
        if re.search(r"\b" + re.escape(p) + r"\b", t):
            return p
    return None


def loud_seconds(path, floor=None, thr=None):
    """The longest unbroken stretch, in seconds, of a clip that is both loud in itself and loud for this room. 0 when the clip cannot be read."""
    try:
        with wave.open(path, "rb") as w:
            rate = w.getframerate() or 16000
            ch = w.getnchannels() or 1
            pcm = array.array("h")
            pcm.frombytes(w.readframes(w.getnframes()))
    except Exception:
        return 0.0
    if ch > 1:
        pcm = pcm[::ch]
    n = max(1, int(rate * FRAME_SECONDS))
    limit = thr if thr is not None else max(LOUD_MIN, LOUD_TIMES_ROOM * (floor or 0))
    best = run = 0
    for i in range(0, len(pcm) - n + 1, n):
        seg = pcm[i:i + n]
        rms = (sum(x * x for x in seg) / float(n)) ** 0.5
        run = run + 1 if rms >= limit else 0
        best = max(best, run)
    return round(best * FRAME_SECONDS, 1)


# ---------- the owner's switch ----------
def state(path=None):
    try:
        with open(path or STATE_FILE, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        d = {}
    return {"on": bool(d.get("on")) and bool(d.get("ack_t")), "ack_t": d.get("ack_t")}


def set_on(on, ack=False, now=None, path=None, log=None):
    now = time.time() if now is None else now
    if on and not ack:
        raise ValueError("Tick the box to say you are responsible for this.")
    s = {"on": bool(on), "ack_t": int(now) if on else state(path)["ack_t"]}
    with open(path or STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(s, f)
    if al_chain:
        try:
            al_chain.append(log or LOG_FILE, "switched_on" if on else "switched_off", {}, now=int(now))
        except OSError:
            pass
    return state(path)


# ---------- the check ----------
def check(path_to_clip, words, floor=None, now=None, state_path=None, log=None):
    """Called with each clip she listened to and the words found in it. Returns None, or {tier, phrase, loud, text}. Rate limited."""
    now = time.time() if now is None else now
    if not state(state_path)["on"]:
        return None
    ph = phrase_in(words)
    loud = loud_seconds(path_to_clip, floor) if path_to_clip else 0.0
    sustained = loud >= LOUD_SECONDS
    if not ph and not sustained:
        return None
    if now - _last[0] < GAP_SECONDS:
        return None
    _last[0] = now
    if ph:
        tier = 2
        text = "Words that may mean someone needs help were heard: \"%s\"%s. I only heard the words, I cannot tell what is happening." % (ph, " and loud sound for %d seconds" % round(loud) if sustained else "")
    else:
        tier = 1
        text = "A long stretch of loud sound was heard, about %d seconds. I cannot tell what it was." % round(loud)
    if al_chain:
        try:
            al_chain.append(log or LOG_FILE, "heard", {"tier": tier, "phrase": ph or "", "loud": loud}, now=int(now))
        except OSError:
            pass
    return {"tier": tier, "phrase": ph, "loud": loud, "text": text}


def act(result, raise_alert=None, start_recording=None):
    """Silent: a panel alert, and a short recording period when the owner has allowed recording."""
    if not result:
        return
    if raise_alert:
        raise_alert("Distress words" if result["phrase"] else "Loud sound", result["text"], result["tier"])
    if start_recording and result["tier"] >= 2:
        start_recording("distress words", RECORD_MINUTES)


def view(state_path=None, log=None):
    ok, n = al_chain.verify(log or LOG_FILE) if al_chain else (True, 0)
    s = state(state_path)
    return {"on": s["on"], "ack_t": s["ack_t"], "log_ok": ok, "log_count": n, "log": al_chain.recent(log or LOG_FILE, 15) if al_chain else []}
