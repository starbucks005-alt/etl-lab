#!/usr/bin/env python3
"""Turns AL's head. Drives the neck servo (MG996R) through the PCA9685 board on channel 8.

The motor moved on the bench on 2026-10-04, found by trying channels one at a time. Run it on the bench first
with the head off the servo.

The panel server asks for a small friendly glance by writing /tmp/al_neck.json.
A motion sensor cannot tell where a person is, so the head does not aim at anyone:
it turns a little to one side, a little to the other, and comes back to the middle.

Setup:   sudo apt install -y python3-pip i2c-tools
         sudo pip3 install adafruit-circuitpython-servokit --break-system-packages
Check:   i2cdetect -y 1        (the PCA9685 shows up as 40)
Bench:   python3 ~/al_panel/al_neck.py --test        (one glance, then stops)
Run:     python3 ~/al_panel/al_neck.py

The head is limited to 60 degrees each side of the middle (90 unless a number was saved with --save). The glance uses 25 unless a smaller number was saved with --save-glance.
"""
import json
import os
import random
import sys
import time

from adafruit_servokit import ServoKit

CHANNEL = 8         # found by trying each channel in turn: the motor moved on 8
MIDDLE_FILE = os.path.expanduser("~/al_neck_middle.txt")   # where the straight ahead number is kept


def read_middle():
    """The angle where her face looks straight ahead. 90 unless a number was saved."""
    try:
        with open(MIDDLE_FILE) as f:
            return max(30, min(150, int(f.read().strip())))
    except Exception:
        return 90


MIDDLE = read_middle()
LIMIT = 60          # the most the head may ever turn from the middle, in degrees
GLANCE_FILE = os.path.expanduser("~/al_neck_glance.txt")   # how far the glance goes each way, if one was saved


def read_glance():
    """How far the glance goes each way, in degrees. 25 unless a number was saved."""
    try:
        with open(GLANCE_FILE) as f:
            return max(0, min(40, int(f.read().strip())))
    except Exception:
        return 25


GLANCE = read_glance()
STEP = 1            # degrees per step
STEP_DELAY = 0.02   # seconds per step, so the head moves slowly and quietly

kit = ServoKit(channels=16)
servo = kit.servo[CHANNEL]
servo.actuation_range = 180
here = MIDDLE


def go(target):
    """Move slowly to the target angle, never past the limit."""
    global here
    target = max(max(0, MIDDLE - LIMIT), min(min(180, MIDDLE + LIMIT), target))
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


def argument(flag):
    """The number after a flag, such as --hold 100, or None."""
    if flag in sys.argv:
        try:
            return max(30, min(150, int(sys.argv[sys.argv.index(flag) + 1])))
        except (IndexError, ValueError):
            print(flag + " needs a number, for example " + flag + " 100")
            sys.exit(1)
    return None


# Setting the straight ahead number, with no glance:
#   python3 ~/al_panel/al_neck.py --hold 100    moves slowly to 100 and holds for 60 seconds, then lets go
#   python3 ~/al_panel/al_neck.py --save 100    keeps 100 as the straight ahead number
if argument("--hold") is not None:
    # slowly, one degree at a time like the glance: jumping straight to a far number can make the motor strain and buzz without moving
    target = argument("--hold")
    here = MIDDLE
    servo.angle = here
    time.sleep(0.5)
    while here != target:
        here += STEP if target > here else -STEP
        servo.angle = here
        time.sleep(STEP_DELAY)
    time.sleep(60)
    servo.angle = None
    sys.exit(0)
if "--save-glance" in sys.argv:
    try:
        number = max(0, min(40, int(sys.argv[sys.argv.index("--save-glance") + 1])))
    except (IndexError, ValueError):
        print("--save-glance needs a number from 0 to 40, for example --save-glance 12")
        sys.exit(1)
    with open(GLANCE_FILE, "w") as f:
        f.write(str(number))
    print("The glance now goes " + str(number) + " degrees each way. Restart the neck: sudo systemctl restart al-neck")
    sys.exit(0)
if argument("--save") is not None:
    with open(MIDDLE_FILE, "w") as f:
        f.write(str(argument("--save")))
    print("Straight ahead is now " + str(argument("--save")) + ". Restart the neck: sudo systemctl restart al-neck")
    sys.exit(0)

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


