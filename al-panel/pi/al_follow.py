#!/usr/bin/env python3
"""Aims the HuskyLens at a face and turns AL's head to the same place, so the two always look the same way.

The HuskyLens sits on a small pan servo (a spare MG90S) on the same servo board as the neck motor.
The HuskyLens says where the biggest face is in its picture. This program turns the pan servo until
that face is in the middle of the picture, then asks the neck to turn to the same angle. Both read the
one number, so they cannot disagree. Both move slowly and quietly, one degree at a time, the way
al_neck.py does, and neither goes more than 60 degrees from the middle.

NOT TRIED on the robot. Written 2026-11-08 from the HuskyLens serial protocol, and the pieces that do not
need the robot are tested (tests/al_follow_test.py). Try it in this order, each step first, nothing moving:

  1. i2cdetect -y 1                    should show 32 (the HuskyLens) and 40 (the servo board).
                                       The HuskyLens must be set to I2C: its menu, General Settings, Protocol Type.
  2. python3 ~/al_panel/al_follow.py --check     asks the HuskyLens to answer and sets it to face recognition.
  3. python3 ~/al_panel/al_follow.py --look      prints what it sees for 20 seconds. Servos do not move.
                                       Stand in front of her and step to YOUR LEFT: it should say "her right".
  4. python3 ~/al_panel/al_follow.py --test      moves the pan servo, then the neck, to her right and left.
                                       Head OFF the neck servo and the HuskyLens off the pan servo for the first try.
  5. python3 ~/al_panel/al_follow.py             follows a face. Stop al-neck first: sudo systemctl stop al-neck

If a servo goes the wrong way: python3 ~/al_panel/al_follow.py --flip pan   (or --flip neck)
If "her right" in --look is the wrong side: python3 ~/al_panel/al_follow.py --flip x
Straight ahead for the pan servo: --hold-pan 100 to try a number, --save-pan-middle 100 to keep it.
The neck keeps using its own straight ahead number from al_neck.py (~/al_neck_middle.txt).
The pan servo is on channel 9 unless --pan-channel N says otherwise (not tried: channel 9 is a guess).

Anything the panel asks of the neck (a friendly glance, by writing /tmp/al_neck.json) still works while no
face is in view. This program does the job of al_neck.py, so only one of the two may run at a time.
"""
import argparse
import json
import os
import sys
import time

HUSKY_ADDRESS = 0x32
HEADER = bytes([0x55, 0xAA, 0x11])
CMD_REQUEST_BLOCKS = 0x21
CMD_RETURN_INFO = 0x29
CMD_RETURN_BLOCK = 0x2A
CMD_KNOCK = 0x2C
CMD_ALGORITHM = 0x2D
CMD_RETURN_OK = 0x2E
FACE_RECOGNITION = 0

PICTURE_WIDTH = 320      # the HuskyLens picture is 320 across by 240 down
SMALLEST_FACE = 20       # blocks narrower or shorter than this many pixels are ignored as noise
NECK_CHANNEL = 8         # same as al_neck.py
LIMIT = 60               # the most either may turn from the middle, in degrees
STEP = 1.0               # degrees per cycle, at most, the same slow pace as the neck
HOME_STEP = 0.5          # going back to the middle after a face is lost, slower still
GAIN = 0.03              # degrees of turn per pixel the face is off center, before the STEP limit
DEADBAND = 18            # a face this many pixels from the middle counts as centered
CYCLE = 0.08             # seconds per look
LOST_AFTER = 4.0         # seconds with no face before she goes back to the middle
REST_AFTER = 2.0         # seconds resting in the middle before the servos let go (so they do not buzz)

CONFIG_FILE = os.path.expanduser("~/al_follow.json")
NECK_MIDDLE_FILE = os.path.expanduser("~/al_neck_middle.txt")
NECK_GLANCE_FILE = os.path.expanduser("~/al_neck_glance.txt")
COMMAND_FILE = "/tmp/al_neck.json"
STATUS_FILE = "/tmp/al_follow.json"
DEFAULTS = {"pan_channel": 9, "pan_middle": 90, "flip_pan": False, "flip_neck": False, "flip_x": False}


# ---- talking to the HuskyLens (no robot needed to test this part) ----

def frame(command, data=b""):
    """One request frame: header, data size, command, data, then the sum of all of that."""
    body = HEADER + bytes([len(data), command]) + bytes(data)
    return body + bytes([sum(body) & 0xFF])


