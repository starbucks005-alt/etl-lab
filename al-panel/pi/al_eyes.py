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

from al_eyes_math import eye_level

LED_COUNT = 32      # two rings of 16
LED_PIN = 12        # GPIO12, physical pin 32
strip = PixelStrip(LED_COUNT, LED_PIN, 800000, 10, False, 255, 0)
strip.begin()

DEFAULT = {"r": 31, "g": 183, "b": 201, "level": 0.12}
REFRESH_SECONDS = 2   # the rings forget their color when they lose power, so it is sent again every few seconds
last = None
last_sent = 0.0
last_lvl = None
BREATHE = not os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)), "eyes_still"))   # a file called eyes_still next to this one turns the slow breathing off
while True:
    try:
        with open("/tmp/al_eyes.json") as f:
            d = json.load(f)
    except Exception:
        d = DEFAULT
    lvl = round(eye_level(d, time.time(), BREATHE), 3)
    if lvl != last_lvl or d != last or time.time() - last_sent > REFRESH_SECONDS:
        c = Color(int(d["r"] * lvl), int(d["g"] * lvl), int(d["b"] * lvl))
        for i in range(LED_COUNT):
            strip.setPixelColor(i, c)
        strip.show()
        last = d
        last_lvl = lvl
        last_sent = time.time()
    time.sleep(0.05)