SWAY_MAX = 14       # the most a sway turns from the middle, in degrees, and never more than the saved glance size if that is smaller
SWAY_DELAY = 0.04   # seconds per degree: slower than the glance, so it looks like a person turning and not a machine (a turn across the whole room takes a few seconds)
SWAY_FILE = os.path.expanduser("~/al_neck_sway.txt")   # 2026-11-18, Dr. O: ALICE's sway was "too slight". How far the sway turns each way, in degrees, for this robot. Read at the start of every sway, so a new number shows at once.


def read_sway_size():
    """Degrees to the far left and far right of the room sweep: the number in ~/al_neck_sway.txt (4 to 55), else SWAY_MAX. Never past the neck's own limit."""
    try:
        with open(SWAY_FILE) as f:
            return max(4, min(55, LIMIT, int(float(f.read().strip()))))
    except Exception:
        return SWAY_MAX


def sway(started_id, until, standalone=False):
    """2026-11-18, Dr. O: they turn their head back and forth while they talk, so there is life inside them. Slow turns to one side and the other, each a
    different small distance with uneven pauses, until the panel writes sway_stop, a different command arrives, or the time is up. Then it eases back to
    the middle and lets go so the servo does not buzz."""
    global here
    reach = read_sway_size()
    side = random.choice((-1, 1))

    def still_swaying():
        if standalone:              # the bench test: just the clock, no panel needed
            return time.time() < until
        d = read_command()
        return d.get("id") == started_id and d.get("cmd") == "sway" and time.time() < until

    def move_to(target):
        global here
        target = max(max(0, MIDDLE - LIMIT), min(min(180, MIDDLE + LIMIT), target))
        count = 0
        while here != target:
            here += STEP if target > here else -STEP
            servo.angle = here
            time.sleep(SWAY_DELAY)
            count += 1
            if count % 4 == 0 and not still_swaying():
                return False
        return True

    # 2026-11-18, Dr. O: "when humans talk, especially in a crowd, they turn their head so it looks like they are talking to the whole room, not just one individual."
    # So it is not a wobble: she turns to one part of the room, holds there as if speaking to those people, then turns on to another. Five spots across the room (far
    # left, half left, middle, half right, far right; the far ones are the size set for this robot), never the same spot twice in a row, and wide turns are more likely than small ones.
    spots = [-1.0, -0.5, 0.0, 0.5, 1.0]
    at = 2
    servo.angle = here
    ok = True
    while ok and still_swaying():
        choices = [i for i in range(len(spots)) if i != at]
        at = random.choices(choices, weights=[1 + abs(i - at) for i in choices])[0]
        ok = move_to(MIDDLE + int(round(spots[at] * reach)))
        if not ok:
            break
        pause_until = time.time() + random.uniform(1.0, 2.8)       # long enough to look at that part of the room
        while time.time() < pause_until and ok:
            time.sleep(0.1)
            ok = still_swaying()
    go(MIDDLE)
    time.sleep(0.3)
    servo.angle = None


if "--sweep" in sys.argv:
    # Bench test of the room sweep itself, 20 seconds by default: python3 ~/al_panel/al_neck.py --sweep   (or --sweep 40). Stop the neck program first: sudo systemctl stop al-neck
    try:
        seconds = float(sys.argv[sys.argv.index("--sweep") + 1])
    except (IndexError, ValueError):
        seconds = 20.0
    print("Room sweep for %d seconds, up to %d degrees each way." % (seconds, read_sway_size()))
    sway(None, time.time() + seconds, standalone=True)
    sys.exit(0)

last = read_command().get("id")   # a command left over from before we started is ignored
while True:
    d = read_command()
    if d.get("id") != last:
        last = d.get("id")
        if d.get("cmd") == "glance":
            glance()
        elif d.get("cmd") == "sway":
            try:
                sway(d.get("id"), float(d.get("until", 0)))
            except Exception as e:      # a sway problem must never take the neck down
                print("SWAY problem:", str(e)[:100], flush=True)
                try:
                    servo.angle = None
                except Exception:
                    pass
            last = read_command().get("id")      # the command that ended the sway is used up
    time.sleep(0.2)
