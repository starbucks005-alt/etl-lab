"""Registered voices for Elle (Astra Lite), 2026-10-23.

Dr. O: "I want them to know my voice. Registered regular voices, their owners." This is the part that remembers a voice and
compares a new clip with the voices that were registered. It is OFF until switched on in the panel, and with nobody registered
it does nothing.

What is kept: for each person a name and a voice fingerprint, a list of numbers. NEVER the recording: the clip is deleted as
soon as the fingerprint is made. Everything stays on the Pi in voices.json beside this file, which is kept out of git, and none
of it is sent anywhere. "Forget" in the panel removes one person.

A person is registered only if the clip starts with them agreeing out loud (CONSENT_LINE). The words are checked by the same
listening service the robot already uses, so a recording of someone who never agreed is turned away.

It only chooses a greeting. It is not a lock: anyone with a recording of a voice could fool it, so nothing important may depend on it.

NOT TRIED on the real robot or with the real voice model. The model is Resemblyzer, installed once on the Pi (see the README). The two
numbers below, MATCH_MIN and MARGIN, are guesses to be tuned by listening to what the log says (lines starting VOICE).
"""
import json
import math
import os
import re
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
VOICE_FILE = os.path.join(HERE, "voices.json")
LOCK = threading.Lock()

MATCH_MIN = 0.78            # how alike a voice must be to a registered one (1.0 is identical). A guess: tune it from the log.
MARGIN = 0.06               # and how far ahead of the next registered voice, so two similar voices are not mixed up
ENROLL_SECONDS = 2.0        # the least speech that makes a fingerprint when registering
HEAR_SECONDS = 1.2          # the least speech worth comparing when she is listening
CONSENT_LINE = "I agree that this robot may remember my voice."

EMBEDDER = None             # tests put a stand-in here. None means the real model, loaded the first time it is needed.
_encoder = None


def _load():
    try:
        with open(VOICE_FILE) as f:
            d = json.load(f)
        if isinstance(d, dict) and isinstance(d.get("people"), list):
            return {"on": bool(d.get("on")), "people": [p for p in d["people"] if isinstance(p, dict) and p.get("name") and isinstance(p.get("vec"), list)]}
    except (OSError, ValueError):
        pass
    return {"on": False, "people": []}


def _save(d):
    tmp = VOICE_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(d, f)
    os.replace(tmp, VOICE_FILE)


def clean_name(name):
    """A plain name: letters, spaces, apostrophes and hyphens, up to 40. Anything else is refused (returns "")."""
    n = re.sub(r"\s+", " ", str(name or "")).strip()
    return n[:40] if n and re.fullmatch(r"[^\W\d_][^\W\d_ '\-]*(?:[ '\-][^\W\d_]+)*", n) else ""


def is_on():
    return _load()["on"]


def set_on(flag):
    with LOCK:
        d = _load()
        d["on"] = bool(flag)
        _save(d)


def people():
    """Who is registered: names, how many clips each, and when. Never the fingerprints."""
    return [{"name": p["name"], "clips": int(p.get("clips", 1)), "created": p.get("created", "")} for p in _load()["people"]]


def forget(name):
    with LOCK:
        d = _load()
        keep = [p for p in d["people"] if p["name"].lower() != str(name or "").strip().lower()]
        changed = len(keep) != len(d["people"])
        if changed:
            d["people"] = keep
            _save(d)
        return changed


def consent_ok(words):
    """True if what was heard is the person agreeing. Speech to text gets names wrong, so the name is not checked, only the agreement."""
    t = re.sub(r"[^a-z ]", " ", str(words or "").lower())
    return "agree" in t and "remember" in t and "voice" in t


def ready():
    """(True, "") when a fingerprint can be made, else (False, why)."""
    if EMBEDDER is not None:
        return True, ""
    try:
        _model()
        return True, ""
    except Exception as e:
        return False, "The voice model is not installed on her yet (%s)." % str(e)[:80]


def _model():
    global _encoder
    if _encoder is None:
        from resemblyzer import VoiceEncoder           # installed once on the Pi, see the README
        _encoder = VoiceEncoder()
    return _encoder


def _norm(v):
    s = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / s for x in v]


def _dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def embed(path, min_seconds):
    """The fingerprint of the speech in a wav file, or ValueError if there is too little speech."""
    if EMBEDDER is not None:
        return _norm(EMBEDDER(path))
    from resemblyzer import preprocess_wav
    wav = preprocess_wav(path)                          # mono, 16 kHz, with the silences trimmed away
    if len(wav) / 16000.0 < min_seconds:
        raise ValueError("I heard less than %.0f seconds of speech." % min_seconds)
    return _norm([float(x) for x in _model().embed_utterance(wav)])


def enroll(name, path):
    """Register a voice, or add a clip to one already registered. Returns how many clips that person now has."""
    name = clean_name(name)
    if not name:
        raise ValueError("That is not a name I can keep.")
    vec = embed(path, ENROLL_SECONDS)
    with LOCK:
        d = _load()
        for p in d["people"]:
            if p["name"].lower() == name.lower():
                n = int(p.get("clips", 1))
                p["vec"] = _norm([(a * n + b) / (n + 1) for a, b in zip(p["vec"], vec)])
                p["clips"] = n + 1
                _save(d)
                return n + 1
        d["people"].append({"name": name, "vec": vec, "clips": 1, "created": time.strftime("%Y-%m-%d")})
        _save(d)
        return 1


def identify(path):
    """Compare a clip with the registered voices. Returns {"name": name or None, "best": score}, or None if nobody is registered
    or there was too little speech to compare. A name is given only if the match is close AND clearly ahead of the next voice."""
    d = _load()
    if not d["people"]:
        return None
    try:
        vec = embed(path, HEAR_SECONDS)
    except ValueError:
        return None
    scored = sorted(((_dot(vec, p["vec"]), p["name"]) for p in d["people"]), reverse=True)
    best, name = scored[0]
    second = scored[1][0] if len(scored) > 1 else -1.0
    ok = best >= MATCH_MIN and (len(scored) == 1 or best - second >= MARGIN)
    return {"name": name if ok else None, "best": round(best, 3)}
