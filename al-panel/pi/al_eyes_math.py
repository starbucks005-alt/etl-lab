"""How bright AL's eyes are at a moment in time. Kept apart from al_eyes.py so it can be tested without the lights.

2026-10-16, Dr. O: "when we have her with others, nothing shows she is alive". So:
  speaking  the eyes pulse like a voice, about three times a second, with a little irregularity so it does not look like a blinking light
  quiet     the eyes swell slowly from about 60 percent to full and back every 5 seconds, so she looks awake
The level never goes above the cap (30 percent), whatever the pulse asks for."""
import math

CAP = 0.30


def eye_level(d, t, breathe=True):
    base = max(0.0, min(CAP, float(d.get("level", 0.12))))
    if d.get("speaking"):
        hi = min(CAP, max(base * 1.8, base + 0.08))
        lo = base * 0.45
        # two waves of slightly different speed, so the pulse wanders the way speech does
        w = 0.6 * math.sin(2 * math.pi * 2.9 * t) + 0.4 * math.sin(2 * math.pi * 1.7 * t + 1.3)
        x = (w + 1.0) / 2.0
        return max(0.0, min(CAP, lo + (hi - lo) * x))
    if breathe:
        # 2026-10-16: the first try (10 percent) could not be seen on the rings. Now she swells from about 60 percent up to her usual brightness and back, every 5 seconds
        return max(0.0, min(CAP, base * (0.60 + 0.40 * (0.5 + 0.5 * math.sin(2 * math.pi * t / 5.0)))))
    return base


def strip_frame(n, t, speaking, speed=1.1, trail=0.28):
    """Brightness from 0 to 1 for each light of a strip, 2026-10-16, Dr. O, for the Guardians: a bright spot that sweeps back and forth
    while they speak, with a soft tail behind it (the voice box of an old television car). Quiet, the strip is dark.
    speed is sweeps per second (one sweep is one way); trail is how much of the strip the tail covers."""
    if not speaking or n <= 0:
        return [0.0] * max(0, n)
    if n == 1:
        return [1.0]
    ph = (t * speed) % 2.0
    pos = (ph if ph <= 1.0 else 2.0 - ph) * (n - 1)          # 0 to n-1 and back
    direction = 1.0 if ph <= 1.0 else -1.0
    out = []
    for i in range(n):
        behind = (pos - i) * direction                        # how far behind the spot this light is
        if behind < 0:
            v = max(0.0, 1.0 - abs(behind) / 1.4)             # a little glow ahead of it
        else:
            v = max(0.0, 1.0 - behind / max(1.0, trail * n)) ** 2
        out.append(max(0.0, min(1.0, v)))
    return out
