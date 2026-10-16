"""How bright AL's eyes are at a moment in time. Kept apart from al_eyes.py so it can be tested without the lights.

2026-10-16, Dr. O: "when we have her with others, nothing shows she is alive". So:
  speaking  the eyes pulse like a voice, about three times a second, with a little irregularity so it does not look like a blinking light
  quiet     the eyes breathe very slowly, a few percent either way, so she looks awake
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
        return max(0.0, min(CAP, base * (1.0 + 0.10 * math.sin(2 * math.pi * t / 6.0))))
    return base
