#!/usr/bin/env python3
"""ALICE's small red light beside her camera eye: it turns on and pulses slowly.

The LED hangs on GPIO12, the yellow wire of the plug in the HAT's GPIO12 socket, and its other wire
goes to ground. ALICE has no eye rings, so nothing else uses GPIO12 on her. Do not run this on a robot
whose eye rings are on GPIO12.

Try it by hand first:   python3 ~/al_panel/al_redled.py     (Ctrl+C stops it and turns the light off)

A file called redled_off next to this one keeps the light dark. Take the file away and restart to bring it back.
"""
import math
import os
import time

from gpiozero import PWMLED

PIN = 12                  # GPIO12, the yellow wire of the HAT's GPIO12 plug
PERIOD_SECONDS = 3.0      # one slow breath in and out
LOW = 0.08                # never fully dark, so it still reads as on
HIGH = 1.0
STEP_SECONDS = 0.02
HERE = os.path.dirname(os.path.abspath(__file__))


def level(t):
    """Brightness from LOW to HIGH, a smooth swell and fade over PERIOD_SECONDS."""
    wave = (1 - math.cos(2 * math.pi * t / PERIOD_SECONDS)) / 2     # 0 to 1 and back
    return LOW + (HIGH - LOW) * wave


def main():
    if os.path.exists(os.path.join(HERE, "redled_off")):
        print("redled_off is there, so the light stays dark", flush=True)
        while True:
            time.sleep(3600)
    led = PWMLED(PIN, frequency=200)
    start = time.time()
    try:
        while True:
            led.value = level(time.time() - start)
            time.sleep(STEP_SECONDS)
    finally:
        led.off()


if __name__ == "__main__":
    main()