def parse(buffer):
    """Pulls every whole frame with a correct sum out of the bytes. Returns (frames, what is left over)."""
    frames = []
    i = 0
    while i + 6 <= len(buffer):
        if bytes(buffer[i:i + 3]) != HEADER:
            i += 1
            continue
        size = buffer[i + 3]
        end = i + 5 + size + 1
        if end > len(buffer):
            break                       # the rest of it has not arrived yet
        if sum(buffer[i:end - 1]) & 0xFF == buffer[end - 1]:
            frames.append((buffer[i + 4], bytes(buffer[i + 5:i + 5 + size])))
            i = end
        else:
            i += 1                      # a bad sum: skip this header and look for the next
    return frames, bytes(buffer[i:])


def block_from(data):
    """A block is x, y, width, height and ID, each two bytes, low byte first."""
    if len(data) < 10:
        return None
    x, y, w, h, ident = (data[k] | (data[k + 1] << 8) for k in range(0, 10, 2))
    return {"x": x, "y": y, "w": w, "h": h, "id": ident}


class Husky:
    """The HuskyLens over any transport that has write(bytes) and read(n)."""

    def __init__(self, transport, wait=0.4):
        self.transport = transport
        self.wait = wait

    def ask(self, command, data=b"", done=None):
        """Sends a request and collects frames until done(frames) is true. None if it never answers."""
        try:
            self.transport.write(frame(command, data))
            got, buffer = [], b""
            stop = time.time() + self.wait
            while time.time() < stop:
                buffer += self.transport.read(16)
                frames, buffer = parse(buffer)
                got += frames
                if done(got):
                    return got
                time.sleep(0.004)
        except (OSError, RuntimeError):
            return None
        return None

    def knock(self):
        got = self.ask(CMD_KNOCK, done=lambda f: any(c == CMD_RETURN_OK for c, _ in f))
        return got is not None

    def algorithm(self, number):
        got = self.ask(CMD_ALGORITHM, bytes([number & 0xFF, number >> 8]),
                       done=lambda f: any(c == CMD_RETURN_OK for c, _ in f))
        return got is not None

    def blocks(self):
        """Every block it sees, an empty list if none, or None if the HuskyLens did not answer."""
        def done(frames):
            info = [d for c, d in frames if c == CMD_RETURN_INFO]
            if not info or len(info[0]) < 2:
                return False
            wanted = info[0][0] | (info[0][1] << 8)
            return sum(1 for c, _ in frames if c == CMD_RETURN_BLOCK) >= wanted
        got = self.ask(CMD_REQUEST_BLOCKS, done=done)
        if got is None:
            return None
        found = [block_from(d) for c, d in got if c == CMD_RETURN_BLOCK]
        return [b for b in found if b]


class Transport:
    """The HuskyLens on the I2C bus the servo board already uses."""

    def __init__(self, i2c, address=HUSKY_ADDRESS):
        self.i2c = i2c
        self.address = address

    def _locked(self, action):
        while not self.i2c.try_lock():
            time.sleep(0.001)
        try:
            action()
        finally:
            self.i2c.unlock()

    def write(self, data):
        self._locked(lambda: self.i2c.writeto(self.address, bytes(data)))

    def read(self, n):
        buf = bytearray(n)
        self._locked(lambda: self.i2c.readfrom_into(self.address, buf))
        return bytes(buf)


# ---- where to aim (no robot needed to test this part) ----

def biggest(blocks):
    """The biggest face that is not tiny, or None. Bigger means closer."""
    seen = [b for b in blocks if b["w"] >= SMALLEST_FACE and b["h"] >= SMALLEST_FACE]
    return max(seen, key=lambda b: b["w"] * b["h"]) if seen else None


def nudge(offset, x, gain=GAIN, deadband=DEADBAND, step=STEP, limit=LIMIT):
    """The new pan offset, in degrees to her right, after seeing a face at picture column x."""
    error = x - PICTURE_WIDTH / 2
    if abs(error) <= deadband:
        return offset
    move = max(-step, min(step, error * gain))
    return max(-limit, min(limit, offset + move))


def ease(value, target, step):
    """Moves value toward target by at most step."""
    return value + max(-step, min(step, target - value))


def servo_angle(middle, offset, flipped):
    """The angle to send a servo for an offset in degrees to her right, kept inside 0 to 180."""
    return max(0, min(180, middle + (-offset if flipped else offset)))


# ---- settings kept on the Pi ----

def load_config():
    config = dict(DEFAULTS)
    try:
        with open(CONFIG_FILE) as f:
            config.update(json.load(f))
    except Exception:
        pass
    return config


def save_config(config):
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)


