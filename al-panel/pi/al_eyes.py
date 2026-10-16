#!/usr/bin/env python3
"""Drives AL's two eye rings (16 lights each, chained, data on GPIO12).

Reads /tmp/al_eyes.json, which the panel server writes, and shows that color.
Needs root for the lights:   sudo python3 ~/al_panel/al_eyes.py
The server already caps the level at 30 percent, and this clamps it again.
"""
import json
import os
import time

from rpi_ws281x import Color, PixelStrip

from al_eyes_math import eye_level, strip_frame

EYE_LEDS = 32       # two rings of 16
HERE = os.path.dirname(os.path.abspath(__file__))


def _strip_leds():
    """A light strip chained after the eye rings (a Guardian). A file called strip_leds next to this one holds how many lights it has; no file, no strip."""
    try:
        return max(0, min(144, int(open(os.path.join(HERE, "strip_leds")).read().strip())))
    except (OSError, ValueError):
        return 0


STRIP = _strip_leds()
LED_COUNT = EYE_LEDS + STRIP
LED_PIN = 12        # GPIO12, physical pin 32
strip = PixelStrip(LED_COUNT, LED_PIN, 800000, 10, False, 255, 0)
strip.begin()

DEFAULT = {"r": 31, "g": 183, "b": 201, "level": 0.12}
REFRESH_SECONDS = 2   # the rings forget their color when they lose power, so it is sent again every few seconds
last = None
last_sent = 0.0
last_lvl = None
last_frame = None
BREATHE = not os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)), "eyes_still"))   # a file called eyes_still next to this one turns the slow breathing off
while True:
    try:
        with open("/tmp/al_eyes.json") as f:
            d = json.load(f)
    except Exception:
        d = DEFAULT
    now_t = time.time()
    lvl = round(eye_level(d, now_t, BREATHE), 3)
    frame = [round(v, 2) for v in strip_frame(STRIP, now_t, bool(d.get("speaking")))] if STRIP else []
    if lvl != last_lvl or d != last or frame != last_frame or now_t - last_sent > REFRESH_SECONDS:
        c = Color(int(d["r"] * lvl), int(d["g"] * lvl), int(d["b"] * lvl))
        for i in range(EYE_LEDS):
            strip.setPixelColor(i, c)
        slvl = max(0.0, min(0.30, float(d.get("level", 0.12)) * 1.6))        # the strip is capped like the eyes, a little brighter so it reads from across a room
        for j, v in enumerate(frame):
            strip.setPixelColor(EYE_LEDS + j, Color(int(d["r"] * slvl * v), int(d["g"] * slvl * v), int(d["b"] * slvl * v)))
        strip.show()
        last_frame = frame
        last = d
        last_lvl = lvl
        last_sent = time.time()
    time.sleep(0.05)
