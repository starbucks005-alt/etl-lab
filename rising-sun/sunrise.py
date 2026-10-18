#!/usr/bin/env python3
"""The sunrise colors, kept here so they can be previewed and tested on any computer. The same table is in sunrise.ino, which is what runs the strip.

  python3 sunrise.py            print the colors for a 30 minute sunrise
"""
import argparse


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


def preview(minutes):
    """Print the colors for a sunrise of this many minutes, ten rows. Touches no hardware."""
    total = max(1.0, minutes * 60.0)
    for i in range(11):
        r, g, b = color_at(i / 10.0)
        print("%5.1f min  %3d %3d %3d" % (i * total / 600.0, r, g, b))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=30)
    a = ap.parse_args()
    preview(a.minutes)