def read_number(path, default, low, high):
    try:
        with open(path) as f:
            return max(low, min(high, int(f.read().strip())))
    except Exception:
        return default


def write_status(data):
    """What she sees, for the panel to show later. Written whole and swapped in so nobody reads half of it."""
    try:
        tmp = STATUS_FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f)
        os.replace(tmp, STATUS_FILE)
    except Exception:
        pass


# ---- the robot ----

def open_hardware():
    import board
    import busio
    from adafruit_servokit import ServoKit
    i2c = busio.I2C(board.SCL, board.SDA)
    kit = ServoKit(channels=16, i2c=i2c)
    return i2c, kit


def slow_to(servo, here, target):
    """Moves one degree at a time to the target. Returns where it ended up."""
    here = float(here)
    while abs(here - target) > 0.01:
        here += max(-1.0, min(1.0, target - here))
        servo.angle = here
        time.sleep(0.02)
    return here


def side(x):
    error = x - PICTURE_WIDTH / 2
    return "centered" if abs(error) <= DEADBAND else ("her right" if error > 0 else "her left")


def check():
    import board
    import busio
    i2c = busio.I2C(board.SCL, board.SDA)
    husky = Husky(Transport(i2c))
    if not husky.knock():
        print("The HuskyLens did not answer. Check: i2cdetect -y 1 shows 32, its menu Protocol Type is I2C,")
        print("the blue and green wires are on the I2C socket (swap them if unsure), and it has power.")
        return 1
    print("The HuskyLens answered.")
    print("Set to face recognition." if husky.algorithm(FACE_RECOGNITION) else "It answered, but would not switch to face recognition.")
    return 0


def look(seconds):
    import board
    import busio
    husky = Husky(Transport(busio.I2C(board.SCL, board.SDA)))
    if not husky.algorithm(FACE_RECOGNITION):
        print("The HuskyLens did not answer. Run --check first.")
        return 1
    config = load_config()
    stop = time.time() + seconds
    while time.time() < stop:
        blocks = husky.blocks()
        if blocks is None:
            print("no answer")
        elif not blocks:
            print("sees nothing")
        else:
            for b in blocks:
                x = PICTURE_WIDTH - b["x"] if config["flip_x"] else b["x"]
                print("face at column %d (%s), %d wide, id %d" % (b["x"], side(x), b["w"], b["id"]))
        time.sleep(0.25)
    return 0


def test(config):
    _, kit = open_hardware()
    neck, pan = kit.servo[NECK_CHANNEL], kit.servo[config["pan_channel"]]
    neck.actuation_range = pan.actuation_range = 180
    neck_middle = read_number(NECK_MIDDLE_FILE, 90, 30, 150)
    pan_middle = max(30, min(150, int(config["pan_middle"])))
    for name, servo, middle, flipped in (("pan servo", pan, pan_middle, config["flip_pan"]),
                                         ("neck", neck, neck_middle, config["flip_neck"])):
        print("The " + name + " goes to HER RIGHT (your left as you face her), then her left, then back to the middle.")
        servo.angle = middle
        time.sleep(0.5)
        here = middle
        for offset in (20, -20, 0):
            here = slow_to(servo, here, servo_angle(middle, offset, flipped))
            time.sleep(0.6)
        servo.angle = None
    print("If the pan servo went the wrong way for her right:  python3 al_follow.py --flip pan")
    print("If the neck did:                                    python3 al_follow.py --flip neck")
    return 0


def hold_pan(number, config):
    _, kit = open_hardware()
    pan = kit.servo[config["pan_channel"]]
    pan.actuation_range = 180
    middle = max(30, min(150, int(config["pan_middle"])))
    pan.angle = middle
    time.sleep(0.5)
    slow_to(pan, middle, max(30, min(150, number)))
    time.sleep(60)
    pan.angle = None
    return 0


