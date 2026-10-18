#!/usr/bin/env python3
"""The artificial sun: a slow ramp from dark red to daylight on an LED strip behind acrylic. Runs on the Pi.

  python3 sunrise.py --dry-run           print the colors for a 30 minute sunrise, touches no pins
  sudo python3 sunrise.py --minutes 30   run it on the strip (rpi_ws281x needs root)

NOT TRIED ON REAL LEDS YET. The color steps are a first guess, picked to look like dawn. Change STEPS after you see it.
"""
import argparse
import sys
import time

LED_COUNT = 60        # how many LEDs are in the strip; change to match yours
LED_PIN = 18          # GPIO18, PWM. Not usable together with the Pi's own audio, so the speaker must be USB or a HAT
LED_BRIGHT_MAX = 255

# (fraction of the sunrise, red, green, blue). Between two rows the color slides.
STEPS = (
    (0.00, 0, 0, 0),
    (0.10, 40, 2, 0),         # a dark red glow
    (0.35, 200, 40, 0),       # deep orange
    (0.65, 255, 120, 20),     # amber
    (0.85, 255, 190, 110),    # warm white
    (1.00, 255, 235, 200),    # daylight
)


def color_at(fraction):
    """(r, g, b) for a point from 0.0 (dark) to 1.0 (full sun)."""
    f = min(1.0, max(0.0, fraction))
    for (f0, *c0), (f1, *c1) in zip(STEPS, STEPS[1:]):
        if f <= f1:
            k = 0.0 if f1 == f0 else (f - f0) / (f1 - f0)
            return tuple(round(a + (b - a) * k) for a, b in zip(c0, c1))
    return STEPS[-1][1:]


def run(minutes, dry=False):
    total = max(1.0, minutes * 60.0)
    strip = None
    if not dry:
        from rpi_ws281x import Color, PixelStrip
        strip = PixelStrip(LED_COUNT, LED_PIN, brightness=LED_BRIGHT_MAX)
        strip.begin()
    start = time.time()
    step = 1.0 if not dry else total / 10.0
    shown = 0.0
    while True:
        f = (time.time() - start) / total if not dry else shown / total
        r, g, b = color_at(f)
        if dry:
            print("%5.1f min  %3d %3d %3d" % (shown / 60.0, r, g, b))
            shown += step
            if shown > total:
                return
            continue
        for i in range(LED_COUNT):
            strip.setPixelColor(i, Color(r, g, b))
        strip.show()
        if f >= 1.0:
            return
        time.sleep(step)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=30)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    run(a.minutes, a.dry_run)
