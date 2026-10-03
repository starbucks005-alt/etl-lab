#!/usr/bin/env python3
"""Shows when AL's motion sensor sees someone (HC-SR501, signal wire on GPIO13).

GPIO13 is the second signal pin of the GPIO12 socket on the HAT, so the sensor
shares the one 4-wire cable with the eye lights (GPIO12). Not tested on AL yet.

Run it by hand to check the wiring:   python3 ~/al_panel/al_motion.py
No sudo needed. Stop it with Ctrl+C.

The sensor needs about a minute after power-up before it settles. Wave a hand
in front of the dome. It should print MOTION, then STILL after its delay.
"""
import time

from gpiozero import MotionSensor

PIN = 13            # GPIO13, physical pin 33
WARM_UP_SECONDS = 60

pir = MotionSensor(PIN, queue_len=1, sample_rate=10, threshold=0.5)

print(f"Warming up for {WARM_UP_SECONDS} seconds. Keep out of its view.")
time.sleep(WARM_UP_SECONDS)
print("Ready. Wave a hand in front of the dome. Ctrl+C to stop.")

was = False
while True:
    now = pir.motion_detected
    if now != was:
        print(time.strftime("%H:%M:%S"), "MOTION" if now else "STILL")
        was = now
    time.sleep(0.1)
