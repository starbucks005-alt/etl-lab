#!/usr/bin/env python3
"""Drives AL's two eye rings (16 lights each, chained, data on GPIO12).

Reads /tmp/al_eyes.json, which the panel server writes, and shows that color.
Needs root for the lights:   sudo python3 ~/al_panel/al_eyes.py
The server already caps the level at 30 percent, and this clamps it again.
"""
import json
import time

from rpi_ws281x import Color, PixelStrip, ws

LED_COUNT = 32      # two rings of 16
LED_PIN = 12        # GPIO12, physical pin 32
# WS2812 rings take their colors in the order green, red, blue. The library's default is red, green, blue, which
# swapped red and green and made her teal eyes show pink. If a color ever looks wrong again, this is the line.
strip = PixelStrip(LED_COUNT, LED_PIN, 800000, 10, False, 255, 0, ws.WS2811_STRIP_GRB)
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
