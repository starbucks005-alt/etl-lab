#!/usr/bin/env python3
"""Small sounds around her speech, one set for each robot (Dr. O, 2026-10-30).

  breath      A.L.I.C.E.: a soft breath in just before she speaks. Nothing else, and nothing playing while she is idle.
  mechanical  Astra 9 and Ted: a relay click before she speaks, a servo tick between sentences, a short soft tone after.
  none        Astra-9 Lite and anything not set: no sounds.

Which set a robot uses: a file called cue_set.txt next to the server holding the word breath, mechanical or none. With no file, the Pi that has
index_alice.html (A.L.I.C.E.) uses breath and every other Pi uses none, so Astra-9 Lite sounds exactly as before.
The sounds are made by this file with plain Python (no downloads, no recordings), written to the folder `cues` next to it the first time they are needed.
NOT HEARD YET: made on a computer with no speakers. Listen to them before trusting them: python3 al_cues.py preview
"""
import math
import os
import random
import struct
import subprocess
import sys
import threading
import time
import wave

HERE = os.path.dirname(os.path.abspath(__file__))
CUE_DIR = os.path.join(HERE, "cues")
SR = 22050

# which sound for which moment, in each set
SETS = {
    "breath": {"before": ["breath_in_1", "breath_in_2", "breath_in_3"]},
    "mechanical": {"before": ["relay_1", "relay_2", "relay_3"],
                   "between": ["servo_1", "servo_2", "servo_3"],
                   "after": ["tone_1", "tone_2", "tone_3"]},
    "none": {},
}


def _lowpass(x, fc):
    a = 1.0 - math.exp(-2.0 * math.pi * fc / SR)
    y, s = [], 0.0
    for v in x:
        s += a * (v - s)
        y.append(s)
    return y


def _breath(seed, dur):
    rnd = random.Random(seed)
    n = int(SR * dur)
    noise = [rnd.uniform(-1, 1) for _ in range(n)]
    band = [a - b for a, b in zip(_lowpass(noise, 2200 + 300 * (seed % 3)), _lowpass(noise, 350))]
    out = []
    for i, v in enumerate(band):
        t = i / n
        env = math.sin(math.pi * t / 0.62) ** 2 if t < 0.62 else math.cos(math.pi * (t - 0.62) / 0.76) ** 2
        out.append(v * env)
    return _norm(out, 0.10)                   # about 20 dB below the top, on purpose: it must be a hint, not a sound effect


def _relay(seed):
    rnd = random.Random(seed)
    n = int(SR * 0.16)
    out = [0.0] * n

    def click(at, amp, tau):
        s0 = int(SR * at)
        for i in range(int(SR * 0.02)):
            if s0 + i < n:
                out[s0 + i] += amp * rnd.uniform(-1, 1) * math.exp(-i / (SR * tau))
    click(0.0, 0.9, 0.0008)
    click(0.012 + 0.003 * (seed % 3), 0.5, 0.0006)
    for i in range(int(SR * 0.05)):                                 # a low thump under it
        out[i] += 0.4 * math.sin(2 * math.pi * (85 + 10 * seed) * i / SR) * math.exp(-i / (SR * 0.012))
    return _norm(out, 0.30)


def _servo(seed):
    rnd = random.Random(seed)
    pulses = 4 + seed % 3
    out = []
    for p in range(pulses):
        f = 1100 + 120 * seed + rnd.uniform(-60, 60)
        for i in range(int(SR * 0.008)):
            ph = (i * f / SR) % 1.0
            out.append((1.0 if ph < 0.5 else -1.0) * 0.5 * math.sin(math.pi * i / (SR * 0.008)))
        out.extend([0.0] * int(SR * 0.012))
    return _norm(out, 0.14)


def _tone(seed):
    f1, f2 = [(2200, 2900), (1900, 2500), (2400, 3100)][seed % 3]
    out = []
    for f in (f1, f2):
        n = int(SR * 0.045)
        for i in range(n):
            out.append(math.sin(2 * math.pi * f * i / SR) * math.sin(math.pi * i / n) ** 0.5)
        out.extend([0.0] * int(SR * 0.025))
    return _norm(out, 0.10)


def _norm(x, peak):
    m = max(abs(v) for v in x) or 1.0
    return [v * peak / m for v in x]


def _make(name):
    kind, num = name.rsplit("_", 1)
    seed = int(num)
    if kind == "breath_in":
        return _breath(seed, (0.55, 0.68, 0.62)[(seed - 1) % 3])
    if kind == "relay":
        return _relay(seed)
    if kind == "servo":
        return _servo(seed)
    return _tone(seed)


