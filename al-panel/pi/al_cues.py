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


if __name__ == "__main__":
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
