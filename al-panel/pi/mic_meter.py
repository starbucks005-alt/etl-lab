#!/usr/bin/env python3
"""Shows how loud her microphone hears the room and a voice, so a missed name can be told from a microphone that is too quiet.

Run on the Pi:  python3 ~/al_panel/mic_meter.py
It stops her for about 15 seconds (the microphone can only be used by one program at a time) and starts her again at the end.
Say "Alice, can you hear me?" when it asks. It prints one reading for every tenth of a second, ten to a row, and then a short summary.
Added 2026-10-07, Dr. O: she did not answer to Astra or Alice and the log could not say whether she was heard."""
import array
import statistics
import subprocess
import sys

DEVICE = "plughw:wm8960soundcard"
SECONDS = 12
BAR = 1726            # the bar she was using at 16:18 on 2026-10-07 (the quietest room reading times three)


def service(action):
    subprocess.run(["sudo", "systemctl", action, "al-panel"], check=False)


def level(buf):
    a = array.array("h")
    a.frombytes(buf[: len(buf) // 2 * 2])
    return (sum(x * x for x in a) / len(a)) ** 0.5 if a else 0.0


def main():
    service("stop")
    proc = None
    try:
        proc = subprocess.Popen(["arecord", "-q", "-D", DEVICE, "-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "raw"],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        print("Be quiet for 3 seconds, then say: Alice, can you hear me?  (%d seconds in all)" % SECONDS, flush=True)
        vals, row = [], []
        for _ in range(SECONDS * 10):
            c = proc.stdout.read(3200)
            if len(c) < 3200:
                break
            v = int(level(c))
            vals.append(v)
            row.append(v)
            if len(row) == 10:
                print(*row, flush=True)
                row = []
    finally:
        if proc:
            proc.terminate()
        service("start")
    if len(vals) < 30:
        print("The microphone gave almost nothing. Is she still running? Try again.")
        return 1
    quiet = int(statistics.median(vals[:30]))
    runs, run = [], 0
    for v in vals:
        run = run + 1 if v > BAR else 0
        runs.append(run)
    print()
    print("Room, the middle reading of the first 3 seconds: %d" % quiet)
    print("Loudest tenth of a second: %d" % max(vals))
    print("Longest stretch above %d: %.1f seconds (she needs at least 0.2 seconds to start listening)" % (BAR, max(runs) / 10.0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