def path_of(name):
    return os.path.join(CUE_DIR, "cue_%s_v1.wav" % name)


def ensure(name):
    p = path_of(name)
    if not os.path.exists(p):
        os.makedirs(CUE_DIR, exist_ok=True)
        data = _make(name)
        with wave.open(p, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, v)) * 32767)) for v in data))
    return p


def which_set(self_robot=False):
    """The set this robot uses. A file cue_set.txt wins; with none, A.L.I.C.E. breathes and every other robot has no sounds."""
    try:
        w = open(os.path.join(HERE, "cue_set.txt")).read().strip().lower()
        if w in SETS:
            return w
    except OSError:
        pass
    return "breath" if self_robot else "none"


def play(cue_set, moment, device, stop_event=None):
    """Play one sound for this moment ("before", "between" or "after") and come back when it has finished. Never raises: a missing sound is silence."""
    names = SETS.get(cue_set, {}).get(moment)
    if not names or (stop_event is not None and stop_event.is_set()):
        return False
    try:
        p = ensure(random.choice(names))
        subprocess.run(["aplay", "-q", "-D", device, p], check=False, timeout=4)
        return True
    except Exception as e:
        print("CUE problem:", e, flush=True)
        return False


# ---- breathing while she is idle, 2026-10-30, Dr. O: "like a recording that runs", pulsing with her eyes ----
# One recording of six breaths, each exactly 4.5 seconds, the same as the slow swell of her eyes in al_eyes_math.py (period 4.5 s on the clock, dimmest when
# time % 4.5 is 3.375). Each play starts when her eyes are dimmest, so she breathes in as they brighten and out as they dim. It is switched on by a file
# called idle_breath.txt next to the server holding the word on. With no file there is no idle breathing. It never plays while she speaks, while the
# microphone is open, or while any other sound is playing, and it starts again a couple of seconds after.
# NOT HEARD YET, and the match with the eyes is not seen yet: timing is by the clock, and aplay takes a moment to start (IDLE_LEAD below is a guess).
IDLE_PERIOD = 4.5
IDLE_TROUGH = 3.375          # time % IDLE_PERIOD at which the eyes are dimmest: sin(2 pi t / 4.5) is -1 there
IDLE_LEAD = 0.15             # seconds aplay needs to start making sound; adjust if she breathes in a little late or early
IDLE_QUIET = 0.18            # loudest point of the idle breath. 0.07 was too quiet for Dr. O and 0.35 too loud (2026-10-30). A file idle_level.txt next to the server overrides it (0.002 to 0.60)
IDLE_RESUME = 2.5            # seconds of quiet after speech or listening before she breathes again
def idle_level():
    try:
        return max(0.002, min(0.60, float(open(os.path.join(HERE, "idle_level.txt")).read().strip())))
    except (OSError, ValueError):
        return IDLE_QUIET


_idle = {"hold": 0, "resume_at": 0.0, "proc": None, "started": False}
_idle_lock = threading.Lock()


def _idle_samples(level=None):
    """Six breaths of 4.5 seconds each. 2026-10-30: the first try (one smooth swell of noise) sounded like ocean waves to Dr. O and to David, so this one
    has what a breath has that a wave does not: an in-breath that is thin and bright, a short stop, an out-breath that is lower and softer, a rest, and an
    uneven flutter in the air. The in-breath still rises until 2.25 s, when her eyes are brightest."""
    rnd = random.Random(11)
    cycle = int(SR * IDLE_PERIOD)
    out = []
    for c in range(6):
        noise = [rnd.uniform(-1, 1) for _ in range(cycle)]
        bright = [a - b for a, b in zip(_lowpass(noise, 3600 + 200 * (c % 3)), _lowpass(noise, 700))]      # in: thin, like air through the nose
        dark = [a - b for a, b in zip(_lowpass(noise, 1500 + 150 * (c % 3)), _lowpass(noise, 200))]        # out: lower and rounder
        flutter = _lowpass([rnd.uniform(-1, 1) for _ in range(cycle)], 9.0)                              # slow uneven wobble of the airflow
        fm = max(abs(v) for v in flutter) or 1.0
        amp_in = (0.9, 1.0, 0.85, 0.95, 0.8, 1.0)[c]
        for i in range(cycle):
            t = i / SR
            if 0.25 <= t < 2.25:                                    # in: starts quickly, then rises to its top as the eyes reach theirs
                x = (t - 0.25) / 2.0
                env = math.sin(math.pi / 2 * x) ** 1.4
                v = bright[i] * env * amp_in
            elif 2.55 <= t < 4.2:                                   # out: after a short stop, letting go and fading
                x = (t - 2.55) / 1.65
                env = 0.6 * math.exp(-2.6 * x) * min(1.0, x * 14.0)
                v = dark[i] * env
            else:
                v = 0.0                                             # the stop and the rest
            out.append(v * (1.0 + 0.45 * flutter[i] / fm))
    return _norm(out, level or idle_level())


