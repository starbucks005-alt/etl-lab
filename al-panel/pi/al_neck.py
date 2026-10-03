#!/usr/bin/env python3
"""Turns AL's head. Drives the neck servo (MG996R) through the PCA9685 board on channel 0.

NOT TESTED ON AL YET. Run it on the bench first with the head off the servo.

The panel server asks for a small friendly glance by writing /tmp/al_neck.json.
A motion sensor cannot tell where a person is, so the head does not aim at anyone:
it turns a little to one side, a little to the other, and comes back to the middle.

Setup:   sudo apt install -y python3-pip i2c-tools
         sudo pip3 install adafruit-circuitpython-servokit --break-system-packages
Check:   i2cdetect -y 1        (the PCA9685 shows up as 40)
Bench:   python3 ~/al_panel/al_neck.py --test        (one glance, then stops)
Run:     python3 ~/al_panel/al_neck.py

The head is limited to 60 degrees each side of the middle (90). The glance uses 25.
"""
import json
import sys
import time

from adafruit_servokit import ServoKit

CHANNEL = 0
MIDDLE = 90
LIMIT = 60          # the most the head may ever turn from the middle, in degrees
GLANCE = 25         # how far the glance goes each way
STEP = 1            # degrees per step
STEP_DELAY = 0.02   # seconds per step, so the head moves slowly and quietly

kit = ServoKit(channels=16)
servo = kit.servo[CHANNEL]
servo.actuation_range = 180
here = MIDDLE


def go(target):
    """Move slowly to the target angle, never past the limit."""
    global here
    target = max(MIDDLE - LIMIT, min(MIDDLE + LIMIT, target))
    while here != target:
        here += STEP if target > here else -STEP
        servo.angle = here
        time.sleep(STEP_DELAY)


def glance():
    go(MIDDLE + GLANCE)
    time.sleep(0.6)
    go(MIDDLE - GLANCE)
    time.sleep(0.6)
    go(MIDDLE)
    time.sleep(0.3)
    servo.angle = None   # let go so the servo does not buzz while it waits


servo.angle = MIDDLE
time.sleep(0.5)
servo.angle = None

if "--test" in sys.argv:
    glance()
    sys.exit(0)

def read_command():
    try:
        with open("/tmp/al_neck.json") as f:
            return json.load(f)
    except Exception:
        return {}


last = read_command().get("id")   # a command left over from before we started is ignored
while True:
    d = read_command()
    if d.get("id") != last:
        last = d.get("id")
        if d.get("cmd") == "glance":
            glance()
    time.sleep(0.2)