def run(config):
    i2c, kit = open_hardware()
    neck, pan = kit.servo[NECK_CHANNEL], kit.servo[config["pan_channel"]]
    neck.actuation_range = pan.actuation_range = 180
    neck_middle = read_number(NECK_MIDDLE_FILE, 90, 30, 150)
    pan_middle = max(30, min(150, int(config["pan_middle"])))
    glance_size = read_number(NECK_GLANCE_FILE, 25, 0, 40)
    husky = Husky(Transport(i2c))

    def read_command():
        try:
            with open(COMMAND_FILE) as f:
                return json.load(f)
        except Exception:
            return {}

    last_command = read_command().get("id")      # a command left over from before we started is ignored
    pan_off = neck_off = 0.0
    held = False
    lost_since = time.time()
    resting_since = None
    errors = 0
    last_status = 0.0

    def move():
        nonlocal held
        pan.angle = servo_angle(pan_middle, pan_off, config["flip_pan"])
        neck.angle = servo_angle(neck_middle, neck_off, config["flip_neck"])
        held = True

    def let_go():
        nonlocal held
        pan.angle = None
        neck.angle = None
        held = False

    def glance():
        neck.angle = neck_middle
        here = slow_to(neck, neck_middle, neck_middle + glance_size)
        time.sleep(0.6)
        here = slow_to(neck, here, neck_middle - glance_size)
        time.sleep(0.6)
        slow_to(neck, here, neck_middle)
        time.sleep(0.3)
        neck.angle = None

    # start at the middle, then let go, the same as al_neck.py does
    pan.angle = pan_middle
    neck.angle = neck_middle
    time.sleep(0.5)
    let_go()
    if not husky.algorithm(FACE_RECOGNITION):
        print("The HuskyLens did not answer yet. Still trying.")

    while True:
        started = time.time()
        blocks = husky.blocks()
        if blocks is None:
            errors += 1
            if errors == 10:
                print("The HuskyLens is not answering. Run --check. Still trying.")
            time.sleep(0.5 if errors < 10 else 2.0)
            continue
        if errors >= 10:
            print("The HuskyLens is answering again.")
            husky.algorithm(FACE_RECOGNITION)
        errors = 0

        target = biggest(blocks)
        now = time.time()
        if target:
            x = PICTURE_WIDTH - target["x"] if config["flip_x"] else target["x"]
            pan_off = nudge(pan_off, x)
            neck_off = ease(neck_off, pan_off, STEP)
            move()
            lost_since = None
            resting_since = None
        else:
            if lost_since is None:
                lost_since = now
            if now - lost_since > LOST_AFTER:
                if pan_off or neck_off:
                    pan_off = ease(pan_off, 0.0, HOME_STEP)
                    neck_off = ease(neck_off, 0.0, HOME_STEP)
                    move()
                    resting_since = None
                else:
                    if resting_since is None:
                        resting_since = now
                    if held and now - resting_since > REST_AFTER:
                        let_go()
                    command = read_command()
                    if command.get("id") != last_command:
                        last_command = command.get("id")
                        if command.get("cmd") == "glance":
                            glance()

        if now - last_status > 0.5:
            last_status = now
            write_status({"time": now, "faces": len(blocks), "face": target,
                          "pan": round(pan_off, 1), "neck": round(neck_off, 1)})
        time.sleep(max(0.0, CYCLE - (time.time() - started)))


def main():
    parser = argparse.ArgumentParser(description="Aims the HuskyLens and turns AL's head to the same place.")
    parser.add_argument("--check", action="store_true", help="ask the HuskyLens to answer, then set face recognition")
    parser.add_argument("--look", nargs="?", const=20, type=int, metavar="SECONDS", help="print what it sees, servos still")
    parser.add_argument("--test", action="store_true", help="move the pan servo and the neck to her right and left")
    parser.add_argument("--flip", choices=["pan", "neck", "x"], help="turn that direction around and keep it")
    parser.add_argument("--pan-channel", type=int, help="keep the servo board channel the pan servo is on")
    parser.add_argument("--save-pan-middle", type=int, help="keep the pan servo's straight ahead number (30 to 150)")
    parser.add_argument("--hold-pan", type=int, help="move the pan servo slowly to this number and hold it for a minute")
    args = parser.parse_args()
    config = load_config()

    if args.flip:
        key = "flip_" + args.flip
        config[key] = not config[key]
        save_config(config)
        print("Flipped " + args.flip + ": now " + ("reversed" if config[key] else "normal") + ". Restart: sudo systemctl restart al-follow")
        return 0
    if args.pan_channel is not None:
        config["pan_channel"] = max(0, min(15, args.pan_channel))
        save_config(config)
        print("The pan servo is on channel " + str(config["pan_channel"]) + ".")
        return 0
    if args.save_pan_middle is not None:
        config["pan_middle"] = max(30, min(150, args.save_pan_middle))
        save_config(config)
        print("The pan servo's straight ahead is now " + str(config["pan_middle"]) + ". Restart: sudo systemctl restart al-follow")
        return 0
    if args.check:
        return check()
    if args.look is not None:
        return look(args.look)
    if args.test:
        return test(config)
    if args.hold_pan is not None:
        return hold_pan(args.hold_pan, config)
    run(config)
    return 0


if __name__ == "__main__":
    sys.exit(main())