def _write_wav(p, data):
    tmp = p + ".tmp"
    with wave.open(tmp, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, v)) * 32767)) for v in data))
    os.replace(tmp, p)


def idle_path():
    p = os.path.join(CUE_DIR, "cue_idle_breath_%05d_v5.wav" % int(round(idle_level() * 10000)))       # the level is in the name, so a new level makes a new file
    if not os.path.exists(p):
        os.makedirs(CUE_DIR, exist_ok=True)
        _write_wav(p, _idle_samples())
    return p


def idle_enabled():
    try:
        return open(os.path.join(HERE, "idle_breath.txt")).read().strip().lower() == "on"
    except OSError:
        return False


def _idle_stop():
    pr = _idle["proc"]
    _idle["proc"] = None
    if pr is not None and pr.poll() is None:
        try:
            pr.terminate()
            pr.wait(timeout=2)
        except Exception:
            try:
                pr.kill()
            except Exception:
                pass


def idle_hold():
    """Call before she speaks, listens or plays any other sound. Stops the idle breath at once and keeps it stopped until idle_release()."""
    with _idle_lock:
        _idle["hold"] += 1
        _idle_stop()


def idle_release():
    with _idle_lock:
        _idle["hold"] = max(0, _idle["hold"] - 1)
        _idle["resume_at"] = time.time() + IDLE_RESUME


def _other_sound():
    """True if something else is recording or playing (a program that was not started by the idle breath)."""
    mine = _idle["proc"].pid if _idle["proc"] is not None else -1
    try:
        if subprocess.run(["pgrep", "-x", "arecord"], capture_output=True, timeout=2).returncode == 0:
            return True
        r = subprocess.run(["pgrep", "-x", "aplay"], capture_output=True, text=True, timeout=2)
        return any(p.strip() and int(p) != mine for p in r.stdout.split())
    except Exception:
        return False


def _idle_loop(device):
    while True:
        try:
            time.sleep(0.2)
            with _idle_lock:
                pr = _idle["proc"]
                if pr is not None and pr.poll() is not None:
                    _idle["proc"] = pr = None
                busy = _idle["hold"] > 0 or time.time() < _idle["resume_at"]
            if not idle_enabled() or busy or _other_sound():
                with _idle_lock:
                    _idle_stop()
                continue
            if pr is not None:
                continue
            path = idle_path()
            wait = (IDLE_TROUGH - time.time()) % IDLE_PERIOD - IDLE_LEAD       # start when her eyes are dimmest, so the breath in rises with them
            if wait < 0:
                wait += IDLE_PERIOD
            time.sleep(wait)
            with _idle_lock:
                if _idle["hold"] == 0 and time.time() >= _idle["resume_at"] and _idle["proc"] is None:
                    _idle["proc"] = subprocess.Popen(["aplay", "-q", "-D", device, path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as e:
            print("CUE idle problem:", e, flush=True)
            time.sleep(5)


def idle_start(device):
    """Start the idle breathing thread once. It does nothing until idle_breath.txt says on."""
    if _idle["started"]:
        return
    _idle["started"] = True
    threading.Thread(target=_idle_loop, args=(device,), daemon=True).start()


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "idlefile":      # write the idle breath to the path given, to listen to it on any computer
        _write_wav(sys.argv[2], _idle_samples())
        print("wrote", sys.argv[2])
        sys.exit(0)
    for s in SETS.values():
        for names in s.values():
            for n in names:
                ensure(n)
    print("made the sounds in", CUE_DIR)
    if len(sys.argv) > 1 and sys.argv[1] == "preview":
        dev = sys.argv[2] if len(sys.argv) > 2 else "plughw:wm8960soundcard"
        for st in ("breath", "mechanical"):
            for mo in ("before", "between", "after"):
                if SETS[st].get(mo):
                    print(st, mo)
                    play(st, mo, dev)
                    import time
                    time.sleep(0.6)
