#!/usr/bin/env python3
"""Drives AL's two eye rings (16 lights each, chained, data on GPIO12).

Reads /tmp/al_eyes.json, which the panel server writes, and shows that color.
Needs root for the lights:   sudo python3 ~/al_panel/al_eyes.py
The server already caps the level at 30 percent, and this clamps it again.
"""
import json
import time

from rpi_ws281x import Color, PixelStrip

LED_COUNT = 32      # two rings of 16
LED_PIN = 12        # GPIO12, physical pin 32
strip = PixelStrip(LED_COUNT, LED_PIN, 800000, 10, False, 255, 0)
strip.begin()

DEFAULT = {"r": 31, "g": 183, "b": 201, "level": 0.12}
last = None
while True:
    try:
        with open("/tmp/al_eyes.json") as f:
            d = json.load(f)
    except Exception:
        d = DEFAULT
    if d != last:
        lvl = max(0.0, min(0.30, float(d.get("level", 0.12))))
        c = Color(int(d["r"] * lvl), int(d["g"] * lvl), int(d["b"] * lvl))
        for i in range(LED_COUNT):
            strip.setPixelColor(i, c)
        strip.show()
        last = d
    time.sleep(0.2)
