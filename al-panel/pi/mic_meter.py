#!/usr/bin/env python3
"""Shows how loud her microphone hears the room and a voice, so a missed name can be told from a microphone that is too quiet.

Run on the Pi:  python3 ~/al_panel/mic_meter.py
It stops her for about 15 seconds (the microphone can only be used by one program at a time) and starts her again at the end.
When it says NOW, count out loud from one to ten, at the voice you would use to talk to her, until it stops. It prints one reading for every tenth of a second, ten to a row, and then a short summary.
Added 2026-10-07, Dr. O: she did not answer to Astra or Alice and the log could not say whether she was heard."""
import array
import statistics
import subprocess
import sys

DEVICE = "plughw:wm8960soundcard"
SECONDS = 15
QUIET = 3             # seconds of quiet first, then the voice
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
        print("Stay quiet for %d seconds. When the line NOW appears, count out loud from one to ten, then again, until it stops." % QUIET, flush=True)
        vals, row = [], []
        for _ in range(SECONDS * 10):
            c = proc.stdout.read(3200)
            if len(c) < 3200:
                break
            if len(vals) == QUIET * 10:
                if row:
                    print(*row, flush=True)
                    row = []
                print(">>> NOW: count out loud, one to ten, then again <<<", flush=True)
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
    if len(vals) < QUIET * 10 + 20:
        print("The microphone gave almost nothing. Is she still running? Try again.")
        return 1
    n = QUIET * 10
    quiet = int(statistics.median(vals[2:n]))      # the first two tenths hold the small pop the microphone makes when it opens
    voice = vals[n:]
    best = max(sum(voice[k:k + 10]) / 10.0 for k in range(max(1, len(voice) - 9)))

    def longest(limit):
        run = top = 0
        for v in voice:
            run = run + 1 if v > limit else 0
            top = max(top, run)
        return top / 10.0
    print()
    print("Room, the middle reading of the quiet time: %d" % quiet)
    print("Your voice, the loudest full second: about %d" % best)
    print("Loudest tenth of a second while you counted: %d" % max(voice))
    print("Longest stretch above 1726: %.1f seconds, above 2500: %.1f seconds (she needs at least 0.2 seconds to start listening)" % (longest(1726), longest(2500)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
