#!/usr/bin/env python3
"""Shows how loud her microphone hears the room and a voice, so a missed name can be told from a microphone that is too quiet.

Run on the Pi:  python3 ~/al_panel/mic_meter.py
It stops her for about 15 seconds (the microphone can only be used by one program at a time) and starts her again at the end.
When it says NOW, count out loud from one to ten, at the voice you would use to talk to her, until it stops. It prints one reading for every tenth of a second, ten to a row, and then a short summary.
Added 2026-10-07, Dr. O: she did not answer to Astra or Alice and the log could not say whether she was heard."""
import array
import os
import statistics
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import al_bands            # the same band check robot Alice listens with, so this shows what she would do
except Exception:
    al_bands = None

def pick_device():
    """The device named on the command line, else the one in the mic_device file next to the server, else the HAT's own."""
    if len(sys.argv) > 1:
        return sys.argv[1]
    try:
        d = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "mic_device")).read().strip()
        if d:
            return d
    except OSError:
        pass
    return "plughw:wm8960soundcard"


DEVICE = pick_device()
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
        print("Listening with: %s" % DEVICE, flush=True)
        print("Stay quiet for %d seconds. When the line NOW appears, count out loud from one to ten, then again, until it stops." % QUIET, flush=True)
        vals, row, bandvals = [], [], []
        bands = al_bands.Bands() if al_bands else None
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
            if bands:
                a = array.array("h")
                a.frombytes(c)
                bandvals.append([al_bands.to_db(x) for x in bands.levels(a)])
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
    if bandvals:
        # how loud each band is in the quiet time (the middle reading), and how far the voice goes above it (the 80th percentile)
        qd = [sorted(b[i] for b in bandvals[2:n])[len(bandvals[2:n]) // 2] for i in range(len(al_bands.CENTERS))]
        vd = [sorted(b[i] for b in bandvals[n:])[int(0.8 * (len(bandvals) - n))] for i in range(len(al_bands.CENTERS))]
        print()
        print("BAND CHECK (decibels; a voice should stand out in the upper bands):")
        print("  band, Hz:           " + "  ".join("%5d" % f for f in al_bands.CENTERS))
        print("  room, quiet time:   " + "  ".join("%5.0f" % x for x in qd))
        print("  voice (80th pct):   " + "  ".join("%5.0f" % x for x in vd))
        print("  voice above room:   " + "  ".join("%+5.0f" % (b - a) for a, b in zip(qd, vd)))
        quiet_hits = sum(1 for b in bandvals[2:n] if al_bands.speechy(b, qd))
        voice_hits = sum(1 for b in bandvals[n:] if al_bands.speechy(b, qd))
        print("  tenths of a second the voice check fired: %d of %d during your voice, %d of %d during the quiet time" % (voice_hits, len(bandvals) - n, quiet_hits, n - 2))
    else:
        print("(al_bands.py is not next to this file, so the band check was skipped)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
